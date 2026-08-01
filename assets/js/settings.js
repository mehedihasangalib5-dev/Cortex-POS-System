// ---------------------------------------------------------------------------
// Settings page: a single shared "settings/business" doc for the business
// profile (name, phone, address, currency symbol, default low-stock
// threshold) plus per-user account settings (display name via Firebase Auth
// updateProfile). Theme preference already lives in localStorage globally.
// ---------------------------------------------------------------------------
import { auth, db } from "./firebase-init.js";
import { requireAuth, toast } from "./app-shell.js";
import { updateProfile } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
    doc, getDoc, setDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const BUSINESS_DOC = 'business';

requireAuth(async (user) => {
    document.getElementById('accName').value = user.displayName || '';
    document.getElementById('accEmail').value = user.email || '';

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
