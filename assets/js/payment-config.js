// ---------------------------------------------------------------------------
// Manual payment configuration (bKash / Nagad "Send Money" verification).
//
// EDIT THE VALUES BELOW — everything else in the registration/payment flow
// reads from this one file.
// ---------------------------------------------------------------------------

export const PAYMENT_METHODS = [
    {
        id: "bkash",
        label: "bKash",
        number: "01806105457",       // TODO: put your real bKash number here
        type: "Personal",             // "Personal" or "Merchant/Agent"
        icon: "fa-solid fa-mobile-screen",
        color: "#E2136E",
    },
    {
        id: "nagad",
        label: "Nagad",
        number: "01612336485",       // TODO: put your real Nagad number here
        type: "Personal",             // "Personal" or "Merchant/Agent"
        icon: "fa-solid fa-mobile-screen",
        color: "#F6921E",
    },
];

// UIDs allowed to see /admin-payments.html and approve/reject orders.
// Find your UID: sign in once, then Firebase Console → Authentication → Users.
export const ADMIN_UIDS = [
    "6q238xgdsBSf8Q0ZnPwLbqswrxR2",
];

// Must match firestore.rules `isAdmin()` list and functions PLAN_PRICES.
export const PLAN_PRICES = {
    starter: { monthly: 990, yearly: 790 },
    pro: { monthly: 2490, yearly: 1990 },
};
