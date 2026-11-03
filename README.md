# EduFlow LMS

A backend-first learning management system built as a modular monolith. Phase 1 provides the API, PostgreSQL connection, migrations, containers, tests, and CI. Authentication, courses, and the frontend come in later phases.

## Run with Docker

Requirements: Docker Desktop (or Docker Engine with Compose), Git. Run from the repository root:

```sh
cp .env.example .env
docker compose up --build -d --wait
docker compose exec backend alembic upgrade head
docker compose exec backend alembic current
curl --fail http://localhost:8000/api/v1/health
curl --fail http://localhost:8000/api/v1/health/db
```

Both endpoints return `{"status":"ok"}` with HTTP 200. The database endpoint executes `SELECT 1` and returns HTTP 503 with `{"detail":"Database unavailable"}` if PostgreSQL is unreachable. API documentation: <http://localhost:8000/docs>; OpenAPI: <http://localhost:8000/openapi.json>.

The example credentials are public placeholders for local development. Keep real credentials in ignored `.env` files. When changing the database user or password, update `DATABASE_URL` too; URL-encode special characters in URL credentials. PostgreSQL credentials are initialized only when its volume is first created. Changing environment variables does not change an existing database user's password.

Only the API is published, on `127.0.0.1:8000`. PostgreSQL is available to the backend at `postgres:5432` on the Compose network. Change `BACKEND_PORT` in `.env` if port 8000 is occupied.

```sh
docker compose ps
docker compose logs backend
docker compose logs postgres
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT 1"'
docker compose stop
```

The named `postgres_data` volume persists between restarts. Do not remove it or use volume deletion commands without explicit approval. Migrations run explicitly; application startup never creates tables. The initial migration only establishes an Alembic baseline and creates no business entities.

## Local Python development

Requirements: Python 3.12+ and [uv](https://docs.astral.sh/uv/). The container and CI use Python 3.13.

```sh
cd backend
uv sync --locked
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

For local Uvicorn, set `DATABASE_URL` to a reachable **local development** PostgreSQL database using the `postgresql+psycopg://` scheme, either in your shell or in `backend/.env`. Settings read `.env` from the current working directory. The root Compose URL uses the hostname `postgres`, which does not resolve on the host; use a separate local PostgreSQL instance for this workflow. Do not point development commands at a shared or production database.

```sh
uv run alembic upgrade head
uv run uvicorn app.main:create_app --factory --reload
```

Tests use doubles for failure cases; production health checks always query PostgreSQL. Integration tests skip unless `TEST_DATABASE_URL` identifies a reachable local test PostgreSQL database:

```sh
uv run pytest -m integration
```

## Structure and development

- `backend/app/api/v1/`: versioned HTTP routes.
- `backend/app/core/`: environment settings.
- `backend/app/db/`: declarative base and synchronous per-request sessions.
- `backend/alembic/`: schema migrations.
- `backend/tests/`: automated checks.
- `.github/workflows/ci.yml`: dependency installation, Ruff, tests, and PostgreSQL migration checks.

Business modules will use Router → Service → Repository → Database where those layers provide value. Infrastructure health checks query the database directly. There are no business models yet.

See [PROJECT_SPEC.md](PROJECT_SPEC.md) for scope and phases, [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) for the future frontend, and [AGENTS.md](AGENTS.md) for project contribution rules. Use Git for version control; no automatic snapshots or duplicate source backups. Never commit `.env` files, push, deploy, or run destructive database commands without authorization.
