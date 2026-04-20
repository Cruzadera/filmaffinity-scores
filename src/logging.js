const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const configured = (process.env.LOG_LEVEL || "info").toLowerCase();
const minLevel = LEVELS[configured] || LEVELS.info;

function ts() {
  return new Date().toISOString();
}

function format(level, msg, meta) {
  const base = `${ts()} ${level.toUpperCase()} - ${msg}`;
  if (meta) {
    try {
      return base + ' ' + (typeof meta === 'string' ? meta : JSON.stringify(meta));
    } catch (e) {
      return base + ' ' + String(meta);
    }
  }
  return base;
}

function debug(msg, meta) {
  if (minLevel <= LEVELS.debug) console.debug(format('debug', msg, meta));
}

function info(msg, meta) {
  if (minLevel <= LEVELS.info) console.log(format('info', msg, meta));
}

function warn(msg, meta) {
  if (minLevel <= LEVELS.warn) console.warn(format('warn', msg, meta));
}

function error(msg, meta) {
  if (minLevel <= LEVELS.error) console.error(format('error', msg, meta));
}

module.exports = { debug, info, warn, error };
