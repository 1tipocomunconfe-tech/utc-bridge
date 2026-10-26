// 🌟 Punto de entrada directo para Render (Background Worker)
// Ejecutar: node src/start_direct.js

require('dotenv').config();

const cronExpression = process.env.CRON_EXPRESSION || '*/2 * * * *';
const timezone = process.env.TZ || 'America/New_York';

console.log('='.repeat(50));
console.log('🚀 AutoSocial Studio - Iniciando Deployment en Render (Background Worker)');
console.log('='.repeat(50));
console.log('📅 Cron Expression:', cronExpression);
console.log('⏰ Timezone:', timezone);
console.log('📦 Caps Diarias - IG:', process.env.DAILY_CAP_INSTAGRAM);
console.log('   YT:', process.env.DAILY_CAP_YOUTUBE, '| TT:', process.env.DAILY_CAP_TIKTOK);

// Verificar Playwright
try {
  const { chromium } = require('playwright');
  console.log('✅ Playwright/chromium disponible');
} catch (e) {
  console.warn('⚠️ Playwright no instalado - npx playwright install chromium');
}

// Configuración directa de rutas usando variables de entorno
const { startDaemon } = require('./scheduler.js');

// Configurar rutas directamente
const customConfig = {
  cronExpression,
  timezone,
  platformQueues: {
    tiktok: process.env.TIKTOK_QUEUE_DIR || '../../queue/default/tiktok/pending',
    instagram: process.env.INSTAGRAM_QUEUE_DIR || '../../queue/default/instagram/pending',
    youtube: process.env.YOUTUBE_QUEUE_DIR || '../../queue/default/youtube/pending'
  }
};

// Iniciar scheduler con configuración personalizada
startDaemon({
  cronExpression: customConfig.cronExpression,
  timezone: customConfig.timezone,
  reconcile: () => { /* No-op */ },
  platformQueues: customConfig.platformQueues
}).then(task => {
  console.log('✅ Scheduler iniciado exitosamente');
  console.log('🕒 Publicaciones cada 2 minutos');
  console.log('📋 Revisa los logs abajo para estatus');
  console.log('='.repeat(50));
}).catch(err => {
  console.error('❌ Error starting scheduler:', err.message);
  process.exit(1);
});
