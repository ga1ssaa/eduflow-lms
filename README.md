# EduFlow LMS

A backend-first learning management system built as a modular monolith. Phases 1–4 provide authentication, course management, enrollment and learning progress. Phases 5A–5B provide the React application: public catalog, authentication, student learning, instructor course/curriculum authoring and statistics, and admin publication moderation.

## Run the frontend

Requirements: Node.js 24 LTS, npm, and the running EduFlow API below. In another terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. Vite proxies `/api` to `http://127.0.0.1:8000`, preserving the browser Origin for backend CSRF validation. Stay on the same hostname for cookies. No frontend environment file is required; optional overrides are in `frontend/.env.example`. If the API port changes, set `EDUFLOW_API_PROXY_TARGET` to its local URL. `VITE_*` settings are public browser configuration and must never contain secrets.

The frontend uses the real API and shows empty states when no courses exist. Registration creates students only. Instructor/admin accounts must already have the appropriate backend role; there is no user-management endpoint or default account.

Instructors land on `/instructor`. Create courses at `/instructor/courses/new`, edit details at `/instructor/courses/:courseId/edit`, manage modules/lessons at `/instructor/courses/:courseId/curriculum`, and view learner progress at `/instructor/courses/:courseId/students`. Course overview pages provide confirmed publish/unpublish and draft deletion. Curriculum ordering uses explicit up/down controls and submits the complete current ID list. Slugs are editable but are not regenerated when a title changes. Text content is plain text; videos use external HTTP(S) links.

Unsaved forms warn before page unload, route navigation, browser history navigation, and explicit sign-out. Inputs survive failed saves and background refetch failures. PATCH sends only changed fields; clearing a lesson video sends `null`. Publication and learning-record deletion restrictions remain server-enforced. Refresh after a 409 conflict and review the preserved inputs before retrying. Changing an existing slug changes its public course URL.

Admins land on `/admin`, with actual total/published/draft counts, course search/filtering, full course review and confirmed publication moderation. No global user statistics or fake user-management controls exist. Dashboard course counts come from bounded paginated API queries. Enrollment/completion counts are shown per course: the API has no instructor-wide enrollment aggregate, so the dashboard does not issue a statistics request for every course or invent a global number. A student enrolled in two courses contributes one enrollment to each course's statistics.

Access tokens stay in memory. Refresh cookies remain HttpOnly; auth POSTs include credentials and the CSRF marker. Session recovery serializes cookie operations, shares refreshes within a tab, and uses Web Locks where supported across tabs. Older browsers without Web Locks may reject a racing refresh safely and require sign-in again. Logout cancels private requests and clears cached data; failed server revocation offers a sign-out retry. Light/dark/system selection is the only persisted browser preference.

```sh
cd frontend
npm run check
npm run lint
npm run format:check
npm test
npm run build
```

`npm run preview` serves the built app on port 4173. Authentication on that port requires adding its exact origin to the backend allowlist; the normal development workflow uses port 5173. A future production host must serve SPA routes with an `index.html` fallback, proxy `/api/v1` to the API, and use HTTPS with Secure refresh cookies and explicit trusted origins. Nothing is deployed by these commands.

Optional real-API browser tests use `npm run test:e2e` after `npx playwright install chromium`. They require Vite on port 5173 pointed at a separate API using an isolated `eduflow_test_*` PostgreSQL database. Set `EDUFLOW_E2E_FIXTURE_FILE` to a private JSON file containing `student`, `instructor`, and `admin` accounts (`email`, `password`) plus `course` and `draft` (`id`, `slug`, `title`). The student full name must be `Frontend Student`. The published course needs two ordered text lessons containing `Private lesson 1.` and `Private lesson 2.` respectively; the draft must satisfy publication rules. Keep this file outside Git with mode 0600; never use development or production accounts. The authoring test creates unique courses through the UI, reorders modules/lessons, verifies student learning and statistics, and confirms moderation/deletion safeguards. Tests create and modify isolated records but never reset databases. Without fixtures they explicitly skip. Browser traces/video are disabled to avoid capturing token responses.

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

The named `postgres_data` volume persists between restarts. Do not remove it or use volume deletion commands without explicit approval. Migrations run explicitly; application startup never creates tables. Migration `0001` establishes the baseline; `0002` adds identity; `0003` adds curriculum; `0004` adds enrollments, lesson progress, and integrity triggers. Downgrading feature migrations deletes their tables and must never be used on valuable data without approval.

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

