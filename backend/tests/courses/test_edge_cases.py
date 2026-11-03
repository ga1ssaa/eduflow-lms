from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_session_factory

pytestmark = pytest.mark.integration


def test_admin_creation_ownership_and_moderation_access(author, actors, course_client):
    marker = uuid4().hex
    response = author.request(
        "POST",
        "courses",
        actor="admin",
        json={"title": f"Admin {marker}", "slug": f"qa-{uuid4().hex}"},
    )
    assert response.status_code == 201, response.text
    own = response.json()
    assert own["instructor_id"] == actors["admin"]["id"]
    assert own["id"] in {
        item["id"] for item in author.request("GET", "courses", actor="admin").json()["items"]
    }
    course, _, _ = author.ready(title=f"Instructor {marker}")
    for actor in ["owner", "student"]:
        for method, path in [
            ("GET", "/api/v1/admin/courses"),
            ("GET", f"/api/v1/admin/courses/{course['id']}"),
            ("POST", f"/api/v1/admin/courses/{course['id']}/publish"),
            ("POST", f"/api/v1/admin/courses/{course['id']}/unpublish"),
        ]:
            assert (
                course_client.request(method, path, headers=actors[actor]["headers"]).status_code
                == 403
            )
    admin_page = course_client.get(
        "/api/v1/admin/courses", params={"search": marker}, headers=actors["admin"]["headers"]
    )
    assert admin_page.status_code == 200
    assert admin_page.json()["total"] == 2
    assert {item["id"] for item in admin_page.json()["items"]} == {own["id"], course["id"]}
    assert (
        course_client.get(
            f"/api/v1/admin/courses/{course['id']}", headers=actors["admin"]["headers"]
        ).json()["instructor_id"]
        == actors["owner"]["id"]
    )


def test_slug_collision_patch_is_atomic_and_session_remains_usable(author):
    first = author.course(title="Original")
    second = author.course()
    response = author.request(
        "PATCH", f"courses/{first['id']}", json={"title": "Must roll back", "slug": second["slug"]}
    )
    assert response.status_code == 409
    persisted = author.request("GET", f"courses/{first['id']}").json()
    assert persisted["title"] == "Original"
    assert persisted["slug"] == first["slug"]
    assert (
        author.request(
            "PATCH", f"courses/{first['id']}", json={"title": "Valid subsequent write"}
        ).status_code
        == 200
    )


def test_middle_child_deletion_compacts_order_and_module_delete_cascades(author):
    from app.courses.models import Lesson

    course = author.course()
    modules = [author.module(course["id"], f"Module {index}") for index in range(3)]
    lessons = [author.lesson(modules[0]["id"], title=f"Lesson {index}") for index in range(3)]
    removed_module_lesson = author.lesson(modules[1]["id"])
    assert author.request("DELETE", f"lessons/{lessons[1]['id']}").status_code == 204
    assert author.request("DELETE", f"modules/{modules[1]['id']}").status_code == 204
    persisted = author.request("GET", f"courses/{course['id']}").json()
    assert [module["id"] for module in persisted["modules"]] == [modules[0]["id"], modules[2]["id"]]
    assert [module["position"] for module in persisted["modules"]] == [1, 2]
    surviving_lessons = persisted["modules"][0]["lessons"]
    assert [lesson["id"] for lesson in surviving_lessons] == [lessons[0]["id"], lessons[2]["id"]]
    assert [lesson["position"] for lesson in surviving_lessons] == [1, 2]
    with get_session_factory()() as db:
        assert db.get(Lesson, UUID(removed_module_lesson["id"])) is None
    assert author.module(course["id"])["position"] == 3
    assert author.lesson(modules[0]["id"])["position"] == 3


def test_published_empty_new_lesson_rejected_without_changing_outline(author):
    course, module, original = author.ready()
    path = f"courses/{course['id']}"
    assert author.request("POST", f"{path}/publish").status_code == 200
    response = author.request(
        "POST", f"modules/{module['id']}/lessons", json={"title": "Empty rejected lesson"}
    )
    assert response.status_code == 409, response.text
    persisted = author.request("GET", path).json()
    assert persisted["status"] == "published"
    assert [item["id"] for item in persisted["modules"][0]["lessons"]] == [original["id"]]
    assert author.lesson(module["id"], title="Valid subsequent lesson")["position"] == 2


def test_video_only_publication_and_clearing_video_rolls_back(author, course_client):
    course = author.course(description="Video course", category="video")
    module = author.module(course["id"])
    lesson = author.lesson(module["id"], content="", video_url="https://example.com/video")
    assert author.request("POST", f"courses/{course['id']}/publish").status_code == 200
    assert course_client.get(f"/api/v1/courses/{course['slug']}").status_code == 200
    response = author.request("PATCH", f"lessons/{lesson['id']}", json={"video_url": None})
    assert response.status_code == 409
    persisted = author.request("GET", f"courses/{course['id']}").json()
    assert persisted["modules"][0]["lessons"][0]["video_url"] == "https://example.com/video"
    assert persisted["status"] == "published"


@pytest.mark.parametrize("symbol", ["%", "_"])
def test_catalog_search_treats_sql_wildcards_literally(author, course_client, symbol):
    marker = uuid4().hex
    exact, _, _ = author.ready(title=f"{marker}{symbol}literal")
    decoy, _, _ = author.ready(title=f"{marker}Xliteral")
    for course in [exact, decoy]:
        assert author.request("POST", f"courses/{course['id']}/publish").status_code == 200
    response = course_client.get("/api/v1/courses", params={"search": f"{marker}{symbol}"})
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert [item["id"] for item in response.json()["items"]] == [exact["id"]]


def test_concurrent_lesson_appends_serialize_order(author, actors, course_client):
    course = author.course()
    module = author.module(course["id"])
    barrier = Barrier(2)

    def append(index):
        with TestClient(course_client.app) as client:
            barrier.wait(timeout=10)
            response = client.post(
                f"/api/v1/instructor/modules/{module['id']}/lessons",
                json={"title": f"Concurrent lesson {index}", "content": "Body"},
                headers=actors["owner"]["headers"],
            )
            assert response.status_code == 201, response.text
            return response.json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        created = list(pool.map(append, range(2)))
    assert {item["position"] for item in created} == {1, 2}
    persisted = author.request("GET", f"courses/{course['id']}").json()["modules"][0]["lessons"]
    assert {item["id"] for item in persisted} == {item["id"] for item in created}
    assert [item["position"] for item in persisted] == [1, 2]
