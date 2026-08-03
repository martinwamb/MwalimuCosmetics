/**
 * Authentication and per-form rights against the existing `users` and
 * `users_rights` tables.
 *
 * The new system shares these tables with FumasV5, so everyone keeps the
 * username and password they already have — no reset, no migration, and both
 * systems can run side by side during changeover.
 *
 * Mirrors SearchClass.DataSearching_users and mglobal.allow_me_ from the
 * decompiled source, with the security defects left behind rather than
 * reproduced. Those are called out individually below.
 */

import type { Queryable } from "../db/connection";
import { encryptPassword } from "../crypto/password";

export interface User {
  usercode: string;
  username: string;
  /** Comma-separated location list from `users.Clocation`, already split. */
  locations: string[];
  level: string | null;
}

/** The five rights FumasV5 tracks per user per form. */
export interface FormRights {
  view: boolean;
  add: boolean;
  edit: boolean;
  delete: boolean;
  approve: boolean;
}

export const NO_RIGHTS: Readonly<FormRights> = Object.freeze({
  view: false, add: false, edit: false, delete: false, approve: false,
});

interface UserRow {
  usercode: string;
  username: string | null;
  Clocation: string | null;
  clevel: string | null;
}

/**
 * Verify a username and password against the shared `users` table.
 *
 * Returns null when authentication fails, without saying which of the two was
 * wrong. The comparison is ciphertext against ciphertext, matching how the
 * legacy app stores passwords.
 *
 * Deliberately NOT reproduced from the legacy implementation:
 *
 *  - It built the query by string concatenation, so a username containing a
 *    quote could rewrite the statement. Everything here is parameterised.
 *  - Its PIN login path set the session user to the PIN value itself rather
 *    than the usercode, so rights were then looked up against a number that
 *    matched nothing. That path is not carried over.
 *  - An empty password produced ciphertext that matched any row whose stored
 *    password was also empty, so a blank account accepted a blank password.
 *    Empty credentials are now rejected before any query runs.
 */
export async function authenticate(
  db: Queryable,
  usercode: string,
  password: string,
): Promise<User | null> {
  if (!usercode || !password) return null;

  const row = await db.queryOne<UserRow>(
    `SELECT usercode, username, Clocation, clevel
       FROM users
      WHERE usercode = ? AND password = ?
      LIMIT 1`,
    [usercode, encryptPassword(password)],
  );
  if (!row) return null;

  return {
    usercode: row.usercode,
    username: row.username || row.usercode,
    locations: splitLocations(row.Clocation),
    level: row.clevel ?? null,
  };
}

/** `users.Clocation` holds a comma-separated list, sometimes with spaces. */
export function splitLocations(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

interface RightsRow {
  r_vw: string | number | null;
  r_ad: string | number | null;
  r_ed: string | number | null;
  r_dl: string | number | null;
  r_ap: string | number | null;
}

/** Stored as '0'/'1' strings in some rows and integers in others. */
const flag = (v: string | number | null | undefined): boolean =>
  v === 1 || v === "1";

/**
 * Load a user's rights for one form.
 *
 * Two traps in the legacy version, both avoided here:
 *
 *  - mglobal.allow_me_ returned whether a row was FOUND, not whether the
 *    right was granted, while the actual permission was left in a set of
 *    shared mutable fields. Calling it for one form and then reading those
 *    fields after another call elsewhere silently returned the wrong answer.
 *    This returns the rights themselves.
 *
 *  - Any usercode equal to "ADMIN" was granted everything unconditionally,
 *    regardless of the rights table, and elsewhere an empty usercode was
 *    quietly rewritten to "admin". Both are gone: rights come only from
 *    `users_rights`.
 *
 * Absence of a row means no rights, which is the safe reading.
 */
export async function getFormRights(
  db: Queryable,
  usercode: string,
  formName: string,
): Promise<FormRights> {
  const row = await db.queryOne<RightsRow>(
    `SELECT r_vw, r_ad, r_ed, r_dl, r_ap
       FROM users_rights
      WHERE code = ? AND form_name = ?
      LIMIT 1`,
    [usercode, formName],
  );
  if (!row) return { ...NO_RIGHTS };

  return {
    view:    flag(row.r_vw),
    add:     flag(row.r_ad),
    edit:    flag(row.r_ed),
    delete:  flag(row.r_dl),
    approve: flag(row.r_ap),
  };
}

export interface MenuEntry {
  formName: string;
  caption: string;
  module: string;
  section: string;
}

/**
 * The forms a user may view, for building the navigation.
 *
 * `sys_forms` is the registry of screens and `users_rights` the grants;
 * joining them yields what this person should actually see. `listed` marks
 * entries meant to appear in a menu as opposed to being reachable only from
 * another screen.
 */
export async function getVisibleForms(
  db: Queryable,
  usercode: string,
  module?: string,
): Promise<MenuEntry[]> {
  const rows = await db.query<{
    f_name: string; f_caption: string | null; module: string | null; section: string | null;
  }>(
    `SELECT f.f_name, f.f_caption, f.module, f.section
       FROM sys_forms f
       JOIN users_rights r ON r.form_name = f.f_name
      WHERE r.code = ? AND r.r_vw = 1 AND f.listed = 'YES'
        ${module ? "AND f.module = ?" : ""}
      GROUP BY f.f_name, f.f_caption, f.module, f.section, f.rank
      ORDER BY f.rank, f.f_caption`,
    module ? [usercode, module] : [usercode],
  );

  return rows.map(r => ({
    formName: r.f_name,
    caption:  r.f_caption || r.f_name,
    module:   r.module || "",
    section:  r.section || "",
  }));
}

/**
 * Record an action in `systemaudit`.
 *
 * The legacy app called this by convention from each screen, so anything that
 * forgot simply went unrecorded — user creation and password changes among
 * them. In the new system this belongs inside the posting functions, where it
 * cannot be skipped, and inside their transaction so the trail cannot survive
 * a rolled-back action.
 */
export async function writeAudit(
  db: Queryable,
  entry: {
    details: string;
    operation: string;
    reference: string;
    module: string;
    section: string;
    staff: string;
    machine: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO systemaudit (details, operation, aref, amodule, adate, astaff, amachine, asection)
     VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`,
    [entry.details, entry.operation, entry.reference, entry.module,
     entry.staff, entry.machine, entry.section],
  );
}