## Course management

Management endpoints require a Bearer access token and load the user's current role and active state through the existing authentication dependencies. Instructors can access only their own courses. Admin access is explicitly allowed for management of any course; `/instructor/courses` still lists only the current user's courses, while `/admin/courses` lists all courses. There is no public role-promotion endpoint.

All paths below start with `/api/v1`:

| Method and path | Purpose |
| --- | --- |
| `POST /instructor/courses` | Create a draft owned by the authenticated instructor or admin. |
| `GET /instructor/courses` | Paginated owned courses. |
| `GET`, `PATCH`, `DELETE /instructor/courses/{course_id}` | View full authoring content, edit, or delete a draft. |
| `POST /instructor/courses/{course_id}/publish`, `/unpublish` | Change publication state. |
| `POST /instructor/courses/{course_id}/modules` | Append a module. |
| `PATCH`, `DELETE /instructor/modules/{module_id}` | Edit or delete a module. |
| `PUT /instructor/courses/{course_id}/modules/order` | Atomically reorder all modules. |
| `POST /instructor/modules/{module_id}/lessons` | Append a lesson. |
| `PATCH`, `DELETE /instructor/lessons/{lesson_id}` | Edit or delete a lesson. |
| `PUT /instructor/modules/{module_id}/lessons/order` | Atomically reorder all lessons. |
| `GET /courses`, `/courses/{slug}` | Public published catalog and curriculum outline. |
| `GET /admin/courses`, `/admin/courses/{course_id}` | Admin-only listing and full details, including drafts. |
| `POST /admin/courses/{course_id}/publish`, `/unpublish` | Admin-only publication moderation with the same validation. |

Course creation requires `title` and `slug`; optional fields are `description`, `category`, and `level` (`beginner`, `intermediate`, `advanced`; default `beginner`). Slugs contain lowercase ASCII letters or digits separated by single hyphens, up to 200 characters. Slug conflicts return 409, including concurrent creation attempts. Title changes do not regenerate slugs. Public input cannot set `instructor_id` or publication state.

Module creation takes `title`. Lesson creation takes `title`, optional `content`, and optional HTTP(S) `video_url`. PATCH changes only supplied fields; `video_url: null` clears the video. Positions are positive, server-assigned, and unique within a parent. Reorder bodies are `{"ids": ["<UUID>", "<UUID>"]}` and must contain exactly all current child IDs once. Parent-course row locks serialize structural edits; deferrable unique constraints let valid swaps commit atomically. No ordering library is used.

Publishing requires a title, nonempty description and category, at least one module and one lesson, and a title plus content or valid video URL for every lesson. Repeated publish requests preserve the current publication date. Unpublish clears it; republishing sets a new date. Edits and deletions that would make a published course invalid are rejected and rolled back. Unpublish before deleting a published course. Courses with enrollments cannot be deleted. Lessons with completion records, and modules containing such lessons, cannot be deleted. For curriculum without learning records, explicit draft-course/module deletion retains its transactional cascade behavior.

Public listings accept `page` (default 1), `page_size` (default 20, maximum 100), case-insensitive literal title `search`, exact `category`, and `level`. Responses contain `items`, `total`, `page`, and `page_size`, ordered by creation time descending and UUID ascending. Each item includes instructor name and module/lesson counts. Public details include ordered module and lesson titles; they never include lesson content or video URLs. Drafts return 404 publicly. Full student lesson content requires the enrolled-student endpoint below.

Course mutations use Bearer authentication rather than ambient refresh cookies, so the auth endpoints' CSRF marker is not required for these routes. CORS allows the PATCH, PUT, and DELETE methods needed by a future browser client. Validation errors use 422, denied roles or ownership use 403, absent resources use 404, and business-state conflicts use 409.

## Enrollment and learning

All learning endpoints require a Bearer token and a current active `student` role. Instructors and admins use their existing authorized management endpoints for content access. Student IDs, completion counts, and percentages are never accepted from a client.

