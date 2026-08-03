/**
 * Machine configuration for the desktop app.
 *
 * Kept in ProgramData rather than beside the executable so it survives
 * upgrades and can be locked down per machine. Credentials are never
 * compiled into the app: an asar archive is only a tar file, and anything
 * inside it is readable by anyone with the installer.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface AppConfig {
  mysqlHost: string;
  mysqlPort: number;
  mysqlUser: string;
  mysqlPassword: string;
  mysqlDatabase: string;
  /** Identifies this till in audit entries and receipt numbering. */
  terminalId: string;
  /**
   * Whether this installation may write to the database.
   *
   * Off by default, and deliberately so. A new installation can be pointed
   * at the live database and explored with no possibility of altering the
   * books; writing is something someone turns on knowingly.
   */
  writesEnabled: boolean;
  /**
   * Minimum gap between statements, in milliseconds.
   *
   * The shop's server also runs the tills and cannot be worked on out of
   * hours, because every machine is powered down when the shop closes. A
   * small gap keeps an exploring user from slowing down a queue.
   */
  queryPacingMs: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  mysqlHost: "10.10.10.4",
  mysqlPort: 3306,
  mysqlUser: "",
  mysqlPassword: "",
  mysqlDatabase: "mwalimuinvest",
  terminalId: os.hostname(),
  writesEnabled: false,
  queryPacingMs: 50,
};

function configDir(): string {
  const base = process.env.PROGRAMDATA || path.join(os.homedir(), ".mwalimu");
  return path.join(base, "Mwalimu");
}

export function configPath(): string {
  return path.join(configDir(), "config.json");
}

export function loadConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: AppConfig): void {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf8");
}

/** The config minus the password, for anything that reaches the renderer. */
export function redactConfig(config: AppConfig): Omit<AppConfig, "mysqlPassword"> & {
  mysqlPasswordSet: boolean;
} {
  const { mysqlPassword, ...rest } = config;
  return { ...rest, mysqlPasswordSet: Boolean(mysqlPassword) };
}
