'use strict';

const express = require('express');
const { provider } = require('../providers');
const { requireAuth } = require('../auth');
const reviews = require('../services/reviewService');
const { enqueueReview } = require('../queue/queue');
const ocrRunner = require('../services/ocrRunner');
const slackNotifier = require('../services/slackNotifier');

const router = express.Router();
router.use(requireAuth);

router.post('/', async (req, res, next) => {
  try {
    const {
      repositoryId,
      repositoryName,
      mode,
      baseBranch,
      featureBranch,
      prNumber,
      baseMergedConfirmed
    } = req.body || {};

    if (!repositoryId || !repositoryName || !mode) {
      return res.status(400).json({ error: 'repositoryId, repositoryName and mode are required' });
    }
    // The base branch must already be merged into the feature branch,
    // otherwise the diff is too large and review results are unreliable.
    if (baseMergedConfirmed !== true) {
      return res.status(400).json({
        error:
          'You must confirm that the base branch is already merged into the feature branch'
      });
    }

    let base = baseBranch;
    let feature = featureBranch;
    let prTitle = null;

    if (mode === 'pr') {
      if (!prNumber) return res.status(400).json({ error: 'prNumber is required in PR mode' });
      const pr = await provider.getPullRequest(repositoryId, prNumber);
      base = pr.targetBranch;
      feature = pr.sourceBranch;
      prTitle = pr.title;
    } else if (mode === 'branches') {
      if (!base || !feature) {
        return res.status(400).json({ error: 'baseBranch and featureBranch are required' });
      }
      if (base === feature) {
        return res.status(400).json({ error: 'Base and feature branches must differ' });
      }
    } else {
      return res.status(400).json({ error: 'mode must be "branches" or "pr"' });
    }

    const repo = await reviews.upsertRepository(provider.name, String(repositoryId), repositoryName);
    const job = await reviews.createJob({
      repositoryId: repo.id,
      userId: req.user.id,
      mode,
      baseBranch: base,
      featureBranch: feature,
      prNumber: mode === 'pr' ? prNumber : null,
      prTitle
    });

    await reviews.appendLog(
      job.id,
      `User ${req.user.email} created review job and confirmed that ` +
        `base branch "${base}" is already merged into feature branch "${feature}"`
    );
    await enqueueReview(job.id);
    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    res.json(await reviews.listJobs());
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const job = await reviews.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Review not found' });
    const result = await reviews.getResult(job.id);
    res.json({ ...job, result });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', async (req, res, next) => {
  try {
    const job = await reviews.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Review not found' });
    if (req.user.role !== 'admin' && job.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!['pending', 'running'].includes(job.status)) {
      return res.status(400).json({ error: `Cannot cancel a ${job.status} review` });
    }

    await reviews.setStatus(job.id, 'cancelled');
    await reviews.appendLog(job.id, `Review cancelled by ${req.user.email}`);
    if (job.status === 'running') {
      // The worker observes the cancelled status and sends the notification
      ocrRunner.kill(job.id);
    } else {
      // Pending jobs are skipped by the worker, so notify from here
      slackNotifier.notifyReviewFinished({ ...job, status: 'cancelled' });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
