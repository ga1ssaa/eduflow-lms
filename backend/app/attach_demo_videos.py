"""Explicit, atomic attachment of reviewed videos to unedited original demo lessons."""

import argparse
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import create_engine, or_, pool, select
from sqlalchemy.engine import URL, make_url
from sqlalchemy.orm import Session, selectinload

from app import seed_demo_courses as seed
from app.core.config import Settings, get_settings
from app.courses.models import Course, Module
from app.import_demo_courses import _ROUTING_ENV, CONFIRMATION, ImportRefused, _check_schema
from app.import_demo_courses import _guard_target as guard_production_target


class VideoAttachment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    course_slug: str
    module_position: int = Field(ge=1, le=3)
    lesson_position: int = Field(ge=1, le=3)
    title: str = Field(min_length=1, max_length=300)
    video_url: str
    source_url: str
    author: str = Field(min_length=1, max_length=300)
    author_url: str | None = None
    license: str = Field(min_length=1, max_length=100)
    license_url: str
    note: str | None = Field(default=None, min_length=1, max_length=500)

    @field_validator("title", "author", "license", "note")
    @classmethod
    def plain_metadata(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if value != value.strip() or any(ord(character) < 32 for character in value):
            raise ValueError("Attribution metadata must be nonempty single-line text")
        return value

    @field_validator("video_url", "source_url", "author_url", "license_url")
    @classmethod
    def https_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        parsed = urlsplit(value)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.fragment
            or any(character.isspace() or ord(character) < 32 for character in value)
        ):
            raise ValueError("Attribution URLs must be credential-free HTTPS URLs")
        return value

    @model_validator(mode="after")
    def direct_video(self) -> "VideoAttachment":
        parsed = urlsplit(self.video_url)
        if (
            parsed.hostname != "upload.wikimedia.org"
            or not parsed.path.lower().endswith((".webm", ".mp4", ".ogv"))
            or parsed.query
        ):
            raise ValueError("Only reviewed direct Wikimedia Commons video files are supported")
        return self


class VideoManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    videos: list[VideoAttachment] = Field(min_length=3, max_length=5)

    @model_validator(mode="after")
    def unique_targets(self) -> "VideoManifest":
        keys = [(v.course_slug, v.module_position, v.lesson_position) for v in self.videos]
        if len(set(keys)) != len(keys):
            raise ValueError("Each demo lesson can have only one reviewed video")
        return self


def load_manifest() -> VideoManifest:
    return VideoManifest.model_validate_json(
        Path(__file__).with_name("demo_videos.json").read_text(encoding="utf-8")
    )


def attributed_content(original: str, video: VideoAttachment) -> str:
    author = video.author + (f" ({video.author_url})" if video.author_url else "")
    note = f"Note: {video.note}\n" if video.note else ""
    return (
        f"{original}\n\nVideo attribution:\nTitle: {video.title}\n"
        f"Source: {video.source_url}\nAuthor: {author}\n"
        f"License: {video.license} ({video.license_url})\n"
        f"{note}"
        "Changes: video unmodified; linked as supplementary lesson material."
    )


def _canonical_fingerprint(course: Course, approved: dict[UUID, tuple[str, str, str]]) -> tuple:
    fingerprint = seed._fingerprint(course)
    modules = []
    for module in fingerprint[-1]:
        lessons = []
        for lesson in module[-1]:
            permitted = approved.get(lesson[0])
            if permitted and (lesson[3], lesson[4]) == (permitted[1], permitted[2]):
                lesson = (*lesson[:3], permitted[0], None, lesson[5])
            lessons.append(lesson)
        modules.append((*module[:-1], tuple(lessons)))
    return (*fingerprint[:-1], tuple(modules))


