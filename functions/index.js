// ---------------------------------------------------------------------------
// Cortex billing backend (Firebase Cloud Functions, 2nd gen).
//
// Why this needs a server at all: SSLCommerz (the payment aggregator used
// here — it routes to bKash, Nagad, Rocket, and cards under one integration)
// requires a `store_passwd` on every API call. That secret can never be
// shipped in browser JS, so plan purchases can't be done purely from the
// static site. These two functions are the trusted middle layer:
//
//   initiatePayment   (callable, auth required)
//     - Client tells us which plan they want.
//     - We look up the REAL price ourselves (never trust a client-sent
//       amount), open a session with SSLCommerz, log a "pending" order,
//       and hand back the hosted payment page URL to redirect to.
//
//   paymentCallback   (public HTTPS endpoint; used as success_url, fail_url,
//                      cancel_url, AND ipn_url in the SSLCommerz session)
//     - SSLCommerz calls this (both as a server-to-server IPN and via the
//       customer's browser redirect) with a transaction id.
//     - We re-validate that transaction directly against SSLCommerz's own
//       validator API (never trust the POST body alone — it can be forged).
//     - Only if SSLCommerz itself confirms VALID/VALIDATED do we mark the
//       order paid and flip users/{uid}.plan — this is the ONLY place in
//       the whole system allowed to do that (see firestore.rules).
// ---------------------------------------------------------------------------
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;

setGlobalOptions({ region: "us-central1", maxInstances: 10 });

// ---- Config (set these in functions/.env — see functions/.env.example) ----
const SSLCZ_STORE_ID = process.env.SSLCZ_STORE_ID;
const SSLCZ_STORE_PASSWORD = process.env.SSLCZ_STORE_PASSWORD;
const SSLCZ_MODE = process.env.SSLCZ_MODE || "sandbox"; // "sandbox" | "live"
const SITE_URL = process.env.SITE_URL || "http://localhost:5500";

const SSLCZ_INIT_URL = SSLCZ_MODE === "live"
    ? "https://securepay.sslcommerz.com/gwprocess/v4/api.php"
    : "https://sandbox.sslcommerz.com/gwprocess/v4/api.php";
const SSLCZ_VALIDATE_URL = SSLCZ_MODE === "live"
    ? "https://securepay.sslcommerz.com/validator/api/validationserverAPI.php"
    : "https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php";

// Source of truth for pricing — must be kept in sync with pricing.html /
// settings.html display values, but the CHARGE always comes from here, not
// from anything the browser sends.
const PLAN_PRICES = {
    starter: 990,
    pro: 2490,
};

// ---------------------------------------------------------------------------
// initiatePayment — called from settings.js when the owner clicks
// "Switch to Starter/Pro".
// ---------------------------------------------------------------------------
exports.initiatePayment = onCall(async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");

    const planId = request.data && request.data.planId;
    const amount = PLAN_PRICES[planId];
    if (!amount) throw new HttpsError("invalid-argument", "Unknown plan.");

    if (!SSLCZ_STORE_ID || !SSLCZ_STORE_PASSWORD) {
        throw new HttpsError("failed-precondition", "Payment gateway isn't configured yet. Set SSLCZ_STORE_ID / SSLCZ_STORE_PASSWORD in functions/.env.");
    }

    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const tranId = `CORTEX-${uid.slice(0, 8)}-${Date.now()}`;

    const callbackBase = `${functionsBaseUrl(request)}/paymentCallback`;

    const payload = {
        store_id: SSLCZ_STORE_ID,
        store_passwd: SSLCZ_STORE_PASSWORD,
        total_amount: amount,
        currency: "BDT",
        tran_id: tranId,
        success_url: callbackBase,
        fail_url: callbackBase,
        cancel_url: callbackBase,
        ipn_url: callbackBase,
        shipping_method: "NO",
        product_name: `Cortex ${planId} plan (monthly)`,
        product_category: "Software Subscription",
        product_profile: "general",
        cus_name: userData.name || "Cortex Owner",
        cus_email: userData.email || request.auth.token.email || "no-reply@cortex.app",
        cus_add1: userData.address || "N/A",
        cus_city: "Dhaka",
        cus_country: "Bangladesh",
        cus_phone: userData.phone || "01700000000",
    };

    const res = await fetch(SSLCZ_INIT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(payload).toString(),
    });
    const json = await res.json();

    if (json.status !== "SUCCESS" || !json.GatewayPageURL) {
        throw new HttpsError("internal", json.failedreason || "Could not start the payment session.");
    }

    await db.doc(`orders/${tranId}`).set({
        uid,
        planId,
        amount,
        currency: "BDT",
        status: "pending",
        gateway: "sslcommerz",
        createdAt: FieldValue.serverTimestamp(),
    });

    return { gatewayUrl: json.GatewayPageURL, tranId };
});

