// ---------------------------------------------------------------------------
// Handles the three auth pages: login.html, register.html, forgot-password.html
// Each page only has the form relevant to it, so each block below is a no-op
// on the other pages.
// ---------------------------------------------------------------------------
import { auth, db } from "./firebase-init.js";
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    updateProfile,
    sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Small helper so button/status text respects the active EN/BN language.
function t(key, fallback) {
    return (typeof window.i18nText === 'function') ? window.i18nText(key) : fallback;
}

function showError(msg) {
    const el = document.getElementById('authError');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
}

function clearMessages() {
    document.getElementById('authError')?.classList.add('hidden');
    document.getElementById('authSuccess')?.classList.add('hidden');
}

function friendlyAuthError(err) {
    const map = {
        'auth/email-already-in-use': 'That email is already registered — try signing in instead.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/weak-password': 'Password should be at least 6 characters.',
        'auth/user-not-found': 'No account found with that email.',
        'auth/wrong-password': 'Incorrect password. Please try again.',
        'auth/invalid-credential': 'Incorrect email or password.',
        'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    };
    return map[err.code] || 'Something went wrong. Please try again.';
}

// --- Login ------------------------------------------------------------
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMessages();
        const btn = document.getElementById('authSubmitBtn');
        btn.disabled = true;
        btn.textContent = t('sk_signing_in', 'Signing in...');
        try {
            await signInWithEmailAndPassword(auth, loginForm.email.value.trim(), loginForm.password.value);
            window.location.href = 'dashboard.html';
        } catch (err) {
            console.error(err);
            showError(friendlyAuthError(err));
            btn.disabled = false;
            btn.textContent = t('k007', 'Sign In');
        }
    });
}

// --- Register -----------------------------------------------------------
const registerForm = document.getElementById('registerForm');
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMessages();
        const btn = document.getElementById('authSubmitBtn');
        btn.disabled = true;
        btn.textContent = t('sk_creating_account', 'Creating account...');
        try {
            const cred = await createUserWithEmailAndPassword(
                auth,
                registerForm.email.value.trim(),
                registerForm.password.value
            );
            const name = registerForm.name.value.trim();
            await updateProfile(cred.user, { displayName: name });
            await setDoc(doc(db, 'users', cred.user.uid), {
                name,
                email: registerForm.email.value.trim(),
                businessName: registerForm.businessName ? registerForm.businessName.value.trim() : '',
                role: 'owner',
                createdAt: serverTimestamp(),
                // Trial lock: 14 days from signup. `plan` stays "trial" until the
                // owner is manually upgraded (e.g. in Firestore or a future billing
                // flow) to "starter" / "pro" / "enterprise", which lifts the lock.
                trialStartedAt: serverTimestamp(),
                plan: 'trial',
            });
            window.location.href = 'dashboard.html';
        } catch (err) {
            console.error(err);
            showError(friendlyAuthError(err));
            btn.disabled = false;
            btn.textContent = t('k228', 'Create Account');
        }
    });
}

// --- Forgot password ------------------------------------------------------
const forgotForm = document.getElementById('forgotForm');
if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMessages();
        const btn = document.getElementById('authSubmitBtn');
        btn.disabled = true;
        btn.textContent = t('sk_sending', 'Sending...');
        try {
            await sendPasswordResetEmail(auth, forgotForm.email.value.trim());
            document.getElementById('authSuccess')?.classList.remove('hidden');
        } catch (err) {
            console.error(err);
            showError(friendlyAuthError(err));
        } finally {
            btn.disabled = false;
            btn.textContent = t('k123', 'Send Reset Link');
        }
    });
}
