/**
 * Auth tests against the local fixture built from the captured schema.
 * The shop's database is never touched.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Database } from "../src/db/connection";
import {
  authenticate, getFormRights, getVisibleForms, splitLocations, writeAudit, NO_RIGHTS,
} from "../src/domain/auth";
import { encryptPassword } from "../src/crypto/password";

const OPTS = {
  host: process.env.MWALIMU_TEST_HOST ?? "127.0.0.1",
  port: Number(process.env.MWALIMU_TEST_PORT ?? 3307),
  user: process.env.MWALIMU_TEST_USER ?? "root",
  password: process.env.MWALIMU_TEST_PASSWORD ?? "",
  database: process.env.MWALIMU_TEST_DB ?? "mwalimuinvest_test",
};

let db: Database;
let available = false;

beforeAll(async () => {
  db = new Database(OPTS);
  available = await db.ping();
  if (!available) return;

  // Seed two users the way FumasV5 itself would have stored them.
  await db.query("DELETE FROM users WHERE usercode IN ('TESTCASH','TESTMGR','TESTBLANK')");
  await db.query(
    `INSERT INTO users (usercode, username, password, Clocation, clevel)
     VALUES (?,?,?,?,?), (?,?,?,?,?), (?,?,?,?,?)`,
    ["TESTCASH", "Test Cashier", encryptPassword("till123"), "MAIN", "1",
     "TESTMGR",  "Test Manager", encryptPassword("mgr456"),  "MAIN, BRANCH2", "9",
     // A row with an empty stored password, which the legacy login accepted
     // when the user also submitted an empty password.
     "TESTBLANK", "Blank", encryptPassword(""), "MAIN", "1"]);

  await db.query("DELETE FROM users_rights WHERE code IN ('TESTCASH','TESTMGR')");
  await db.query(
    `INSERT INTO users_rights (code, form_name, r_vw, r_ad, r_ed, r_dl, r_ap)
     VALUES (?,?,?,?,?,?,?), (?,?,?,?,?,?,?), (?,?,?,?,?,?,?)`,
    ["TESTCASH", "FPOS",        "1","1","0","0","0",
     "TESTCASH", "FGRNnewlist", "1","0","0","0","0",
     "TESTMGR",  "FPOS",        "1","1","1","1","1"]);

  await db.query("DELETE FROM sys_forms WHERE f_name IN ('FPOS','FGRNnewlist')");
  await db.query(
    `INSERT INTO sys_forms (f_name, f_caption, module, section, rank, listed)
     VALUES (?,?,?,?,?,?), (?,?,?,?,?,?)`,
    ["FPOS", "Point Of Sale", "Sales", "Selling", 1, "YES",
     "FGRNnewlist", "Goods Received", "Stocks", "Receiving", 2, "YES"]);
});

afterAll(async () => {
  if (db && available) {
    await db.query("DELETE FROM users WHERE usercode IN ('TESTCASH','TESTMGR','TESTBLANK')");
    await db.query("DELETE FROM users_rights WHERE code IN ('TESTCASH','TESTMGR')");
    await db.query("DELETE FROM sys_forms WHERE f_name IN ('FPOS','FGRNnewlist')");
    await db.query("DELETE FROM systemaudit WHERE aref = 'AUDIT-TEST'");
  }
  if (db) await db.close();
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => { if (!available) return; await fn(); });

describe("authenticate", () => {
  maybe("accepts an existing FumasV5 password unchanged", async () => {
    // The point of the whole exercise: nobody has to be given a new password.
    const user = await authenticate(db, "TESTCASH", "till123");
    expect(user).not.toBeNull();
    expect(user!.usercode).toBe("TESTCASH");
    expect(user!.username).toBe("Test Cashier");
  });

  maybe("rejects a wrong password", async () => {
    expect(await authenticate(db, "TESTCASH", "wrong")).toBeNull();
  });

  maybe("rejects an unknown user", async () => {
    expect(await authenticate(db, "NOSUCHUSER", "till123")).toBeNull();
  });

  maybe("rejects empty credentials instead of matching a blank password", async () => {
    // The legacy login encrypted "" and compared it, so an account with a
    // blank stored password let anyone in by submitting nothing.
    expect(await authenticate(db, "TESTBLANK", "")).toBeNull();
    expect(await authenticate(db, "", "till123")).toBeNull();
  });

  maybe("is not vulnerable to a quote in the username", async () => {
    // This input rewrote the statement in the legacy concatenated version.
    const user = await authenticate(db, "' OR '1'='1", "' OR '1'='1");
    expect(user).toBeNull();
  });

  maybe("splits the location list", async () => {
    const mgr = await authenticate(db, "TESTMGR", "mgr456");
    expect(mgr!.locations).toEqual(["MAIN", "BRANCH2"]);
  });
});

describe("splitLocations", () => {
  it("handles spacing, blanks and absence", () => {
    expect(splitLocations("MAIN, BRANCH2")).toEqual(["MAIN", "BRANCH2"]);
    expect(splitLocations("MAIN")).toEqual(["MAIN"]);
    expect(splitLocations("")).toEqual([]);
    expect(splitLocations(null)).toEqual([]);
    expect(splitLocations("A,,B ,")).toEqual(["A", "B"]);
  });
});

describe("getFormRights", () => {
  maybe("returns exactly what is granted", async () => {
    const r = await getFormRights(db, "TESTCASH", "FPOS");
    expect(r).toEqual({ view: true, add: true, edit: false, delete: false, approve: false });
  });

  maybe("distinguishes users on the same form", async () => {
    const mgr = await getFormRights(db, "TESTMGR", "FPOS");
    expect(mgr.delete).toBe(true);
    expect(mgr.approve).toBe(true);
  });

  maybe("grants nothing when no row exists", async () => {
    expect(await getFormRights(db, "TESTCASH", "FSomeOtherForm")).toEqual(NO_RIGHTS);
    expect(await getFormRights(db, "NOSUCHUSER", "FPOS")).toEqual(NO_RIGHTS);
  });

  maybe("gives ADMIN no special treatment", async () => {
    // The legacy code granted every right to any user called ADMIN,
    // regardless of the rights table. That backdoor is not carried over.
    expect(await getFormRights(db, "ADMIN", "FPOS")).toEqual(NO_RIGHTS);
    expect(await getFormRights(db, "admin", "FPOS")).toEqual(NO_RIGHTS);
  });
});

describe("getVisibleForms", () => {
  maybe("lists only forms the user may view", async () => {
    const forms = await getVisibleForms(db, "TESTCASH");
    expect(forms.map(f => f.formName).sort()).toEqual(["FGRNnewlist", "FPOS"]);
    expect(forms.find(f => f.formName === "FPOS")!.caption).toBe("Point Of Sale");
  });

  maybe("filters by module", async () => {
    const sales = await getVisibleForms(db, "TESTCASH", "Sales");
    expect(sales.map(f => f.formName)).toEqual(["FPOS"]);
  });

  maybe("returns nothing for a user with no grants", async () => {
    expect(await getVisibleForms(db, "NOSUCHUSER")).toEqual([]);
  });
});

describe("writeAudit", () => {
  maybe("records an action", async () => {
    await writeAudit(db, {
      details: "Test audit entry", operation: "ADDED", reference: "AUDIT-TEST",
      module: "Sales", section: "Point Of Sale", staff: "TESTCASH", machine: "TESTPC",
    });
    const row = await db.queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM systemaudit WHERE aref = ?", ["AUDIT-TEST"]);
    expect(Number(row!.n)).toBe(1);
  });
});
