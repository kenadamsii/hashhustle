import type { BalanceRow, UserRow } from "./db";

/**
 * HashHustle mining engine (server-only).
 *
 * Implements the Dynamic Satoshi Yield Algorithm (see
 * /home/team/shared/skills/dynamic-mining-yield): paid-tier rewards are derived
 * from the subscription price and current BTC price so the business keeps a
 * fixed service margin (PAYOUT = PRICE x (1 - SERVICE_MARGIN)). The free tier
 * is funded by ad revenue at a small fixed base rate.
 *
 * Reward model:
 *   total daily sats = AD_FUNDED_BASE_RATE + SUBSCRIPTION_YIELD(tier)
 * where SUBSCRIPTION_YIELD is only > 0 for paid tiers and is margin-locked.
 */

export const SERVICE_MARGIN = 0.25; // business retains 25% of subscription revenue
export const MIN_WITHDRAWAL_SATS = 10_000;
export const AD_FUNDED_BASE_RATE_SATS_PER_DAY = 8_640; // 0.1 sats/s — free engine, ad-funded
export const MAX_ACCRUAL_MS = 7 * 24 * 60 * 60 * 1000; // cap idle accrual at 7 days
export const BTC_PRICE_DEFAULT_USD = 64_000;
const PRICE_CACHE_TTL_MS = 10 * 60 * 1000;

export type Tier = "free" | "pro" | "whale";

export interface TierConfig {
  label: string;
  priceUsd: number;
  hashrateGhs: number;
  withdrawalFee: number; // fraction of the withdrawal taken as a service fee
}

export const TIERS: Record<Tier, TierConfig> = {
  free: {
    label: "Bronze (Free)",
    priceUsd: 0,
    hashrateGhs: 5_000, // 5 TH/s
    withdrawalFee: 0.015, // 1.5%
  },
  pro: {
    label: "Pro Plan",
    priceUsd: 9.99,
    hashrateGhs: 25_000, // 25 TH/s
    withdrawalFee: 0.005, // 0.5%
  },
  whale: {
    label: "Whale Plan",
    priceUsd: 29.99,
    hashrateGhs: 100_000, // 100 TH/s
    withdrawalFee: 0, // fee waived
  },
};

export const MISSIONS: Record<string, { label: string; rewardSats: number }> = {
  "premium-sponsor-video-ad": { label: "Premium Sponsor Video Ad", rewardSats: 150 },
  "interactive-harvester-interstitial": { label: "Interactive Harvester Interstitial", rewardSats: 80 },
  "follow-x-community": { label: "Follow X Community", rewardSats: 200 },
};

export function isTier(t: string): t is Tier {
  return t === "free" || t === "pro" || t === "whale";
}

let priceCache: { price: number; at: number } | null = null;

/**
 * Current BTC price in USD: cached CoinGecko fetch with a fallback to
 * HH_BTC_PRICE_USD (then a sane default) when the network is unavailable.
 */
export async function getBtcPriceUsd(): Promise<number> {
  if (priceCache && Date.now() - priceCache.at < PRICE_CACHE_TTL_MS) {
    return priceCache.price;
  }
  const env = Number(process.env.HH_BTC_PRICE_USD);
  let price = Number.isFinite(env) && env > 0 ? env : BTC_PRICE_DEFAULT_USD;
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const body = (await res.json()) as { bitcoin?: { usd?: number } };
      const live = body?.bitcoin?.usd;
      if (typeof live === "number" && live > 0) price = live;
    }
  } catch {
    // Network unavailable — keep env/default price.
  }
  priceCache = { price, at: Date.now() };
  return price;
}

/**
 * Dynamic satoshi yield for a paid tier, in sats per GH/s per day, guaranteeing
 * the service margin: the user's monthly satoshi payout equals
 * priceUsd x (1 - SERVICE_MARGIN) / btcPrice x 1e8.
 */
