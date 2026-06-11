# AI Review Hub - Project Specification

## Overview

AI Review Hub is a self-hosted web portal for running AI-powered code reviews on Git repositories.

The portal provides a simple UI where users can:

- Select a repository
- Select two branches (base branch and feature branch)

OR

- Select a Merge Request / Pull Request

Then launch an AI code review using Alibaba Open Code Review (OCR).

The application is deployed as a Docker container.

The system must support:

- GitHub
- GitHub Enterprise
- GitLab
- Self-hosted GitLab

through configuration.

---

# Goals

The main goal is to provide a centralized interface for AI code reviews.

Users should not need to:

- clone repositories manually
- run OCR manually
- remember OCR parameters
- interact with LLM APIs directly

Everything should be available through the web UI.

---

# High-Level Architecture

## Components

### Web Portal

Responsibilities:

- authentication
- repository selection
- branch selection
- review launch
- review history
- review results visualization

### PostgreSQL

Stores:

- users
- sessions
- review jobs
- review results
- repository metadata
- audit logs

### Redis

Stores:

- review queue
- background jobs

### OCR Runner

Runs inside the same container initially.

Responsibilities:

- clone repository
- update local repository cache
- execute OCR
- save results

Future versions may move OCR Runner into a dedicated worker container.

---

# Supported Git Providers

## GitHub

Configuration:

env GIT_PROVIDER=github GIT_HOST=https://github.com GIT_TOKEN=...

## GitHub Enterprise

env GIT_PROVIDER=github GIT_HOST=https://github.company.com GIT_TOKEN=...

## GitLab

env GIT_PROVIDER=gitlab GIT_HOST=https://gitlab.com GIT_TOKEN=...

## Self-hosted GitLab

env GIT_PROVIDER=gitlab GIT_HOST=https://gitlab.company.com GIT_TOKEN=...

---

# Repository Cache

Repositories must be cached locally.

Directory:

text /data/repos

Example:

text /data/repos/ github/ backend-api/ frontend/ gitlab/ payments/

The system must:

- clone repository on first usage
- perform git fetch on subsequent runs
- reuse cached repository

Never clone a fresh repository for every review.

---

# Review Creation Flow

## Selector Search / Filtering

Repositories may contain hundreds of branches and dozens of open
PRs / MRs, so plain dropdowns are not usable.

On the New Review page all three selectors must be searchable
comboboxes with type-to-filter:

- repository selector
- base / feature branch selectors
- pull request / merge request selector

Requirements:

- the user types a query and the list is filtered as they type
  (debounced)
- filtering is performed server-side via the `search` query parameter
  on the corresponding API endpoints
- providers use native API search where available (GitLab projects,
  GitLab branches); otherwise the provider paginates through the
  listing API and filters results server-side (GitHub)
- matching is case-insensitive substring match; for PRs / MRs the
  query matches number, title, source branch and target branch

## Pre-launch Confirmation

A review must be launched only when the parent (base) branch has already
been merged into the feature branch. Otherwise the diff against the parent
branch becomes too large and the review results are unreliable.

Before launching a review the portal must:

- show a warning explaining this requirement
- require the user to explicitly confirm it every time

The review job is created only after this confirmation. The API rejects
review creation requests without the confirmation flag, and the
confirmation is recorded in the review job logs.

## Branch Comparison Mode

User selects:

- repository
- base branch
- feature branch

Example:

text Repository: backend-api Base branch: main Feature branch: feature/user-search

The portal creates a review job.

OCR is executed as:

bash ocr review \ --from origin/main \ --to feature/user-search \ --format json

inside the repository directory.

---

## Pull Request / Merge Request Mode

User selects:

- repository
- pull request / merge request

The portal automatically resolves:

- source branch
- target branch

and launches OCR.

---

# OCR Integration

OCR is installed inside Docker image.

Installation:

bash npm install -g @alibaba-group/open-code-review

OCR is executed through child process execution.

Example:

bash ocr review \ --from origin/main \ --to feature/login \ --format json

The application must capture:

- stdout
- stderr
- exit code

and store results.

---

# LLM Configuration

Configuration through environment variables:

env OCR_LLM_URL= OCR_LLM_TOKEN= OCR_LLM_MODEL= OCR_USE_ANTHROPIC= OCR_LLM_AUTH_HEADER=

