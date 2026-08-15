# Play Console Setup — Owner Steps (cannot be automated)

HashHustle's paid tiers use **Google Play Billing subscriptions**. The code
(`feat/play-billing`, merged via PR) is complete; the following must be done by
the owner in the [Google Play Console](https://play.google.com/console) because
they require an actual Play Console account, app listing, and signing keys that
cannot be created from this sandbox.

## 1. Product configuration (must match the code)

Create two **subscriptions** under *Monetize → Products → Subscriptions*:

| Product ID     | Name          | Price       | Billing period |
|----------------|---------------|-------------|----------------|
| `pro_monthly`  | HashHustle Pro   | $9.99  | Monthly |
| `whale_monthly`| HashHustle Whale | $29.99 | Monthly |

> These IDs are hard-coded in `src/lib/billing.ts` (`SUBSCRIPTION_PRODUCTS`)
> and mirrored server-side in `src/routes/api/purchase.ts`. If you change the
> IDs here, update both files.

## 2. App / listing prerequisites

- The app package id is `com.hashhustle.app` (set in `capacitor.config.ts` and
  the Android Gradle files). Create the app in Play Console with this id.
- Complete the app listing essentials (title, description, graphics, privacy
  policy incl. data-safety answers about reward payouts).
- Build a signed release **AAB** on a machine with Android SDK + JDK 17+
  (this sandbox has neither). Commands:
  `npm ci && npm run build:mobile && npx cap sync android && cd android && ./gradlew bundleRelease`
  (or `assembleDebug` for local testing).
- Upload to an **internal testing track**, add license-testers as Play
  Console testers, and install the build on their devices.

## 3. Server-side verification (production hardening)

`verifyPurchase` (`src/routes/api/purchase.ts`) is currently a **stub**: it
records the purchase token and promotes the tier without calling Google. Before
launch, replace the `TODO(production)` block with a call to the
**Google Play Developer API**:

1. In Play Console: *Setup → API access* → create/link a Google Cloud project.
2. Enable the **Android Publisher API** and create a **service account** with
   the *View financial data* role; download its JSON key.
3. Server-side, exchange the JSON key for an access token and call
   `androidpublisher.purchases.subscriptions.get` with
   `packageName=com.hashhustle.app`, `subscriptionId=<productId>` and
   `token=<purchaseToken>` (see the google-auth-library / googleapis docs).
4. Only mark the purchase `verified` and promote the tier when the API returns
   an `active` / in-trial state; reject otherwise. Store the key path in env
   (e.g. `GOOGLE_SERVICE_ACCOUNT_JSON`) — never in the repo.

## 4. Android app / IAP runtime notes

- **Web demo path**: on the web (no store), the upgrade modal offers a clearly
  labelled *Demo Upgrade (no charge)* that runs the same server pipeline with
  `source = "web-simulated"`. Real charges happen only via Play Billing inside
  the Android app.
- **Remote vs bundled mode**: for purchases to verify against the HashHustle
  backend, the Android WebView must be able to reach it. Either uncomment
  `server.url` in `capacitor.config.ts` (remote mode — recommended) or ensure
  the bundled shell can reach the deployed API origin. `allowMixedContent` is
  already `false`; the backend must be HTTPS.
- The `capacitor-billing` plugin (renamed successor of the unmaintained
  `@capacitor-community/billing`, same author, v8.1.0, Capacitor 8 compatible)
  is registered automatically by `npx cap sync` — no `MainActivity` edits.
- Subscriptions must be **acknowledged** within 3 days; the app calls
  `sendAck(purchaseToken)` right after purchase (fire-and-forget).

## 5. Test checklist

1. Internal track build installs; open Upgrade → Pro → Google Play sheet.
2. Use a license tester account; complete the (test) purchase.
3. Balance API returns `tier: "pro"` / hashrate 25 TH/s; `purchases` row has
   `source=play`, `status=pending-verification` until step 3 (real verification)
   is implemented.
4. Cancel / refund path: subscription lapses → tier should revert (follow-up
   job to be added).
