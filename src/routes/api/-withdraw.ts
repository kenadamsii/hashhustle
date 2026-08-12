import { createServerFn } from "@tanstack/react-start";

// Request a withdrawal to a Bitcoin address
export const requestWithdrawal = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { address: string; amount: number } }) => {
    const MIN_WITHDRAWAL = 10000;
    const FEE_RATE = 0.015; // 1.5% for free tier

    if (!data.address || data.address.length < 26) {
      return { success: false, error: "Invalid Bitcoin address" };
    }

    if (data.amount < MIN_WITHDRAWAL) {
      return {
        success: false,
        error: `Minimum withdrawal is ${MIN_WITHDRAWAL} sats`,
        currentAmount: data.amount,
        required: MIN_WITHDRAWAL,
      };
    }

    const fee = Math.round(data.amount * FEE_RATE);
    const netAmount = data.amount - fee;

    return {
      success: true,
      txId: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      amount: data.amount,
      fee,
      netAmount,
      address: data.address,
      timestamp: Date.now(),
    };
  });
