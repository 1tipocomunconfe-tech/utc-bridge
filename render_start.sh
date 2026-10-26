#!/bin/bash

# Script para iniciar el sistema en Render
# Este script asegura que las rutas sean correctas

# Instalar dependencias
npm install

# Instalar Playwright
npx playwright install chromium

# Corregir rutas en config.js
node -e "
  const fs = require('fs');
  const path = require('path');
  const configPath = path.join(__dirname, 'src/config.js');
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
  console.log('✅ Rutas en config.js corregidas para Render');
"

# Iniciar el scheduler
node src/start.js
