'use strict';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  env: process.env.APP_ENV || 'development',
  port: parseInt(process.env.APP_PORT || '8080', 10),
  appSecret: process.env.APP_SECRET || 'dev-secret',

  databaseUrl: required('DATABASE_URL'),
  queueUrl: process.env.QUEUE_URL || 'redis://localhost:6379/0',

  reposCacheDir: process.env.REPOS_CACHE_DIR || '/data/repos',
  reviewsDir: process.env.REVIEWS_DIR || '/data/reviews',
  logsDir: process.env.LOGS_DIR || '/data/logs',

  git: {
    provider: (process.env.GIT_PROVIDER || 'github').toLowerCase(),
    host: process.env.GIT_HOST || 'https://github.com',
    token: process.env.GIT_TOKEN || ''
  },

  admin: {
    email: process.env.ADMIN_EMAIL || '',
    password: process.env.ADMIN_PASSWORD || ''
  },

  session: {
    cookieName: 'ocr_session',
    ttlMs: 7 * 24 * 60 * 60 * 1000
  },

  slack: {
    enabled: process.env.SLACK_ENABLED === 'true',
    botToken: process.env.SLACK_BOT_TOKEN || '',
    channelId: process.env.SLACK_CHANNEL_ID || '',
    notifyOnSuccess: process.env.SLACK_NOTIFY_ON_SUCCESS !== 'false',
    notifyOnFailure: process.env.SLACK_NOTIFY_ON_FAILURE !== 'false',
    notifyOnCancelled: process.env.SLACK_NOTIFY_ON_CANCELLED === 'true'
  }
};
