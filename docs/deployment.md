# Deployment and maintenance guide

The [live portfolio](https://eduflow-lms.tech) uses Vercel for the frontend, Render for the Docker API and Neon PostgreSQL. This guide describes the repository's deployment contract and explicit maintenance procedures; working-branch polish may not yet be published.

Resource creation, Git publication, remote migrations, account provisioning and deployment require explicit approval. Existing local data is not transferred automatically. Keep credentials in approved secret stores, never in Git, command arguments, chat or logs. Never relabel production as development to bypass a guard.

The primary production origin is `https://eduflow-lms.tech`; `https://eduflow-lms-topaz.vercel.app` remains the Vercel provider URL for operational reference. Documenting these origins does not change or verify DNS, TLS, redirects, Vercel domains or hosted environment settings.

## Hosting contract and limits

Use the selected Free/Hobby plans without implicit paid upgrades. Check current [Render Free](https://render.com/docs/free), [Neon](https://neon.com/pricing) and [Vercel Hobby](https://vercel.com/docs/plans/hobby) terms and usage in their dashboards. Free services can suspend or exhaust allowances; this is a personal portfolio deployment, not an uptime guarantee. Sleeping services may delay first requests. No numeric pricing or allowance is assumed here.

[`render.yaml`](../render.yaml) defines a Free Docker service in Frankfurt, with automatic redeploys disabled. The existing non-root, production-only runtime listens on `0.0.0.0:${PORT:-8000}` (Render supplies `PORT`). No registry, persistent disk, background worker, or Docker image publication is needed; Render builds `backend/Dockerfile` from the repository. Do not override its start command or add migrations to startup.

The Blueprint sets `WEB_CONCURRENCY=1` and `UVICORN_LIMIT_CONCURRENCY=4` in the process environment. Argon2id password hashing is memory-intensive; unrestricted concurrent login/registration can exhaust a small instance. The Uvicorn bound limits accepted concurrent connections/tasks and returns 503 under excess load, including potentially during parallel catalog calls. It is a conservative demo setting, not a load-test guarantee or a rate limiter. Confirm actual Render memory and CPU metrics after deployment before increasing it. No password-hashing security parameters are reduced.

Use `/api/v1/health` for Render's liveness check so health polling does not wake Neon continuously. Verify `/api/v1/health/db` separately after migration/deployment. Sleeping services can cause first-request delays, proxy error pages, or transient database failures; retry after wake-up. Do not use artificial keep-alive polling to defeat free-tier suspension.

## Production environment

Set these in Render's environment dashboard; never enter credentials in Git, URLs shared in chat, command arguments, or build logs. `sync: false` values in the Blueprint must be supplied explicitly.

| Variable                                        | Production value                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`                                   | `production`                                                                                                  |
| `DATABASE_URL`                                  | Neon **pooled** PostgreSQL URL, including its TLS parameters                                                  |
| `JWT_SECRET`                                    | Unique random secret of at least 32 non-padding characters, stored privately and kept stable across redeploys |
| `AUTH_ALLOWED_ORIGINS`                          | JSON array of explicitly trusted HTTPS frontend origins, starting with `["https://eduflow-lms.tech"]`         |
| `CORS_ORIGINS`                                  | Same explicit HTTPS origin array; never wildcard or an origin with a trailing slash                           |
| `REFRESH_COOKIE_SECURE`                         | `true`                                                                                                        |
| `REFRESH_COOKIE_SAMESITE`                       | `lax` (same-origin proxy)                                                                                     |
| `REFRESH_COOKIE_NAME`                           | `eduflow_refresh`                                                                                             |
| `JWT_ISSUER`                                    | `eduflow`                                                                                                     |
| `ACCESS_TOKEN_MINUTES` / `REFRESH_TOKEN_DAYS`   | `15` / `7`                                                                                                    |
| `DATABASE_CONNECT_TIMEOUT`                      | `15` seconds, to allow a sleeping Neon compute to wake                                                        |
| `WEB_CONCURRENCY` / `UVICORN_LIMIT_CONCURRENCY` | `1` / `4`, as above                                                                                           |
| `PORT`                                          | Supplied by Render; do not replace with localhost or hardcode a different port                                |

For the primary domain, explicitly include `https://eduflow-lms.tech` in both `AUTH_ALLOWED_ORIGINS` and `CORS_ORIGINS`. If authentication is intentionally supported on the provider URL too, include `https://eduflow-lms-topaz.vercel.app` as a separate exact entry in both arrays. A custom domain, provider hostname, `www` alias and preview deployment are distinct origins; none is trusted implicitly. Review hosted settings separately before any approved change.

Vercel: Root Directory `frontend`, Node.js **24.x**, framework Vite, build `npm run build`, output `dist`, and public `VITE_API_BASE_URL=/api/v1`. No backend secrets belong in Vercel or `VITE_*`. `EDUFLOW_API_PROXY_TARGET` configures local Vite only and does not configure Vercel.

## Neon connections and explicit migrations

For a new environment, create a separate empty Neon project/database after approval; never point it at the existing development database. Prefer Frankfurt for both services when available. Copy the pooled and direct connection strings privately from Neon's Connect dialog. The application accepts `postgres://`, `postgresql://`, and `postgresql+psycopg://`; settings normalize them to the synchronous psycopg 3 driver and preserve URL query parameters. Keep Neon's `sslmode=require&channel_binding=require` parameters (or a verified stricter TLS configuration); never disable TLS. Password characters must be URL-encoded.

Use the `-pooler` hostname for the application's `DATABASE_URL`. Existing SQLAlchemy `pool_pre_ping` checks stale connections; the default pool has five persistent slots and ten overflow slots per process, opened lazily. The deployment's single worker and bounded request concurrency constrain use. Neon uses PgBouncer transaction pooling and supports driver protocol-level prepared statements; the app does not use SQL `PREPARE`, session advisory locks, or session-local state. See [Neon pooling](https://neon.com/docs/connect/connection-pooling).

For Alembic use the **direct** hostname, not `-pooler`; migrations already use `NullPool` and do not run at startup. Run the following only after verifying and approving the new remote target. In a separate local terminal, load production settings from a private environment file outside the repository using a trusted secret loader, with `DATABASE_URL` set to the **direct** URL. Do not overwrite the root or backend development `.env`. All production validation rules above still apply. From `backend/`:

```sh
uv sync --locked
uv run --locked alembic current
uv run --locked alembic upgrade head
uv run --locked alembic current
uv run --locked alembic check
```

These are remote database operations requiring explicit approval, not local documentation checks. Run migrations once from the intended release before starting that release. Do not use `stamp`, downgrades, resets, or automatic startup migrations. Do not use the pooled Render environment for this maintenance terminal.

## Release sequence (approval required)

For an existing deployment, verify and reuse its approved services, database and stable origin. The creation steps below apply only to a separately approved new environment; do not provision duplicates for an ordinary release.

1. Review and approve the configuration, then separately approve the desired Git publication. No commit or push is performed by preparation. Keep all local data intact.
2. Select Vercel Hobby and the intended stable HTTPS frontend origin without enabling paid add-ons. For the existing portfolio, use `https://eduflow-lms.tech` as the primary origin and retain the provider URL for operational reference. Do not route visitors or run authentication until the backend proxy and allowlist are ready. Preview deployment origins are not automatically trusted; do not give arbitrary previews production database access.
3. Create the empty Neon Free project/database, save both TLS URLs in a private secret store, and verify its identity before executing the explicit direct-URL migration commands above. Monitor Free storage, compute, and transfer usage.
4. Create the Render Free Docker service using `render.yaml` from the approved branch, supply the required environment values, and review the Free plan before confirming creation. Blueprint import starts the initial deployment even with automatic redeploys off. Do not configure a pre-deploy command, disk, paid instance, or Render database. Confirm both health endpoints after startup and note the actual assigned HTTPS `onrender.com` hostname.
5. Review the existing [`frontend/vercel.json`](../frontend/vercel.json), which points to the deployed backend. For a separately approved new environment, start from [`frontend/vercel.json.example`](../frontend/vercel.json.example) and replace **only** `replace-with-render-host.invalid` with that environment's actual Render hostname. Do not blindly overwrite the current configuration. The template intentionally uses a non-routable placeholder; Vercel does not automatically consume `.example` files or interpolate environment variables in this JSON. Review the resulting file before the separately approved frontend deployment. API rewrites precede the SPA fallback, which excludes `/api` so API failures do not become HTML page responses. Static assets remain served normally.
6. Deploy the approved frontend to Vercel with the settings above. The rewrite preserves `/api/v1`, query strings, methods, and bodies. API response caching is explicitly disabled, including private/auth responses. Keep access tokens in memory and the refresh cookie HttpOnly, host-only, Secure, and scoped to `/api/v1/auth`. Do not add a cookie Domain or strip `Origin`, `Cookie`, `Authorization`, `X-CSRF-Token`, or `Set-Cookie`. Auth POSTs still require the exact frontend `Origin` and `X-CSRF-Token: 1`; never weaken CSRF to make a proxy work.
7. Through the frontend origin, verify both health endpoints, registration/login, 204 logout, cookie creation/clearing, refresh rotation after reload, authenticated routes, enrollment, progress, and authoring with explicitly approved disposable accounts. Confirm browser cookies belong to the frontend host, API responses are not cached, and upstream failures are handled. Compare direct Render and proxied health responses. Configuration alone does not establish live behavior; repeat these checks for the intended release and record what was verified.
8. If an initial admin is required, use the existing `python -m app.cli create-admin --email YOUR-ADDRESS --full-name "Your Name"` from a trusted local backend terminal with the privately loaded direct production URL and `ENVIRONMENT=production`, after separate approval. It prompts securely and rejects existing users. Render Free has no interactive shell. Public registration remains student-only. Instructor creation and demo seeding are development-only; do not bypass that guard or point development tools at Neon production. Existing demo courses/accounts are not automatically published or imported. Production instructor provisioning and demo-course import have dedicated approval-gated procedures below.

No resource creation, migration, account provisioning or deployment is authorized merely by the presence of these instructions.

## Dedicated production instructor (approval required)

The separate `app.provision_production_instructor` maintenance command creates **one new active instructor** per explicitly approved invocation. It does not promote accounts, create an admin, create sessions, import courses, or change public registration/RBAC. Keep the development instructor command development-only. Obtain approval for the dedicated email/display name and production account creation before connecting; no email or password is supplied by the repository.

Verify the DIRECT endpoint in Neon belongs to project `eduflow-production`, branch `production`, and the intended database. Load the existing production settings privately into a local interactive terminal environment, without changing development `.env`, Render settings, or Vercel. Required settings include `ENVIRONMENT=production`, DIRECT `DATABASE_URL` retaining TLS parameters, a valid privately supplied `JWT_SECRET`, `REFRESH_COOKIE_SECURE=true`, and explicit HTTPS origin lists. Do not put credentials in CLI arguments or shell history. Unset libpq `PG*` routing defaults. The same strict endpoint/TLS, effective public schema, and `0004_learning` checks as the course importer apply; the confirmation label attests the operator's project/branch verification and does not independently query Neon project metadata.

From `backend/`, only after approval:

```sh
.venv/bin/python -m app.provision_production_instructor \
  --email "<APPROVED_DEDICATED_INSTRUCTOR_EMAIL>" \
  --full-name "<APPROVED_PUBLIC_DISPLAY_NAME>" \
  --expected-host "<NEON_DIRECT_HOST>" \
  --expected-database "<NEON_DATABASE_NAME>" \
  --confirm-production-provisioning eduflow-production/production
```

Enter and confirm a unique password from a password manager at the **hidden interactive prompts**. There is no password argument or password environment-variable interface. Input refuses a non-interactive or echoing prompt. Existing `RegisterRequest` normalizes email and validates the display name/password; password policy remains 12–128 characters with a letter and a non-space non-letter. Prefer a generated password of at least 20 characters meeting that policy. The existing account service applies Argon2id hashing and unique-email enforcement. A duplicate normalized email, including an existing student account, is rejected without updates or promotion; the unique index also protects concurrent creation.

The service's commit is enclosed in a savepoint inside one caller-owned transaction. Schema, creation, refresh, or pre-commit failures roll back the new account; existing users, sessions, courses, enrollments and progress remain untouched. Success exposes only the instructor UUID after the outer commit. If the final commit acknowledgement is lost, the result may be uncertain: obtain a read-only account verification before retrying, never promote or overwrite an existing account, and never assume a failed response proves no account exists. No account deletion/reset is provided.

Record the returned UUID privately as the approved course owner. After separately approving read-only production access, use it for the course importer dry-run below; account provisioning does not start that import. Database-free tests check validation, hashing, duplicate refusal, target checks and transaction/error orchestration; they do not establish production connectivity or prove PostgreSQL savepoint behavior. An isolated PostgreSQL rehearsal is still needed before production execution.

## Explicit production demo-course import (approval required)

`python -m app.import_demo_courses` is a separate, production-only maintenance CLI. The development seed and instructor CLI retain their development-only guards. It imports the existing original manifest: Python Fundamentals, Modern React Development, UI/UX Design Essentials, SQL & PostgreSQL, and FastAPI Backend Development each have 3 modules/9 lessons; JavaScript Essentials, Git & GitHub Workflow, and Web Development Foundations each have 2 modules/6 lessons. Total: **8 courses, 21 modules, 63 text lessons**, all video URLs null. No accounts, credentials, sessions, enrollments, or progress are imported.

Before any production connection, obtain approval and verify in Neon that the DIRECT endpoint belongs to project `eduflow-production`, branch `production`, and the intended database. The CLI cannot infer a Neon project/branch name from a PostgreSQL connection alone: its confirmation label is an operator attestation, while the expected host/database checks enforce the chosen endpoint. Use a trusted local terminal with the privately loaded production settings described above, `ENVIRONMENT=production`, a DIRECT TLS `DATABASE_URL`, and no libpq `PG*` routing overrides. Never change the development `.env`, pass the URL/password in command arguments, change Render settings, or set production to `development` to bypass safeguards. No migrations are run by the importer; revision `0004_learning` and the public schema are required.

An **existing active instructor UUID** must be approved as the owner. All eight courses reference that user; the importer never creates users or changes roles. An existing dedicated content instructor can be reused. Otherwise, separately approve the dedicated production instructor procedure above. Public registration remains student-only; `create-instructor` remains development-only. Do not promote an existing student/admin, copy development accounts/password hashes, or create a placeholder account through SQL.

After approving read-only production access, from `backend/`, substitute the actual instructor UUID, DIRECT hostname, and database name (not the Neon project name):

```sh
.venv/bin/python -m app.import_demo_courses \
  --instructor-id "<ACTIVE_PRODUCTION_INSTRUCTOR_UUID>" \
  --expected-host "<NEON_DIRECT_HOST>" \
  --expected-database "<NEON_DATABASE_NAME>" \
  --dry-run
```

Inspect the result before separately approving writes: a first empty demo namespace should report `would_create=8, skipped=0`. Any conflicting reserved slug/UUID, owner, curriculum, or publication status stops the operation; existing courses are never repaired or overwritten. Matching published records are skipped using the same deterministic UUIDs and full-content comparison as the development seed. Repeat runs must use the same instructor UUID and manifest.

Only after approving writes, execute:

```sh
.venv/bin/python -m app.import_demo_courses \
  --instructor-id "<ACTIVE_PRODUCTION_INSTRUCTOR_UUID>" \
  --expected-host "<NEON_DIRECT_HOST>" \
  --expected-database "<NEON_DATABASE_NAME>" \
  --apply --confirm-production-import eduflow-production/production
```

Apply wraps the existing per-course publication service in **one outer database transaction**, with service commits contained in savepoints: a failure before commit rolls back the entire import, including earlier courses from this invocation. If the connection fails while acknowledging the final commit, its outcome may be uncertain; use a read-only dry-run to verify before retrying. Unique constraints prevent concurrent duplicates; after a competing import completes, rerun the dry-run rather than bypassing a conflict. Dry-run uses a read-only transaction and does not publish, commit, or change records. Course success output is emitted only after the outer commit.

After a successful import, run the dry-run again: expect `would_create=0, skipped=8`. Verify the eight reserved `demo-` slugs in the public `/api/v1/courses` listing (following pagination) and each `/api/v1/courses/{slug}` detail. The existing publication service validates content, sets publication timestamps, and makes the courses visible; public responses still omit lesson bodies. Existing production users and their sessions/enrollments/progress remain untouched. No rollback-by-deletion is provided: if a successful import later needs removal, request a separate reviewed operation that respects enrollment/progress restrictions.

Preparation tests use database-free doubles; they do not establish live Neon connectivity or prove PostgreSQL savepoint behavior. Run a separately approved isolated PostgreSQL rehearsal before the first production apply if this has not yet been verified.

## Optional videos

The three reviewed CC BY 3.0 videos are confirmed attached in production to **Names and Values**, **Focused Commits** and **Semantic HTML**, with plaintext attribution. The original course importer still uses the base text manifest with null video URLs. Any subsequent production inspection or write requires its own target verification and appropriate approval: follow [Demo videos](demo-videos.md). Attachment status does not establish current external playback availability. Never rerun the original importer to overwrite attached content.
