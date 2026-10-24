# Admin

Endpoints for admins only, under `/api/v2/admin`. Everyone else gets `403`.

## Background jobs

Some work runs on timers inside the backend: publishing queued Social Hub posts, task reminders,
attendance upkeep. Each module's jobs are in `Backend/src/jobs/`. They run in this one process
(like the rate limits), so they assume a single backend instance. `DISABLE_SCHEDULER=true` turns
the timers off; the jobs can then still be run by hand.

| Method and path | Does |
|---|---|
| `GET /admin/jobs` | Each job's `name`, how often it runs (`everyMinutes`), whether it is `running`, and `lastRunAt`, `lastResult`, `lastError` |
| `POST /admin/jobs/:name/run` | Runs it now and returns what it did. Unknown names answer `404`. Outside production, `{ "now": "2026-10-24T18:00:00Z" }` runs it as if it were that time |

Running a job by hand is recorded in the audit log (`admin_job_run`).
