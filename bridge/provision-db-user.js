/**
 * Mwalimu Cosmetics — one-time MySQL credential provisioning.
 *
 * Run once per PC that needs database access. It:
 *
 *   1. Creates (or updates) a dedicated MySQL user for that machine's role,
 *      granted only what the role actually needs on `mwalimuinvest` alone.
 *   2. Generates a strong random password.
 *   3. Writes C:\MwalimuSync\db-config.json so the bridge scripts stop using
 *      the hardcoded root credentials.
 *
 * Why this matters: the root password was committed to git in pusher.js and
 * daily-backup.js. It is in the history of every clone, so it must be assumed
 * known. Moving to per-role users limits what that knowledge is worth, and
 * lets root itself be rotated without touching the shop's scripts.
 *
 * Roles:
 *   sync    — the polling agent. Reads everything; writes only the tables it
 *             legitimately posts to, and may CALL the stock procedures.
 *   backup  — the nightly export. Read-only, nothing else.
 *   probe   — schema capture. Read-only, plus the metadata rights needed to
 *             read routine definitions.
 *
 * Usage, on the PC being provisioned:
 *   node provision-db-user.js sync
 *   node provision-db-user.js backup --admin-user root --admin-password '...'
 *
 * The admin credentials are used only for this run and are never stored.
 * If omitted, the current resolved credentials are used, which on a
 * not-yet-provisioned machine means the legacy root login.
 */

const mysql  = require("mysql");
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const { getMysqlConfig, toDriverOptions, CONFIG_PATH } = require("./db-config");

const DB = "mwalimuinvest";

/**
 * Least privilege per role.
 *
 * The sync agent's write list is deliberately narrow: it posts supplier
 * payments and goods-received notes, so it needs those ledger tables, but it
 * has no business dropping anything or touching the `users` table. Stock is
 * only ever written through do_stock_transactions, hence EXECUTE.
 */
const ROLES = {
  sync: {
    user: "mwalimu_sync",
    grants: [
      `GRANT SELECT ON \`${DB}\`.* TO ?@?`,
      `GRANT INSERT, UPDATE ON \`${DB}\`.\`journal_transactions\` TO ?@?`,
      `GRANT INSERT, UPDATE ON \`${DB}\`.\`creditors_transactions\` TO ?@?`,
      `GRANT INSERT, UPDATE ON \`${DB}\`.\`ap_prepayment\` TO ?@?`,
      `GRANT INSERT, UPDATE ON \`${DB}\`.\`grn\` TO ?@?`,
      `GRANT INSERT, UPDATE ON \`${DB}\`.\`grn_d\` TO ?@?`,
      `GRANT UPDATE ON \`${DB}\`.\`accounts\` TO ?@?`,
      `GRANT UPDATE ON \`${DB}\`.\`nauto\` TO ?@?`,
      `GRANT INSERT ON \`${DB}\`.\`systemaudit\` TO ?@?`,
      `GRANT EXECUTE ON \`${DB}\`.* TO ?@?`,
    ],
  },
  backup: {
    user: "mwalimu_backup",
    grants: [`GRANT SELECT ON \`${DB}\`.* TO ?@?`],
  },
  probe: {
    user: "mwalimu_probe",
    grants: [
      `GRANT SELECT ON \`${DB}\`.* TO ?@?`,
      // SHOW CREATE PROCEDURE/FUNCTION needs routine metadata access.
      `GRANT SELECT ON \`mysql\`.\`proc\` TO ?@?`,
    ],
  },
};

function log(msg) { console.log(`[${new Date().toLocaleTimeString("en-KE")}] ${msg}`); }

function query(conn, sql, params) {
  return new Promise((res, rej) =>
    conn.query(sql, params || [], (e, r) => e ? rej(e) : res(r))
  );
}

function parseArgs(argv) {
  const role = argv[2];
  const opts = {};
  for (let i = 3; i < argv.length; i += 2) {
    const key = String(argv[i] || "").replace(/^--/, "");
    if (key) opts[key] = argv[i + 1];
  }
  return { role, opts };
}

