const path = require('path');

module.exports = {
  projectRoot: process.cwd(),
  queueDir: path.join(process.cwd(), 'queue'),
  schedulerStateDir: path.join(process.cwd(), '.scheduler-state'),
  platformQueues: {
    tiktok: path.join(process.cwd(), 'queue'),
    instagram: path.join(process.cwd(), 'queue'),
    youtube: path.join(process.cwd(), 'queue'),
  },
  publishWindowStart: '08:00',
  publishWindowEnd: '22:00',
  timezone: 'America/New_York',
  cronExpression: '*/2 * * * *',
  postDelayMs: 1000,
  jitterMaxMs: 30000,
  randomQueueOrder: false,
  limits: {
    tiktok: { cap: 5, period: 'daily' },
    instagram: { cap: 3, period: 'daily' },
    youtube: { cap: 2, period: 'daily' },
  },
};