import { createServerFn } from "@tanstack/react-start";

/**
 * Withdrawal API: `/api/withdraw` (server function).
 * Validates the request (10k sat threshold, wallet address shape, sufficient
 * balance), takes the tier's service fee, deducts the balance and records a
 * pending withdrawal. Returns a transaction id and the new state.
 */

interface WithdrawPayload {
  userId: string;
  address: string;
}

export const requestWithdrawal = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as WithdrawPayload)
  .handler(async ({ data }) => {
    const { userId, address } = data;
    const db = await import("../../lib/db");
    const engine = await import("../../lib/mining");

    const user = db.getOrCreateUser(userId);
    const bal = db.getBalance(userId);

    if (!address || typeof address !== "string") {
      return { ok: false, error: "Please enter a valid Bitcoin wallet address.", state: await snapshot(db, engine, user, userId) };
    }
    const addr = address.trim();
    if (addr.length < 26 || addr.length > 62) {
      return { ok: false, error: "Please enter a valid Bitcoin wallet address.", state: await snapshot(db, engine, user, userId) };
    }
    if (!/^[13bcB][a-km-zA-HJ-NP-Z1-9]{25,61}$/.test(addr)) {
      return { ok: false, error: "Please enter a valid Bitcoin wallet address.", state: await snapshot(db, engine, user, userId) };
    }

    const balanceSats = bal?.sats ?? 0;
    if (balanceSats < engine.MIN_WITHDRAWAL_SATS) {
      return {
        ok: false,
        error: `Minimum withdrawal threshold is ${engine.MIN_WITHDRAWAL_SATS.toLocaleString()} Satoshis.`,
        state: await snapshot(db, engine, user, userId),
      };
    }

    const tier = engine.isTier(user.tier) ? user.tier : "free";
    const feeRate = engine.TIERS[tier].withdrawalFee;
    const feeSats = Math.round(balanceSats * feeRate * 100) / 100;
    const netSats = Math.round((balanceSats - feeSats) * 100) / 100;
    const txid =
      "tx-hh-" +
      Array.from(crypto.getRandomValues(new Uint8Array(9)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("") +
      "f7931a";

    const d = db.getDb();
    d.transaction(() => {
      db.setBalance(userId, 0);
      db.insertWithdrawal({
        id: txid,
        user_id: userId,
        address: addr,
        amount_sats: balanceSats,
        fee_sats: feeSats,
        status: "pending",
        txid,
        created_at: Date.now(),
      });
    })();

    return {
      ok: true,
      txid,
      amountSats: balanceSats,
      feeSats,
      netSats,
      state: await snapshot(db, engine, user, userId),
    };
  });

async function snapshot(
  db: typeof import("../../lib/db"),
  engine: typeof import("../../lib/mining"),
  user: import("../../lib/db").UserRow,
  userId: string,
) {
  const fresh = db.getUser(userId) ?? user;
  const bal =
    db.getBalance(userId) ?? { user_id: userId, sats: 0, updated_at: Date.now() };
  return engine.buildUserState(fresh, bal, engine.todayUtc());
}
