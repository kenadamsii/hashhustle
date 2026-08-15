import { createServerFn } from "@tanstack/react-start";
import { SUBSCRIPTION_PRODUCTS } from "../../lib/billing";

/**
 * Purchase verification API: `/api/purchase` (server function).
 *
 * Called after a successful Play Billing purchase (native) or a clearly
 * labelled web demo purchase. It records the purchase and promotes the user's
 * tier so the mining engine pays out at the new rate.
 *
 * ⚠️ VERIFICATION STUB — production hardening:
 * This endpoint does NOT yet cryptographically validate the purchase token
 * against Google. In production the `play` source must be verified with the
 * Google Play Developer API (`purchases.subscriptions.get`) using a service
 * account, and only then entitle the user. See PLAY_CONSOLE.md for the exact
 * Play Console / service-account steps the owner must complete. Until then,
 * tokens are recorded as `pending-verification` (play) or `simulated` (web)
 * and the tier is promoted immediately so the flow is demonstrable end to end.
 */

interface PurchasePayload {
  userId: string;
  productId: string; // "pro_monthly" | "whale_monthly"
  purchaseToken: string; // Google purchase token (play) or web demo token
  source: "play" | "web-simulated";
}

/** Product id -> tier/price. Kept in sync with Play Console product config. */
const PRODUCTS: Record<
  string,
  { tier: "pro" | "whale"; priceUsd: number }
> = {
  [SUBSCRIPTION_PRODUCTS.pro.productId]: {
    tier: "pro",
    priceUsd: SUBSCRIPTION_PRODUCTS.pro.priceUsd,
  },
  [SUBSCRIPTION_PRODUCTS.whale.productId]: {
    tier: "whale",
    priceUsd: SUBSCRIPTION_PRODUCTS.whale.priceUsd,
  },
};

export const verifyPurchase = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as PurchasePayload)
  .handler(async ({ data }) => {
    const { userId, productId, purchaseToken, source } = data;
    const db = await import("../../lib/db");
    const engine = await import("../../lib/mining");

    const user = db.getOrCreateUser(userId);

    if (!productId || !PRODUCTS[productId]) {
      return {
        ok: false,
        error: "Unknown product id.",
        state: await snapshot(db, engine, user, userId),
      };
    }
    if (!purchaseToken || typeof purchaseToken !== "string") {
      return {
        ok: false,
        error: "Missing purchase token.",
        state: await snapshot(db, engine, user, userId),
      };
    }
    if (source !== "play" && source !== "web-simulated") {
      return {
        ok: false,
        error: "Unknown purchase source.",
        state: await snapshot(db, engine, user, userId),
      };
    }

    const { tier, priceUsd } = PRODUCTS[productId];
    const token = purchaseToken.slice(0, 256);

    // Idempotent: a token that was already processed just re-promotes the tier.
    const existing = db.getPurchaseByToken(token);
    if (existing) {
      db.upgradeUserTier(userId, tier, engine.TIERS[tier].hashrateGhs);
      return {
        ok: true,
        alreadyProcessed: true,
        state: await snapshot(db, engine, user, userId),
      };
    }

    // TODO(production): verify `token` with Google Play Developer API
    // (androidpublisher.purchases.subscriptions.get) before entitling. A
    // service account is required — see PLAY_CONSOLE.md.
    const status =
      source === "play" ? "pending-verification" : "simulated";
    db.insertPurchase({
      id:
        "pur-" +
        Array.from(crypto.getRandomValues(new Uint8Array(9)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
      user_id: userId,
      product_id: productId,
      tier,
      source,
      status,
      purchase_token: token,
      price_usd: priceUsd,
      created_at: Date.now(),
    });

    db.upgradeUserTier(userId, tier, engine.TIERS[tier].hashrateGhs);

    return {
      ok: true,
      tier,
      productId,
      status,
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
