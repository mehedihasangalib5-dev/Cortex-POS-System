// ---------------------------------------------------------------------------
// Runs on every public page. Watches Firebase Auth state and toggles the
// "Sign In / Start Free Trial" vs "Go to Dashboard / Logout" nav buttons
// (desktop + mobile) using the .hidden-auth helper class.
// ---------------------------------------------------------------------------
import { auth } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

onAuthStateChanged(auth, (user) => {
    document.querySelectorAll('[data-auth="out"]').forEach((el) => el.classList.toggle('hidden-auth', !!user));
    document.querySelectorAll('[data-auth="in"]').forEach((el) => el.classList.toggle('hidden-auth', !user));
    document.querySelectorAll('[data-user-email]').forEach((el) => { el.textContent = user ? user.email : ''; });
});

document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-logout]');
    if (!btn) return;
    e.preventDefault();
    signOut(auth).then(() => { window.location.href = 'index.html'; });
});
