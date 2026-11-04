# EduFlow LMS — Project Specification

## Purpose and delivery status

EduFlow is a portfolio learning management system for publishing structured courses, enrolling learners, and tracking completion. It should demonstrate a professional, maintainable product with a small operational footprint and a fast local development loop.

**Phases 1–4 cover the core backend.** Foundation, identity, courses, and learning provide the API. Phases 5A–5B provide the React frontend: catalog, authentication, student learning, instructor dashboards and authoring, curriculum ordering, learner statistics, admin overview and publication moderation. Production QA and later product polish remain future work. Code and passing checks establish what is delivered; this document also records the roadmap.

## Technology

| Area | Choice |
| --- | --- |
| Runtime and API | Python 3.13, FastAPI |
| Database | PostgreSQL 17, SQLAlchemy 2.0 synchronous sessions, psycopg 3 |
| Configuration and validation | Pydantic 2, pydantic-settings |
| Schema changes | Alembic |
| Quality | pytest, Ruff |
| Local runtime and CI | Docker Compose, GitHub Actions |
| Frontend | React, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router, Lucide |

Use free local tools and existing dependencies where practical. Frontend dependencies live separately under `frontend/`.

## Roles and planned workflows

| Role | Planned capabilities |
| --- | --- |
| Student | Browse published courses, enroll, access enrolled lessons, mark lessons complete, view personal progress |
| Instructor | Manage owned courses, modules, and lessons; publish content; inspect progress for their learners |
| Admin | Review all courses and moderate availability; user/role management remains outside the implemented API |

Authorization enforces implemented capabilities on the server, including ownership checks. Hiding a UI action is not authorization.

## Phase 1 functional requirements

- Expose the API below `/api/v1` and provide FastAPI-generated API documentation.
- `GET /api/v1/health` returns HTTP 200 with `{"status":"ok"}` when the application is running. It must not depend on a database connection.
- `GET /api/v1/health/db` performs a lightweight database connectivity check. It returns HTTP 200 with `{"status":"ok"}` on success, or HTTP 503 with `{"detail":"Database unavailable"}` when connectivity fails. Responses must not expose credentials or driver errors.
- Load validated settings from the environment, with a documented local `.env` workflow and a tracked example containing no secrets.
- Provide synchronous request-scoped database sessions with deterministic cleanup. Roll back failed work and explicitly commit successful writes when business workflows are introduced.
- Provide Alembic configuration and a reproducible migration workflow. Phase 1 introduces no business tables.
- Provide Docker Compose startup, automated endpoint checks, linting, formatting checks, and CI.

## Architecture

Use a backend-first modular monolith: one deployable API, one PostgreSQL database, and explicit feature boundaries. Avoid microservices, queues, caching layers, and generic framework abstractions until a concrete requirement justifies them.

The intended flow for business features is **Router → Service → Repository → Database**:

- Routers handle HTTP input, response schemas, dependencies, and status codes.
- Services own business rules and transaction boundaries.
- Repositories encapsulate nontrivial persistence queries.
- Database infrastructure owns engines, sessions, and metadata.

Keep configuration and shared infrastructure separate from feature modules. Add services and repositories when a feature needs them; a simple health check does not need empty layers or a generic CRUD base. Synchronous database operations must not block an async event loop; use ordinary synchronous route handlers or the framework's supported thread execution mechanisms.

## Phase 2 identity requirements

- Public registration normalizes email, validates credentials, rejects duplicates and extra role fields, and assigns `student` only.
- Login rejects incorrect credentials and inactive users. Argon2id hashes passwords; JWT access tokens are short lived and validate signature, expiration, issuer, subject, and token type.
- Refresh tokens are opaque cryptographically random values delivered only through HttpOnly cookies. Persist hashes, never raw tokens. Lock and recheck refresh sessions during rotation; atomically revoke the old session and issue a replacement. Reject expired, revoked, and reused sessions, including concurrent attempts.
- Logout revokes the supplied refresh session and clears its cookie. It does not invalidate previously issued stateless access tokens.
- Current-user access and role dependencies query current PostgreSQL user state. Inactive users are rejected. Roles in browser input or stale token claims never authorize a request.
- All auth POST requests require an exact allowed Origin and the custom `X-CSRF-Token: 1` header. CORS permits explicit trusted origins with credentials. Production cookies require Secure; SameSite and lifetime are configured explicitly. Browser access tokens belong in memory; refresh tokens never belong in localStorage.
- An explicit terminal CLI creates administrators using a hidden password prompt. No default account, automatic bootstrap, silent promotion, or password command argument exists.
- Authentication uses Router → Service → Repository → Database. Keep auth as one feature module rather than introducing another deployment or generic abstraction layer.

