// ---------------------------------------------------------------------------
// Real 14-day trial enforcement.
//
// Reads the signed-in user's /users/{uid} doc (trialStartedAt + plan, written
// at signup in auth-forms.js). If the account is still on plan:"trial" and
// 14 days have passed since trialStartedAt, the app is locked: a full-screen
// overlay is shown and the page-specific `onReady` callback in app-shell.js
// is never called, so no Firestore reads/writes for POS/inventory/etc. can
// happen. Accounts on any other plan value ("starter" / "pro" / "enterprise")
// are never locked — upgrading is just a matter of changing that field.
//
// Legacy users created before this feature existed (no trialStartedAt on
// their doc) are self-healed: we stamp trialStartedAt = now on first load,
// so they get a fresh 14-day window instead of being locked immediately.
// ---------------------------------------------------------------------------
import { db } from "./firebase-init.js";
import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const TRIAL_DAYS = 14;

function lang() {
    return localStorage.getItem('lang') || 'en';
}

const COPY = {
    en: {
        title: 'Your free trial has ended',
        body: 'Your 14-day free trial finished. Your data is safe and waiting — upgrade to a paid plan to unlock your dashboard again.',
        upgrade: 'View Plans & Upgrade',
        logout: 'Logout',
        daysLeft: (n) => `${n} day${n === 1 ? '' : 's'} left in your free trial`,
    },
    bn: {
        title: 'আপনার ফ্রি ট্রায়াল শেষ হয়ে গেছে',
        body: 'আপনার ১৪ দিনের ফ্রি ট্রায়াল শেষ হয়েছে। আপনার ডেটা নিরাপদ আছে — ড্যাশবোর্ড আবার আনলক করতে একটি পেইড প্ল্যান নিন।',
        upgrade: 'প্ল্যান দেখুন ও আপগ্রেড করুন',
        logout: 'লগআউট',
        daysLeft: (n) => `আপনার ফ্রি ট্রায়ালের আর ${n} দিন বাকি`,
    },
};

function daysBetween(fromMillis, toMillis) {
    return Math.floor((toMillis - fromMillis) / 86400000);
}

function renderLockOverlay() {
    if (document.getElementById('trialLockOverlay')) return;
    const c = COPY[lang()] || COPY.en;
    const el = document.createElement('div');
    el.id = 'trialLockOverlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:1.5rem;background:rgba(15,17,26,0.72);backdrop-filter:blur(4px);';
    el.innerHTML = `
      <div style="max-width:26rem;width:100%;background:var(--bg-surface,#fff);border-radius:1.25rem;padding:2.25rem 2rem;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,0.35);">
        <div style="width:3.25rem;height:3.25rem;border-radius:9999px;background:#F5A62322;display:flex;align-items:center;justify-content:center;margin:0 auto 1.25rem;">
          <i class="fa-solid fa-lock" style="color:#F5A623;font-size:1.1rem;"></i>
        </div>
        <h2 style="font-weight:800;font-size:1.25rem;margin-bottom:0.6rem;">${c.title}</h2>
        <p style="font-size:0.9rem;color:var(--text-secondary,#666);margin-bottom:1.5rem;">${c.body}</p>
        <a href="pricing.html" class="btn-primary" style="display:block;padding:0.65rem 1rem;border-radius:0.75rem;font-size:0.9rem;font-weight:600;margin-bottom:0.6rem;">${c.upgrade}</a>
        <button id="trialLockLogoutBtn" style="display:block;width:100%;padding:0.6rem 1rem;font-size:0.85rem;color:var(--text-secondary,#666);background:none;border:none;cursor:pointer;">${c.logout}</button>
      </div>`;
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';
    document.getElementById('trialLockLogoutBtn').addEventListener('click', async () => {
        const { getAuth, signOut } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
        await signOut(getAuth());
        window.location.href = 'login.html';
    });
}

function renderLockedBanner() {
    if (document.getElementById('trialLockedBanner')) return;
    const c = COPY[lang()] || COPY.en;
    const el = document.createElement('div');
    el.id = 'trialLockedBanner';
    el.style.cssText = 'position:sticky;top:0;z-index:60;background:#EF4444;color:#fff;font-size:0.8rem;font-weight:600;text-align:center;padding:0.6rem 1rem;';
    el.innerHTML = `${c.title} — ${c.body}`;
    document.body.prepend(el);
}

function renderTrialBanner(daysLeft) {
    if (document.getElementById('trialBanner') || document.getElementById('trialLockedBanner') || daysLeft > 3) return;
    const c = COPY[lang()] || COPY.en;
    const el = document.createElement('div');
    el.id = 'trialBanner';
    el.style.cssText = 'position:sticky;top:0;z-index:60;background:#F5A623;color:#1a1a1a;font-size:0.8rem;font-weight:600;text-align:center;padding:0.5rem 1rem;';
    el.innerHTML = `${c.daysLeft(daysLeft)} · <a href="pricing.html" style="text-decoration:underline;">${c.upgrade}</a>`;
    document.body.prepend(el);
}

/**
 * Checks the current user's trial/plan status.
 * Returns true if the app should proceed (unlocked), false if locked
 * (overlay has already been rendered — caller should not run page init).
 *
 * opts.allowLockedAccess: pass true on pages that must stay reachable even
 * after the trial has expired (currently just settings.html, so the owner
 * can actually pick a plan and lift the lock). On those pages a red banner
 * is shown instead of the full-screen block, and `onReady` still runs.
 */
export async function enforceTrialLock(user, opts = {}) {
    const allowLockedAccess = !!opts.allowLockedAccess;
    try {
        const ref = doc(db, 'users', user.uid);
        const snap = await getDoc(ref);
        let data = snap.exists() ? snap.data() : {};

        if (!data.trialStartedAt) {
            // Legacy account with no trial stamp yet — start the clock now.
            await setDoc(ref, { trialStartedAt: serverTimestamp(), plan: data.plan || 'trial' }, { merge: true });
            renderTrialBanner(TRIAL_DAYS);
            return true;
        }

        const plan = data.plan || 'trial';
        if (plan !== 'trial') return true; // paid plan — never locked

        const start = data.trialStartedAt instanceof Timestamp ? data.trialStartedAt.toMillis() : Date.now();
        const elapsed = daysBetween(start, Date.now());
        const daysLeft = TRIAL_DAYS - elapsed;

        if (daysLeft <= 0) {
            if (allowLockedAccess) {
                renderLockedBanner();
                return true;
            }
            renderLockOverlay();
            return false;
        }

        renderTrialBanner(daysLeft);
        return true;
    } catch (err) {
        // Fail open: a Firestore/network hiccup shouldn't lock a paying-in-spirit
        // user out of their own dashboard.
        console.error('Trial check failed:', err);
        return true;
    }
}
