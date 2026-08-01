// ---------------------------------------------------------------------------
// Shared shell logic for every page inside the signed-in app (dashboard.html,
// pos.html, inventory.html, accounting.html, ...).
//
// Handles: auth guard (redirect to login.html if signed out), filling in the
// user's name/email/initial in the header, logout, and highlighting the
// active sidebar link based on <body data-page="...">.
//
// Usage in a page's module script:
//   import { requireAuth } from "./app-shell.js";
//   requireAuth((user) => { ...page-specific init that needs `user`... });
// ---------------------------------------------------------------------------
import { auth } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { enforceTrialLock } from "./trial-guard.js";
import { pageAllowedForPlan, FEATURE_LABELS } from "./plan-features.js";

function lang() {
    return localStorage.getItem('lang') || 'en';
}

const FEATURE_LOCK_COPY = {
    en: (label) => ({
        title: `Upgrade to unlock ${label}`,
        body: `${label} isn\u2019t included in your current plan. Upgrade to Pro to get access, along with HR & Payroll, Accounting, and the AI Assistant.`,
        cta: 'View Plans & Upgrade',
    }),
    bn: (label) => ({
        title: `${label} আনলক করতে আপগ্রেড করুন`,
        body: `আপনার বর্তমান প্ল্যানে ${label} নেই। Pro-তে আপগ্রেড করলে এটি সহ HR & Payroll, Accounting, আর AI Assistant পাবেন।`,
        cta: 'প্ল্যান দেখুন ও আপগ্রেড করুন',
    }),
};

function renderFeatureLockOverlay(page) {
    if (document.getElementById('featureLockOverlay')) return;
    const label = FEATURE_LABELS[page] || page;
    const c = (FEATURE_LOCK_COPY[lang()] || FEATURE_LOCK_COPY.en)(label);
    const el = document.createElement('div');
    el.id = 'featureLockOverlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:1.5rem;background:rgba(15,17,26,0.72);backdrop-filter:blur(4px);';
    el.innerHTML = `
      <div style="max-width:26rem;width:100%;background:var(--bg-surface,#fff);border-radius:1.25rem;padding:2.25rem 2rem;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,0.35);">
        <div style="width:3.25rem;height:3.25rem;border-radius:9999px;background:#2454FF22;display:flex;align-items:center;justify-content:center;margin:0 auto 1.25rem;">
          <i class="fa-solid fa-lock" style="color:#2454FF;font-size:1.1rem;"></i>
        </div>
        <h2 style="font-weight:800;font-size:1.25rem;margin-bottom:0.6rem;">${c.title}</h2>
        <p style="font-size:0.9rem;color:var(--text-secondary,#666);margin-bottom:1.5rem;">${c.body}</p>
        <a href="pricing.html" class="btn-primary" style="display:block;padding:0.65rem 1rem;border-radius:0.75rem;font-size:0.9rem;font-weight:600;margin-bottom:0.6rem;">${c.cta}</a>
        <a href="dashboard.html" style="display:block;width:100%;padding:0.6rem 1rem;font-size:0.85rem;color:var(--text-secondary,#666);">Back to Dashboard</a>
      </div>`;
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';
}

export function requireAuth(onReady) {
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }

        document.querySelectorAll('[data-user-email]').forEach((el) => { el.textContent = user.email; });
        document.querySelectorAll('[data-user-name]').forEach((el) => { el.textContent = user.displayName || user.email; });
        document.querySelectorAll('[data-user-initial]').forEach((el) => {
            el.textContent = (user.displayName || user.email || '?').charAt(0).toUpperCase();
        });

        const page = document.body.getAttribute('data-page');
        document.querySelectorAll('[data-nav]').forEach((el) => {
            el.classList.toggle('active', el.getAttribute('data-nav') === page);
        });

        // Account-level lock: payment under review, trial expired, or paid
        // plan lapsed. If locked, an overlay is shown and page init is
        // skipped so no module can read/write Firestore data behind it.
        const unlocked = await enforceTrialLock(user, { allowLockedAccess: page === 'settings' });
        if (!unlocked) return;

        // Module-level gate: the account is unlocked, but this specific
        // module (e.g. Accounting, HR & Payroll, AI Assistant) may not be
        // included in the current plan.
        if (page && page !== 'settings') {
            try {
                const snap = await getDoc(doc(db, 'users', user.uid));
                const plan = (snap.exists() && snap.data().plan) || 'trial';
                if (!pageAllowedForPlan(page, plan)) {
                    renderFeatureLockOverlay(page);
                    return;
                }
            } catch (err) {
                // Fail open on a read hiccup — don't block a paying user
                // from their own dashboard over a transient error.
                console.error('Feature gate check failed:', err);
            }
        }

        if (typeof onReady === 'function') onReady(user);
    });
}

document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-logout]');
    if (!btn) return;
    e.preventDefault();
    signOut(auth).then(() => { window.location.href = 'login.html'; });
});

// ---- Small shared helpers used across the app pages ----
export function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function formatTaka(n) {
    const num = Number(n) || 0;
    return '৳' + num.toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function toast(msg, type = 'success') {
    let el = document.getElementById('appToast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'appToast';
        el.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;max-width:320px;';
        document.body.appendChild(el);
    }
    const bg = type === 'error' ? '#EF4444' : (type === 'info' ? '#2454FF' : '#10B981');
    const row = document.createElement('div');
    row.style.cssText = `background:${bg};color:#fff;padding:0.75rem 1rem;border-radius:0.75rem;font-size:0.875rem;font-weight:500;margin-top:0.5rem;box-shadow:0 8px 24px rgba(0,0,0,0.2);animation:fadeIn 0.2s ease;`;
    row.textContent = msg;
    el.appendChild(row);
    setTimeout(() => { row.style.opacity = '0'; row.style.transition = 'opacity 0.3s ease'; setTimeout(() => row.remove(), 300); }, 3200);
}
