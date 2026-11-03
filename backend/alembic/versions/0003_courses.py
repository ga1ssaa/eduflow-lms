"""Add instructor-owned courses and ordered curriculum."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003_courses"
down_revision: str | Sequence[str] | None = "0002_identity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "courses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("instructor_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("slug", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("category", sa.String(100), server_default="", nullable=False),
        sa.Column("level", sa.String(20), server_default="beginner", nullable=False),
        sa.Column("status", sa.String(20), server_default="draft", nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.CheckConstraint(
            "level IN ('beginner', 'intermediate', 'advanced')", name="ck_courses_level"
        ),
        sa.CheckConstraint("status IN ('draft', 'published')", name="ck_courses_status"),
        sa.CheckConstraint("length(btrim(title)) > 0", name="ck_courses_title"),
        sa.CheckConstraint("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name="ck_courses_slug"),
        sa.CheckConstraint(
            "(status = 'draft' AND published_at IS NULL) OR "
            "(status = 'published' AND published_at IS NOT NULL)",
            name="ck_courses_publication_time",
        ),
        sa.ForeignKeyConstraint(["instructor_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_courses_instructor_id", "courses", ["instructor_id"])
    op.create_index("ix_courses_slug", "courses", ["slug"], unique=True)
    op.create_index("ix_courses_category", "courses", ["category"])
    op.create_index("ix_courses_status_created_at", "courses", ["status", "created_at"])
    op.create_table(
        "modules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint("position > 0", name="ck_modules_positive_position"),
        sa.CheckConstraint("length(btrim(title)) > 0", name="ck_modules_title"),
        sa.UniqueConstraint(
            "course_id",
            "position",
            name="uq_modules_course_position",
            deferrable=True,
            initially="IMMEDIATE",
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_modules_course_id", "modules", ["course_id"])
    op.create_table(
        "lessons",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("module_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("content", sa.Text(), server_default="", nullable=False),
        sa.Column("video_url", sa.String(2048), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint("position > 0", name="ck_lessons_positive_position"),
        sa.CheckConstraint("length(btrim(title)) > 0", name="ck_lessons_title"),
        sa.UniqueConstraint(
            "module_id",
            "position",
            name="uq_lessons_module_position",
            deferrable=True,
            initially="IMMEDIATE",
        ),
        sa.ForeignKeyConstraint(["module_id"], ["modules.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_lessons_module_id", "lessons", ["module_id"])


def downgrade() -> None:
    # This explicit downgrade discards all course content; never use against valuable data.
    op.drop_table("lessons")
    op.drop_table("modules")
    op.drop_table("courses")
