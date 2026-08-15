import { Capacitor } from "@capacitor/core";

/**
 * HashHustle Play Billing service (client-safe).
 *
 * Thin wrapper around the `capacitor-billing` plugin (the renamed successor of
 * `@capacitor-community/billing`, same author, Capacitor 8 compatible — the
 * original package is no longer published). It exposes our two subscription
 * products and the native purchase flow:
 *
 *   querySkuDetails({ product, type })  -> product details (price, currency…)
 *   launchBillingFlow({ product, type })-> resolves with the Google purchase
 *                                          JSON (purchaseToken, productId …)
 *   sendAck({ purchaseToken })          -> acknowledges the purchase
 *
 * The plugin has no real store on web (returns { value: "web" } stubs), so this
 * module also exposes `isNativePlatform()` so the UI can route to a clearly
 * labelled web demo flow when not running inside the Android shell.
 *
 * NOTE: `capacitor-billing` is imported dynamically (not at module top level)
 * so the web/SSR bundle never needs the plugin — it is only loaded when a
 * native purchase is actually initiated.
 */

/** The two subscription SKUs, matching Play Console product ids. */
export const SUBSCRIPTION_PRODUCTS = {
  pro: { productId: "pro_monthly", type: "SUBS", tier: "pro", priceUsd: 9.99 },
  whale: {
    productId: "whale_monthly",
    type: "SUBS",
    tier: "whale",
    priceUsd: 29.99,
  },
} as const;

export type SubTier = keyof typeof SUBSCRIPTION_PRODUCTS;

export function isNativePlatform(): boolean {
  return typeof Capacitor !== "undefined" && Capacitor.isNativePlatform();
}

/** Product details as returned by Play Console / the billing plugin. */
export interface PlayProduct {
  productId: string;
  title?: string;
  description?: string;
  price?: string;
  priceAmountMicros?: number;
  currencyCode?: string;
  billingPeriod?: string;
}

/** A completed Google Play purchase (subset of the purchase originalJson). */
export interface PlayPurchase {
  purchaseToken: string;
  productId: string;
  orderId?: string;
  purchaseTime?: number;
  purchaseState?: number;
}

type BillingResult = Record<string, unknown> & { value?: string };

async function billingPlugin() {
  const mod = await import("capacitor-billing");
  return mod.BillingPlugin;
}

/** Whether a plugin result is the web stub (`{ value: "web" }`). */
function isWebStub(result: BillingResult | null | undefined): boolean {
  return (
    !result ||
    result.value === "web" ||
    Object.keys(result).length === 0
  );
}

/** Query a subscription product's details from the Play Store. */
export async function getPlayProduct(tier: SubTier): Promise<PlayProduct | null> {
  const { productId, type } = SUBSCRIPTION_PRODUCTS[tier];
  try {
    const plugin = await billingPlugin();
    const result = (await plugin.querySkuDetails({
      product: productId,
      type,
    })) as unknown as BillingResult;
    if (isWebStub(result)) return null;
    return result as unknown as PlayProduct;
  } catch {
    // Product not yet configured in Play Console, billing unavailable, etc.
    return null;
  }
}

/**
 * Launch the Google Play purchase flow for a subscription. Resolves with the
 * completed purchase (or rejects if the user cancels / billing errors).
 */
export async function purchaseSubscription(
  tier: SubTier,
): Promise<PlayPurchase> {
  const { productId, type } = SUBSCRIPTION_PRODUCTS[tier];
  const plugin = await billingPlugin();
  const result = (await plugin.launchBillingFlow({
    product: productId,
    type,
  })) as unknown as BillingResult;
  if (isWebStub(result)) {
    throw new Error("Play Billing is not available on web.");
  }
  const purchase = result as unknown as PlayPurchase;
  if (!purchase.purchaseToken) {
    throw new Error("Purchase completed but no purchase token was returned.");
  }
  return purchase;
}

/** Acknowledge a subscription purchase (required by Google within 3 days). */
export async function acknowledgePurchase(purchaseToken: string): Promise<void> {
  try {
    const plugin = await billingPlugin();
    await plugin.sendAck({ purchaseToken });
  } catch {
    // Acknowledgement failures are retried by Play automatically; the
    // server-side record is what matters for entitlements.
  }
}

/** Map a Play product id back to the HashHustle tier (server-side source). */
export function productIdToTier(productId: string): SubTier | null {
  if (productId === SUBSCRIPTION_PRODUCTS.pro.productId) return "pro";
  if (productId === SUBSCRIPTION_PRODUCTS.whale.productId) return "whale";
  return null;
}