/** Random password from an unambiguous alphabet — these get typed by humans sometimes. */
function generatePassword(length = 32) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function run() {
  const { role, opts } = parseArgs(process.argv);

  if (!role || !ROLES[role]) {
    console.error(`Usage: node provision-db-user.js <${Object.keys(ROLES).join("|")}> [--admin-user U --admin-password P] [--host H]`);
    process.exit(1);
  }

  const spec = ROLES[role];
  const base = getMysqlConfig(opts.host ? { host: opts.host } : undefined);

  const adminConfig = toDriverOptions({
    ...base,
    ...(opts["admin-user"]     ? { user: opts["admin-user"] } : {}),
    ...(opts["admin-password"] !== undefined ? { password: opts["admin-password"] } : {}),
  });

  log(`Provisioning role '${role}' as user '${spec.user}' on ${adminConfig.host}`);
  log(`Connecting as '${adminConfig.user}' to apply grants…`);

  const conn = mysql.createConnection(adminConfig);
  await new Promise((res, rej) => conn.connect(e => e ? rej(e) : res()));

  // The account is restricted to the LAN and the VPN subnet. Never '%': that
  // would expose an unpatched MySQL 5.1 to anything that can route to it.
  const hosts = ["10.10.10.%", "10.20.0.%", "localhost"];
  const password = generatePassword();

  for (const host of hosts) {
    // MySQL 5.1 has no CREATE USER IF NOT EXISTS, and GRANT ... IDENTIFIED BY
    // creates the account when absent and sets its password when present.
    // Doing it per host keeps the account list explicit and auditable.
    await query(conn,
      `GRANT USAGE ON *.* TO ?@? IDENTIFIED BY ?`,
      [spec.user, host, password]);

    for (const grant of spec.grants) {
      // Each grant statement carries exactly two placeholders: user and host.
      await query(conn, grant, [spec.user, host]);
    }
    log(`  granted ${spec.user}@${host}`);
  }

  await query(conn, "FLUSH PRIVILEGES");
  conn.end();

  // Verify the new credentials actually work before writing them anywhere,
  // so a failed provision cannot leave a machine with a config it can't use.
  log("Verifying the new credentials…");
  const verifyConn = mysql.createConnection(toDriverOptions({
    ...base, user: spec.user, password,
  }));
  await new Promise((res, rej) => verifyConn.connect(e => e ? rej(e) : res()));
  const check = await query(verifyConn, "SELECT COUNT(*) AS n FROM si");
  verifyConn.end();
  log(`  verified — read ${check[0].n} rows from si`);

  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  const existing = fs.existsSync(CONFIG_PATH)
    ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) : {};
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    ...existing,
    host: base.host, port: base.port, database: DB,
    user: spec.user, password,
    role, provisionedAt: new Date().toISOString(),
  }, null, 2), "utf8");

  // A credentials file readable by every user on the PC would defeat the
  // point of having moved the password out of source. Restrict it to
  // SYSTEM and Administrators; the scheduled tasks run as SYSTEM.
  try {
    const { execFileSync } = require("child_process");
    execFileSync("icacls", [
      CONFIG_PATH, "/inheritance:r",
      "/grant:r", "SYSTEM:F",
      "/grant:r", "Administrators:F",
    ], { stdio: "pipe" });
    log("Restricted file permissions to SYSTEM and Administrators.");
  } catch (e) {
    log(`WARNING: could not restrict permissions on ${CONFIG_PATH} (${e.message}).`);
    log("         Set them manually — the file contains a database password.");
  }

  log(`Wrote ${CONFIG_PATH}`);
  log("");
  log("Done. Remaining steps, in order:");
  log("  1. Provision every other PC that talks to MySQL.");
  log("  2. Confirm no script still logs 'LEGACY FALLBACK in use'.");
  log("  3. Rotate the MySQL root password — it is in this repo's git history.");
  log("  4. Restrict root to localhost so it cannot be used across the network.");
}

run().catch(err => {
  log("Failed: " + err.message);
  log("No config file was written; the previous credentials remain in effect.");
  process.exit(1);
});
