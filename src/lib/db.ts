import { mkdirSync } from "node:fs";
import { Database } from "bun:sqlite";

/**
 * HashHustle SQLite data layer (server-only).
 *
 * Runs on Bun's native SQLite (`bun:sqlite`). The database file lives in
 * ./data/hashhustle.db (overridable via HH_DB_PATH) and is git-ignored.
 *
 * IMPORTANT: This module imports `bun:sqlite`, which only exists in the Bun
 * runtime. It must never be statically imported from a module that is also
 * bundled for the browser — API route handlers load it via dynamic import.
 */

let db: Database | null = null;

export interface UserRow {
  id: string;
  tier: "free" | "pro" | "whale";
  hashrate_ghs: number;
  streak_day: number;
  last_streak_claim: string | null;
  mining_started_at: number | null;
  total_mined_sats: number;
  created_at: number;
}

export interface BalanceRow {
  user_id: string;
  sats: number;
  updated_at: number;
}

export interface WithdrawalRow {
  id: string;
  user_id: string;
  address: string;
  amount_sats: number;
  fee_sats: number;
  status: "pending" | "completed" | "failed";
  txid: string | null;
  created_at: number;
}

export interface PurchaseRow {
  id: string;
  user_id: string;
  product_id: string;
  tier: "pro" | "whale";
  source: "play" | "web-simulated";
  status: "pending-verification" | "simulated" | "verified";
  purchase_token: string;
  price_usd: number;
  created_at: number;
}

export function getDb(): Database {
  if (db) return db;
  const path = process.env.HH_DB_PATH ?? "./data/hashhustle.db";
  if (path !== ":memory:") {
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (dir) mkdirSync(dir, { recursive: true });
  }
  const instance = new Database(path, { create: true });
  instance.exec("PRAGMA journal_mode = WAL");
  instance.exec("PRAGMA foreign_keys = ON");
  migrate(instance);
  db = instance;
  return db;
}

function migrate(d: Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      tier TEXT NOT NULL DEFAULT 'free',
      hashrate_ghs REAL NOT NULL DEFAULT 5000,
      streak_day INTEGER NOT NULL DEFAULT 1,
      last_streak_claim TEXT,
      mining_started_at INTEGER,
      total_mined_sats REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS balances (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      sats REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      address TEXT NOT NULL,
      amount_sats REAL NOT NULL,
      fee_sats REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      txid TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mission_claims (
      user_id TEXT NOT NULL,
      mission_key TEXT NOT NULL,
      claim_date TEXT NOT NULL,
      reward_sats REAL NOT NULL,
      claimed_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, mission_key, claim_date)
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      product_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      purchase_token TEXT NOT NULL UNIQUE,
      price_usd REAL NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

/** Return the user row, creating it (with a zeroed balance) if unknown. */
export function getOrCreateUser(userId: string): UserRow {
  const d = getDb();
  const existing = d
    .query("SELECT * FROM users WHERE id = ?")
    .get(userId) as UserRow | null;
  if (existing) return existing;

  const now = Date.now();
  d.transaction(() => {
    d.query(
      "INSERT OR IGNORE INTO users (id, tier, hashrate_ghs, streak_day, last_streak_claim, mining_started_at, total_mined_sats, created_at) VALUES (?, 'free', 5000, 1, NULL, NULL, 0, ?)",
    ).run(userId, now);
    d.query(
      "INSERT OR IGNORE INTO balances (user_id, sats, updated_at) VALUES (?, 0, ?)",
    ).run(userId, now);
  })();

  return d.query("SELECT * FROM users WHERE id = ?").get(userId) as UserRow;
}

export function getUser(userId: string): UserRow | null {
  return getDb().query("SELECT * FROM users WHERE id = ?").get(userId) as
    | UserRow
    | null;
}

export function getBalance(userId: string): BalanceRow | null {
  return getDb().query("SELECT * FROM balances WHERE user_id = ?").get(userId) as
    | BalanceRow
    | null;
}

export function creditBalance(userId: string, sats: number) {
  const d = getDb();
  d.query(
    "UPDATE balances SET sats = sats + ?, updated_at = ? WHERE user_id = ?",
  ).run(sats, Date.now(), userId);
}

export function setBalance(userId: string, sats: number) {
  const d = getDb();
  d.query("UPDATE balances SET sats = ?, updated_at = ? WHERE user_id = ?").run(
    sats,
    Date.now(),
    userId,
  );
}

export function setUserMining(userId: string, startedAt: number | null) {
  getDb()
    .query("UPDATE users SET mining_started_at = ? WHERE id = ?")
    .run(startedAt, userId);
}

export function addTotalMined(userId: string, sats: number) {
  getDb()
    .query("UPDATE users SET total_mined_sats = total_mined_sats + ? WHERE id = ?")
    .run(sats, userId);
}

export function setStreak(
  userId: string,
  streakDay: number,
  lastClaim: string,
) {
  getDb()
    .query("UPDATE users SET streak_day = ?, last_streak_claim = ? WHERE id = ?")
    .run(streakDay, lastClaim, userId);
}

export function upgradeUserTier(userId: string, tier: string, hashrateGhs: number) {
  getDb()
    .query("UPDATE users SET tier = ?, hashrate_ghs = ? WHERE id = ?")
    .run(tier, hashrateGhs, userId);
}

export function insertWithdrawal(w: WithdrawalRow) {
  getDb()
    .query(
      "INSERT INTO withdrawals (id, user_id, address, amount_sats, fee_sats, status, txid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      w.id,
      w.user_id,
      w.address,
      w.amount_sats,
      w.fee_sats,
      w.status,
      w.txid,
      w.created_at,
    );
}

export function getMissionClaimsToday(
  userId: string,
  date: string,
): { mission_key: string; reward_sats: number }[] {
  return getDb()
    .query(
      "SELECT mission_key, reward_sats FROM mission_claims WHERE user_id = ? AND claim_date = ?",
    )
    .all(userId, date) as { mission_key: string; reward_sats: number }[];
}

export function insertMissionClaim(
  userId: string,
  missionKey: string,
  date: string,
  rewardSats: number,
) {
  getDb()
    .query(
      "INSERT OR IGNORE INTO mission_claims (user_id, mission_key, claim_date, reward_sats, claimed_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(userId, missionKey, date, rewardSats, Date.now());
}

export function insertPurchase(p: PurchaseRow) {
  getDb()
    .query(
      "INSERT OR IGNORE INTO purchases (id, user_id, product_id, tier, source, status, purchase_token, price_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      p.id,
      p.user_id,
      p.product_id,
      p.tier,
      p.source,
      p.status,
      p.purchase_token,
      p.price_usd,
      p.created_at,
    );
}

/** Look up a purchase by its (unique) token — used to keep verify idempotent. */
export function getPurchaseByToken(
  purchaseToken: string,
): PurchaseRow | null {
  return getDb()
    .query("SELECT * FROM purchases WHERE purchase_token = ?")
    .get(purchaseToken) as PurchaseRow | null;
}

export function getPurchasesByUser(userId: string): PurchaseRow[] {
  return getDb()
    .query("SELECT * FROM purchases WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as PurchaseRow[];
}
