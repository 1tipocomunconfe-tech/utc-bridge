const path = require('path');

// Múltiples capas de fallback para projectRoot
// 1. VARIABLE DE ENTORNO PROJECT_ROOT (si está configurada en Render)
// 2. __dirname + '..' (directorio del archivo config.js subiendo un nivel)
// 3. process.cwd() (último recurso)
const defaultProjectRoot = process.env.PROJECT_ROOT || path.resolve(__dirname, '..') || process.cwd();

// Config con TODOS los valores seguros - CADA UNA tiene un fallback
const config = {
  // Rutas - siempre tienen valores seguros
  projectRoot: defaultProjectRoot,
  queueDir: path.join(defaultProjectRoot, 'queue') || process.cwd(),
  schedulerStateDir: path.join(defaultProjectRoot, '.scheduler-state') || process.cwd(),
  platformQueues: {
    tiktok: path.join(defaultProjectRoot, 'queue') || process.cwd(),
    instagram: path.join(defaultProjectRoot, 'queue') || process.cwd(),
    youtube: path.join(defaultProjectRoot, 'queue') || process.cwd(),
  },

  // Configuración de publicación
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

  // Notificaciones - strings vacíos en lugar de undefined
  notifyTelegramBotToken: '',
  notifyTelegramChatId: '',
  notifyDiscordWebhookUrl: '',
  notifyLevel: 'errors',

  // Valores adicionales seguros
  staleLockMs: 1800000,
};

// Exporta el objeto config directamente
module.exports = config;