const path = require('path');
const config = require('./config') || {};
const projectRoot = config.projectRoot || process.env.PROJECT_ROOT || process.cwd();
const STATE_FILE = path.resolve(projectRoot, "accounts-state.json");
const DEFAULT_ACCOUNT = { id: "default", name: "Default" };
const LEGACY_PROFILE_DIRS = {
  tiktok: config.profileDir,
  instagram: config.instagramProfileDir,
  youtube: config.youtubeProfileDir,
};