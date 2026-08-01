/**
 * Rebuild the local test database from the real captured schema.
 *
 * The previous test database was hand-written from reading decompiled C#. It
 * had the item master as `sitems` when production calls it `si`, invented
 * columns that do not exist, and contained none of the 87 stored routines.
 * Tests against it would have passed while production broke — the worst
 * possible failure mode for a test fixture. This replaces it with structure
 * dumped from the live server.
 *
 * Production runs MySQL 5.1.73 with sql_mode 'IGNORE_SPACE', which is far
 * more permissive than a modern default. The local instance is 5.7, so the
 * session mode is forced to match: otherwise 5.7 rejects statements that
 * production accepts (zero dates especially), and the fixture stops
 * representing reality.
 *
 * Usage:
 *   node db/reset-testdb.js
 *   MWALIMU_TEST_PORT=3307 node db/reset-testdb.js
 */

const { execFileSync, execSync } = require("child_process");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

const HOST = process.env.MWALIMU_TEST_HOST ?? "127.0.0.1";
const PORT = process.env.MWALIMU_TEST_PORT ?? "3307";
const USER = process.env.MWALIMU_TEST_USER ?? "root";
const PASS = process.env.MWALIMU_TEST_PASSWORD ?? "";
const DB   = process.env.MWALIMU_TEST_DB   ?? "mwalimuinvest_test";

// Match production so the fixture behaves the way the real server does.
const PROD_SQL_MODE = "IGNORE_SPACE";

const MYSQL_EXE = process.env.MYSQL_EXE ?? path.join(
  os.homedir(), "Documents", "FumasV5-testdb",
  "mysql-5.7.44-winx64", "bin", "mysql.exe");

const DB_DIR = __dirname;

function mysqlArgs(extra) {
  const args = ["-h", HOST, "-P", String(PORT), "-u", USER];
  if (PASS) args.push(`-p${PASS}`);
  return args.concat(extra);
}

function runSql(sql, { database } = {}) {
  const args = mysqlArgs(database ? [database] : []);
  return execFileSync(MYSQL_EXE, args, {
    input: `SET SESSION sql_mode='${PROD_SQL_MODE}';\n${sql}`,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

function runSqlFile(file, database) {
  // Piped through stdin so the DELIMITER directives in routines.sql are
  // handled by the client, which is the only thing that understands them.
  const sql = fs.readFileSync(file, "utf8");
  return runSql(sql, { database });
}

function query(sql, database) {
  return runSql(sql, { database }).trim();
}

function main() {
  if (!fs.existsSync(MYSQL_EXE)) {
    console.error(`mysql client not found at ${MYSQL_EXE}`);
    console.error("Set MYSQL_EXE to its location.");
    process.exit(1);
  }

  const schemaFile   = path.join(DB_DIR, "schema.sql");
  const routinesFile = path.join(DB_DIR, "routines.sql");
  for (const f of [schemaFile, routinesFile]) {
    if (!fs.existsSync(f)) {
      console.error(`Missing ${f}. Run the schema probe, then node db/build-sql.js.`);
      process.exit(1);
    }
  }

  console.log(`Rebuilding ${DB} on ${HOST}:${PORT} (sql_mode ${PROD_SQL_MODE})`);

  console.log("  dropping and recreating…");
  runSql(`DROP DATABASE IF EXISTS \`${DB}\`; CREATE DATABASE \`${DB}\` DEFAULT CHARSET utf8;`);

  console.log("  loading schema.sql…");
  runSqlFile(schemaFile, DB);

  console.log("  loading routines.sql…");
  runSqlFile(routinesFile, DB);

  // ── Verify against the capture, not against expectations ──────
  const captured = JSON.parse(fs.readFileSync(
    path.join(DB_DIR, "_phase0-raw", "schema.json"), "utf8"));
  const capturedRoutines = JSON.parse(fs.readFileSync(
    path.join(DB_DIR, "_phase0-raw", "routines.json"), "utf8"));

  const tables = Number(query(
    `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${DB}';`)
    .split("\n").pop());
  const procs = Number(query(
    `SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='${DB}' AND ROUTINE_TYPE='PROCEDURE';`)
    .split("\n").pop());
  const funcs = Number(query(
    `SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='${DB}' AND ROUTINE_TYPE='FUNCTION';`)
    .split("\n").pop());

  const wantTables = captured.filter(s => s.ddl).length;
  const wantProcs  = capturedRoutines.filter(r => r.ddl && r.type === "PROCEDURE").length;
  const wantFuncs  = capturedRoutines.filter(r => r.ddl && r.type === "FUNCTION").length;

  console.log("");
  console.log(`  tables     ${tables}/${wantTables}`);
  console.log(`  procedures ${procs}/${wantProcs}`);
  console.log(`  functions  ${funcs}/${wantFuncs}`);

  // Without these, stock cannot be written at all and no test involving a
  // sale or an adjustment means anything.
  const CRITICAL = ["do_stock_transactions", "do_siserial_transactions",
                    "get_smallest_qty", "get_payref", "get_category", "get_average_cost"];
  const present = query(
    `SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='${DB}';`)
    .split("\n").slice(1).map(s => s.trim());
  const missing = CRITICAL.filter(n => !present.includes(n));

  console.log("");
  if (missing.length) {
    console.error(`  MISSING critical routines: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log(`  all ${CRITICAL.length} critical routines present`);

  const shortfall = (wantTables - tables) + (wantProcs - procs) + (wantFuncs - funcs);
  if (shortfall > 0) {
    console.log("");
    console.log(`  NOTE: ${shortfall} object(s) did not load. 5.7 is stricter than 5.1,`);
    console.log("        so some legacy DDL may be rejected. Check before relying on");
    console.log("        any test that touches those objects.");
  }

  console.log("");
  console.log(`Done. Connect with: mysql -h ${HOST} -P ${PORT} -u ${USER} ${DB}`);
}

try {
  main();
} catch (e) {
  console.error("Failed:", e.message);
  if (e.stderr) console.error(String(e.stderr).slice(0, 4000));
  process.exit(1);
}
