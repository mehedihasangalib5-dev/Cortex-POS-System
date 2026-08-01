# Cortex billing backend (SSLCommerz via Firebase Cloud Functions)

Why this folder exists: a real payment gateway needs a secret (SSLCommerz's
`store_passwd`) on every API call. That can't live in `settings.js` or any
other browser-side file — anyone could open devtools and steal it. So this
is a small server piece, deployed to Firebase Cloud Functions (same Firebase
project you're already using for Auth/Firestore), that holds the secret and
is the only thing allowed to change a user's `plan`.

## What it does

- **`initiatePayment`** — called from `settings.js` when the owner clicks
  "Switch to Starter/Pro". Looks up the real price itself, opens a session
  with SSLCommerz, and returns the hosted payment page URL to redirect to.
- **`paymentCallback`** — SSLCommerz calls this after payment (both as a
  background IPN call and via the customer's browser). It re-checks the
  transaction directly with SSLCommerz's own validator API before trusting
  anything, then — only if genuinely paid — updates `users/{uid}.plan` and
  redirects back to `settings.html?payment=success|failed|cancelled`.

`firestore.rules` was updated so clients can no longer write their own
`plan` field directly — only this backend (via the Admin SDK) can.

## One-time setup

1. **Upgrade to the Blaze (pay-as-you-go) plan.** Cloud Functions that call
   an external API (SSLCommerz) need outbound network access, which requires
   Blaze. Free tier included calls still cost nothing for normal traffic.
2. **Get SSLCommerz credentials.** Sandbox (free, for testing):
   https://developer.sslcommerz.com/registration/ — gives you a sandbox
   `store_id` / `store_passwd`. Apply for a live merchant account when
   you're ready to take real money.
3. `cd functions && cp .env.example .env` and fill in `SSLCZ_STORE_ID`,
   `SSLCZ_STORE_PASSWORD`, `SITE_URL` (where your static site is hosted).
4. Install the Firebase CLI if you don't have it: `npm install -g firebase-tools`,
   then `firebase login` and `firebase use --add` to point this folder at
   your existing Firebase project.
5. Deploy: `firebase deploy --only functions,firestore:rules`
6. The deploy output prints the real URL for `paymentCallback`, e.g.
   `https://us-central1-your-project.cloudfunctions.net/paymentCallback`.
   Set `FUNCTIONS_BASE_URL` in `.env` to that same base
   (`https://us-central1-your-project.cloudfunctions.net`, no path) and
   redeploy so `initiatePayment` builds the right callback URL.

## Testing

Sandbox card details and test bKash numbers are listed on SSLCommerz's
sandbox dashboard once you register. A sandbox "payment" flows through the
exact same code path as a live one — only `SSLCZ_MODE` and the store
credentials change when you go live.

## Going further (not included yet)

- Yearly billing / proration — `PLAN_PRICES` in `index.js` currently only
  has flat monthly prices for Starter/Pro.
- Recurring auto-renewal — SSLCommerz's basic checkout is a one-time charge;
  true subscriptions need their token/recurring-payment API.
- Downgrade-to-trial or cancellation flow.
