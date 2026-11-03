from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def test_content_crud_append_delete_and_reorder(author):
    course = author.course()
    first = author.module(course["id"], "First")
    second = author.module(course["id"], "Second")
    third = author.module(course["id"], "Third")
    assert first["position"] < second["position"] < third["position"]
    order_path = f"courses/{course['id']}/modules/order"
    response = author.request(
        "PUT", order_path, json={"ids": [third["id"], first["id"], second["id"]]}
    )
    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()] == [third["id"], first["id"], second["id"]]
    module_survivor_positions = [
        item["position"] for item in response.json() if item["id"] != second["id"]
    ]
    assert (
        author.request("PATCH", f"modules/{third['id']}", json={"title": " Renamed "}).json()[
            "title"
        ]
        == "Renamed"
    )
    lesson_a = author.lesson(first["id"], title="Lesson A")
    lesson_b = author.lesson(first["id"], title="Lesson B")
    lesson_c = author.lesson(first["id"], title="Lesson C")
    assert lesson_a["position"] < lesson_b["position"] < lesson_c["position"]
    response = author.request(
        "PUT",
        f"modules/{first['id']}/lessons/order",
        json={"ids": [lesson_c["id"], lesson_a["id"], lesson_b["id"]]},
    )
    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()] == [
        lesson_c["id"],
        lesson_a["id"],
        lesson_b["id"],
    ]
    lesson_survivor_positions = [
        item["position"] for item in response.json() if item["id"] != lesson_b["id"]
    ]
    assert (
        author.request(
            "PATCH",
            f"lessons/{lesson_a['id']}",
            json={"title": "Updated", "video_url": "https://example.com/video"},
        ).status_code
        == 200
    )
    assert (
        author.request("PATCH", f"lessons/{lesson_a['id']}", json={"video_url": None}).json()[
            "video_url"
        ]
        is None
    )
    assert author.request("DELETE", f"lessons/{lesson_b['id']}").status_code == 204
    appended_lesson = author.lesson(first["id"])
    assert appended_lesson["position"] > max(lesson_survivor_positions)
    assert author.request("DELETE", f"modules/{second['id']}").status_code == 204
    appended_module = author.module(course["id"])
    persisted = author.request("GET", f"courses/{course['id']}").json()
    assert persisted["modules"][-1]["id"] == appended_module["id"]
    assert appended_module["position"] > max(module_survivor_positions)


@pytest.mark.parametrize("kind", ["modules", "lessons"])
def test_reorder_rejects_duplicate_missing_foreign_ids_atomically(author, kind):
    course = author.course()
    parent = course["id"]
    if kind == "modules":
        first, second = author.module(parent), author.module(parent)
        foreign = author.module(author.course()["id"])
        path = f"courses/{parent}/modules/order"
    else:
        parent = author.module(parent)["id"]
        first, second = author.lesson(parent), author.lesson(parent)
        foreign = author.lesson(author.module(course["id"])["id"])
        path = f"modules/{parent}/lessons/order"
    for ids in [[first["id"], first["id"]], [first["id"]], [second["id"], foreign["id"]], []]:
        response = author.request("PUT", path, json={"ids": ids})
        assert response.status_code == 409, response.text
        persisted = author.request("GET", f"courses/{course['id']}").json()
        items = persisted["modules"]
        if kind == "lessons":
            items = next(item for item in items if item["id"] == parent)["lessons"]
        assert [item["id"] for item in items] == [first["id"], second["id"]]
    assert author.request("PUT", path, json={"ids": [second["id"], first["id"]]}).status_code == 200


def test_child_validation_and_forbidden_parent_position_fields(author):
    course = author.course()
    module = author.module(course["id"])
    lesson = author.lesson(module["id"])
    for payload in [
        {"title": " "},
        {"title": None},
        {"title": "Valid", "position": 99},
        {"title": "Valid", "course_id": course["id"]},
    ]:
        assert (
            author.request("POST", f"courses/{course['id']}/modules", json=payload).status_code
            == 422
        )
    for payload in [
        {"title": " "},
        {"title": None},
        {"content": None},
        {"position": 4},
        {"module_id": module["id"]},
        {"video_url": "javascript:alert(1)"},
        {"video_url": "file:///private/file"},
    ]:
        assert author.request("PATCH", f"lessons/{lesson['id']}", json=payload).status_code == 422
    assert (
        author.request("PATCH", f"modules/{module['id']}", json={"position": 8}).status_code == 422
    )


def test_concurrent_module_appends_have_distinct_ordered_positions(author, course_client, actors):
    course = author.course()
    barrier = Barrier(2)

    def append(index):
        with TestClient(course_client.app) as client:
            barrier.wait(timeout=10)
            response = client.post(
                f"/api/v1/instructor/courses/{course['id']}/modules",
                json={"title": f"Concurrent {index}"},
                headers=actors["owner"]["headers"],
            )
            assert response.status_code == 201, response.text
            return response.json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        items = list(pool.map(append, range(2)))
    assert len({item["position"] for item in items}) == 2
    persisted = author.request("GET", f"courses/{course['id']}").json()["modules"]
    assert {item["id"] for item in persisted} == {item["id"] for item in items}
    assert [item["position"] for item in persisted] == sorted(item["position"] for item in items)
