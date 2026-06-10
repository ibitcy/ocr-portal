'use strict';

const express = require('express');
const { provider } = require('../providers');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    res.json(await provider.listRepositories());
  } catch (err) {
    next(err);
  }
});

router.get('/:id/branches', async (req, res, next) => {
  try {
    res.json(await provider.listBranches(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/pull-requests', async (req, res, next) => {
  try {
    res.json(await provider.listPullRequests(req.params.id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
