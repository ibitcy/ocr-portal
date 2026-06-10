'use strict';

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const config = require('./config');

const COOKIE = config.session.cookieName;

async function loadSession(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token = $1 AND s.expires_at > now()`,
      [token]
    );
    if (rows.length > 0) req.user = rows[0];
  } catch (err) {
    return next(err);
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { rows } = await pool.query(
      'SELECT id, email, password_hash, role FROM users WHERE email = $1',
      [email.trim().toLowerCase()]
    );
    const user = rows[0];
    const valid = user && (await bcrypt.compare(password, user.password_hash));
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + config.session.ttlMs);
    await pool.query(
      'INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
      [token, user.id, expiresAt]
    );

    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: config.session.ttlMs
    });
    res.json({ id: user.id, email: user.email, role: user.role });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies?.[COOKIE];
    if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(req.user);
});

module.exports = { router, loadSession, requireAuth, requireAdmin };
