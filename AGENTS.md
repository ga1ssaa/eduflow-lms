# EduFlow Contributor Guide

## Project scope

EduFlow is a backend-first LMS built as a synchronous modular monolith. Read `README.md`, `PROJECT_SPEC.md`, and relevant code before making changes. Read `DESIGN_SYSTEM.md` for UI work. Keep each change limited to the requested feature and its necessary documentation and tests. Clearly distinguish implemented functionality from roadmap items.

The backend uses Python 3.12+, FastAPI, PostgreSQL, SQLAlchemy 2 synchronous sessions, psycopg 3, Alembic, Pydantic 2, and pydantic-settings. Quality checks use pytest and Ruff; local services use Docker Compose and CI uses GitHub Actions. The planned frontend uses React, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router, and Lucide. Do not add paid resources or unnecessary dependencies.

## Implementation guidance

- Prefer small, explicit modules and the existing project conventions.
- For business features, separate HTTP routing, business rules, persistence queries, and database infrastructure. Use Router → Service → Repository → Database where the complexity warrants it; avoid empty layers and generic abstractions for simple operations.
- Keep database use synchronous. Clean up request-scoped sessions reliably, roll back failed operations, and make transaction boundaries explicit.
- Validate public input and output with Pydantic models. Keep versioned endpoints under `/api/v1` and use consistent HTTP errors.
- Add role and ownership checks on the server when authentication is introduced. Never expose password hashes, tokens, credentials, or raw database errors.
- Document configuration changes in the tracked example environment file without adding secrets.

## Safety and versioning

Do not automatically commit, push, deploy, run migrations against a real database, or perform destructive actions without explicit approval. Never delete Docker volumes or database data automatically. Treat staging and production databases as real databases; use only clearly identified disposable local databases for automated migration validation.

Keep secrets in untracked environment files or approved secret stores. Never track secrets or print them in logs, reports, or documentation. Use placeholders in examples.

Use Git for normal version history. Do not generate automatic backup directories, `.bak` files, or copied old versions. If manual snapshots are explicitly needed, keep at most ten; do not automatically delete existing snapshots to enforce the limit. Confirm the intended cleanup first.

## Verification and handoff

Before editing, identify the expected behavior and checks that will demonstrate it. After editing:

1. Run the relevant pytest tests, including meaningful success and failure cases for changed behavior.
2. Run Ruff lint and formatting checks using the commands documented in `README.md`.
3. For schema changes, review the Alembic migration and validate upgrade behavior against a disposable local database. Review downgrade implications and data loss explicitly; do not run destructive validation against real data.
4. Review the final diff for scope, security, accidental generated files, and documentation accuracy.

Report what changed, files affected, checks and their results, and any remaining limitations. State skipped or unavailable checks plainly. Do not claim a feature is complete solely because scaffolding or a test stub exists.
