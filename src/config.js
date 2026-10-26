const path = require('path');

// __dirname en Render: /opt/render/project/src/
// Al hacer '..' obtenemos: /opt/render/project/ (el root correcto)
const defaultProjectRoot = process.env.PROJECT_ROOT || path.resolve(__dirname, '..');

// Config con TODOS los valores por defecto seguros
const config = {
  // Rutas - siempre tienen valores
  projectRoot: defaultProjectRoot,
  queueDir: path.join(defaultProjectRoot, 'queue'),
  schedulerStateDir: path.join(defaultProjectRoot, '.scheduler-state'),
  platformQueues: {
    tiktok: path.join(defaultProjectRoot, 'queue'),
    instagram: path.join(defaultProjectRoot, 'queue'),
    youtube: path.join(defaultProjectRoot, 'queue'),
  },

  // Configuración de publicación - valores seguros
  publishWindowStart: '08:00',
  publishWindowEnd: '22:00',
  timezone: 'America/New_York',
  cronExpression: '*/2 * * * *',

  // Retrasos y jitter - números seguros
  postDelayMs: 1000,
  jitterMaxMs: 30000,
  randomQueueOrder: false,

  // Límites seguros
  limits: {
    tiktok: { cap: 5, period: 'daily' },
    instagram: { cap: 3, period: 'daily' },
    youtube: { cap: 2, period: 'daily' },
  },

  // Notificaciones - valores seguros (cadenas vacías en lugar de undefined)
  notifyTelegramBotToken: '',
  notifyTelegramChatId: '',
  notifyDiscordWebhookUrl: '',
  notifyLevel: 'errors',
};

module.exports = config;