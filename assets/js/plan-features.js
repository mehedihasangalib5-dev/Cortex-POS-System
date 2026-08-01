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
export const PLAN_FEATURES = {
    trial: ['pos', 'inventory', 'customers', 'reports'],
    starter: ['pos', 'inventory', 'customers', 'reports'],
    pro: ['pos', 'inventory', 'customers', 'reports', 'hr-payroll', 'accounting', 'ai-assistant'],
    enterprise: ['pos', 'inventory', 'customers', 'reports', 'hr-payroll', 'accounting', 'ai-assistant'],
};

export const UNGATED_PAGES = ['dashboard', 'settings'];

// Human-readable names for the lock screen's "upgrade to unlock X" copy.
export const FEATURE_LABELS = {
    'pos': 'Point of Sale',
    'inventory': 'Inventory',
    'customers': 'Customers',
    'reports': 'Reports',
    'hr-payroll': 'HR & Payroll',
    'accounting': 'Accounting',
    'ai-assistant': 'AI Assistant',
};

export function pageAllowedForPlan(page, plan) {
    if (!page || UNGATED_PAGES.includes(page)) return true;
    const features = PLAN_FEATURES[plan] || PLAN_FEATURES.trial;
    return features.includes(page);
}
