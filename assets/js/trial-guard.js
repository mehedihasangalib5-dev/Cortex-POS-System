// ---------------------------------------------------------------------------
// Account-level access lock. Three separate reasons a dashboard can be
// locked, checked in this order:
//
//  1. PAYMENT UNDER REVIEW — the account is still on plan:"trial" and has a
//     bKash/Nagad order sitting in "pending_verification" (submitted at
//     register.html Step 3). Nothing unlocks until an admin approves or
//     rejects it in admin-payments.html — there is no trial access in the
//     meantime.
//  2. FREE TRIAL EXPIRED — plan:"trial", no pending order, and 14 days have
//     passed since trialStartedAt (written at signup in register-wizard.js).
//  3. PAID PLAN EXPIRED — plan is starter/pro/enterprise but planExpiresAt
//     (stamped by the admin on approval — see admin-payments.html) is in
//     the past. Locks again automatically until the plan is renewed/
//     upgraded (another approved order pushes planExpiresAt forward).
//
// Whichever fires first shows a full-screen overlay and the page-specific
// `onReady` callback in app-shell.js is never called, so no module can
// read/write Firestore data behind the lock. `opts.allowLockedAccess`
// (used on settings.html) downgrades this to a banner instead, so the
// owner can still reach Settings to check status / resubmit payment.
// ---------------------------------------------------------------------------
import { db } from "./firebase-init.js";
import {
    doc, getDoc, setDoc, serverTimestamp, Timestamp,
    collection, query, where, limit, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const TRIAL_DAYS = 14;

function lang() {
    return localStorage.getItem('lang') || 'en';
}

const COPY = {
    en: {
        trialTitle: 'Your free trial has ended',
        trialBody: 'Your 14-day free trial finished. Your data is safe and waiting — upgrade to a paid plan to unlock your dashboard again.',
        pendingTitle: 'Payment under review',
        pendingBody: 'We\u2019ve received your bKash/Nagad payment details. Your dashboard unlocks automatically as soon as it\u2019s approved — usually within 1-24 hours.',
        expiredTitle: 'Your plan has expired',
        expiredBody: 'Your subscription period ended. Your data is safe and waiting — renew or upgrade your plan to unlock your dashboard again.',
        upgrade: 'View Plans & Upgrade',
        renew: 'Renew Now',
        logout: 'Logout',
        daysLeft: (n) => `${n} day${n === 1 ? '' : 's'} left in your free trial`,
        planDaysLeft: (n) => `Your plan renews in ${n} day${n === 1 ? '' : 's'}`,
    },
    bn: {
        trialTitle: 'আপনার ফ্রি ট্রায়াল শেষ হয়ে গেছে',
        trialBody: 'আপনার ১৪ দিনের ফ্রি ট্রায়াল শেষ হয়েছে। আপনার ডেটা নিরাপদ আছে — ড্যাশবোর্ড আবার আনলক করতে একটি পেইড প্ল্যান নিন।',
        pendingTitle: 'পেমেন্ট যাচাই চলছে',
        pendingBody: 'আপনার bKash/Nagad পেমেন্ট তথ্য পেয়েছি। অনুমোদনের সাথে সাথেই ড্যাশবোর্ড আনলক হয়ে যাবে — সাধারণত ১-২৪ ঘণ্টার মধ্যে।',
        expiredTitle: 'আপনার প্ল্যানের মেয়াদ শেষ',
        expiredBody: 'আপনার সাবস্ক্রিপশনের মেয়াদ শেষ হয়েছে। আপনার ডেটা নিরাপদ আছে — ড্যাশবোর্ড আবার আনলক করতে প্ল্যান রিনিউ বা আপগ্রেড করুন।',
        upgrade: 'প্ল্যান দেখুন ও আপগ্রেড করুন',
        renew: 'এখনই রিনিউ করুন',
        logout: 'লগআউট',
        daysLeft: (n) => `আপনার ফ্রি ট্রায়ালের আর ${n} দিন বাকি`,
        planDaysLeft: (n) => `আপনার প্ল্যান আর ${n} দিনে রিনিউ করতে হবে`,
    },
};

function daysBetween(fromMillis, toMillis) {
    return Math.floor((toMillis - fromMillis) / 86400000);
}

function renderLockOverlay({ title, body, ctaHref, ctaLabel }) {
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
        <h2 style="font-weight:800;font-size:1.25rem;margin-bottom:0.6rem;">${title}</h2>
        <p style="font-size:0.9rem;color:var(--text-secondary,#666);margin-bottom:1.5rem;">${body}</p>
        ${ctaHref ? `<a href="${ctaHref}" class="btn-primary" style="display:block;padding:0.65rem 1rem;border-radius:0.75rem;font-size:0.9rem;font-weight:600;margin-bottom:0.6rem;">${ctaLabel}</a>` : ''}
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

function renderLockedBanner(text) {
    if (document.getElementById('trialLockedBanner')) return;
    const el = document.createElement('div');
    el.id = 'trialLockedBanner';
    el.style.cssText = 'position:sticky;top:0;z-index:60;background:#EF4444;color:#fff;font-size:0.8rem;font-weight:600;text-align:center;padding:0.6rem 1rem;';
    el.innerHTML = text;
    document.body.prepend(el);
}

function renderCountdownBanner(id, text, ctaHref, ctaLabel, bg) {
    if (document.getElementById(id) || document.getElementById('trialLockedBanner')) return;
    const el = document.createElement('div');
    el.id = id;
    el.style.cssText = `position:sticky;top:0;z-index:60;background:${bg};color:#1a1a1a;font-size:0.8rem;font-weight:600;text-align:center;padding:0.5rem 1rem;`;
    el.innerHTML = `${text} · <a href="${ctaHref}" style="text-decoration:underline;">${ctaLabel}</a>`;
    document.body.prepend(el);
}

async function hasPendingOrder(uid) {
    const snap = await getDocs(query(
        collection(db, 'orders'),
        where('uid', '==', uid),
        where('status', '==', 'pending_verification'),
        limit(1)
    ));
    return !snap.empty;
}

/**
 * Checks the current user's payment/trial/plan status.
 * Returns true if the app should proceed (unlocked), false if locked
 * (overlay or banner has already been rendered — caller should not run
 * page init on `false`).
 *
 * opts.allowLockedAccess: pass true on pages that must stay reachable even
 * while locked (currently just settings.html). A red banner is shown
 * instead of the full-screen block, and `onReady` still runs.
 */
export async function enforceTrialLock(user, opts = {}) {
    const allowLockedAccess = !!opts.allowLockedAccess;
    const c = COPY[lang()] || COPY.en;
    try {
        const ref = doc(db, 'users', user.uid);
        const snap = await getDoc(ref);
        let data = snap.exists() ? snap.data() : {};

        if (!data.trialStartedAt) {
            // Legacy account with no trial stamp yet — start the clock now.
            await setDoc(ref, { trialStartedAt: serverTimestamp(), plan: data.plan || 'trial' }, { merge: true });
            renderCountdownBanner('trialBanner', c.daysLeft(TRIAL_DAYS), 'pricing.html', c.upgrade, '#F5A623');
            return true;
        }

        const plan = data.plan || 'trial';

        // --- Paid plans: only an expiry check, never the trial/pending logic below.
        if (plan !== 'trial') {
            if (data.planExpiresAt instanceof Timestamp) {
                const expiresAtMs = data.planExpiresAt.toMillis();
                if (Date.now() >= expiresAtMs) {
                    if (allowLockedAccess) {
                        renderLockedBanner(`${c.expiredTitle} — ${c.expiredBody}`);
                        return true;
                    }
                    renderLockOverlay({ title: c.expiredTitle, body: c.expiredBody, ctaHref: 'pricing.html', ctaLabel: c.renew });
                    return false;
                }
                const daysLeft = daysBetween(Date.now(), expiresAtMs);
                if (daysLeft <= 3) {
                    renderCountdownBanner('planExpiryBanner', c.planDaysLeft(daysLeft), 'pricing.html', c.renew, '#F5A623');
                }
            }
            return true;
        }

        // --- plan === 'trial' from here on.
        // A trial-plan account with a payment awaiting review never gets
        // trial access — it's locked until the admin decides.
        if (await hasPendingOrder(user.uid)) {
            if (allowLockedAccess) {
                renderLockedBanner(`${c.pendingTitle} — ${c.pendingBody}`);
                return true;
            }
            renderLockOverlay({ title: c.pendingTitle, body: c.pendingBody });
            return false;
        }

        const start = data.trialStartedAt instanceof Timestamp ? data.trialStartedAt.toMillis() : Date.now();
        const elapsed = daysBetween(start, Date.now());
        const daysLeft = TRIAL_DAYS - elapsed;

        if (daysLeft <= 0) {
            if (allowLockedAccess) {
                renderLockedBanner(`${c.trialTitle} — ${c.trialBody}`);
                return true;
            }
            renderLockOverlay({ title: c.trialTitle, body: c.trialBody, ctaHref: 'pricing.html', ctaLabel: c.upgrade });
            return false;
        }

        if (daysLeft <= 3) {
            renderCountdownBanner('trialBanner', c.daysLeft(daysLeft), 'pricing.html', c.upgrade, '#F5A623');
        }
        return true;
    } catch (err) {
        // Fail open: a Firestore/network hiccup shouldn't lock a paying-in-spirit
        // user out of their own dashboard.
        console.error('Plan/trial check failed:', err);
        return true;
    }
}
