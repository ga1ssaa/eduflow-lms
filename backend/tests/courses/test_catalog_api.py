from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import event, update

from app.db.session import get_engine, get_session_factory

pytestmark = pytest.mark.integration


def assert_public_safe(value):
    if isinstance(value, dict):
        assert not {"content", "video_url", "password_hash", "token_hash"} & value.keys()
        for child in value.values():
            assert_public_safe(child)
    elif isinstance(value, list):
        for child in value:
            assert_public_safe(child)


def test_catalog_filters_counts_outline_and_private_content(author, actors, course_client):
    marker = uuid4().hex
    course, module, lesson = author.ready(title=f"Unique {marker}")
    author.lesson(module["id"], title="Second", video_url="https://example.com/private-video")
    author.module(course["id"], "Empty module")
    hidden = author.course(title=f"Hidden {marker}")
    assert author.request("POST", f"courses/{course['id']}/publish").status_code == 200
    response = course_client.get("/api/v1/courses", params={"search": marker})
    assert response.status_code == 200
    catalog = response.json()
    assert catalog["total"] == 1
    assert catalog["page"] == 1 and catalog["page_size"] == 20
    assert len(catalog["items"]) == 1
    summary = catalog["items"][0]
    assert summary["id"] == course["id"]
    assert summary["instructor_name"] == actors["owner"]["name"]
    assert summary["module_count"] == 2
    assert summary["lesson_count"] == 2
    assert_public_safe(catalog)
    detail = course_client.get(f"/api/v1/courses/{course['slug']}")
    assert detail.status_code == 200
    assert_public_safe(detail.json())
    assert "Private lesson body" not in detail.text
    assert "private-video" not in detail.text
    assert detail.json()["modules"][0]["lessons"][0]["id"] == lesson["id"]
    assert course_client.get(f"/api/v1/courses/{hidden['slug']}").status_code == 404
    for filters, expected in [
        ({"category": "qa", "level": "beginner"}, 1),
        ({"category": "no-such-category"}, 0),
        ({"level": "advanced"}, 0),
    ]:
        response = course_client.get("/api/v1/courses", params={"search": marker, **filters})
        assert response.status_code == 200
        assert response.json()["total"] == expected


def test_pagination_deterministic_tied_creation_dates(author, course_client):
    from app.courses.models import Course

    marker = uuid4().hex
    ids = []
    for index in range(3):
        course, _, _ = author.ready(title=f"{marker} course {index}")
        assert author.request("POST", f"courses/{course['id']}/publish").status_code == 200
        ids.append(course["id"])
    with get_session_factory()() as db:
        db.execute(
            update(Course)
            .where(Course.id.in_(ids))
            .values(created_at=datetime(2026, 1, 1, tzinfo=UTC))
        )
        db.commit()
    seen = []
    for page in range(1, 4):
        response = course_client.get(
            "/api/v1/courses", params={"search": marker, "page": page, "page_size": 1}
        )
        assert response.status_code == 200
        result = response.json()
        assert result["total"] == 3
        assert result["page"] == page and result["page_size"] == 1
        seen.extend(item["id"] for item in result["items"])
    assert seen == sorted(ids)
    assert (
        course_client.get(
            "/api/v1/courses", params={"search": marker, "page": 4, "page_size": 1}
        ).json()["items"]
        == []
    )


def test_catalog_query_count_does_not_grow_per_course(author, course_client):
    marker = uuid4().hex
    for index in range(4):
        course, _, _ = author.ready(title=f"{marker} bounded {index}")
        assert author.request("POST", f"courses/{course['id']}/publish").status_code == 200
    queries = []

    def collect(connection, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            queries.append(statement)

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", collect)
    try:
        response = course_client.get("/api/v1/courses", params={"search": marker.upper()})
    finally:
        event.remove(engine, "before_cursor_execute", collect)
    assert response.status_code == 200
    assert response.json()["total"] == 4
    # Count plus one aggregated page query; allow setup overhead without allowing N+1.
    assert len(queries) <= 3, queries


@pytest.mark.parametrize(
    "params",
    [{"page": 0}, {"page": -1}, {"page_size": 0}, {"page_size": 101}, {"level": "invalid"}],
)
def test_catalog_rejects_invalid_filters_and_pagination(course_client, params):
    assert course_client.get("/api/v1/courses", params=params).status_code == 422
