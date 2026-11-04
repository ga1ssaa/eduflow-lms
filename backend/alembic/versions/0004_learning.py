"""Add enrollment and lesson completion with immutable learning ownership."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_learning"
down_revision: str | Sequence[str] | None = "0003_courses"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "enrollments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("student_id", sa.Uuid(), nullable=False),
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.Column(
            "enrolled_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("student_id", "course_id", name="uq_enrollments_student_course"),
    )
    op.create_index("ix_enrollments_student_id", "enrollments", ["student_id"])
    op.create_index("ix_enrollments_course_id", "enrollments", ["course_id"])
    op.create_table(
        "lesson_progress",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("enrollment_id", sa.Uuid(), nullable=False),
        sa.Column("lesson_id", sa.Uuid(), nullable=False),
        sa.Column(
            "completed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["enrollment_id"], ["enrollments.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["lesson_id"], ["lessons.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "enrollment_id", "lesson_id", name="uq_lesson_progress_enrollment_lesson"
        ),
    )
    op.create_index("ix_lesson_progress_enrollment_id", "lesson_progress", ["enrollment_id"])
    op.create_index("ix_lesson_progress_lesson_id", "lesson_progress", ["lesson_id"])
    op.execute("""
        CREATE FUNCTION learning_validate_progress_course() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE enrollment_course uuid; lesson_course uuid;
        BEGIN
            SELECT course_id INTO enrollment_course FROM enrollments WHERE id = NEW.enrollment_id;
            SELECT m.course_id INTO lesson_course FROM lessons l
                JOIN modules m ON m.id = l.module_id WHERE l.id = NEW.lesson_id;
            IF enrollment_course IS NULL OR lesson_course IS NULL THEN
                RAISE EXCEPTION 'Progress parents must exist and be visible'
                    USING ERRCODE = '23503';
            END IF;
            IF enrollment_course IS DISTINCT FROM lesson_course THEN
                RAISE EXCEPTION 'Lesson and enrollment must belong to the same course'
                    USING ERRCODE = '23514', CONSTRAINT = 'ck_lesson_progress_same_course';
            END IF;
            RETURN NEW;
        END $$
    """)
    op.execute("""
        CREATE TRIGGER trg_lesson_progress_same_course
        BEFORE INSERT OR UPDATE OF enrollment_id, lesson_id ON lesson_progress
        FOR EACH ROW EXECUTE FUNCTION learning_validate_progress_course()
    """)
    op.execute("""
        CREATE FUNCTION learning_immutable_parent() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE parent_column text;
        BEGIN
            FOREACH parent_column IN ARRAY TG_ARGV LOOP
                IF (to_jsonb(OLD) -> parent_column) IS DISTINCT FROM
                   (to_jsonb(NEW) -> parent_column) THEN
                    RAISE EXCEPTION 'Learning ownership cannot be changed'
                        USING ERRCODE = '23514', CONSTRAINT = 'ck_learning_immutable_parent';
                END IF;
            END LOOP;
            RETURN NEW;
        END $$
    """)
    op.execute("""
        CREATE TRIGGER trg_enrollments_immutable_parent
        BEFORE UPDATE OF student_id, course_id ON enrollments FOR EACH ROW
        EXECUTE FUNCTION learning_immutable_parent('student_id', 'course_id')
    """)
    op.execute("""
        CREATE TRIGGER trg_lessons_immutable_parent
        BEFORE UPDATE OF module_id ON lessons FOR EACH ROW
        EXECUTE FUNCTION learning_immutable_parent('module_id')
    """)
    op.execute("""
        CREATE TRIGGER trg_modules_immutable_parent
        BEFORE UPDATE OF course_id ON modules FOR EACH ROW
        EXECUTE FUNCTION learning_immutable_parent('course_id')
    """)


def downgrade() -> None:
    # Explicit downgrade deletes all enrollment/completion history. Never use on valuable data.
    op.execute("DROP TRIGGER trg_modules_immutable_parent ON modules")
    op.execute("DROP TRIGGER trg_lessons_immutable_parent ON lessons")
    op.execute("DROP TRIGGER trg_enrollments_immutable_parent ON enrollments")
    op.execute("DROP FUNCTION learning_immutable_parent()")
    op.execute("DROP TRIGGER trg_lesson_progress_same_course ON lesson_progress")
    op.execute("DROP FUNCTION learning_validate_progress_course()")
    op.drop_table("lesson_progress")
    op.drop_table("enrollments")