Example:

env OCR_LLM_URL=https://api.anthropic.com/v1/messages OCR_LLM_TOKEN=... OCR_LLM_MODEL=claude-opus-4-6 OCR_USE_ANTHROPIC=true OCR_LLM_AUTH_HEADER=x-api-key

---

# Authentication

Initial version:

- local authentication
- email + password

Future:

- GitHub OAuth
- GitLab OAuth
- SSO

---

# User Roles

## Admin

Can:

- configure providers
- view all reviews
- manage users

## User

Can:

- run reviews
- view all reviews on the dashboard (including who started each review)
- cancel only own reviews

## Viewer

Read-only role.

Can:

- view the dashboard and all reviews (including who started each review)
- view review details, logs and results

Cannot:

- create reviews (the New Review page is hidden in the UI and
  `POST /api/reviews` returns 403)
- cancel reviews

---

# User Management

User management is available only to admins.

Admins can:

- create users (email, password, role)
- change user roles
- reset user passwords
- delete users

Rules:

- an admin cannot change their own role
- an admin cannot delete their own account
- a user with existing reviews cannot be deleted
- passwords are stored only as bcrypt hashes, never raw

---

# Review Statuses

Possible states:

text pending running completed failed cancelled

---

# Review Result Storage

Store:

- repository
- branch information
- pull request information
- OCR output
- execution logs
- execution time
- user

Example:

json { "repository": "backend-api", "baseBranch": "main", "featureBranch": "feature/login", "status": "completed", "durationSeconds": 42 }

---

# Database Schema

## users

text id email password_hash role created_at

## repositories

text id name provider external_id created_at

## review_jobs

text id repository_id user_id status created_at started_at finished_at

## review_results

text id review_job_id ocr_output_json summary created_at

---

# REST API

## Authentication

http POST /api/auth/login POST /api/auth/logout GET /api/auth/me

## Repositories

http GET /api/repositories GET /api/repositories/:id/branches GET /api/repositories/:id/pull-requests

All three endpoints accept an optional `search` query parameter for
server-side filtering (case-insensitive substring match):

http GET /api/repositories?search=backend GET /api/repositories/:id/branches?search=feature/login GET /api/repositories/:id/pull-requests?search=login

## Reviews

http POST /api/reviews GET /api/reviews GET /api/reviews/:id POST /api/reviews/:id/cancel

## Administration (admin only)

http GET /api/admin/users POST /api/admin/users PATCH /api/admin/users/:id DELETE /api/admin/users/:id GET /api/admin/repositories GET /api/admin/settings

---

# UI Pages

## Login

Email/password authentication.

## Dashboard

Available to all authenticated users. Every user sees all reviews
and who started each of them.

Displays:

- recent reviews
- review statistics

## New Review

Allows selecting:

- repository
- branch mode
- PR/MR mode

and launching review.

Repository, branch and PR/MR selectors are searchable comboboxes:
the user types a query and matching items are loaded from the server
(see "Selector Search / Filtering").

## Review Details

Displays:

- status
- logs
- OCR output
- execution metadata

## Administration

Available only to admins.

Displays:

- users
- repositories
- provider settings

User management:

- create users
- change user roles
- reset user passwords
- delete users

---

# Slack Notifications

The system must support optional Slack notifications.

When a code review finishes, fails or is cancelled, the system may send a
notification to a configured Slack channel.

Configuration must be done through environment variables:

- `SLACK_ENABLED`
- `SLACK_BOT_TOKEN`
- `SLACK_CHANNEL_ID`
- `SLACK_NOTIFY_ON_SUCCESS`
- `SLACK_NOTIFY_ON_FAILURE`
- `SLACK_NOTIFY_ON_CANCELLED`

Slack notifications must be optional.

If `SLACK_ENABLED=false`, the system must not send Slack messages.

If Slack variables are missing, the application must still start normally,
but Slack notifications should be disabled or skipped with a clear log
message.

Notification failures must never affect the review job itself.

---

# Logging

All operations must be logged.

Examples:

text User started review Repository cloned OCR started OCR finished Review failed

Logs must be visible in UI.

---

# Future Enhancements

- Multiple review engines
- Claude Code integration
- Codex integration
- Gemini integration
- Scheduled reviews
- Webhooks
- PR comment publishing
- Email notifications
- Review templates
