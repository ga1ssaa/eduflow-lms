from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.courses.schemas import Level, ModuleOutline, ReadModel, Status


class EmptyBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EnrollmentRead(ReadModel):
    id: UUID
    student_id: UUID
    course_id: UUID
    enrolled_at: datetime


class CourseProgress(ReadModel):
    course_id: UUID
    total_lessons: int
    completed_lessons: int
    progress_percentage: float
    is_completed: bool


class EnrolledCourseSummary(CourseProgress):
    enrollment_id: UUID
    title: str
    slug: str
    description: str
    category: str
    level: Level
    status: Status
    is_available: bool
    instructor_name: str
    enrolled_at: datetime


class EnrolledCoursePage(ReadModel):
    items: list[EnrolledCourseSummary]
    total: int
    page: int
    page_size: int


class StudentCourseRead(EnrolledCourseSummary):
    modules: list[ModuleOutline]
    progress: CourseProgress


class StudentLessonRead(ReadModel):
    id: UUID
    title: str
    content: str
    video_url: str | None
    position: int
    course_id: UUID
    module_id: UUID
    module_title: str
    course_title: str
    is_completed: bool
    completed_at: datetime | None


class CompletionRead(ReadModel):
    lesson_id: UUID
    is_completed: bool
    completed_at: datetime | None
    progress: CourseProgress


class StudentDashboard(ReadModel):
    total_enrolled_courses: int
    completed_courses: int
    in_progress_courses: int
    courses: list[EnrolledCourseSummary]


class InstructorStudentRead(ReadModel):
    student_id: UUID
    full_name: str
    enrollment_id: UUID
    enrolled_at: datetime
    total_lessons: int
    completed_lessons: int
    progress_percentage: float
    is_completed: bool


class InstructorStudentPage(ReadModel):
    items: list[InstructorStudentRead]
    total: int
    page: int
    page_size: int


class CourseStats(ReadModel):
    course_id: UUID
    total_students: int
    completed_students: int
    in_progress_students: int
    average_progress_percentage: float
    total_lessons: int
