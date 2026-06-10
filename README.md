# AI Review Hub

Self-hosted web portal for running AI-powered code reviews on Git repositories using
[Alibaba Open Code Review (OCR)](https://github.com/alibaba/open-code-review).

Select a repository, pick two branches or an open PR/MR, and launch a review — the portal
clones/updates the repository in a local cache, runs the OCR CLI, and stores statuses, logs
and results in PostgreSQL.

## Features (MVP)

- Local authentication (email + password), default admin seeded from env
- GitHub / GitHub Enterprise / GitLab / self-hosted GitLab via env configuration
- Repository, branch and PR/MR selection in the UI
- Branch comparison mode and PR/MR mode
- Background review queue (Redis + BullMQ), OCR runs inside the app container
- Repository cache in `/data/repos` (clone once, fetch afterwards)
- Review history, live logs and OCR results in the UI
- Admin page: users, known repositories, provider settings (read-only)

## Quick start

1. Create your environment file:

```bash
cp .env.example .env
```

2. Edit `.env` and set at minimum:

| Variable | Description |
| --- | --- |
| `APP_SECRET` | Random secret for the app |
| `POSTGRES_PASSWORD` | PostgreSQL password |
| `GIT_PROVIDER` | `github` or `gitlab` |
| `GIT_HOST` | e.g. `https://github.com`, `https://gitlab.company.com` |
| `GIT_TOKEN` | Personal access token with repo read scope |
| `OCR_LLM_URL`, `OCR_LLM_TOKEN`, `OCR_LLM_MODEL` | LLM endpoint used by OCR |
| `OCR_USE_ANTHROPIC`, `OCR_LLM_AUTH_HEADER` | Optional LLM tuning for OCR |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Default admin user (seeded/synced on startup) |
| `SLACK_ENABLED` | Optional: `true` to send Slack notifications when reviews finish |
| `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID` | Slack bot token (`chat:write` scope) and target channel |
| `SLACK_NOTIFY_ON_SUCCESS`, `SLACK_NOTIFY_ON_FAILURE`, `SLACK_NOTIFY_ON_CANCELLED` | Per-status notification toggles |

Never commit `.env` — it is git-ignored. All Git and LLM tokens live only in
environment variables and are never stored in the database.

3. Build and start:

```bash
docker compose up -d --build
```

4. Open http://localhost:8080 and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## How it works

```
Browser ── REST API ── Express (Node.js)
                          │
                          ├─ PostgreSQL  users, sessions, repositories,
                          │              review_jobs, review_results
                          │
                          ├─ Redis       BullMQ review queue
                          │
                          └─ Worker (same container)
                               ├─ RepoCache   /data/repos/<provider>/<repo>
                               │              clone on first use, fetch after
                               └─ OcrRunner   ocr review --from origin/<base>
                                              --to <feature> --format json
```

- Migrations run automatically on startup; the default admin is seeded (and its
  password is kept in sync with `ADMIN_PASSWORD`).
- OCR is the only review engine; all CLI interaction is isolated in
  `src/services/ocrRunner.js`.
- Review statuses: `pending`, `running`, `completed`, `failed`, `cancelled`.

## REST API

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/auth/me` | Current user |
| GET | `/api/repositories` | List repositories from the Git provider |
| GET | `/api/repositories/:id/branches` | List branches |
| GET | `/api/repositories/:id/pull-requests` | List open PRs / MRs |
| POST | `/api/reviews` | Create a review job |
| GET | `/api/reviews` | List all reviews (visible to every user) |
| GET | `/api/reviews/:id` | Review details, logs and result |
| POST | `/api/reviews/:id/cancel` | Cancel a pending/running review (owner or admin) |
| GET | `/api/admin/users` | List users (admin) |
| GET | `/api/admin/repositories` | List known repositories (admin) |
| GET | `/api/admin/settings` | Provider settings, tokens masked (admin) |

## Local development

Requires Node.js >= 20, PostgreSQL and Redis.

```bash
npm install
DATABASE_URL=postgresql://user:pass@localhost:5432/ocr_portal \
QUEUE_URL=redis://localhost:6379/0 \
REPOS_CACHE_DIR=./data/repos REVIEWS_DIR=./data/reviews LOGS_DIR=./data/logs \
GIT_PROVIDER=github GIT_HOST=https://github.com GIT_TOKEN=... \
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=secret \
npm run dev
```

Note: running reviews locally also requires the OCR CLI
(`npm install -g @alibaba-group/open-code-review`).

## Project structure

```
src/
  server.js            entrypoint: migrations, seed, HTTP server, worker
  config.js            env-driven configuration
  db.js                PostgreSQL pool
  migrate.js           SQL migration runner
  migrations/          schema migrations
  seed.js              default admin seeding
  auth.js              sessions, login/logout/me
  providers/           GitHub / GitLab API clients
  services/
    repoCache.js       repository cache in /data/repos
    ocrRunner.js       isolated OCR CLI execution
    reviewService.js   review job persistence and logs
    slackNotifier.js   optional Slack notifications
  queue/               BullMQ queue and worker
  routes/              repositories, reviews, admin endpoints
public/                web UI (vanilla JS SPA)
```