def attach_videos(
    db: Session, manifest: VideoManifest, instructor_id: UUID, *, apply: bool = False
) -> tuple[int, int]:
    """Preflight every affected course before changing any lesson; caller owns the transaction."""
    manifest = VideoManifest.model_validate(manifest.model_dump())
    originals = {
        spec.slug: seed.build_course(spec, instructor_id) for spec in seed.load_manifest().courses
    }
    approved = {}
    for video in manifest.videos:
        course = originals.get(video.course_slug)
        if course is None or video.module_position > len(course.modules):
            raise seed.SeedConflict("Video target does not identify an original demo lesson")
        lesson = course.modules[video.module_position - 1].lessons[video.lesson_position - 1]
        approved[lesson.id] = (
            lesson.content,
            attributed_content(lesson.content, video),
            video.video_url,
        )
    expected = [originals[slug] for slug in sorted({v.course_slug for v in manifest.videos})]
    seed._instructor(db, instructor_id, lock=apply)
    query = (
        select(Course)
        .where(
            or_(
                Course.id.in_([c.id for c in expected]), Course.slug.in_([c.slug for c in expected])
            )
        )
        .order_by(Course.id)
        .options(selectinload(Course.modules).selectinload(Module.lessons))
        .execution_options(populate_existing=True)
    )
    if apply:
        query = query.with_for_update()
    existing = list(db.scalars(query))
    changes, skipped = [], 0
    for original in expected:
        matches = [c for c in existing if c.id == original.id or c.slug == original.slug]
        if (
            len(matches) != 1
            or matches[0].status != "published"
            or matches[0].published_at is None
            or _canonical_fingerprint(matches[0], approved) != seed._fingerprint(original)
        ):
            raise seed.SeedConflict(f"Original demo course differs or is missing: {original.slug}")
        for module in matches[0].modules:
            for lesson in module.lessons:
                permitted = approved.get(lesson.id)
                if permitted:
                    if (lesson.content, lesson.video_url) == (permitted[1], permitted[2]):
                        skipped += 1
                    else:
                        changes.append((lesson, permitted))
    # No assignments, flushes, or service commits occur until the complete preflight succeeds.
    if apply and changes:
        for lesson, permitted in changes:
            lesson.content, lesson.video_url = permitted[1], permitted[2]
        db.flush()
    return len(changes), skipped


def _guard_target(settings: Settings, expected_host: str, expected_database: str) -> URL:
    if settings.environment == "production":
        return guard_production_target(settings, expected_host, expected_database)
    url = make_url(str(settings.database_url))
    if (
        settings.environment != "development"
        or url.drivername != "postgresql+psycopg"
        or url.host not in {"localhost", "127.0.0.1", "::1"}
        or url.host != expected_host
        or not url.username
        or not url.database
        or not re.fullmatch(r"[A-Za-z0-9_-]{1,63}", url.database)
        or url.database != expected_database
        or url.port is not None
        and not 1 <= url.port <= 65535
        or any(
            key not in {"sslmode", "connect_timeout"} or not isinstance(value, str)
            for key, value in url.query.items()
        )
        or any(key.upper() in _ROUTING_ENV and value for key, value in os.environ.items())
    ):
        raise ImportRefused("Explicit local development target verification failed")
    return url


def _run(
    settings: Settings, url: URL, manifest: VideoManifest, instructor_id: UUID, *, apply: bool
) -> tuple[int, int]:
    engine = create_engine(
        url,
        poolclass=pool.NullPool,
        isolation_level="READ COMMITTED",
        hide_parameters=True,
        connect_args={"connect_timeout": settings.database_connect_timeout},
    )
    try:
        with engine.connect() as connection:
            transaction = connection.begin()
            try:
                if not apply:
                    connection.exec_driver_sql("SET TRANSACTION READ ONLY")
                _check_schema(connection, url.database)
                with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
                    result = attach_videos(db, manifest, instructor_id, apply=apply)
                    if apply:
                        db.commit()  # Release only the savepoint; the connection owns the commit.
                if apply:
                    transaction.commit()
                return result
            finally:
                if transaction.is_active:
                    transaction.rollback()
    finally:
        engine.dispose()


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        self.exit(2, "Invalid demo video attachment arguments; use --help.\n")


def main(argv: list[str] | None = None) -> int:
    parser = _Parser(description=__doc__)
    parser.add_argument("--instructor-id", type=UUID, required=True)
    parser.add_argument("--expected-host", required=True)
    parser.add_argument("--expected-database", required=True)
    parser.add_argument("--confirm-production")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    try:
        settings = get_settings()
        if (
            settings.environment == "production"
            and args.apply
            and args.confirm_production != CONFIRMATION
        ):
            raise ImportRefused("Production project/branch attestation is required for apply")
        url = _guard_target(settings, args.expected_host, args.expected_database)
        manifest = load_manifest()
        changed, skipped = _run(settings, url, manifest, args.instructor_id, apply=args.apply)
    except (ImportRefused, seed.SeedConflict) as error:
        print(
            f"Demo video attachment refused: {error}. No existing edits are overwritten.",
            file=sys.stderr,
        )
        return 1
    except (Exception, KeyboardInterrupt):
        print(
            "Demo video attachment failed or commit could not be confirmed. "
            "Verify with a read-only dry run before retrying; no credentials are shown.",
            file=sys.stderr,
        )
        return 1
    label = "attached" if args.apply else "would_attach"
    print(
        f"{label}={changed}, skipped={skipped}. "
        + ("Attachment committed." if args.apply else "Read-only inspection; nothing changed.")
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
