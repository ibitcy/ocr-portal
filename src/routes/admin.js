'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const config = require('../config');
const { requireAdmin } = require('../auth');

const router = express.Router();
router.use(requireAdmin);

const VALID_ROLES = ['admin', 'user', 'viewer'];
const MIN_PASSWORD_LENGTH = 8;

router.get('/users', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, role, created_at FROM users ORDER BY id'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/users', async (req, res, next) => {
  try {
    const { email, password, role } = req.body || {};
    const normalizedEmail = (email || '').trim().toLowerCase();

    if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      return res
        .status(400)
        .json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Role must be "admin", "user" or "viewer"' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, role, created_at`,
      [normalizedEmail, passwordHash, role]
    );
    if (rows.length === 0) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.patch('/users/:id', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { role, password } = req.body || {};

    if (role === undefined && password === undefined) {
      return res.status(400).json({ error: 'Nothing to update: provide role and/or password' });
    }
    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Role must be "admin", "user" or "viewer"' });
    }
    if (password !== undefined && password.length < MIN_PASSWORD_LENGTH) {
      return res
        .status(400)
        .json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    if (role !== undefined && userId === req.user.id) {
      return res.status(400).json({ error: 'You cannot change your own role' });
    }

    const sets = [];
    const params = [userId];
    let i = 2;
    if (role !== undefined) {
      sets.push(`role = $${i++}`);
      params.push(role);
    }
    if (password !== undefined) {
      sets.push(`password_hash = $${i++}`);
      params.push(await bcrypt.hash(password, 12));
    }

    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $1
       RETURNING id, email, role, created_at`,
      params
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });

    // Invalidate sessions on password reset so the old credentials stop working
    if (password !== undefined) {
      await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/users/:id', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    const { rows: jobRows } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM review_jobs WHERE user_id = $1',
      [userId]
    );
    if (jobRows[0].count > 0) {
      return res
        .status(409)
        .json({ error: `User has ${jobRows[0].count} review(s) and cannot be deleted` });
    }

    const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    if (rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/repositories', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, provider, external_id, created_at FROM repositories ORDER BY name'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Provider settings are env-driven; expose read-only, never the token itself.
router.get('/settings', (req, res) => {
  res.json({
    gitProvider: config.git.provider,
    gitHost: config.git.host,
    gitTokenConfigured: Boolean(config.git.token),
    llmModel: process.env.OCR_LLM_MODEL || null,
    llmUrl: process.env.OCR_LLM_URL || null,
    llmTokenConfigured: Boolean(process.env.OCR_LLM_TOKEN)
  });
});

module.exports = router;
