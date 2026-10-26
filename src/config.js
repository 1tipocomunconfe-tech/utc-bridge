const path = require('path');

// Use __dirname to reliably determine project root
// __dirname is set by Node.js to the directory of this file
// __dirname = /Users/stuffswag.com/Documents/Proyectos/UPLOADTIPOCOMUNSHORT/src
// projectRoot = one level up = /Users/stuffswag.com/Documents/Proyectos/UPLOADTIPOCOMUNSHORT
const projectRoot = path.resolve(__dirname, '..');

module.exports = {
  projectRoot: projectRoot,
  queueDir: path.join(projectRoot, 'queue'),
  schedulerStateDir: path.join(projectRoot, '.scheduler-state'),
  platformQueues: {
    tiktok: path.join(projectRoot, 'queue'),
    instagram: path.join(projectRoot, 'queue'),
    youtube: path.join(projectRoot, 'queue'),
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