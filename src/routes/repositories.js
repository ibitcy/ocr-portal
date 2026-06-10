'use strict';

const express = require('express');
const { provider } = require('../providers');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

function searchParam(req) {
  const s = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  return s || undefined;
}

router.get('/', async (req, res, next) => {
  try {
    res.json(await provider.listRepositories(searchParam(req)));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/branches', async (req, res, next) => {
  try {
    res.json(await provider.listBranches(req.params.id, searchParam(req)));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/pull-requests', async (req, res, next) => {
  try {
    res.json(await provider.listPullRequests(req.params.id, searchParam(req)));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
