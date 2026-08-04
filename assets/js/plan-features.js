// ---------------------------------------------------------------------------
// Which dashboard modules each plan can open. Keys match each page's
// <body data-page="..."> attribute (see app-shell.js). Keep this in sync
// with the feature lists on pricing.html.
//
//   Free Trial / Starter : POS, Inventory, Customers, Reports
//   Pro / Enterprise      : + HR & Payroll, Accounting, AI Assistant
//
// "dashboard" and "settings" are not module-gated — every signed-in user
// can always reach them (settings is where they see/upgrade their plan).
// ---------------------------------------------------------------------------

/**
 * Every lookup below keys off this. Defends against a `plan` value that
 * isn't an exact-case match to trial/starter/pro/enterprise — e.g. a stray
 * "Enterprise" or " enterprise" typed by hand into Firestore (rather than
 * granted through admin-enterprise.html, which always writes the plan
 * select's lowercase value) — silently falling back to the trial limits
 * instead of the plan the account is actually supposed to be on.
 */
function normalizePlan(plan) {
    return String(plan || 'trial').trim().toLowerCase();
}

export const PLAN_FEATURES = {
    trial: ['pos', 'inventory', 'warehouses', 'customers', 'reports'],
    starter: ['pos', 'inventory', 'warehouses', 'customers', 'reports'],
    pro: ['pos', 'inventory', 'warehouses', 'customers', 'reports', 'hr-payroll', 'accounting', 'ai-assistant'],
    enterprise: ['pos', 'inventory', 'warehouses', 'customers', 'reports', 'hr-payroll', 'accounting', 'ai-assistant'],
};

export const UNGATED_PAGES = ['dashboard', 'settings'];

// Human-readable names for the lock screen's "upgrade to unlock X" copy.
export const FEATURE_LABELS = {
    'pos': 'Point of Sale',
    'inventory': 'Inventory',
    'warehouses': 'Warehouses',
    'customers': 'Customers',
    'reports': 'Reports',
    'hr-payroll': 'HR & Payroll',
    'accounting': 'Accounting',
    'ai-assistant': 'AI Assistant',
};

export function pageAllowedForPlan(page, plan) {
    if (!page || UNGATED_PAGES.includes(page)) return true;
    const features = PLAN_FEATURES[normalizePlan(plan)] || PLAN_FEATURES.trial;
    return features.includes(page);
}

// ---------------------------------------------------------------------------
// Product-count and team-login limits, matching the numbers printed on each
// pricing.html card. `null` = unlimited. Used by inventory.js (product
// create) and settings.js (team invites) to actually enforce what the
// pricing page promises.
// ---------------------------------------------------------------------------
export const PRODUCT_LIMITS = {
    trial: 100,
    starter: 500,
    pro: null,
    enterprise: null,
};

export const LOGIN_LIMITS = {
    trial: 1,
    starter: 2,
    pro: 10,
    enterprise: null,
};

export function productLimitFor(plan) {
    plan = normalizePlan(plan);
    return PRODUCT_LIMITS[plan] ?? PRODUCT_LIMITS.trial;
}

export function loginLimitFor(plan) {
    plan = normalizePlan(plan);
    return LOGIN_LIMITS[plan] ?? LOGIN_LIMITS.trial;
}

// ---------------------------------------------------------------------------
// How many warehouses/locations each plan can create. `null` = unlimited.
// Enforced client-side in warehouses.js when adding a new warehouse.
//
// Pro and Enterprise are BOTH unlimited — matches "Unlimited warehouses" on
// the Pro pricing card and the FAQ's "every plan above Starter supports
// unlimited warehouses/locations" (pricing.html / faq.html).
// ---------------------------------------------------------------------------
export const WAREHOUSE_LIMITS = {
    trial: 1,
    starter: 2,
    pro: null,
    enterprise: null,
};

export function warehouseLimitFor(plan) {
    plan = normalizePlan(plan);
    return WAREHOUSE_LIMITS[plan] ?? WAREHOUSE_LIMITS.trial;
}
