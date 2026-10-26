// 🌟 Punto de entrada para Render
require('dotenv').config();

const cronExpression = process.env.CRON_EXPRESSION || '*/2 * * * *';
const timezone = process.env.TZ || 'America/New_York';

console.log('='.repeat(50));
console.log('🚀 AutoSocial Studio - Iniciando Deployment en Render');
console.log('='.repeat(50));
console.log('📅 Cron Expression:', cronExpression);
console.log('⏰ Timezone:', timezone);

try {
  const { chromium } = require('playwright');
  console.log('✅ Playwright/chromium disponible');
} catch (e) {
  console.warn('⚠️ Playwright no instalado');
}

const { startDaemon } = require('./src/scheduler.js');

startDaemon({
  cronExpression,
  timezone,
  reconcile: () => { /* No-op */ }
}).then(task => {
  console.log('✅ Scheduler iniciado exitosamente');
  console.log('🕒 Publicaciones cada 2 minutos');
  console.log('='.repeat(50));
}).catch(err => {
  console.error('❌ Error starting scheduler:', err.message);
  process.exit(1);
});
