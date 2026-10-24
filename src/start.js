// 🌟 Punto de entrada para deployment en Render
// Ejecutar: node src/start.js

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

// Corregir rutas para Render
const fs = require('fs');
const path = require('path');

// Función para corregir rutas en config.js
function fixConfigForRender() {
  const configPath = path.join(__dirname, 'config.js');
  let content = fs.readFileSync(configPath, 'utf8');

  // Corregir rutas para Render
  const correctedContent = content
    .replace(/queueDir: path.resolve.*pending/, 'queueDir: path.resolve(__dirname, "../../queue/default/tiktok/pending"),')
    .replace(/postedDir: path.resolve.*posted/, 'postedDir: path.resolve(__dirname, "../../queue/default/tiktok/posted"),')
    .replace(/failedDir: path.resolve.*failed/, 'failedDir: path.resolve(__dirname, "../../queue/default/tiktok/failed"),')
    .replace(/instagramQueueDir: path.resolve.*pending/, 'instagramQueueDir: path.resolve(__dirname, "../../queue/default/instagram/pending"),')
    .replace(/instagramPostedDir: path.resolve.*posted/, 'instagramPostedDir: path.resolve(__dirname, "../../queue/default/instagram/posted"),')
    .replace(/instagramFailedDir: path.resolve.*failed/, 'instagramFailedDir: path.resolve(__dirname, "../../queue/default/instagram/failed"),')
    .replace(/youtubeQueueDir: path.resolve.*pending/, 'youtubeQueueDir: path.resolve(__dirname, "../../queue/default/youtube/pending"),')
    .replace(/youtubePostedDir: path.resolve.*posted/, 'youtubePostedDir: path.resolve(__dirname, "../../queue/default/youtube/posted"),')
    .replace(/youtubeFailedDir: path.resolve.*failed/, 'youtubeFailedDir: path.resolve(__dirname, "../../queue/default/youtube/failed"),');

  fs.writeFileSync(configPath, correctedContent, 'utf8');
  console.log('✅ Rutas corregidas para Render');
}

// Corregir rutas antes de iniciar el scheduler
fixConfigForRender();

// Importar y iniciar scheduler
const { startDaemon } = require('./scheduler.js');

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
  console.error('❌ Error starting scheduler:', err.message);
  process.exit(1);
});
