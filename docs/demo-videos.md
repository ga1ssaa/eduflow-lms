# Optional demo lesson videos

The reviewed sidecar attaches three supplementary English videos to existing original demo lessons. The base `backend/app/demo_courses.json` remains unchanged: 8 courses, 21 modules, 63 text lessons, null video URLs and stable UUIDs. No accounts, courses, lessons, enrollments or progress are created, and nothing runs at startup.

Production attachment is confirmed for **Names and Values**, **Focused Commits** and **Semantic HTML**, with the plaintext attribution described below. This records the confirmed attachment status; current external playback availability requires separate verification.

| Target lesson                                                   | Video / author                                                                | Source                                                                                      | License                                                   |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Python Fundamentals → module 1, lesson 1: Names and Values      | Lecture 1.3 Python as a Language / Charles Severance (University of Michigan) | [Commons record](https://commons.wikimedia.org/wiki/File:Pythonlectureseverance1.3.webm)    | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Git & GitHub Workflow → module 1, lesson 2: Focused Commits     | Git Foundations - Commit / GitHub                                             | [Commons record](https://commons.wikimedia.org/wiki/File:Git_Foundations_-_Commit.webm)     | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Web Development Foundations → module 1, lesson 1: Semantic HTML | Web standards for the future / W3C                                            | [Commons record](https://commons.wikimedia.org/wiki/File:Web_standards_for_the_future.webm) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |

The Commons source records were reviewed for authorship and licensing. The videos are linked unchanged, without downloading or rehosting. The Python video is a **2012 conceptual introduction**, supplementary context rather than a tutorial on modern Python syntax; its attribution includes this note. Availability, delivery speed, codecs and continued hosting depend on the external host.

The W3C media URL uses Commons' lower-bandwidth 480p VP9/Opus rendition (854×480), with no editorial edits. Its source page, author, license and attribution remain unchanged.

`backend/app/demo_videos.json` records each course slug and one-based module/lesson position, title, HTTPS media/source URLs, author, license and license URL. Optional verified author URLs and contextual notes are supported. Only direct `upload.wikimedia.org` WebM/MP4/OGV files are accepted. The CLI does not fetch media or accept arbitrary manifest paths.

The selected lesson keeps its exact original text. A deterministic plaintext `Video attribution:` block is appended with title, source, author, license link and unchanged-video notice, keeping attribution with displayed/exported lesson content.

Playback uses native browser controls and remains optional for completion. App caption tracks are not yet integrated, so this is not a claim of WCAG AA conformance for prerecorded media. English SRT source pages exist for [Python](https://commons.wikimedia.org/wiki/TimedText:Pythonlectureseverance1.3.webm.en.srt) and [W3C](https://commons.wikimedia.org/wiki/TimedText:Web_standards_for_the_future.webm.en.srt); no English Git track was verified. Subtitle provenance, conversion to WebVTT and caption playback require separate verification. The W3C subtitle page carries a separate CC BY-SA 4.0 text license; do not assume the video's CC BY 3.0 automatically licenses caption text.

## Local development

Migrations and the original demo seed must already be applied. Use the existing active instructor UUID that owns those demo courses. From `backend/`, with the intended local settings loaded privately:

```sh
.venv/bin/python -m app.attach_demo_videos \
  --instructor-id '<ACTIVE_INSTRUCTOR_UUID>' \
  --expected-host '127.0.0.1' \
  --expected-database '<LOCAL_DATABASE_NAME>'
```

The default is a **read-only dry-run**; `--dry-run` may be explicit. Expect `would_attach=3, skipped=0` initially. After approving a local write, repeat with `--apply`; success reports `attached=3, skipped=0`. A subsequent dry-run reports `would_attach=0, skipped=3`.

Development mode requires an explicitly matching `localhost`, `127.0.0.1` or `::1` PostgreSQL endpoint. Docker service names are refused; use an explicitly configured loopback endpoint from the host. Routing query overrides and libpq routing defaults are refused. The expected database, effective public schema and revision `0004_learning` are checked before attachment.

## Preservation and transactions

The complete affected course must match the deterministic original: ownership, identity, publication, modules, lesson ordering, titles and content. Only an original selected lesson or its exact approved URL plus attribution is accepted. Missing courses, changed owners, edits to other lessons, different URLs, partial attribution and renamed/unpublished courses stop preflight before any assignments. Unrelated courses remain untouched.

Apply locks affected courses in stable order. All lesson changes share one outer transaction; pre-commit failure rolls back the invocation. Dry-run uses `SET TRANSACTION READ ONLY` and rolls back without writing. If final commit acknowledgement is lost, inspect with a read-only dry-run before retrying.

**After attachment, the original seed/importer intentionally reports a fingerprint conflict**, because selected lessons now have video URLs and attribution. Verify/repeat using the attachment CLI. Do not bypass importer checks, change its fingerprint or overwrite attached content. Removal requires a separately reviewed operation; no reset/delete command is provided.

## Production maintenance procedure: approval required

The confirmed attachments do not authorize further production access. Separately verify in Neon that the DIRECT endpoint belongs to project `eduflow-production`, branch `production`, and the intended database. Obtain read-only access approval and load credentials privately without changing development `.env` or hosted settings. Use `ENVIRONMENT=production`, existing production security settings, and TLS `sslmode=require&channel_binding=require` or `sslmode=verify-full`. Unset libpq routing defaults.

After approval, inspect with the same command using the approved production instructor UUID, DIRECT host and database, plus `--dry-run`. Production reuses the importer's strict target/TLS guard, expected database/public-schema verification and `0004_learning` check. SQL/hostname checks cannot establish the Neon project/branch.

Only after a clean dry-run and **separate write approval**, use:

```sh
.venv/bin/python -m app.attach_demo_videos \
  --instructor-id '<APPROVED_PRODUCTION_INSTRUCTOR_UUID>' \
  --expected-host '<NEON_DIRECT_HOST>' \
  --expected-database '<NEON_DATABASE_NAME>' \
  --apply --confirm-production eduflow-production/production
```

The confirmation attests the project/branch, not the database name. Follow with a read-only check expecting all three skipped. Never put credentials in CLI arguments, change production environment labels to bypass safeguards or run migrations through this command. A local PostgreSQL rehearsal does not establish Neon/TLS connectivity.

## Checks

```sh
cd backend
.venv/bin/python -m pytest tests/test_demo_videos.py -m 'not integration'
.venv/bin/ruff check app/attach_demo_videos.py tests/test_demo_videos.py
.venv/bin/ruff format --check app/attach_demo_videos.py tests/test_demo_videos.py
```

Unit tests use test-only URLs and forbid database connections. Opt-in PostgreSQL tests reuse the maintenance suite's strict private-cluster fixture: explicit maintenance test settings are required, fresh `eduflow_test_maintenance_*` databases are created and retained. They check exact attachment/repeat behavior, read-only dry-run, real flush/root rollback and preservation of existing users, sessions, enrollments and progress. Without those explicit settings they skip. Never target development, staging or production with these test settings.
