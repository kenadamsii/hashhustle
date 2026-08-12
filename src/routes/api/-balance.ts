import { createServerFn } from "@tanstack/react-start";

// Get current user balance
export const getBalance = createServerFn({ method: "GET" })
  .handler(async () => {
    // In production this reads from DB. Returns mock data for now.
    return {
      sats: 8420,
      btc: "0.00008420",
      pendingWithdrawal: 0,
      tier: "free" as const,
    };
  });
