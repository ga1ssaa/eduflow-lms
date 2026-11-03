# EduFlow LMS

A backend-first learning management system built as a modular monolith. Phase 1 provides the API and database foundation. Phase 2 adds registration, login, JWT access tokens, rotating refresh sessions, logout, current-user access, role dependencies, and an administrator CLI. Courses and the frontend come in later phases.

## Run with Docker

Requirements: Docker Desktop (or Docker Engine with Compose), Git. Run from the repository root:

```sh
cp .env.example .env
```

Generate the signing secret directly into the ignored `.env` without printing it. This preserves an existing nonempty secret:

```sh
python3 - <<'PY'
from pathlib import Path
import secrets
path = Path('.env')
content = path.read_text()
if not any(line.startswith('JWT_SECRET=') and line.partition('=')[2].strip()
           for line in content.splitlines()):
    content = '\n'.join(line for line in content.splitlines()
                        if not line.startswith('JWT_SECRET='))
    path.write_text(content + '\nJWT_SECRET=' + secrets.token_urlsafe(48) + '\n')
path.chmod(0o600)
PY
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

The named `postgres_data` volume persists between restarts. Do not remove it or use volume deletion commands without explicit approval. Migrations run explicitly; application startup never creates tables. Migration `0001` establishes the baseline; `0002` adds users and refresh sessions. Its downgrade deletes those tables and must never be used on valuable data without approval.

## Authentication

| Endpoint | Contract |
| --- | --- |
| `POST /api/v1/auth/register` | JSON `email`, `password`, `full_name`; returns safe user fields with 201. Always creates a student; extra fields such as `role` are rejected. |
| `POST /api/v1/auth/login` | JSON `email`, `password`; returns `access_token`, `token_type`, `expires_in` and sets the refresh cookie. |
| `POST /api/v1/auth/refresh` | Uses the refresh cookie; returns a new access token and replaces the refresh cookie. The old token immediately becomes unusable. |
| `POST /api/v1/auth/logout` | Revokes the presented refresh session and clears its cookie; returns 204. Already issued access tokens remain valid until expiry unless the user becomes inactive. |
| `GET /api/v1/users/me` | Requires `Authorization: Bearer <access token>`; returns safe user fields. |

Emails are trimmed and normalized to lowercase. Full names contain 2–100 characters after trimming. Registration passwords contain 12–128 characters, including a letter and a non-space nonletter. Passwords use Argon2id. Unknown accounts and incorrect passwords receive the same authentication error. Password hashes and refresh-session details are never returned.

Every POST above requires **both** an exact allowlisted `Origin` and `X-CSRF-Token: 1`, including registration and login. Missing or untrusted origins and missing headers receive 403. The custom header forces browser preflight; strict CORS and Origin checks prevent cross-origin cookie requests. The header is a fixed request marker, not a secret. API tools must send these headers too. The default allowlist includes `http://localhost:8000` for local API documentation and port 5173 for the future frontend; Swagger's Try it out needs the CSRF header. Never configure wildcard or untrusted origins.

The future browser client should send `credentials: "include"` for login, refresh, and logout, keep access tokens in memory, and let the browser manage the HttpOnly refresh cookie. Never put refresh tokens in localStorage. Refresh tokens are high-entropy random values; only SHA-256 hashes are stored. Rotation locks the existing session row and commits revocation and replacement together, so only one concurrent attempt succeeds. An old-token replay is rejected; it does not invalidate the separately issued replacement session.

Access JWTs use HS256 and validate signature, expiration, issuer, subject, and access-token type. Authorization loads current user state from PostgreSQL. `get_current_user` and `require_role(*roles)` live in `app.auth.dependencies`; pass the explicitly allowed roles. Admin does not implicitly inherit instructor access. No public role-management or role-test endpoints exist.

### Configuration and administrator bootstrap

`JWT_SECRET` is required and must contain at least 32 characters. Keep it private and stable across restarts. `JWT_ISSUER`, `ACCESS_TOKEN_MINUTES` (default 15), and `REFRESH_TOKEN_DAYS` (default 7) are independently configurable. Cookie settings are `REFRESH_COOKIE_NAME`, `REFRESH_COOKIE_SECURE`, and `REFRESH_COOKIE_SAMESITE`; the cookie is host-only with path `/api/v1/auth`. CORS origins and auth origins are explicit JSON arrays in `.env`.

