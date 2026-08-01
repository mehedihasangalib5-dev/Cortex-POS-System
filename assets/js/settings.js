// ---------------------------------------------------------------------------
// Settings page: a single shared "settings/business" doc for the business
// profile (name, phone, address, currency symbol, default low-stock
// threshold) plus per-user account settings (display name via Firebase Auth
// updateProfile). Theme preference already lives in localStorage globally.
// ---------------------------------------------------------------------------
import { auth, db, functions } from "./firebase-init.js";
import { requireAuth, toast } from "./app-shell.js";
import { updateProfile } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
    doc, getDoc, setDoc, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

const BUSINESS_DOC = 'business';
const TRIAL_DAYS = 14;
const PLAN_LABEL = { trial: 'Free Trial', starter: 'Starter', pro: 'Pro', enterprise: 'Enterprise' };

requireAuth(async (user) => {
    document.getElementById('accName').value = user.displayName || '';
    document.getElementById('accEmail').value = user.email || '';

    handlePaymentReturn();
    await loadBillingStatus(user);
    document.querySelectorAll('[data-plan-btn]').forEach((btn) => {
        btn.addEventListener('click', () => onSwitchPlan(user, btn.dataset.planBtn));
    });

    try {
        const snap = await getDoc(doc(db, 'settings', BUSINESS_DOC));
        if (snap.exists()) {
            const data = snap.data();
            document.getElementById('bizName').value = data.name || '';
            document.getElementById('bizPhone').value = data.phone || '';
            document.getElementById('bizAddress').value = data.address || '';
            document.getElementById('bizCurrency').value = data.currencySymbol || '৳';
            document.getElementById('bizReceiptNote').value = data.receiptFooterNote || '';
        } else {
            document.getElementById('bizCurrency').value = '৳';
        }
    } catch (err) {
        console.error(err);
        toast('Could not load business settings', 'error');
    }

    document.getElementById('businessForm').addEventListener('submit', onSaveBusiness);
    document.getElementById('accountForm').addEventListener('submit', (e) => onSaveAccount(e, user));
});

// SSLCommerz redirects the browser back to
// settings.html?payment=success|failed|cancelled after checkout.
function handlePaymentReturn() {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('payment');
    if (!status) return;

    if (status === 'success') toast('Payment received — your plan is updated!');
    else if (status === 'cancelled') toast('Payment cancelled.', 'info');
    else toast('Payment could not be completed. Please try again.', 'error');

    // Clean the URL so a page refresh doesn't re-show the toast.
    window.history.replaceState({}, '', window.location.pathname);
}

async function loadBillingStatus(user) {
    const badge = document.getElementById('planBadge');
    const statusText = document.getElementById('planStatusText');
    try {
        const ref = doc(db, 'users', user.uid);
        const snap = await getDoc(ref);
        const data = snap.exists() ? snap.data() : {};
        const plan = data.plan || 'trial';

        badge.textContent = PLAN_LABEL[plan] || plan;
        badge.style.background = plan === 'trial' ? '#F5A62322' : '#10B98122';
        badge.style.color = plan === 'trial' ? '#F5A623' : '#10B981';

        if (plan === 'trial') {
            const start = data.trialStartedAt instanceof Timestamp ? data.trialStartedAt.toMillis() : Date.now();
            const elapsed = Math.floor((Date.now() - start) / 86400000);
            const daysLeft = TRIAL_DAYS - elapsed;
            statusText.textContent = daysLeft > 0
                ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in your free trial. Pick a plan below anytime to continue after it ends.`
                : 'Your free trial has ended. Pick a plan below to unlock your dashboard again.';
        } else {
            statusText.textContent = `You're on the ${PLAN_LABEL[plan] || plan} plan. Thanks for being a customer!`;
        }

        document.querySelectorAll('[data-plan-btn]').forEach((btn) => {
            const isCurrent = btn.dataset.planBtn === plan;
            btn.disabled = isCurrent;
            btn.textContent = isCurrent ? 'Current Plan' : `Switch to ${PLAN_LABEL[btn.dataset.planBtn]}`;
            btn.classList.toggle('opacity-60', isCurrent);
        });
    } catch (err) {
        console.error(err);
        statusText.textContent = 'Could not load your plan status.';
    }
}

// Real payment: calls the initiatePayment Cloud Function (which holds the
// SSLCommerz secret server-side), then sends the browser to the hosted
// SSLCommerz checkout page. The plan itself is only ever flipped by the
// paymentCallback function after it independently verifies the payment —
// nothing here writes `plan` to Firestore directly.
async function onSwitchPlan(user, planId) {
    const btn = document.querySelector(`[data-plan-btn="${planId}"]`);
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Redirecting to payment...';
    try {
        const initiatePayment = httpsCallable(functions, 'initiatePayment');
        const result = await initiatePayment({ planId });
        window.location.href = result.data.gatewayUrl;
    } catch (err) {
        console.error(err);
        toast(err.message || 'Could not start payment. Please try again.', 'error');
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

async function onSaveBusiness(e) {
    e.preventDefault();
    const errEl = document.getElementById('businessFormError');
    errEl.classList.add('hidden');
    const btn = document.getElementById('businessSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        await setDoc(doc(db, 'settings', BUSINESS_DOC), {
            name: document.getElementById('bizName').value.trim(),
            phone: document.getElementById('bizPhone').value.trim(),
            address: document.getElementById('bizAddress').value.trim(),
            currencySymbol: document.getElementById('bizCurrency').value.trim() || '৳',
            receiptFooterNote: document.getElementById('bizReceiptNote').value.trim(),
            updatedAt: serverTimestamp(),
        }, { merge: true });
        toast('Business profile saved');
    } catch (err) {
        console.error(err);
        errEl.textContent = 'Could not save business profile. Please try again.';
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Business Profile';
    }
}

async function onSaveAccount(e, user) {
    e.preventDefault();
    const errEl = document.getElementById('accountFormError');
    const okEl = document.getElementById('accountFormSuccess');
    errEl.classList.add('hidden');
    okEl.classList.add('hidden');
    const btn = document.getElementById('accountSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const name = document.getElementById('accName').value.trim();
        await updateProfile(user, { displayName: name });
        document.querySelectorAll('[data-user-name]').forEach((el) => { el.textContent = name || user.email; });
        document.querySelectorAll('[data-user-initial]').forEach((el) => {
            el.textContent = (name || user.email || '?').charAt(0).toUpperCase();
        });
        okEl.textContent = 'Profile updated.';
        okEl.classList.remove('hidden');
        toast('Profile saved');
    } catch (err) {
        console.error(err);
        errEl.textContent = 'Could not update your profile. Please try again.';
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Profile';
    }
}
