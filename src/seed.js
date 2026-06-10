'use strict';

const bcrypt = require('bcryptjs');
const pool = require('./db');
const config = require('./config');

async function seedAdmin() {
  const password = config.admin.password;
  const email = config.admin.email.trim().toLowerCase();
  if (!email || !password) {
    console.warn('ADMIN_EMAIL / ADMIN_PASSWORD not set, skipping admin seed');
    return;
  }

  const { rows } = await pool.query(
    'SELECT id, password_hash FROM users WHERE email = $1',
    [email]
  );

  if (rows.length === 0) {
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')`,
      [email, passwordHash]
    );
    console.log(`Seeded default admin user: ${email}`);
    return;
  }

  // Keep the default admin password in sync with ADMIN_PASSWORD
  const matches = await bcrypt.compare(password, rows[0].password_hash);
  if (!matches) {
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
      passwordHash,
      rows[0].id
    ]);
    console.log(`Updated default admin password from environment: ${email}`);
  }
}

module.exports = { seedAdmin };
