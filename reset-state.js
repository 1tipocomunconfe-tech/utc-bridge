#!/usr/bin/env node
// Reset scheduler state to allow new publications

const fs = require('fs');
const path = require('path');

const stateDir = '/sessions/trusting-compassionate-hamilton/mnt/UPLOADTIPOCOMUNSHORT/.scheduler-state/default';

// Reset Instagram state to null (no in-progress)
const instagramPath = path.join(stateDir, 'instagram.json');
const instagramNewState = {
  inProgress: null,
  lastCompleted: null
};

try {
  fs.writeFileSync(instagramPath, JSON.stringify(instagramNewState, null, 2));
  console.log('✅ Instagram state resetado a null');
} catch (err) {
  console.error('❌ Error resetting Instagram state:', err.message);
}

// Reset YouTube state (ya estaba en null, pero forzamos)
const youtubePath = path.join(stateDir, 'youtube.json');
const youtubeNewState = {
  inProgress: null,
  lastCompleted: null
};

try {
  fs.writeFileSync(youtubePath, JSON.stringify(youtubeNewState, null, 2));
  console.log('✅ YouTube state resetado');
} catch (err) {
  console.error('❌ Error resetting YouTube state:', err.message);
}

console.log('\nState files listos para reinicio del scheduler');