Local HTTP development uses `ENVIRONMENT=development`, Secure=false, and SameSite=lax. Production requires HTTPS, `ENVIRONMENT=production`, Secure=true, and exact HTTPS origins. SameSite=none requires Secure=true and is needed only when the eventual frontend is cross-site. All modes retain CSRF checks. A secret change invalidates access JWTs but does not revoke refresh sessions. Revoke sessions separately when handling a compromise.

Create the initial administrator explicitly after migrations:

```sh
docker compose exec backend python -m app.cli create-admin --email your-address@example.com --full-name "Your Name"
```

The CLI prompts for the password and confirmation without echoing it and requires a terminal. It refuses existing accounts and never silently promotes a student. There is no default administrator and no startup bootstrap. Do not pass passwords through command arguments or shell history.

## Local Python development

Requirements: Python 3.12+ and [uv](https://docs.astral.sh/uv/). The container and CI use Python 3.13.

```sh
cd backend
uv sync --locked
uv run python -m pytest
uv run ruff check .
uv run ruff format --check .
```

For local Uvicorn, set `DATABASE_URL` to a reachable **local development** PostgreSQL database using the `postgresql+psycopg://` scheme, either in your shell or in `backend/.env`. Settings read `.env` from the current working directory. The root Compose URL uses the hostname `postgres`, which does not resolve on the host; use a separate local PostgreSQL instance for this workflow. Do not point development commands at a shared or production database.

```sh
uv run alembic upgrade head
uv run python -m uvicorn app.main:create_app --factory --reload
```

Set a generated `JWT_SECRET` in the local Python environment or `backend/.env` too. Tests use doubles for selected failure cases; production health checks always query PostgreSQL. Auth integration tests skip unless `TEST_DATABASE_URL` identifies a reachable isolated PostgreSQL database whose name begins `eduflow_test_`. Provision a new test database, migrate it with Alembic, and keep credentials in an ignored environment file. Never use the development database for tests. Tests use unique records and do not reset or delete database contents.

```sh
uv run python -m pytest -m integration
```

To run the full suite using the existing Compose PostgreSQL service, create a separate test database once:

```sh
# Run from the repository root; this creates a new database and never resets one.
docker compose exec postgres sh -c 'createdb -U "$POSTGRES_USER" eduflow_test_auth'
```

In the ignored root `.env`, add `TEST_DATABASE_URL` using the same connection details as `DATABASE_URL` but with database name `eduflow_test_auth`. Do not replace the development `DATABASE_URL`. For a custom Compose project name, adjust the network name below.

```sh
docker build --target test -t eduflow-lms-tests backend
docker run --rm --network eduflow-lms_default --env-file .env eduflow-lms-tests \
  sh -c 'export DATABASE_URL="${TEST_DATABASE_URL:?Set isolated TEST_DATABASE_URL in .env}"; exec uv run --locked python -m pytest -p no:cacheprovider'
```

The test image uses locked dependencies and includes Alembic migrations. The test fixture migrates the isolated database and creates unique records; it never drops tables, truncates data, or removes volumes. The runtime image excludes development dependencies and tests.

## Structure and development

- `backend/app/api/v1/`: versioned HTTP routes.
- `backend/app/core/`: environment settings.
- `backend/app/db/`: declarative base and synchronous per-request sessions.
- `backend/alembic/`: schema migrations.
- `backend/tests/`: automated checks.
- `.github/workflows/ci.yml`: dependency installation, Ruff, tests, and PostgreSQL migration checks.

`backend/app/auth/` contains auth models, schemas, security helpers, dependencies, routes, services, and persistence queries. Authentication follows Router → Service → Repository → Database without generic base repositories. Infrastructure health checks query the database directly.

See [PROJECT_SPEC.md](PROJECT_SPEC.md) for scope and phases, [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) for the future frontend, and [AGENTS.md](AGENTS.md) for project contribution rules. Use Git for version control; no automatic snapshots or duplicate source backups. Never commit `.env` files, push, deploy, or run destructive database commands without authorization.