export function subscriptionYieldSatsPerGhsDay(
  tier: Tier,
  btcPriceUsd: number,
): number {
  const cfg = TIERS[tier];
  if (cfg.priceUsd <= 0 || btcPriceUsd <= 0) return 0;
  const monthlyPayoutUsd = cfg.priceUsd * (1 - SERVICE_MARGIN);
  const monthlyPayoutSats = (monthlyPayoutUsd / btcPriceUsd) * 100_000_000;
  return monthlyPayoutSats / (30 * cfg.hashrateGhs);
}

/** Total daily yield in sats for a user's tier at the given BTC price. */
export function dailyYieldSats(tier: Tier, btcPriceUsd: number): number {
  const cfg = TIERS[tier];
  const base = AD_FUNDED_BASE_RATE_SATS_PER_DAY;
  const sub = subscriptionYieldSatsPerGhsDay(tier, btcPriceUsd) * cfg.hashrateGhs;
  return base + sub;
}

/** Per-second yield used by the client ticker (fractional sats/sec). */
export function yieldSatsPerSec(tier: Tier, btcPriceUsd: number): number {
  return dailyYieldSats(tier, btcPriceUsd) / 86_400;
}

export interface UserState {
  userId: string;
  tier: Tier;
  hashrateThs: number;
  balanceSats: number;
  totalMinedSats: number;
  mining: boolean;
  miningStartedAt: number | null;
  yieldSatsPerSec: number;
  est24hPayoutSats: number;
  streakDay: number;
  streakClaimedToday: boolean;
  withdrawalFeeRate: number;
  withdrawalFeeSats: number;
  btcPriceUsd: number;
  missionsCompletedToday: string[];
}

/** Build the full user state, auto-claiming any accrued mining rewards. */
export async function buildUserState(
  user: UserRow,
  balance: BalanceRow,
  todayStr: string,
): Promise<UserState> {
  const btcPrice = await getBtcPriceUsd();
  const tier = isTier(user.tier) ? user.tier : "free";
  const cfg = TIERS[tier];

  let miningStartedAt = user.mining_started_at;
  if (miningStartedAt) {
    const elapsed = Math.min(Date.now() - miningStartedAt, MAX_ACCRUAL_MS);
    if (elapsed > 0) {
      const reward = dailyYieldSats(tier, btcPrice) * (elapsed / 86_400_000);
      if (reward > 0.0000001) {
        const { creditBalance, addTotalMined, setUserMining } = await import("./db");
        creditBalance(user.id, reward);
        addTotalMined(user.id, reward);
        miningStartedAt = null;
        setUserMining(user.id, null);
        balance = { ...balance, sats: balance.sats + reward };
        user = { ...user, mining_started_at: null, total_mined_sats: user.total_mined_sats + reward };
      }
    }
  }

  const withdrawalFeeSats = Math.round(balance.sats * cfg.withdrawalFee * 100) / 100;

  const { getMissionClaimsToday } = await import("./db");
  const claims = getMissionClaimsToday(user.id, todayStr);

  return {
    userId: user.id,
    tier,
    hashrateThs: cfg.hashrateGhs / 1000,
    balanceSats: Math.round(balance.sats * 100) / 100,
    totalMinedSats: Math.round(user.total_mined_sats * 100) / 100,
    mining: miningStartedAt !== null,
    miningStartedAt,
    yieldSatsPerSec: yieldSatsPerSec(tier, btcPrice),
    est24hPayoutSats: Math.round(dailyYieldSats(tier, btcPrice) * 100) / 100,
    streakDay: user.streak_day,
    streakClaimedToday: user.last_streak_claim === todayStr,
    withdrawalFeeRate: cfg.withdrawalFee,
    withdrawalFeeSats,
    btcPriceUsd: btcPrice,
    missionsCompletedToday: claims.map((c) => c.mission_key),
  };
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Streak bonus for the given streak day: +50 sats/day, day 5 = 250 ("1.5x"). */
export function streakBonus(streakDay: number): number {
  return Math.min(Math.max(streakDay, 1), 5) * 50;
}
