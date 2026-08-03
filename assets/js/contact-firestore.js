// ---------------------------------------------------------------------------
// Contact form → Firestore. Writes each submission as a document in the
// "contactMessages" collection. See firestore.rules for the matching
// security rule (public create, signed-in-only read).
// ---------------------------------------------------------------------------
import { db } from "./firebase-init.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Small helper so button/status text respects the active EN/BN language.
function t(key, fallback) {
    return (typeof window.i18nText === 'function') ? window.i18nText(key) : fallback;
}

const form = document.getElementById('contactForm');

if (form) {
    form.addEventListener('submit', async function (e) {
        e.preventDefault();

        const btn = document.getElementById('submitBtn');
        const alertBox = document.getElementById('formAlert');
        const successBox = document.getElementById('formSuccess');
        const honeypot = form.querySelector('input[name="website"]').value;

        alertBox.classList.add('hidden');
        successBox.classList.add('hidden');

        if (honeypot) {
            // Likely a bot — drop silently, don't hit Firestore.
            return;
        }

        btn.disabled = true;
        btn.textContent = t('sk_sending', 'Sending...');

        try {
            await addDoc(collection(db, 'contactMessages'), {
                name: form.name.value.trim(),
                email: form.email.value.trim(),
                subject: form.subject.value.trim(),
                message: form.message.value.trim(),
                status: 'new', // 'new' | 'read' | 'replied' — managed from admin-messages.html
                createdAt: serverTimestamp(),
            });
            successBox.classList.remove('hidden');
            form.reset();
        } catch (err) {
            console.error(err);
            alertBox.textContent = t('sk_send_error', 'Something went wrong sending your message. Please try again or email us directly.');
            alertBox.classList.remove('hidden');
        } finally {
            btn.disabled = false;
            btn.textContent = t('k041', 'Send Message');
        }
    });
}
