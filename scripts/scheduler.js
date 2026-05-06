#!/usr/bin/env node
const dotenv = require('dotenv');
dotenv.config({ quiet: true });

const { spawn } = require('child_process');
const logger = require('../src/logging');

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function toBool(v, def = false) {
  if (v === undefined || v === null || String(v).trim() === '') return def;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}

function toInt(v, def) {
  if (v === undefined || v === null || String(v).trim() === '') return def;
  const n = Number(v);
  return Number.isNaN(n) ? def : n;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runNodeScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath, ...args], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${scriptPath} exited with code ${code}`));
      }
    });
  });
}

async function runTask(label, scriptPath, args = []) {
  try {
    logger.info(`Running task: ${label}`);
    await runNodeScript(scriptPath, args);
    return true;
  } catch (err) {
    logger.error(`Task failed (${label}): ${err && err.message ? err.message : err}`);
    return false;
  }
}

async function runCycle({ forceSync = false } = {}) {
  const skipSyncOnUpdateFail = toBool(process.env.SKIP_SYNC_ON_UPDATE_FAIL, true);

  const updateOk = await runTask('updateCache', 'src/scripts/updateCache.js');
  if (!updateOk && skipSyncOnUpdateFail) {
    logger.warn('Skipping sync-jellyfin because updateCache failed and SKIP_SYNC_ON_UPDATE_FAIL is true');
    return;
  }

  const syncArgs = forceSync ? ['--force'] : [];
  await runTask(`sync-jellyfin${forceSync ? ' --force' : ''}`, 'scripts/sync-jellyfin.js', syncArgs);
}

async function main() {
  const sleepSeconds = Math.max(1, toInt(process.env.SLEEP_SECONDS, 86400));
  const forceOnStartup = toBool(process.env.SYNC_JELLYFIN_FORCE_ON_STARTUP, true);
  const ratingsApiUrl = normalizeUrl(process.env.SYNC_RATINGS_API_URL);

  if (ratingsApiUrl) {
    logger.info(`Scheduler will resolve ratings through API mode (${ratingsApiUrl})`);
  } else {
    logger.warn('Scheduler is running without SYNC_RATINGS_API_URL; sync-jellyfin will use the local scraper compatibility path');
  }

  logger.info(`Scheduler starting (sleepSeconds=${sleepSeconds}, forceOnStartup=${forceOnStartup})`);

  await runCycle({ forceSync: forceOnStartup });

  while (true) {
    await sleep(sleepSeconds * 1000);
    await runCycle({ forceSync: false });
  }
}

if (require.main === module) {
  main().catch((err) => {
    logger.error(`Scheduler crashed: ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
}
