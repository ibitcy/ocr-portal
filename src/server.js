'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const config = require('./config');
const { runMigrations } = require('./migrate');
const { seedAdmin } = require('./seed');
const { router: authRouter, loadSession } = require('./auth');
const repositoriesRouter = require('./routes/repositories');
const reviewsRouter = require('./routes/reviews');
const adminRouter = require('./routes/admin');
const { startWorker } = require('./queue/worker');

async function main() {
  for (const dir of [config.reposCacheDir, config.reviewsDir, config.logsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  console.log('Running database migrations...');
  await runMigrations();
  await seedAdmin();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser(config.appSecret));
  app.use(loadSession);

  app.get('/health', (req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRouter);
  app.use('/api/repositories', repositoriesRouter);
  app.use('/api/reviews', reviewsRouter);
  app.use('/api/admin', adminRouter);

  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));
  // SPA fallback for client-side routes
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use((err, req, res, next) => {
    console.error('Request error:', err.message);
    res.status(500).json({ error: err.message });
  });

  app.listen(config.port, () => {
    console.log(`AI Review Hub listening on port ${config.port} (${config.env})`);
  });

  // OCR runner worker lives in the same container for the MVP
  startWorker();
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
