/**
 * Mwalimu Cosmetics — MySQL credential resolution for the bridge scripts.
 *
 * Credentials must not live in source. This repository's history already
 * contains the MySQL root password (it was hardcoded in pusher.js and
 * daily-backup.js), so that credential should be treated as compromised and
 * rotated — removing it from the current files does not remove it from git
 * history, and anyone with a clone still has it.
 *
 * Resolution order, first match wins:
 *
 *   1. Environment variables (MWALIMU_DB_HOST, _PORT, _USER, _PASSWORD, _NAME)
 *   2. C:\MwalimuSync\db-config.json  (written once per PC, never committed)
 *   3. The legacy hardcoded root credentials, with a loud warning
 *
 * Step 3 exists on purpose. The sync agent self-updates by overwriting
 * pusher.js on a machine we cannot log into, so a version that requires the
 * config file would strand the agent the moment it updated, before anyone
 * could place that file. The fallback keeps the shop running while the config
 * is rolled out, and `usingLegacyFallback` makes the situation visible in the
 * logs rather than silent. Remove it once every PC reports false.
 *
 * To provision a machine: node provision-db-user.js  (see that script).
 */

const fs = require("fs");

const CONFIG_PATH = "C:\\MwalimuSync\\db-config.json";

// The credentials the scripts shipped with before this was introduced.
// Present only so a self-updated agent cannot lose database access.
const LEGACY_FALLBACK = {
  host: "10.10.10.4", port: 3306, user: "root", password: "allowme",
};

/**
 * Options every connection needs regardless of where credentials came from.
 *
 * Deliberately NOT set here: `dateStrings`. The new desktop code wants it, to
 * stop the driver building JS Date objects in local time and shifting values
 * by the UTC+3 offset on round-trip. But the existing agent already handles
 * driver Date objects explicitly (`v instanceof Date` when serialising rows,
 * and `new Date(row.earliest)` when bucketing by day), so turning it on here
 * would quietly change the format this agent has always sent to the server.
 * A credentials change must not alter data on the wire. New callers that want
 * string dates pass `{ dateStrings: true }` themselves.
 */
const CONNECTION_DEFAULTS = {
  database: "mwalimuinvest",
  ssl: false,
  // MySQL 5.1.73 runs old_passwords, i.e. the pre-4.1 auth handshake. The
  // legacy `mysql` driver is the only one that still speaks it.
  insecureAuth: true,
  connectTimeout: 8000,
};

function fromEnv() {
  const { MWALIMU_DB_HOST, MWALIMU_DB_USER, MWALIMU_DB_PASSWORD } = process.env;
  if (!MWALIMU_DB_HOST || !MWALIMU_DB_USER || MWALIMU_DB_PASSWORD === undefined) return null;
  return {
    host: MWALIMU_DB_HOST,
    port: Number(process.env.MWALIMU_DB_PORT || 3306),
    user: MWALIMU_DB_USER,
    password: MWALIMU_DB_PASSWORD,
    database: process.env.MWALIMU_DB_NAME || CONNECTION_DEFAULTS.database,
    source: "environment",
  };
}

function fromConfigFile() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (!raw.host || !raw.user || raw.password === undefined) return null;
    return {
      host: raw.host,
      port: Number(raw.port || 3306),
      user: raw.user,
      password: raw.password,
      database: raw.database || CONNECTION_DEFAULTS.database,
      source: CONFIG_PATH,
    };
  } catch {
    return null;
  }
}

/**
 * Build the connection options for the `mysql` package.
 *
 * @param {object} [overrides] merged last, e.g. { database: "mwalimuinvest_test" }
 * @returns {object} options, plus `source` and `usingLegacyFallback` for logging
 */
function getMysqlConfig(overrides) {
  const resolved = fromEnv() || fromConfigFile();

  if (resolved) {
    return {
      ...CONNECTION_DEFAULTS, ...resolved, ...overrides,
      usingLegacyFallback: false,
    };
  }

  return {
    ...CONNECTION_DEFAULTS, ...LEGACY_FALLBACK, ...overrides,
    source: "legacy hardcoded fallback",
    usingLegacyFallback: true,
  };
}

/**
 * One-line description of where credentials came from, safe to log.
 * Never includes the password.
 */
function describeConfigSource(config) {
  return config.usingLegacyFallback
    ? `MySQL credentials: LEGACY FALLBACK in use (${config.user}@${config.host}) ` +
      `— run provision-db-user.js on this PC to move to a dedicated least-privilege user`
    : `MySQL credentials: ${config.user}@${config.host} from ${config.source}`;
}

/** Strip our own bookkeeping keys before handing options to mysql.createConnection. */
function toDriverOptions(config) {
  const { source, usingLegacyFallback, ...driverOptions } = config;
  return driverOptions;
}

module.exports = { getMysqlConfig, describeConfigSource, toDriverOptions, CONFIG_PATH };
