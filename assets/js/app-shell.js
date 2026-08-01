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
import { enforceTrialLock } from "./trial-guard.js";

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

        // 14-day trial lock: if the trial has expired and the account hasn't
        // been upgraded, an overlay is shown and page init is skipped so no
        // module can read/write Firestore data behind the lock.
        const unlocked = await enforceTrialLock(user, { allowLockedAccess: page === 'settings' });
        if (!unlocked) return;

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
