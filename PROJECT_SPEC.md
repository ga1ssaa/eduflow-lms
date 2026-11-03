# EduFlow LMS — Project Specification

## Purpose and delivery status

EduFlow is a portfolio learning management system for publishing structured courses, enrolling learners, and tracking completion. It should demonstrate a professional, maintainable product with a small operational footprint and a fast local development loop.

**Phases 1–2 cover foundation and identity.** Foundation provides application startup, health endpoints, configuration, database connectivity, migrations, containers, automated checks, and documentation. Identity adds registration, login, JWT access tokens, refresh rotation, logout, current-user access, role dependencies, and explicit administrator bootstrap. Courses, learning workflows, dashboards, and the frontend remain future work. Code and passing checks establish what is delivered; this document also records the roadmap.

## Technology

| Area | Choice |
| --- | --- |
| Runtime and API | Python 3.13, FastAPI |
| Database | PostgreSQL 17, SQLAlchemy 2.0 synchronous sessions, psycopg 3 |
| Configuration and validation | Pydantic 2, pydantic-settings |
| Schema changes | Alembic |
| Quality | pytest, Ruff |
| Local runtime and CI | Docker Compose, GitHub Actions |
| Future frontend | React, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router, Lucide |

Use free local tools and existing dependencies where practical. The frontend stack is a plan, not a Phase 1 dependency.

## Roles and planned workflows

| Role | Planned capabilities |
| --- | --- |
| Student | Browse published courses, enroll, access enrolled lessons, mark lessons complete, view personal progress |
| Instructor | Manage owned courses, modules, and lessons; publish content; inspect progress for their learners |
| Admin | Manage users, roles, and course availability across the system |

Future authorization must enforce these capabilities on the server, including ownership checks. Hiding a UI action is not authorization.

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
| Course | Instructor-owned learning product, publication state, title, description | Future |
| Module | Ordered section belonging to one course | Future |
| Lesson | Ordered learning content belonging to one module | Future |
| Enrollment | Student membership in a course; unique per student and course | Future |
| Lesson completion | Completion record; unique per enrollment and lesson | Future |

Confirm field types and deletion policies when each feature is designed. Enforce relationship integrity and uniqueness in PostgreSQL. Derive progress from eligible lessons and completion records; define behavior for newly added or unpublished lessons before exposing percentages. Avoid storing a second mutable progress total without a demonstrated need.

## API principles

- Keep stable JSON contracts under `/api/v1`; version breaking contract changes deliberately.
- Use Pydantic request and response models with explicit public fields. Never return password hashes, token material, or internal exception details.
- Use standard HTTP methods and status codes. Validate input and return actionable, consistent errors.
- Add bounded pagination and deterministic ordering to future list endpoints.
- Use JWT access tokens, revocable refresh sessions, and current-state role checks. Add resource ownership checks alongside course authoring in Phase 3.
- Design API behavior for the frontend without coupling backend modules to a browser implementation.

## Delivery phases

| Phase | Outcome | Scope boundary |
| --- | --- | --- |
| 1 — Foundation | Runnable API and database infrastructure with checks | Health endpoints only; no authentication or business entities |
| 2 — Identity | Registration, login, token refresh/logout, roles | Authentication and authorization tested before learning features |
| 3 — Course authoring | Instructor-owned courses, ordered modules and lessons, publishing | Server-side ownership and publication rules |
| 4 — Learning | Enrollment, access rules, lesson completion, progress | Integrity and repeat-request behavior tested |
| 5 — Product UI | Responsive student, instructor, and admin experiences | React frontend using the design system and real API data |
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
