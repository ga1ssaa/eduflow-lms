from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    StringConstraints,
    field_validator,
    model_validator,
)

Level = Literal["beginner", "intermediate", "advanced"]
Status = Literal["draft", "published"]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Slug = Annotated[
    str, StringConstraints(min_length=1, max_length=200, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=100000)]
Category = Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)]
Content = Annotated[str, StringConstraints(strip_whitespace=True, max_length=100000)]


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("*", mode="before")
    @classmethod
    def reject_nul(cls, value: object) -> object:
        if isinstance(value, str) and "\x00" in value:
            raise ValueError("Text must not contain NUL characters")
        return value

    @model_validator(mode="before")
    @classmethod
    def forbid_null(cls, value: object) -> object:
        if isinstance(value, dict) and any(
            field_value is None and key != "video_url" for key, field_value in value.items()
        ):
            raise ValueError("Fields cannot be null")
        return value


class CourseCreate(RequestModel):
    title: Title
    slug: Slug
    description: Description = ""
    category: Category = ""
    level: Level = "beginner"


class CourseUpdate(RequestModel):
    title: Title | None = None
    slug: Slug | None = None
    description: Description | None = None
    category: Category | None = None
    level: Level | None = None


class ModuleCreate(RequestModel):
    title: Title


class ModuleUpdate(RequestModel):
    title: Title | None = None


class LessonCreate(RequestModel):
    title: Title
    content: Content = ""
    video_url: HttpUrl | None = Field(default=None, max_length=2048)


class LessonUpdate(RequestModel):
    title: Title | None = None
    content: Content | None = None
    video_url: HttpUrl | None = Field(default=None, max_length=2048)


class OrderUpdate(RequestModel):
    ids: list[UUID] = Field(max_length=10000)


class ReadModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")


class LessonOutline(ReadModel):
    id: UUID
    title: str
    position: int


class ModuleOutline(ReadModel):
    id: UUID
    title: str
    position: int
    lessons: list[LessonOutline]


class LessonRead(LessonOutline):
    module_id: UUID
    content: str
    video_url: str | None
    created_at: datetime
    updated_at: datetime


class ModuleRead(ReadModel):
    id: UUID
    course_id: UUID
    title: str
    position: int
    created_at: datetime
    updated_at: datetime
    lessons: list[LessonRead]


class PublicCourseSummary(ReadModel):
    id: UUID
    slug: str
    title: str
    description: str
    category: str
    level: Level
    instructor_name: str
    module_count: int
    lesson_count: int
    published_at: datetime | None


class PublicCourseDetail(PublicCourseSummary):
    modules: list[ModuleOutline]


class CourseSummary(PublicCourseSummary):
    instructor_id: UUID
    status: Status
    created_at: datetime
    updated_at: datetime


class CourseRead(CourseSummary):
    modules: list[ModuleRead]


class PublicCoursePage(ReadModel):
    items: list[PublicCourseSummary]
    total: int
    page: int
    page_size: int


class CoursePage(ReadModel):
    items: list[CourseSummary]
    total: int
    page: int
    page_size: int
