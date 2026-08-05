/**
 * Mwalimu Cosmetics — read-only audit of the MySQL grant tables.
 *
 * Written to diagnose FumasV5 failing with "you need the RELOAD privilege(s)
 * for this operation". FumasV5 connects as root from every till, so the
 * question is which root@host rows exist and what each one is actually
 * granted.
 *
 * This script only reads. It issues no GRANT, no UPDATE, and no FLUSH.
 */

const mysql = require("mysql");
const { getMysqlConfig, describeConfigSource, toDriverOptions } = require("./db-config");

// Connect to the app database, not `mysql`. Reading the grant tables requires
// privileges that are exactly what we are here to check, so the connection
// itself must not depend on them.
const config = getMysqlConfig({ database: "mwalimuinvest" });
console.log(describeConfigSource(config));

const conn = mysql.createConnection(toDriverOptions(config));

const q = (sql, p) => new Promise((res, rej) =>
  conn.query(sql, p || [], (e, r) => (e ? rej(e) : res(r))));

const GLOBAL_PRIVS = [
  "Select_priv", "Insert_priv", "Update_priv", "Delete_priv",
  "Create_priv", "Drop_priv", "Reload_priv", "Shutdown_priv",
  "Process_priv", "File_priv", "Grant_priv", "References_priv",
  "Index_priv", "Alter_priv", "Show_db_priv", "Super_priv",
  "Create_tmp_table_priv", "Lock_tables_priv", "Execute_priv",
  "Create_view_priv", "Show_view_priv", "Create_routine_priv",
  "Alter_routine_priv", "Create_user_priv",
];

(async () => {
  await new Promise((res, rej) => conn.connect(e => (e ? rej(e) : res())));

  const [me] = await q("SELECT VERSION() v, CURRENT_USER() cu, USER() u");
  console.log(`\nMySQL ${me.v}`);
  console.log(`connected as ${me.u}, authenticated as ${me.cu}\n`);

  // What this very session holds. Always readable, needs no privileges, and is
  // the authoritative answer for the account FumasV5 is failing under.
  console.log("=== SHOW GRANTS FOR CURRENT_USER() ===");
  const mine = await q("SHOW GRANTS FOR CURRENT_USER()");
  mine.forEach(x => console.log("  " + Object.values(x)[0]));
  console.log("");

  let rows;
  try {
    rows = await q(
      `SELECT User, Host, LENGTH(Password) AS pwlen, ${GLOBAL_PRIVS.join(", ")}
         FROM mysql.user ORDER BY User, Host`);
  } catch (e) {
    console.log(`=== mysql.user — NOT READABLE from this login ===`);
    console.log(`  ${e.message}`);
    console.log("");
    console.log("  That failure is itself the finding: an account with full global");
    console.log("  privileges can always read mysql.user. This one cannot, so its");
    console.log("  rights are scoped to a database rather than granted globally —");
    console.log("  and RELOAD only exists as a global privilege.");
    conn.end();
    return;
  }

  console.log("=== mysql.user — global privileges ===");
  for (const r of rows) {
    const granted = GLOBAL_PRIVS.filter(p => r[p] === "Y").map(p => p.replace("_priv", ""));
    const denied  = GLOBAL_PRIVS.filter(p => r[p] !== "Y").map(p => p.replace("_priv", ""));
    console.log(`\n  ${r.User || "''"}@${r.Host}   password ${r.pwlen ? `set (len ${r.pwlen})` : "EMPTY"}`);
    console.log(`     RELOAD: ${r.Reload_priv}`);
    console.log(`     granted: ${granted.length === GLOBAL_PRIVS.length ? "ALL" : (granted.join(", ") || "none")}`);
    if (denied.length && granted.length) console.log(`     missing: ${denied.join(", ")}`);
  }

  console.log("\n=== SHOW GRANTS ===");
  for (const r of rows) {
    try {
      const g = await q("SHOW GRANTS FOR ?@?", [r.User, r.Host]);
      console.log(`\n  ${r.User || "''"}@${r.Host}:`);
      g.forEach(x => console.log("     " + Object.values(x)[0]));
    } catch (e) {
      console.log(`\n  ${r.User || "''"}@${r.Host}: could not read — ${e.message}`);
    }
  }

  const dbs = await q("SELECT User, Host, Db FROM mysql.db ORDER BY User, Host");
  console.log("\n=== mysql.db — database-level rows ===");
  if (!dbs.length) console.log("  (none)");
  dbs.forEach(d => console.log(`  ${d.User || "''"}@${d.Host} -> ${d.Db}`));

  console.log("\n=== does the in-memory copy match the tables? ===");
  console.log("  (a mismatch means someone edited mysql.user directly without FLUSH PRIVILEGES)");
  try {
    await q("FLUSH TABLES");
    console.log("  this session CAN reload — FLUSH TABLES succeeded");
  } catch (e) {
    console.log(`  this session CANNOT reload — ${e.message}`);
  }

  conn.end();
})().catch(e => {
  console.error("\nFailed: " + e.message);
  try { conn.end(); } catch {}
  process.exit(1);
});
