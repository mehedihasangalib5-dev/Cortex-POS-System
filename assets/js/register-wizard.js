// ---------------------------------------------------------------------------
// Drives the 3-step register.html wizard:
//   Step 1  Create account       -> Firebase Auth user + users/{uid} doc (plan: "trial")
//   Step 2  Business info        -> merged into users/{uid}
//   Step 3  Plan + payment       -> trial finishes immediately; starter/pro
//                                   collects bKash/Nagad proof into /orders
//                                   with status "pending_verification"
//   Step 4  Confirmation         -> shown only after a paid-plan submission
// ---------------------------------------------------------------------------
import { auth, db, storage } from "./firebase-init.js";
import {
    createUserWithEmailAndPassword,
    updateProfile,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
    doc, setDoc, addDoc, collection, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
    ref, uploadBytes, getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import { PAYMENT_METHODS, PLAN_PRICES } from "./payment-config.js";

const wizardCard = document.getElementById('wizardCard');
if (wizardCard) {

    const params = new URLSearchParams(window.location.search);
    const requestedPlan = params.get('plan'); // "starter" | "pro" | null

    let currentUid = null;
    let selectedPlan = (requestedPlan === 'starter' || requestedPlan === 'pro') ? requestedPlan : 'trial';
    let billingCycle = 'monthly';
    let selectedMethod = PAYMENT_METHODS[0]?.id || 'bkash';

    // ---- helpers ----------------------------------------------------------
    function showError(msg) {
        const el = document.getElementById('authError');
        if (!el) return;
        el.textContent = msg;
        el.classList.remove('hidden');
    }
    function clearError() {
        document.getElementById('authError')?.classList.add('hidden');
    }
    function friendlyAuthError(err) {
        const map = {
            'auth/email-already-in-use': 'That email is already registered — try signing in instead.',
            'auth/invalid-email': 'Please enter a valid email address.',
            'auth/weak-password': 'Password should be at least 6 characters.',
            'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
        };
        return map[err.code] || 'Something went wrong. Please try again.';
    }
    function money(n) {
        return '৳' + Number(n).toLocaleString('en-US');
    }
    function goToStep(n) {
        document.querySelectorAll('[data-step]').forEach((el) => {
            el.classList.toggle('hidden', el.getAttribute('data-step') !== String(n));
        });
        document.getElementById('stepIndicator').classList.toggle('hidden', n === 4);
        document.querySelectorAll('[data-step-dot]').forEach((el) => {
            el.classList.toggle('active', Number(el.getAttribute('data-step-dot')) <= n);
        });
        clearError();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ---- Step 1: create account -------------------------------------------
    const step1Form = document.getElementById('step1Form');
    step1Form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearError();
        if (step1Form.password.value !== step1Form.confirmPassword.value) {
            showError('Passwords do not match.');
            return;
        }
        const btn = document.getElementById('step1Btn');
        btn.disabled = true;
        btn.textContent = 'Creating account...';
        try {
            const email = step1Form.email.value.trim();
            const name = step1Form.name.value.trim();
            const cred = await createUserWithEmailAndPassword(auth, email, step1Form.password.value);
            currentUid = cred.user.uid;
            await updateProfile(cred.user, { displayName: name });
            await setDoc(doc(db, 'users', currentUid), {
                name,
                email,
                phone: step1Form.phone.value.trim(),
                role: 'owner',
                createdAt: serverTimestamp(),
                // Trial lock: every account starts on "trial" no matter which
                // plan they're about to pay for — `plan` only flips to
                // starter/pro once the admin approves the bKash/Nagad proof.
                trialStartedAt: serverTimestamp(),
                plan: 'trial',
            });
            goToStep(2);
        } catch (err) {
            console.error(err);
            showError(friendlyAuthError(err));
        } finally {
            btn.disabled = false;
            btn.textContent = 'Continue';
        }
    });

    // ---- Step 2: business info ---------------------------------------------
    const step2Form = document.getElementById('step2Form');
    step2Form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearError();
        const btn = document.getElementById('step2Btn');
        btn.disabled = true;
        btn.textContent = 'Saving...';
        try {
            await setDoc(doc(db, 'users', currentUid), {
                businessName: step2Form.businessName.value.trim(),
                businessType: step2Form.businessType.value,
                branchCount: step2Form.branchCount.value,
                city: step2Form.city.value.trim(),
            }, { merge: true });
            initStep3();
            goToStep(3);
        } catch (err) {
            console.error(err);
            showError('Could not save your business info. Please try again.');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Continue';
        }
    });

    // ---- Step 3: plan + payment --------------------------------------------
    function currentPrice() {
        if (selectedPlan === 'trial') return 0;
        return PLAN_PRICES[selectedPlan][billingCycle];
    }

    function renderPlanSelection() {
        document.querySelectorAll('.plan-card').forEach((card) => {
            card.classList.toggle('selected', card.getAttribute('data-plan') === selectedPlan);
        });
        const isPaid = selectedPlan !== 'trial';
        document.getElementById('billingToggle').classList.toggle('flex', isPaid);
        document.getElementById('billingToggle').classList.toggle('hidden', !isPaid);
        document.getElementById('trialConfirmForm').classList.toggle('hidden', isPaid);
        document.getElementById('paidPlanSection').classList.toggle('hidden', !isPaid);
        document.getElementById('paymentSection').classList.add('hidden');
        if (isPaid) {
            document.getElementById('paidPlanSection').classList.remove('hidden');
            document.getElementById('summaryPlan').textContent =
                (selectedPlan === 'starter' ? 'Starter' : 'Pro') + ' — ' + (billingCycle === 'monthly' ? 'Monthly' : 'Yearly');
            document.getElementById('summaryTotal').textContent = money(currentPrice()) + (billingCycle === 'yearly' ? '/mo (billed yearly)' : '/mo');
        }
    }

    function renderPaymentMethods() {
        const numbersWrap = document.getElementById('paymentNumbers');
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

        const radiosWrap = document.getElementById('methodRadios');
        radiosWrap.innerHTML = PAYMENT_METHODS.map((m, i) => `
            <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name="method" value="${m.id}" ${i === 0 ? 'checked' : ''}/>
                <span>${m.label}</span>
            </label>
        `).join('');
        radiosWrap.querySelectorAll('input[name="method"]').forEach((r) => {
            r.addEventListener('change', () => { selectedMethod = r.value; });
        });

        document.getElementById('payAmountLabel').textContent = money(currentPrice());
    }

    function initStep3() {
        // Reflect prices pulled from payment-config.js on the plan cards.
        document.querySelector('[data-price-display="starter"]').textContent = money(PLAN_PRICES.starter.monthly);
        document.querySelector('[data-price-display="pro"]').textContent = money(PLAN_PRICES.pro.monthly);
        renderPlanSelection();
    }

    document.getElementById('planCards').addEventListener('click', (e) => {
        const card = e.target.closest('.plan-card');
        if (!card) return;
        selectedPlan = card.getAttribute('data-plan');
        renderPlanSelection();
    });

    document.getElementById('billingToggle').addEventListener('click', (e) => {
        const btn = e.target.closest('.billing-btn');
        if (!btn) return;
        billingCycle = btn.getAttribute('data-billing');
        document.querySelectorAll('.billing-btn').forEach((b) => b.classList.toggle('active', b === btn));
        renderPlanSelection();
    });
    document.querySelector('[data-billing="monthly"]')?.classList.add('active');

    // Trial: nothing left to pay for — just go to the dashboard.
    document.getElementById('trialConfirmForm').addEventListener('submit', (e) => {
        e.preventDefault();
        window.location.href = 'dashboard.html';
    });

    document.getElementById('proceedToPaymentBtn').addEventListener('click', () => {
        if (!document.getElementById('tcCheckbox').checked) {
            showError('Please accept the Terms & Conditions to continue.');
            return;
        }
        clearError();
        renderPaymentMethods();
        document.getElementById('paidPlanSection').classList.add('hidden');
        document.getElementById('paymentSection').classList.remove('hidden');
    });

    document.getElementById('backToPlanBtn').addEventListener('click', () => {
        document.getElementById('paymentSection').classList.add('hidden');
        document.getElementById('paidPlanSection').classList.remove('hidden');
    });

    const paymentProofForm = document.getElementById('paymentProofForm');
    paymentProofForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearError();
        const file = document.getElementById('screenshotInput').files[0];
        if (!file) {
            showError('Please attach your payment screenshot.');
            return;
        }
        const btn = document.getElementById('submitProofBtn');
        btn.disabled = true;
        btn.textContent = 'Uploading...';
        try {
            const path = `payment-proofs/${currentUid}/${Date.now()}-${file.name}`;
            const fileRef = ref(storage, path);
            await uploadBytes(fileRef, file);
            const screenshotUrl = await getDownloadURL(fileRef);

            await addDoc(collection(db, 'orders'), {
                uid: currentUid,
                plan: selectedPlan,
                billingCycle,
                amount: currentPrice(),
                method: selectedMethod,
                senderNumber: paymentProofForm.senderNumber.value.trim(),
                trxId: paymentProofForm.trxId.value.trim(),
                screenshotUrl,
                status: 'pending_verification',
                createdAt: serverTimestamp(),
            });

            goToStep(4);
        } catch (err) {
            console.error(err);
            showError('Could not submit your payment proof. Please try again.');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Submit for Verification';
        }
    });

    // ---- Back buttons -------------------------------------------------------
    document.querySelectorAll('[data-back]').forEach((btn) => {
        btn.addEventListener('click', () => goToStep(Number(btn.getAttribute('data-back'))));
    });

    // ---- Password show/hide (kept from the old single-step form) -----------
    document.querySelectorAll('.password-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.getAttribute('data-target'));
            if (!input) return;
            input.type = input.type === 'password' ? 'text' : 'password';
            btn.querySelector('i').classList.toggle('fa-eye');
            btn.querySelector('i').classList.toggle('fa-eye-slash');
        });
    });

    goToStep(1);
}
