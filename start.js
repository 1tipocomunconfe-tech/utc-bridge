const dotenv = require('dotenv');
dotenv.config();

const cronExpression = process.env.CRON_EXPRESSION || '*/2 * * * *';
const timezone = process.env.TZ || 'America/New_York';

const PORT = process.env.PORT || 10000;
const express = require('express');
const app = express();

app.get('/', (req, res) => { res.send('AutoSocial Studio is running! 🚀'); });
app.listen(PORT, () => { console.log(`🌐 Health check server running on port ${PORT}`); });

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