import { createServerFn } from "@tanstack/react-start";
import type { UserRow } from "../../lib/db";
import type { Tier } from "../../lib/mining";

/**
 * Mining API: `/api/mining` (server functions).
 * Actions:
 *   - startMining        — engage the harvester (records mining start)
 *   - claimMiningRewards — disengage + credit rewards accrued since start
 *   - claimMission       — credit a completed ad/sponsor mission reward
 *   - claimStreak        — credit the daily stacking bonus
 *   - upgradeTier        — apply a subscription tier (simulated purchase)
 */

interface MiningPayload {
  userId: string;
  action:
    | "start"
    | "claim"
    | "mission"
    | "streak"
    | "upgrade";
  missionKey?: string;
  tier?: string;
}

export const miningAction = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as MiningPayload)
  .handler(async ({ data }) => {
    const { userId, action, missionKey, tier } = data;
    const db = await import("../../lib/db");
    const engine = await import("../../lib/mining");

    const user = db.getOrCreateUser(userId);
    const now = Date.now();

    switch (action) {
      case "start": {
        if (!user.mining_started_at) {
          db.setUserMining(userId, now);
          user.mining_started_at = now;
        }
        return { ok: true, state: await snapshot(db, engine, user, userId) };
      }

      case "claim": {
        let rewardSats = 0;
        if (user.mining_started_at) {
          const btcPrice = await engine.getBtcPriceUsd();
          const elapsed = Math.min(
            now - user.mining_started_at,
            engine.MAX_ACCRUAL_MS,
          );
          rewardSats =
            engine.dailyYieldSats(user.tier as Tier, btcPrice) *
            (elapsed / 86_400_000);
          rewardSats = Math.round(rewardSats * 100) / 100;
          if (rewardSats > 0) {
            db.creditBalance(userId, rewardSats);
            db.addTotalMined(userId, rewardSats);
          }
          db.setUserMining(userId, null);
          user.mining_started_at = null;
        }
        return {
          ok: true,
          rewardSats,
          state: await snapshot(db, engine, user, userId),
        };
      }

      case "mission": {
        const mission = missionKey
          ? engine.MISSIONS[missionKey]
          : undefined;
        if (!mission) {
          return { ok: false, error: "Unknown mission.", state: await snapshot(db, engine, user, userId) };
        }
        const today = engine.todayUtc();
        if (
          db
            .getMissionClaimsToday(userId, today)
            .some((c) => c.mission_key === missionKey)
        ) {
          return { ok: false, error: "Mission already claimed today.", state: await snapshot(db, engine, user, userId) };
        }
        db.insertMissionClaim(userId, missionKey!, today, mission.rewardSats);
        db.creditBalance(userId, mission.rewardSats);
        db.addTotalMined(userId, mission.rewardSats);
        return { ok: true, rewardSats: mission.rewardSats, state: await snapshot(db, engine, user, userId) };
      }

      case "streak": {
        const today = engine.todayUtc();
        if (user.last_streak_claim === today) {
          return { ok: false, error: "Stacking bonus already claimed today.", state: await snapshot(db, engine, user, userId) };
        }
        const bonus = engine.streakBonus(user.streak_day);
        const nextDay = user.streak_day >= 5 ? 1 : user.streak_day + 1;
        db.creditBalance(userId, bonus);
        db.addTotalMined(userId, bonus);
        db.setStreak(userId, nextDay, today);
        return { ok: true, rewardSats: bonus, state: await snapshot(db, engine, user, userId) };
      }

      case "upgrade": {
        if (!tier || !engine.isTier(tier)) {
          return { ok: false, error: "Invalid tier.", state: await snapshot(db, engine, user, userId) };
        }
        db.upgradeUserTier(userId, tier, engine.TIERS[tier].hashrateGhs);
        user.tier = tier;
        user.hashrate_ghs = engine.TIERS[tier].hashrateGhs;
        return { ok: true, state: await snapshot(db, engine, user, userId) };
      }

      default:
        return { ok: false, error: "Unknown action.", state: await snapshot(db, engine, user, userId) };
    }
  });

/** Rebuild the snapshot after a mutation using the caller's user/balance rows. */
async function snapshot(
  db: typeof import("../../lib/db"),
  engine: typeof import("../../lib/mining"),
  user: UserRow,
  userId: string,
) {
  const fresh = db.getUser(userId) ?? user;
  const bal =
    db.getBalance(userId) ?? { user_id: userId, sats: 0, updated_at: Date.now() };
  return engine.buildUserState(fresh, bal, engine.todayUtc());
}
