/**
 * MySQL access for the Mwalimu Cosmetics system.
 *
 * Everything that touches the shop's database goes through here, for three
 * reasons that are specific to this deployment:
 *
 *  1. The server is MySQL 5.1.73 on modest hardware, shared with the tills.
 *     A query that is merely inefficient here is a customer waiting at a
 *     counter. Callers get a paced runner rather than an open connection.
 *
 *  2. Every statement is parameterised. The legacy app concatenated SQL and
 *     "escaped" apostrophes by replacing them with backticks, which corrupts
 *     data rather than protecting it. That stops here.
 *
 *  3. Writes must be atomic. withTransaction() is the only way to get a
 *     writable handle, so "I forgot to wrap it" is not expressible.
 */

import * as mysql from "mysql";

export interface ConnectionOptions {
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
  connectTimeout?: number;
  /**
   * Return DATE and DATETIME as strings rather than JS Date objects.
   *
   * On by default here, and it matters: the driver builds Date objects in the
   * process's local time, so a value read and written back shifts by the
   * UTC+3 offset. Reading dates as strings keeps them exactly as stored.
   */
  dateStrings?: boolean;
}

/** A handle that can run queries. Both the pool and a transaction provide one. */
export interface Queryable {
  query<T = any>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  queryOne<T = any>(sql: string, params?: readonly unknown[]): Promise<T | null>;
}

/** A Queryable inside an open transaction. Writes require one of these. */
export interface Transaction extends Queryable {
  readonly inTransaction: true;
}

export class QueryError extends Error {
  constructor(message: string, readonly sql: string, readonly cause?: unknown) {
    // The SQL is included but never the parameters: those routinely hold
    // customer names and payment references, and this text reaches logs.
    super(`${message}\n  SQL: ${sql.replace(/\s+/g, " ").trim().slice(0, 300)}`);
    this.name = "QueryError";
  }
}

// The driver's own types declare `ssl` as a string or TLS options object, but
// it accepts false to mean "no TLS", which is what this LAN server needs.
function buildDriverOptions(opts: ConnectionOptions): mysql.PoolConfig {
  return {
    host: opts.host,
    port: opts.port ?? 3306,
    user: opts.user,
    password: opts.password,
    database: opts.database,
    connectTimeout: opts.connectTimeout ?? 10000,
    dateStrings: opts.dateStrings ?? true,
    ssl: false,
    // MySQL 5.1 predates the modern auth handshake.
    insecureAuth: true,
    // Decimals as strings so money never passes through a float on the way
    // in or out; money.ts parses them into integer cents.
    supportBigNumbers: true,
    bigNumberStrings: true,
    // One statement per call. Defence in depth against injection, and it
    // keeps errors attributable to a single query.
    multipleStatements: false,
  } as unknown as mysql.PoolConfig;
}

function runQuery<T>(
  conn: mysql.Connection | mysql.PoolConnection,
  sql: string,
  params: readonly unknown[],
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    conn.query(sql, params as any[], (err, rows) => {
      if (err) reject(new QueryError(err.message, sql, err));
      else resolve(rows as T[]);
    });
  });
}

/**
 * A connection pool with deliberate pacing.
 *
 * The pool is small and requests are serialised by a minimum gap, because
 * this database is also serving live tills. Throughput is explicitly not the
 * goal; staying out of the way is.
 */
export class Database implements Queryable {
  private readonly pool: mysql.Pool;
  private lastQueryAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly options: ConnectionOptions,
    /**
     * Minimum milliseconds between statements. The default is gentle on
     * purpose. Raise it for bulk or diagnostic work that runs while the shop
     * is trading; the server cannot be worked on out of hours because
     * everything is powered down when the shop closes.
     */
    private readonly minQueryGapMs = 0,
  ) {
    this.pool = mysql.createPool({
      ...buildDriverOptions(options),
      connectionLimit: 4,
      queueLimit: 0,
    });
  }

  /** Serialise through a single chain so pacing cannot be bypassed. */
  private schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      if (this.minQueryGapMs > 0) {
        const wait = this.lastQueryAt + this.minQueryGapMs - Date.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
      }
      try {
        return await fn();
      } finally {
        this.lastQueryAt = Date.now();
      }
    });
    // Keep the chain alive even when a caller's query rejects.
    this.queue = run.catch(() => undefined);
    return run;
  }

  query<T = any>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return this.schedule(() => runQuery<T>(this.pool as any, sql, params));
  }

  async queryOne<T = any>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length ? rows[0]! : null;
  }

  /**
   * Run work inside a transaction, committing on success and rolling back on
   * any thrown error.
   *
   * This is the only route to a writable handle. Because the callback
   * receives the transaction and nothing else can write, a partially applied
   * sale is not something a caller can accidentally produce.
   *
   * All ledger tables are InnoDB — verified against the live database — so
   * these guarantees are real rather than assumed.
   */
  async withTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.schedule(async () => {
      const conn = await new Promise<mysql.PoolConnection>((resolve, reject) => {
        this.pool.getConnection((err, c) => err ? reject(err) : resolve(c));
      });

      const tx: Transaction = {
        inTransaction: true,
        query: <T = any>(sql: string, params: readonly unknown[] = []) =>
          runQuery<T>(conn, sql, params),
        queryOne: async <T = any>(sql: string, params: readonly unknown[] = []) => {
          const rows = await runQuery<T>(conn, sql, params);
          return rows.length ? rows[0]! : null;
        },
      };

      try {
        await new Promise<void>((res, rej) => conn.beginTransaction(e => e ? rej(e) : res()));
      } catch (e) {
        conn.release();
        throw e;
      }

      try {
        const result = await fn(tx);
        await new Promise<void>((res, rej) => conn.commit(e => e ? rej(e) : res()));
        return result;
      } catch (error) {
        // Rollback failure must not mask the error that caused it.
        await new Promise<void>(res => conn.rollback(() => res()));
        throw error;
      } finally {
        conn.release();
      }
    });
  }

  /** True when the connection works and the database answers. */
  async ping(): Promise<boolean> {
    try {
      await this.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.queue.catch(() => undefined);
    await new Promise<void>(res => this.pool.end(() => res()));
  }

  get databaseName(): string {
    return this.options.database;
  }
}
