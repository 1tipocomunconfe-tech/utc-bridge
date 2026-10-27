const path = require('path');
const config = require('./config') || {};

const defaultProjectRoot = process.env.PROJECT_ROOT || path.resolve(__dirname, '..') || process.cwd();

const configExport = {
  projectRoot: defaultProjectRoot,
  queueDir: path.join(defaultProjectRoot, 'queue'),
  schedulerStateDir: path.join(defaultProjectRoot, '.scheduler-state'),
  platformQueues: {
    tiktok: path.join(defaultProjectRoot, 'queue'),
    instagram: path.join(defaultProjectRoot, 'queue'),
    youtube: path.join(defaultProjectRoot, 'queue'),
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
  notifyTelegramBotToken: '',
  notifyTelegramChatId: '',
  notifyDiscordWebhookUrl: '',
  notifyLevel: 'errors',
  staleLockMs: 1800000,
};

module.exports = configExport;