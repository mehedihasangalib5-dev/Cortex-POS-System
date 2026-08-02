// ---------------------------------------------------------------------------
// Settings page: a single shared "settings/business" doc for the business
// profile (name, phone, address, currency symbol, default low-stock
// threshold) plus per-user account settings (display name via Firebase Auth
// updateProfile). Theme preference already lives in localStorage globally.
//
// Billing & Plan: "Switch to Starter/Pro" opens an in-page modal that
// submits a manual bKash/Nagad payment proof — the exact same flow and
// `orders` document shape as a brand-new signup (see register-wizard.js),
// just for an already-signed-in account. The uid, business data, and
// everything else stay untouched; only `plan` changes, and only once an
// admin approves it in admin-payments.html. There is no automated gateway
// here on purpose — nothing writes `plan` from the client.
// ---------------------------------------------------------------------------
import { auth, db } from "./firebase-init.js";
import { requireAuth, toast } from "./app-shell.js";
import { updateProfile } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
    doc, getDoc, setDoc, addDoc, collection, query, where, limit, getDocs,
    serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { PAYMENT_METHODS, PLAN_PRICES } from "./payment-config.js";

const BUSINESS_DOC = 'business';
const TRIAL_DAYS = 14;
const PLAN_LABEL = { trial: 'Free Trial', starter: 'Starter', pro: 'Pro', enterprise: 'Enterprise' };

let upgradePlanId = null;
let upgradeBillingCycle = 'monthly';
let upgradeMethod = PAYMENT_METHODS[0]?.id || 'bkash';

requireAuth(async (user) => {
    document.getElementById('accName').value = user.displayName || '';
    document.getElementById('accEmail').value = user.email || '';

    await loadBillingStatus(user);
    document.querySelectorAll('[data-plan-btn]').forEach((btn) => {
        btn.addEventListener('click', () => openUpgradeModal(btn.dataset.planBtn));
    });
    initUpgradeModal(user);

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

async function hasPendingOrder(uid) {
    const snap = await getDocs(query(
        collection(db, 'orders'),
        where('uid', '==', uid),
        where('status', '==', 'pending_verification'),
        limit(1)
    ));
    return !snap.empty;
}

async function loadBillingStatus(user) {
    const badge = document.getElementById('planBadge');
    const statusText = document.getElementById('planStatusText');
    try {
        const ref = doc(db, 'users', user.uid);
        const snap = await getDoc(ref);
        const data = snap.exists() ? snap.data() : {};
        const plan = data.plan || 'trial';
        const isExpired = plan !== 'trial' && data.planExpiresAt instanceof Timestamp && Date.now() >= data.planExpiresAt.toMillis();
        const pending = await hasPendingOrder(user.uid);

        badge.textContent = pending ? 'Review Pending' : (isExpired ? 'Expired' : (PLAN_LABEL[plan] || plan));
        badge.style.background = pending || isExpired ? '#F5A62322' : (plan === 'trial' ? '#F5A62322' : '#10B98122');
        badge.style.color = pending || isExpired ? '#F5A623' : (plan === 'trial' ? '#F5A623' : '#10B981');

        if (pending) {
            statusText.textContent = 'We\u2019ve received your payment details and it\u2019s awaiting review — usually within 1-24 hours. You can keep using your current plan in the meantime.';
        } else if (isExpired) {
            statusText.textContent = `Your ${PLAN_LABEL[plan] || plan} plan has expired. Renew it below to unlock your dashboard again.`;
        } else if (plan === 'trial') {
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
            const isCurrent = !pending && !isExpired && btn.dataset.planBtn === plan;
            const isRenewable = !pending && isExpired && btn.dataset.planBtn === plan;
            btn.disabled = isCurrent || pending;
            btn.textContent = pending ? 'Review Pending' : (isCurrent ? 'Current Plan' : (isRenewable ? `Renew ${PLAN_LABEL[btn.dataset.planBtn]}` : `Switch to ${PLAN_LABEL[btn.dataset.planBtn]}`));
            btn.classList.toggle('opacity-60', isCurrent || pending);
        });
    } catch (err) {
        console.error(err);
        statusText.textContent = 'Could not load your plan status.';
    }
}

// ---------------------------------------------------------------------------
// Upgrade modal — manual bKash/Nagad payment proof for an existing account.
// ---------------------------------------------------------------------------
function money(n) { return '৳' + Number(n).toLocaleString('en-US'); }

function currentUpgradePrice() {
    return PLAN_PRICES[upgradePlanId]?.[upgradeBillingCycle] || 0;
}

function renderUpgradePaymentMethods() {
    const numbersWrap = document.getElementById('upgradePaymentNumbers');
    numbersWrap.innerHTML = PAYMENT_METHODS.map((m) => `
        <div class="surface p-4 rounded-xl" style="border-color:var(--border-subtle)">
            <div class="flex items-center gap-2 mb-1">
                <i class="${m.icon}" style="color:${m.color}"></i>
                <span class="font-semibold text-sm">${m.label} (${m.type})</span>
            </div>
            <div class="flex items-center justify-between gap-2">
                <span class="font-mono text-sm">${m.number}</span>
                <button type="button" class="text-xs font-medium text-primary" data-copy="${m.number}">Copy</button>
            </div>
        </div>
    `).join('');
    numbersWrap.querySelectorAll('[data-copy]').forEach((btn) => {
        btn.addEventListener('click', () => {
            navigator.clipboard?.writeText(btn.getAttribute('data-copy'));
            const original = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = original; }, 1500);
        });
    });

    const radiosWrap = document.getElementById('upgradeMethodRadios');
    radiosWrap.innerHTML = PAYMENT_METHODS.map((m, i) => `
        <label class="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name="upgradeMethod" value="${m.id}" ${m.id === upgradeMethod ? 'checked' : ''}/>
            <span>${m.label}</span>
        </label>
    `).join('');
    radiosWrap.querySelectorAll('input[name="upgradeMethod"]').forEach((r) => {
        r.addEventListener('change', () => { upgradeMethod = r.value; });
    });

    document.getElementById('upgradePayAmount').textContent = money(currentUpgradePrice());
}

