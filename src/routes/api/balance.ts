import { createServerFn } from "@tanstack/react-start";

/**
 * GET-style balance API: `/api/balance` (server function).
 * Returns the user's full state (balance, tier, hashrate, live yield,
 * streak + mission progress). Auto-claims any mining rewards accrued since
 * the last claim, so a balance check is always up to date.
 */

interface BalancePayload {
  userId: string;
}

export const getBalance = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as BalancePayload)
  .handler(async ({ data }) => {
    const { userId } = data;
    const db = await import("../../lib/db");
    const engine = await import("../../lib/mining");

    const user = db.getOrCreateUser(userId);
    const bal =
      db.getBalance(userId) ?? { user_id: userId, sats: 0, updated_at: Date.now() };
    return await engine.buildUserState(user, bal, engine.todayUtc());
  });
