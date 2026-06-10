CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id         SERIAL PRIMARY KEY,
  token      TEXT NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

CREATE TABLE IF NOT EXISTS repositories (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  provider    TEXT NOT NULL,
  external_id TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);

CREATE TABLE IF NOT EXISTS review_jobs (
  id               SERIAL PRIMARY KEY,
  repository_id    INTEGER NOT NULL REFERENCES repositories(id),
  user_id          INTEGER NOT NULL REFERENCES users(id),
  mode             TEXT NOT NULL CHECK (mode IN ('branches', 'pr')),
  base_branch      TEXT NOT NULL,
  feature_branch   TEXT NOT NULL,
  pr_number        INTEGER,
  pr_title         TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  logs             TEXT NOT NULL DEFAULT '',
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  duration_seconds INTEGER
);

CREATE INDEX IF NOT EXISTS idx_review_jobs_user ON review_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_review_jobs_status ON review_jobs(status);

CREATE TABLE IF NOT EXISTS review_results (
  id              SERIAL PRIMARY KEY,
  review_job_id   INTEGER NOT NULL REFERENCES review_jobs(id) ON DELETE CASCADE,
  ocr_output_json JSONB,
  raw_stdout      TEXT,
  raw_stderr      TEXT,
  exit_code       INTEGER,
  summary         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_results_job ON review_results(review_job_id);