function openUpgradeModal(planId) {
    upgradePlanId = planId;
    upgradeBillingCycle = 'monthly';
    upgradeMethod = PAYMENT_METHODS[0]?.id || 'bkash';

    document.getElementById('upgradeModalTitle').textContent = `Switch to ${PLAN_LABEL[planId] || planId}`;
    document.getElementById('upgradeForm').reset();
    document.getElementById('upgradeFormError').classList.add('hidden');
    document.querySelectorAll('.upgrade-billing-btn').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-billing') === 'monthly');
    });
    renderUpgradePaymentMethods();

    const modal = document.getElementById('upgradeModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeUpgradeModal() {
    const modal = document.getElementById('upgradeModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function initUpgradeModal(user) {
    document.getElementById('upgradeModalClose').addEventListener('click', closeUpgradeModal);
    document.getElementById('upgradeModal').addEventListener('click', (e) => {
        if (e.target.id === 'upgradeModal') closeUpgradeModal();
    });

    document.getElementById('upgradeBillingToggle').addEventListener('click', (e) => {
        const btn = e.target.closest('.upgrade-billing-btn');
        if (!btn) return;
        upgradeBillingCycle = btn.getAttribute('data-billing');
        document.querySelectorAll('.upgrade-billing-btn').forEach((b) => b.classList.toggle('active', b === btn));
        document.getElementById('upgradePayAmount').textContent = money(currentUpgradePrice());
    });

    document.getElementById('upgradeForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('upgradeFormError');
        errEl.classList.add('hidden');
        const btn = document.getElementById('upgradeSubmitBtn');
        btn.disabled = true;
        btn.textContent = 'Submitting...';
        try {
            await addDoc(collection(db, 'orders'), {
                uid: user.uid,
                customerEmail: user.email,
                businessName: document.getElementById('bizName').value.trim() || user.email,
                plan: upgradePlanId,
                billingCycle: upgradeBillingCycle,
                amount: currentUpgradePrice(),
                method: upgradeMethod,
                senderNumber: document.getElementById('upgradeSenderNumber').value.trim(),
                trxId: document.getElementById('upgradeTrxId').value.trim(),
                status: 'pending_verification',
                createdAt: serverTimestamp(),
            });
            closeUpgradeModal();
            toast('Submitted! We\u2019ll review it and activate your plan shortly.');
            await loadBillingStatus(user);
        } catch (err) {
            console.error(err);
            errEl.textContent = 'Could not submit your payment proof. Please try again.';
            errEl.classList.remove('hidden');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Submit for Verification';
        }
    });
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