| Endpoint | Behavior |
| --- | --- |
| `POST /api/v1/courses/{course_id}/enroll` | Enroll in a published course; repeated/concurrent requests return the same enrollment without duplicates. |
| `GET /api/v1/students/me/courses` | Paginated own enrollments with course metadata, availability, enrollment dates, and progress. |
| `GET /api/v1/students/me/courses/{course_id}` | Published enrolled course outline and own progress. |
| `GET /api/v1/students/me/lessons/{lesson_id}` | Protected content/video, course/module context, and own completion state. |
| `POST /api/v1/students/me/lessons/{lesson_id}/complete` | Idempotently mark complete and return current course progress. |
| `DELETE /api/v1/students/me/lessons/{lesson_id}/complete` | Idempotently mark incomplete and return recalculated progress. |
| `GET /api/v1/students/me/courses/{course_id}/progress` | Actual lesson/completion counts, percentage, and completion flag. |
| `GET /api/v1/students/me/dashboard` | Enrolled/completed/in-progress course counts and enrollment progress summaries. |
| `GET /api/v1/instructor/courses/{course_id}/students` | Paginated enrollment and student progress summaries; owner or admin only. |
| `GET /api/v1/instructor/courses/{course_id}/stats` | Enrollment/completion counts and average progress; owner or admin only. |

Enrollment and completion writes return HTTP 200, including repeats. Enrollment has no required body; extra identity fields are rejected. Completion responses include `lesson_id`, `is_completed`, `completed_at`, and a `progress` object. Missing, unenrolled, or unpublished protected resources return 404. Inactive accounts return 401; disallowed roles and cross-instructor statistics requests return 403.

Progress counts only current lessons in the enrolled course. Percentages use decimal rounding to two places with `ROUND_HALF_UP`: 1/3 → 33.33, 2/3 → 66.67, 7/10 → 70. Zero lessons means 0% and `is_completed=false`; completion otherwise requires all lessons, independently of the rounded percentage. No percentage is stored. New lessons can turn a completed course into an in-progress course. Removing an uncompleted lesson reduces the denominator; removing completed lessons is blocked. Marking incomplete intentionally removes that completion record.

Own course listings and dashboard retain enrollment metadata and numeric progress when a course is unpublished, with `is_available=false`; they expose no draft curriculum or lesson content. Course detail, lesson access, progress detail, and completion changes are blocked until republished. Dashboard in-progress counts include every enrolled course that is not complete, including courses with zero progress. Instructor statistics retain enrolled users even if their role or active state changes, without exposing authentication data.

Course row locks coordinate learning writes with publication and curriculum edits. Protected detail reads hold shared locks while constructing response snapshots. Unique constraints prevent duplicate enrollments/completions; foreign keys preserve learning records. A PostgreSQL trigger rejects cross-course completion links, and parent-identity triggers prevent reparenting enrollments, modules, and lessons. There is no unenrollment or archival workflow in this phase.

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

Set a generated `JWT_SECRET` in the local Python environment or `backend/.env` too. Tests use doubles for selected failure cases; production health checks always query PostgreSQL. Auth and course integration tests skip unless `TEST_DATABASE_URL` identifies a reachable isolated PostgreSQL database whose name begins `eduflow_test_`. Provision a new test database, migrate it with Alembic, and keep credentials in an ignored environment file. Never use the development database for tests. Tests use unique records and do not reset or delete database contents.

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
- `backend/tests/`: automated backend checks.
- `frontend/src/`: typed API/session client, shared components, role routes and product pages.
- `frontend/src/tests/`, `frontend/e2e/`: client/component regressions and optional real-API browser checks.
- `.github/workflows/ci.yml`: dependency installation, Ruff, tests, and PostgreSQL migration checks.

`backend/app/auth/` contains auth models, schemas, security helpers, dependencies, routes, services, and persistence queries. Authentication follows Router → Service → Repository → Database without generic base repositories. Infrastructure health checks query the database directly.

`backend/app/courses/` contains course models, schemas, persistence queries, and business services. Public, instructor, and admin routers reuse these services and the existing database sessions; publication and ownership rules are shared.

`backend/app/learning/` contains enrollment/progress models, schemas, queries, and services. Its router reuses current-state auth dependencies and the same database sessions. Integration tests cover concurrency and learning-record preservation in the isolated test database.

See [PROJECT_SPEC.md](PROJECT_SPEC.md) for scope and phases, [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) for the frontend, and [AGENTS.md](AGENTS.md) for project contribution rules. Use Git for version control; no automatic snapshots or duplicate source backups. Never commit `.env` files, push, deploy, or run destructive database commands without authorization.
