from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import RefreshSession, User


def user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email))


def user_by_id(db: Session, user_id: UUID) -> User | None:
    return db.get(User, user_id)


def lock_refresh_session(db: Session, token_hash: str) -> RefreshSession | None:
    # Under PostgreSQL READ COMMITTED, a waiting SELECT rechecks the current row.
    return db.scalar(
        select(RefreshSession)
        .where(RefreshSession.token_hash == token_hash)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
