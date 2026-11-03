from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.auth.models import User
from app.db.session import get_session_factory

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("actor,expected", [(None, 401), ("student", 403), ("inactive", 401)])
def test_authoring_rejects_unauthorized_actors(course_client, actors, actor, expected):
    headers = actors[actor]["headers"] if actor else {}
    for method, path, payload in [
        ("GET", "/api/v1/instructor/courses", None),
        ("POST", "/api/v1/instructor/courses", {"title": "Denied", "slug": "denied"}),
        ("GET", "/api/v1/admin/courses", None),
    ]:
        response = course_client.request(method, path, headers=headers, json=payload)
        assert response.status_code == expected


@pytest.mark.parametrize(
    "overrides",
    [
        {"title": " "},
        {"title": None},
        {"slug": " "},
        {"slug": "bad/slug"},
        {"slug": "bad_slug"},
        {"slug": "Uppercase"},
        {"slug": " padded "},
        {"slug": None},
        {"description": None},
        {"category": None},
        {"level": "expert"},
        {"level": None},
        {"status": "published"},
        {"instructor_id": str(uuid4())},
        {"role": "admin"},
        {"published_at": "2025-01-01"},
    ],
)
def test_create_rejects_invalid_and_privileged_fields(author, overrides):
    response = author.request(
        "POST", "courses", json={"title": "Valid", "slug": f"qa-{uuid4().hex}", **overrides}
    )
    assert response.status_code == 422, response.text


def test_course_defaults_normalization_ownership_and_slug_collision(author, actors):
    slug = f"qa-{uuid4().hex}"
    course = author.course(title="  Trimmed title  ", slug=slug)
    assert course["title"] == "Trimmed title"
    assert course["slug"] == slug
    assert course["status"] == "draft"
    assert course["level"] == "beginner"
    assert course["instructor_id"] == actors["owner"]["id"]
    assert course["published_at"] is None
    duplicate = author.request("POST", "courses", json={"title": "Other", "slug": slug})
    assert duplicate.status_code == 409
    assert (
        author.request("PATCH", f"courses/{course['id']}", json={"title": "Updated"}).status_code
        == 200
    )


def test_required_fields_and_null_patch(author):
    for payload in [{}, {"title": "Title"}, {"slug": "slug-only"}]:
        assert author.request("POST", "courses", json=payload).status_code == 422
    course = author.course()
    for field in ["title", "slug", "description", "category", "level"]:
        response = author.request("PATCH", f"courses/{course['id']}", json={field: None})
        assert response.status_code == 422


def test_ownership_admin_moderation_and_role_read_from_database(author, actors, course_client):
    course, module, lesson = author.ready()
    for method, path, payload in [
        ("GET", f"courses/{course['id']}", None),
        ("PATCH", f"courses/{course['id']}", {"title": "Stolen"}),
        ("DELETE", f"courses/{course['id']}", None),
        ("POST", f"courses/{course['id']}/publish", None),
        ("POST", f"courses/{course['id']}/modules", {"title": "Stolen"}),
        ("PATCH", f"modules/{module['id']}", {"title": "Stolen"}),
        ("DELETE", f"lessons/{lesson['id']}", None),
    ]:
        response = author.request(method, path, actor="other", json=payload)
        assert response.status_code in {403, 404}, response.text
    listing = author.request("GET", "courses", actor="other").json()
    assert course["id"] not in {item["id"] for item in listing["items"]}
    assert author.request("GET", f"courses/{course['id']}", actor="admin").status_code == 200
    assert (
        author.request(
            "PATCH", f"lessons/{lesson['id']}", actor="admin", json={"title": "Admin edited"}
        ).status_code
        == 200
    )
    admin_list = author.request("GET", "courses", actor="admin").json()
    assert course["id"] not in {item["id"] for item in admin_list["items"]}
    headers = actors["admin"]["headers"]
    assert (
        course_client.get(f"/api/v1/admin/courses/{course['id']}", headers=headers).status_code
        == 200
    )
    assert (
        course_client.post(
            f"/api/v1/admin/courses/{course['id']}/publish", headers=headers
        ).status_code
        == 200
    )
    assert (
        course_client.post(
            f"/api/v1/admin/courses/{course['id']}/unpublish", headers=headers
        ).status_code
        == 200
    )
    with get_session_factory()() as db:
        db.get(User, UUID(actors["owner"]["id"])).role = "student"
        db.commit()
    assert author.request("GET", f"courses/{course['id']}").status_code == 403


def test_publish_validation_idempotency_unpublish_and_published_edit_rollback(
    author, course_client
):
    course = author.course()
    path = f"courses/{course['id']}"
    assert author.request("POST", f"{path}/publish").status_code == 409
    assert course_client.get(f"/api/v1/courses/{course['slug']}").status_code == 404
    author.request("PATCH", path, json={"description": "Description", "category": "qa"})
    module = author.module(course["id"])
    assert author.request("POST", f"{path}/publish").status_code == 409
    lesson = author.lesson(module["id"], content="")
    assert author.request("POST", f"{path}/publish").status_code == 409
    assert (
        author.request(
            "PATCH", f"lessons/{lesson['id']}", json={"content": "Secret course body"}
        ).status_code
        == 200
    )
    published = author.request("POST", f"{path}/publish")
    assert published.status_code == 200, published.text
    published_at = published.json()["published_at"]
    assert published_at
    assert author.request("POST", f"{path}/publish").json()["published_at"] == published_at
    for method, target, payload in [
        ("PATCH", path, {"description": ""}),
        ("PATCH", f"lessons/{lesson['id']}", {"content": "", "video_url": None}),
        ("DELETE", f"modules/{module['id']}", None),
        ("DELETE", f"lessons/{lesson['id']}", None),
        ("DELETE", path, None),
    ]:
        assert author.request(method, target, json=payload).status_code == 409
    persisted = author.request("GET", path).json()
    assert persisted["description"] == "Description"
    assert persisted["modules"][0]["lessons"][0]["content"] == "Secret course body"
    assert author.request("POST", f"{path}/unpublish").json()["published_at"] is None
    assert author.request("POST", f"{path}/unpublish").status_code == 200
    assert course_client.get(f"/api/v1/courses/{course['slug']}").status_code == 404
    assert author.request("DELETE", path).status_code == 204
    assert author.request("GET", path).status_code == 404
    assert (
        author.request("PATCH", f"lessons/{lesson['id']}", json={"title": "Gone"}).status_code
        == 404
    )


def test_concurrent_slug_creation_has_one_winner(author, actors, course_client):
    barrier = Barrier(2)
    payload = {"title": "Race course", "slug": f"race-{uuid4().hex}"}

    def create(_):
        with TestClient(course_client.app) as client:
            barrier.wait(timeout=10)
            return client.post(
                "/api/v1/instructor/courses", json=payload, headers=actors["owner"]["headers"]
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(create, range(2))) == [201, 409]


@pytest.mark.parametrize("method", ["PATCH", "PUT", "DELETE"])
def test_browser_authoring_preflight(course_client, method):
    response = course_client.options(
        "/api/v1/instructor/courses",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