## Domain model and status

| Entity | Responsibility and relationships | Status |
| --- | --- | --- |
| User | UUID, unique indexed normalized email, password hash, full name, constrained role, active state, UTC creation/update timestamps | Phase 2 |
| Refresh session | UUID, user foreign key, unique token hash, UTC expiry/revocation/creation timestamps | Phase 2 |
| Course | Instructor-owned product, unique slug, title, description, category, constrained level/publication state, UTC timestamps | Phase 3 |
| Module | Ordered titled section belonging to one course; positive unique position per course | Phase 3 |
| Lesson | Ordered content/video belonging to one module; positive unique position per module | Phase 3 |
| Enrollment | UUID, student/course foreign keys, UTC enrollment timestamp; unique per student and course | Phase 4 |
| LessonProgress | UUID, enrollment/lesson foreign keys, UTC completion timestamp; unique per enrollment and lesson | Phase 4 |

Confirm field types and deletion policies when each feature is designed. Enforce relationship integrity and uniqueness in PostgreSQL. Derive progress from eligible lessons and completion records; define behavior for newly added or unpublished lessons before exposing percentages. Avoid storing a second mutable progress total without a demonstrated need.

## Phase 3 course requirements

- Creation derives instructor identity from the authenticated user and starts in draft state. Public input cannot set ownership, publication state, or child positions. Require a canonical lowercase slug and enforce global uniqueness in PostgreSQL, reporting concurrent collisions safely.
- Instructors manage owned courses and curriculum. Admin management access is explicit in the role dependencies and service policy. Owned listings remain scoped to the current user; admin listings include all courses. Student and inactive-user authoring requests are denied.
- Provide course CRUD and publish/unpublish endpoints under `/api/v1/instructor/courses`, child management under `/api/v1/instructor/modules` and `/api/v1/instructor/lessons`, and exact-parent `/modules/order` and `/lessons/order` endpoints. Reuse auth dependencies and request-scoped synchronous sessions.
- Reordering accepts exactly the complete current set of child IDs once. Reject foreign, duplicate, missing, and stale sets without partial writes. Serialize curriculum mutations on the course row and use deferrable parent-position unique constraints. Assign contiguous positions on append/delete/reorder.
- Publishing requires a valid title, nonempty description and category, at least one module and one total lesson, and a title plus content or valid HTTP(S) video URL for every lesson. Repeated publishing is safe and preserves the current publication date. Unpublishing clears that date. Validate published edits in the same transaction and roll back changes that invalidate publication.
- Only drafts without enrollments can be deleted. Course/module cascades apply only where no learning records would be lost. Completed lessons and modules containing completion records are protected from deletion. User foreign keys restrict deletion of referenced instructors. No soft-delete mechanism is introduced.
- Public `/api/v1/courses` supports bounded pagination, literal case-insensitive title search, category and level filters, deterministic ordering, instructor names, and curriculum counts without N+1 queries. Public `/{slug}` exposes only a published course and ordered titles; never lesson content or video URLs. Drafts are not discoverable publicly.
- Admin-only `/api/v1/admin/courses` supports listing, full details, publishing, and unpublishing under the same validation rules. No separate moderation workflow is introduced.
- Enrollment, student access to full lesson content, progress, dashboards, and frontend screens are excluded from this phase.

## API principles

- Keep stable JSON contracts under `/api/v1`; version breaking contract changes deliberately.
- Use Pydantic request and response models with explicit public fields. Never return password hashes, token material, or internal exception details.
- Use standard HTTP methods and status codes. Validate input and return actionable, consistent errors.
- Add bounded pagination and deterministic ordering to future list endpoints.
- Use JWT access tokens, revocable refresh sessions, and current-state role checks. Enforce resource ownership checks for course authoring.
- Design API behavior for the frontend without coupling backend modules to a browser implementation.

## Phase 4 learning requirements

