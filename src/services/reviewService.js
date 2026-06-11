'use strict';

const pool = require('../db');

async function appendLog(jobId, message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await pool.query(
    `UPDATE review_jobs SET logs = logs || $1 WHERE id = $2`,
    [line, jobId]
  );
  console.log(`[job ${jobId}] ${message}`);
}

async function upsertRepository(provider, externalId, name) {
  const { rows } = await pool.query(
    `INSERT INTO repositories (provider, external_id, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider, external_id) DO UPDATE SET name = EXCLUDED.name
     RETURNING *`,
    [provider, externalId, name]
  );
  return rows[0];
}

async function createJob({ repositoryId, userId, mode, baseBranch, featureBranch, prNumber, prTitle }) {
  const { rows } = await pool.query(
    `INSERT INTO review_jobs
       (repository_id, user_id, mode, base_branch, feature_branch, pr_number, pr_title)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [repositoryId, userId, mode, baseBranch, featureBranch, prNumber || null, prTitle || null]
  );
  return rows[0];
}

async function getJob(id) {
  const { rows } = await pool.query(
    `SELECT j.*, r.name AS repository_name, r.provider, r.external_id AS repository_external_id,
            u.email AS user_email
       FROM review_jobs j
       JOIN repositories r ON r.id = j.repository_id
       JOIN users u ON u.id = j.user_id
      WHERE j.id = $1`,
    [id]
  );
  return rows[0] || null;
}

// Reviews are visible to every authenticated user
async function listJobs({ limit = 100 } = {}) {
  const { rows } = await pool.query(
    `SELECT j.id, j.mode, j.base_branch, j.feature_branch, j.pr_number, j.pr_title,
            j.status, j.created_at, j.started_at, j.finished_at, j.duration_seconds,
            r.name AS repository_name, u.email AS user_email
       FROM review_jobs j
       JOIN repositories r ON r.id = j.repository_id
       JOIN users u ON u.id = j.user_id
      ORDER BY j.id DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

async function getResult(jobId) {
  const { rows } = await pool.query(
    'SELECT * FROM review_results WHERE review_job_id = $1 ORDER BY id DESC LIMIT 1',
    [jobId]
  );
  return rows[0] || null;
}

async function setStatus(jobId, status, extra = {}) {
  const sets = ['status = $2'];
  const params = [jobId, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }
  await pool.query(`UPDATE review_jobs SET ${sets.join(', ')} WHERE id = $1`, params);
}

async function saveResult({ jobId, ocrOutputJson, suggestionsJson, rawStdout, rawStderr, exitCode, summary }) {
  await pool.query(
    `INSERT INTO review_results
       (review_job_id, ocr_output_json, suggestions_json, raw_stdout, raw_stderr, exit_code, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      jobId,
      ocrOutputJson ? JSON.stringify(ocrOutputJson) : null,
      suggestionsJson ? JSON.stringify(suggestionsJson) : null,
      rawStdout,
      rawStderr,
      exitCode,
      summary
    ]
  );
}

module.exports = {
  appendLog,
  upsertRepository,
  createJob,
  getJob,
  listJobs,
  getResult,
  setStatus,
  saveResult
};
