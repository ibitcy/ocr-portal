'use strict';

const { Worker } = require('bullmq');
const { QUEUE_NAME, createConnection } = require('./queue');
const { provider } = require('../providers');
const RepoCache = require('../services/repoCache');
const ocrRunner = require('../services/ocrRunner');
const reviews = require('../services/reviewService');
const slackNotifier = require('../services/slackNotifier');
const { buildSuggestions } = require('../services/suggestionDiff');

const repoCache = new RepoCache(provider);

function buildSummary(parsed, exitCode) {
  if (exitCode !== 0) return `OCR exited with code ${exitCode}`;
  if (!parsed) return 'Review completed (non-JSON output)';
  const comments = parsed.comments || parsed.issues || parsed.results;
  if (Array.isArray(comments)) return `Review completed: ${comments.length} finding(s)`;
  if (Array.isArray(parsed)) return `Review completed: ${parsed.length} finding(s)`;
  return 'Review completed';
}

async function processReview(job) {
  const { reviewJobId } = job.data;
  const reviewJob = await reviews.getJob(reviewJobId);
  if (!reviewJob) {
    console.error(`Review job ${reviewJobId} not found, skipping`);
    return;
  }
  if (reviewJob.status === 'cancelled') {
    await reviews.appendLog(reviewJobId, 'Job was cancelled before execution, skipping');
    return;
  }

  const log = (msg) => reviews.appendLog(reviewJobId, msg).catch(() => {});
  const startedAt = new Date();

  await reviews.setStatus(reviewJobId, 'running', { started_at: startedAt });
  await log(
    `Review started by ${reviewJob.user_email} for ${reviewJob.repository_name} ` +
      `(${reviewJob.base_branch} -> ${reviewJob.feature_branch})`
  );

  try {
    const repoDir = await repoCache.ensure(reviewJob.repository_name, log);
    await repoCache.checkoutBranch(reviewJob.repository_name, reviewJob.feature_branch, log);

    const { exitCode, stdout, stderr } = await ocrRunner.run({
      jobId: reviewJobId,
      cwd: repoDir,
      baseBranch: reviewJob.base_branch,
      featureBranch: reviewJob.feature_branch,
      onLog: log
    });

    const parsed = ocrRunner.parseOutput(stdout);
    const summary = buildSummary(parsed, exitCode);
    // Best-effort: returns null on failure, the UI then falls back to raw output
    const suggestions = buildSuggestions({ parsed, rawStdout: stdout });
    if (suggestions) await log(`Generated diffs for ${suggestions.length} suggestion(s)`);

    // Token usage is optional; parsing failures must never fail the review
    let tokenUsage = null;
    try {
      tokenUsage = ocrRunner.parseTokenUsage(parsed);
      if (tokenUsage) {
        await log(
          `Token usage: input=${tokenUsage.inputTokens ?? 'n/a'}, ` +
            `output=${tokenUsage.outputTokens ?? 'n/a'}, total=${tokenUsage.totalTokens ?? 'n/a'}`
        );
      }
    } catch (err) {
      await log(`Warning: token usage parsing failed: ${err.message}`);
    }

    await reviews.saveResult({
      jobId: reviewJobId,
      ocrOutputJson: parsed,
      suggestionsJson: suggestions,
      tokenUsage,
      rawStdout: stdout,
      rawStderr: stderr,
      exitCode,
      summary
    });

    // Respect a cancellation that happened while OCR was running
    const current = await reviews.getJob(reviewJobId);
    const finishedAt = new Date();
    const duration = Math.round((finishedAt - startedAt) / 1000);

    if (current?.status === 'cancelled') {
      await reviews.setStatus(reviewJobId, 'cancelled', {
        finished_at: finishedAt,
        duration_seconds: duration
      });
      await log('Review cancelled');
      await slackNotifier.notifyReviewFinished(await reviews.getJob(reviewJobId));
      return;
    }

    const status = exitCode === 0 ? 'completed' : 'failed';
    await reviews.setStatus(reviewJobId, status, {
      finished_at: finishedAt,
      duration_seconds: duration,
      error: exitCode === 0 ? null : `OCR exited with code ${exitCode}`
    });
    await log(`Review ${status} in ${duration}s`);
    await slackNotifier.notifyReviewFinished(await reviews.getJob(reviewJobId), { summary });
  } catch (err) {
    const finishedAt = new Date();
    const duration = Math.round((finishedAt - startedAt) / 1000);
    await reviews.setStatus(reviewJobId, 'failed', {
      finished_at: finishedAt,
      duration_seconds: duration,
      error: err.message
    });
    await log(`Review failed: ${err.message}`);
    await slackNotifier.notifyReviewFinished(await reviews.getJob(reviewJobId), {
      error: err.message
    });
  }
}

function startWorker() {
  const worker = new Worker(QUEUE_NAME, processReview, {
    connection: createConnection(),
    concurrency: 1
  });
  worker.on('error', (err) => console.error('Worker error:', err.message));
  console.log('Review worker started');
  return worker;
}

module.exports = { startWorker };
