'use strict';

const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const config = require('../config');

const QUEUE_NAME = 'reviews';

function createConnection() {
  return new IORedis(config.queueUrl, { maxRetriesPerRequest: null });
}

const reviewQueue = new Queue(QUEUE_NAME, { connection: createConnection() });

async function enqueueReview(reviewJobId) {
  await reviewQueue.add(
    'review',
    { reviewJobId },
    { removeOnComplete: 1000, removeOnFail: 1000 }
  );
}

module.exports = { QUEUE_NAME, createConnection, reviewQueue, enqueueReview };
