from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.auth.models import User
from app.courses import service
from app.courses.models import Course
from app.db.session import get_session_factory

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("public", [True, False])
def test_detail_snapshot_blocks_concurrent_unpublish_or_deletion(author, actors, public):
    course, _, _ = author.ready()
    assert author.request("POST", f"courses/{course['id']}/publish").status_code == 200
    course_id = UUID(course["id"])
    with get_session_factory()() as reader:
        if public:
            snapshot = service.public_course(reader, course["slug"])
        else:
            owner = reader.get(User, UUID(actors["owner"]["id"]))
            snapshot = service.get_course(reader, owner, course_id)
        assert snapshot.id == course_id
        with get_session_factory()() as writer:
            with pytest.raises(OperationalError) as blocked:
                writer.execute(
                    select(Course.id).where(Course.id == course_id).with_for_update(nowait=True)
                )
            assert blocked.value.orig.sqlstate == "55P03"
    with get_session_factory()() as writer:
        assert (
            writer.scalar(
                select(Course.id).where(Course.id == course_id).with_for_update(nowait=True)
            )
            == course_id
        )


@pytest.mark.parametrize(
    "operation",
    [
        "create",
        "course",
        "module_create",
        "module",
        "lesson_create",
        "lesson",
        "modules_order",
        "lessons_order",
        "publish",
    ],
)
def test_committed_response_survives_interleaved_course_deletion(author, actors, operation):
    course, module, lesson = author.ready()
    paths = {
        "create": ("POST", "courses", {"title": "Snapshot", "slug": f"snapshot-{uuid4().hex}"}),
        "course": ("PATCH", f"courses/{course['id']}", {"title": "Snapshot"}),
        "module_create": ("POST", f"courses/{course['id']}/modules", {"title": "Snapshot"}),
        "module": ("PATCH", f"modules/{module['id']}", {"title": "Snapshot"}),
        "lesson_create": (
            "POST",
            f"modules/{module['id']}/lessons",
            {"title": "Snapshot", "content": "Body"},
        ),
        "lesson": ("PATCH", f"lessons/{lesson['id']}", {"title": "Snapshot"}),
        "modules_order": ("PUT", f"courses/{course['id']}/modules/order", {"ids": [module["id"]]}),
        "lessons_order": ("PUT", f"modules/{module['id']}/lessons/order", {"ids": [lesson["id"]]}),
        "publish": ("POST", f"courses/{course['id']}/publish", None),
    }
    deleted = []

    def delete_after_commit(session):
        if deleted:
            return
        # Emulate another authorized request immediately after the database commit.
        # Use the real feature service, scoped to fixture-created test records only.
        target = next(item for item in session.identity_map.values() if isinstance(item, Course))
        deleted.append(target.id)
        with get_session_factory()() as other:
            owner = other.get(User, UUID(actors["owner"]["id"]))
            service.set_publication(other, owner, target.id, published=False)
            service.delete_course(other, owner, target.id)

    event.listen(Session, "after_commit", delete_after_commit)
    try:
        method, path, payload = paths[operation]
        response = author.request(method, path, json=payload)
    finally:
        event.remove(Session, "after_commit", delete_after_commit)
    assert response.status_code == (201 if method == "POST" and operation != "publish" else 200)
    assert response.json()
    assert len(deleted) == 1
    assert author.request("GET", f"courses/{deleted[0]}").status_code == 404


@pytest.mark.parametrize("field", ["title", "description", "category", "slug"])
def test_course_nul_input_is_rejected_before_postgres(author, field):
    response = author.request(
        "POST",
        "courses",
        json={"title": "Valid", "slug": f"nul-{uuid4().hex}", field: "bad\x00text"},
    )
    assert response.status_code == 422


def test_lesson_nul_and_search_nul_are_validation_errors(author, course_client):
    course = author.course()
    module = author.module(course["id"])
    assert (
        author.request(
            "POST",
            f"modules/{module['id']}/lessons",
            json={"title": "Valid", "content": "bad\x00text"},
        ).status_code
        == 422
    )
    for field in ("search", "category"):
        assert (
            course_client.get("/api/v1/courses", params={field: "bad\x00text"}).status_code == 422
        )
    assert course_client.get("/api/v1/courses/bad%00slug").status_code == 422
