#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Ruta del archivo config.js
const configPath = path.join(__dirname, 'src', 'config.js');

// Leer el archivo
const content = fs.readFileSync(configPath, 'utf8');

// Función para reemplazar las rutas de queueDir y similares
function replaceQueuePaths(content) {
  // Reemplazar las rutas de TikTok
  const tiktokQueueDirReplacement = 
    `queueDir: path.resolve(projectRoot, process.env.TIKTOK_QUEUE_DIR || "queue/default/tiktok/pending"),`;
  
  const tiktokPostedDirReplacement = 
    `postedDir: path.resolve(projectRoot, process.env.TIKTOK_POSTED_DIR || "queue/default/tiktok/posted"),`;
  
  const tiktokFailedDirReplacement = 
    `failedDir: path.resolve(projectRoot, process.env.TIKTOK_FAILED_DIR || "queue/default/tiktok/failed"),`;
  
  // Reemplazar las líneas en el contenido
  const newContent = content
    .replace(/queueDir: path.resolve.*pending/, tiktokQueueDirReplacement)
    .replace(/postedDir: path.resolve.*posted/, tiktokPostedDirReplacement)
    .replace(/failedDir: path.resolve.*failed/, tiktokFailedDirReplacement);
  
  return newContent;
}

// Aplicar los cambios
const updatedContent = replaceQueuePaths(content);

// Escribir el archivo actualizado
fs.writeFileSync(configPath, updatedContent, 'utf8');

console.log('✅ Archivo config.js actualizado para usar rutas correctas de TikTok');
