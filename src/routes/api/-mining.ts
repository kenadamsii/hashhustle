import { createServerFn } from "@tanstack/react-start";

// Mining reward claim — grants satoshis based on active tier
export const claimMining = createServerFn({ method: "POST" })
  .handler(async () => {
    // Tier hashrate multipliers (sats per claim)
    const tiers = {
      free: { hashrate: 5, rewardPerClaim: 5 },
      pro: { hashrate: 25, rewardPerClaim: 30 },
      whale: { hashrate: 100, rewardPerClaim: 150 },
    } as const;

    // In production this reads from DB. For now returns mock.
    const activeTier: keyof typeof tiers = "free";

    const tier = tiers[activeTier];
    return {
      success: true,
      reward: tier.rewardPerClaim,
      hashrate: tier.hashrate,
      activeTier,
      timestamp: Date.now(),
    };
  });