function functionsBaseUrl(request) {
    // Cloud Functions v2 onCall requests don't carry a usable host header for
    // this purpose reliably across emulator/prod, so build it from env if set,
    // otherwise fall back to the auto-generated Cloud Run-style URL pattern.
    if (process.env.FUNCTIONS_BASE_URL) return process.env.FUNCTIONS_BASE_URL;
    const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
    return `https://us-central1-${project}.cloudfunctions.net`;
}

// ---------------------------------------------------------------------------
// paymentCallback — the ONE endpoint used for success_url, fail_url,
// cancel_url, and ipn_url. SSLCommerz POSTs form data here; we independently
// re-validate with their validator API before trusting anything, then
// redirect the customer's browser back to settings.html with a status flag.
// ---------------------------------------------------------------------------
exports.paymentCallback = onRequest(async (req, res) => {
    const body = req.method === "POST" ? req.body : req.query;
    const tranId = body.tran_id;
    const valId = body.val_id;

    if (!tranId) {
        return res.redirect(303, `${SITE_URL}/settings.html?payment=failed`);
    }

    const orderRef = db.doc(`orders/${tranId}`);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
        return res.redirect(303, `${SITE_URL}/settings.html?payment=failed`);
    }
    const order = orderSnap.data();

    // Already processed (e.g. both the browser redirect AND the IPN hit this
    // endpoint for the same transaction) — don't double-charge/apply.
    if (order.status === "paid") {
        return res.redirect(303, `${SITE_URL}/settings.html?payment=success`);
    }

    if (!valId) {
        // No val_id means SSLCommerz itself reports this as failed/cancelled.
        await orderRef.set({ status: "failed", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        const outcome = body.status === "CANCELLED" ? "cancelled" : "failed";
        return res.redirect(303, `${SITE_URL}/settings.html?payment=${outcome}`);
    }

    // Re-validate directly with SSLCommerz — this is the step that actually
    // proves the payment happened; never trust the POSTed body alone.
    const validateUrl = `${SSLCZ_VALIDATE_URL}?val_id=${encodeURIComponent(valId)}&store_id=${SSLCZ_STORE_ID}&store_passwd=${SSLCZ_STORE_PASSWORD}&format=json`;
    let verification;
    try {
        const vRes = await fetch(validateUrl);
        verification = await vRes.json();
    } catch (err) {
        console.error("SSLCommerz validation call failed:", err);
        return res.redirect(303, `${SITE_URL}/settings.html?payment=failed`);
    }

    const isValid = verification && (verification.status === "VALID" || verification.status === "VALIDATED")
        && Number(verification.amount) === Number(order.amount)
        && verification.currency === order.currency;

    if (!isValid) {
        await orderRef.set({ status: "failed", updatedAt: FieldValue.serverTimestamp(), verification }, { merge: true });
        return res.redirect(303, `${SITE_URL}/settings.html?payment=failed`);
    }

    // Confirmed paid — this write bypasses firestore.rules because it runs
    // with the Admin SDK, which is exactly why plan changes are only allowed
    // to happen from here.
    await db.doc(`users/${order.uid}`).set({
        plan: order.planId,
        planUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await orderRef.set({
        status: "paid",
        paidAt: FieldValue.serverTimestamp(),
        verification,
    }, { merge: true });

    return res.redirect(303, `${SITE_URL}/settings.html?payment=success`);
});
