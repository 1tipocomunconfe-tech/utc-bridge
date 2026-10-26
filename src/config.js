const path = require('path');

// Aseguramos que projectRoot siempre tenga un valor
// En Render: process.cwd() es /opt/render/project/src/
// __dirname es /opt/render/project/src/
// path.resolve(__dirname, '..') da /opt/render/project/ (el root correcto)
const defaultProjectRoot = process.env.PROJECT_ROOT || path.resolve(__dirname, '..');

// Extiende o crea el objeto config con valores seguros
const config = {
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
};

// Exporta el objeto config directamente
module.exports = config;