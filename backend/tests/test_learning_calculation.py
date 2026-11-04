import pytest

from app.learning.service import _progress_values, percentage


@pytest.mark.parametrize(
    "completed,total,expected",
    [(0, 0, 0), (0, 3, 0), (1, 3, 33.33), (2, 3, 66.67), (7, 10, 70), (1, 32, 3.13)],
)
def test_documented_decimal_rounding(completed, total, expected):
    assert percentage(completed, total) == expected


def test_rounded_percentage_cannot_prematurely_complete_a_course():
    progress = _progress_values({"total_lessons": 20000, "completed_lessons": 19999})
    assert progress["progress_percentage"] == 100
    assert progress["is_completed"] is False
