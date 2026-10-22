// Archivo para Render - punto de entrada
// Ejecutar: node render-start.js

require('dotenv').config();

// Configuración - usar variables de entorno o defaults
const cronExpression = process.env.CRON_EXPRESSION || '*/2 * * * *';
const timezone = process.env.TZ || 'America/New_York';

console.log('='.repeat(50));
console.log('🚀 AutoSocial Studio - Iniciando Deployment en Render');
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

// Iniciar scheduler desde la carpeta src
const { startDaemon } = require('./src/scheduler.js');

startDaemon({
  cronExpression,
  reconcile: () => { /* No-op */ },
  timezone,
}).then(task => {
  console.log('✅ Scheduler iniciado exitosamente');
  console.log('🕒 Publicaciones cada 2 minutos');
  console.log('📋 Revisa los logs abajo para estatus');
  console.log('='.repeat(50));
}).catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