- Only current active students enroll in published courses, using authenticated identity. Unique constraints and transactional upserts make enrollment and completion idempotent under concurrency. Instructor/admin roles cannot use student learning routes.
- Own enrollment listings include dates, course availability, and derived progress. Published enrolled-course details include curriculum outlines; full lesson content and video URLs require the protected enrolled-student endpoint. Never expose another student's enrollment or completions.
- Unpublishing preserves enrollments and completion records but blocks protected course/lesson/progress access and completion changes until republished. Own listings/dashboard retain basic enrollment metadata and numeric progress, without draft curriculum or content.
- Completion records represent completed lessons only. Marking incomplete intentionally removes the record. Calculate counts from lessons belonging to the enrolled course, not client values or cached percentages. Round percentages to two decimals with decimal `ROUND_HALF_UP`; zero lessons is 0% and incomplete. Determine completion from counts, not rounded percentages.
- Adding lessons can reduce a previously complete percentage. Removing uncompleted lessons changes the denominator. Reject course deletion when enrolled and reject lesson/module deletion that would remove completions. Foreign keys preserve learning records even if an operation bypasses API checks.
- Database triggers validate completion course membership and prohibit reparenting enrollment identity, module course, or lesson module. Preserve existing rows and tables through additive migrations.
- Student dashboard data uses real enrollments and current progress: total, completed, remaining in-progress, per-course summaries, and enrollment dates. Zero-progress courses count as in-progress.
- Instructor students/statistics endpoints require ownership or explicit admin authorization and use bounded SQL query counts. Include actual enrollment/completion totals and progress summaries without passwords, hashes, tokens, or authentication secrets.
- Learning operations coordinate with existing course locks and return response snapshots within protected transactions. Do not introduce payments, certificates, quizzes, messaging, video hosting, or frontend code.

## Delivery phases

| Phase | Outcome | Scope boundary |
| --- | --- | --- |
| 1 — Foundation | Runnable API and database infrastructure with checks | Health endpoints only; no authentication or business entities |
| 2 — Identity | Registration, login, token refresh/logout, roles | Authentication and authorization tested before learning features |
| 3 — Course authoring | Instructor-owned courses, ordered modules and lessons, publishing | Server-side ownership and publication rules |
| 4 — Learning | Enrollment, access rules, lesson completion, progress | Integrity and repeat-request behavior tested |
| 5A — Product UI foundation | Catalog, auth, student learning, instructor reviews and admin publication | Real API data; responsive light/dark themes; authoring forms deferred |
| 5B — Authoring UI | Instructor course/module/lesson forms and ordering | Existing CRUD APIs; ownership, 409 conflicts and publication validation |
| 6 — Polish | Dashboards, accessibility, documentation, operational hardening | Prioritize evidence from real workflows; no invented metrics |

Future phase scope is provisional and should be refined before implementation.

## Definition of done

For Phase 1:

- A clean checkout can start the documented local stack using the example configuration.
- Both health routes meet their contracts; database failure produces a controlled 503 without leaking internals.
- Sessions are cleaned up reliably; configuration and migration tooling load correctly.
- Alembic upgrade validation succeeds against a disposable local database, with no business tables introduced.
- pytest, Ruff lint, and Ruff formatting checks pass locally and in CI.
- Secrets, generated caches, and local database files are ignored. Documentation matches actual commands and behavior.

For later features, also require authorization tests, success and failure cases, reviewed migrations where applicable, responsive accessible UI where applicable, and explicit documentation of remaining limitations. Do not claim a future feature is complete from scaffolding alone.

For Phase 2, require registration/login validation, JWT rejection cases, real PostgreSQL refresh rotation and concurrency tests, logout cookie clearing, all role combinations and inactive-user checks, CLI bootstrap checks, and unchanged health endpoints. Validate migrations on an isolated database without resetting development data. Run pytest, Ruff lint/format, and an independent security review. Document any unavailable verification rather than treating a skipped integration suite as completion.

For Phase 3, also require real PostgreSQL course/curriculum CRUD, ownership and admin checks, publication invariants, atomic reorder and rollback tests, foreign-key/unique/check-constraint tests, catalog visibility/filtering/pagination/counts, and public content-leakage checks. Preserve all earlier-phase tests. Apply the additive migration without resetting development data and confirm Alembic metadata matches the database.

For Phase 4, require isolated PostgreSQL tests for enrollment/access/complete/incomplete, duplicate and concurrent requests, role/ownership restrictions, publication changes, rounding, curriculum changes, dashboard/statistics values, deletion safeguards, and database cross-course integrity. Preserve all earlier tests and development data. Verify migration, complete pytest suite, Ruff, live health/auth restrictions, and an independent final review.

For Phase 5B, require instructor course and curriculum CRUD, changed-field PATCH semantics, full-set atomic reorder requests, confirmed publishing/deletion and server-conflict feedback. Preserve unsaved input across refetch errors and warn before navigation/sign-out. Require role-protected instructor/admin dashboards with real course counts, paginated per-course learner statistics, and no per-course statistics fan-out on overview pages. No global instructor enrollment aggregate is claimed without backend support. Verify frontend checks/build, unit regressions and real-API instructor → student → admin browser workflows on an isolated database, plus both themes and narrow layouts. Backend/authentication security remains unchanged.
