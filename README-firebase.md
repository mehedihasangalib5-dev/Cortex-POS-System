# Firebase / Firestore Backend Setup

This static site is wired to use **Firebase Authentication** (email/password)
and **Cloud Firestore** as its backend. You just need to plug in your own
Firebase project's config — no server required.

## 1. Create a Firebase project

1. Go to https://console.firebase.google.com and create a new project.
2. In the project, go to **Build → Authentication → Get started**, and
   enable the **Email/Password** sign-in provider.
3. Go to **Build → Firestore Database → Create database**. Start in
   **production mode** (we provide rules below).

## 2. Get your web app config

1. In **Project settings** (gear icon) → **General** tab → **Your apps**,
   click the Web icon (`</>`) to register a web app.
2. Copy the `firebaseConfig` object it shows you.
3. Paste those values into `assets/js/firebase-config.js` in this project,
   replacing the placeholder values.

## 3. Deploy the Firestore security rules

Copy the contents of `firestore.rules` into **Firestore Database → Rules**
in the Firebase console and publish, or deploy with the Firebase CLI:

```bash
firebase deploy --only firestore:rules
```

These rules:
- Let anyone submit the **Contact** form (public `create` on `contactMessages`),
  but only the platform admin can read/manage those messages.
- Let each signed-in user read/create/update only their **own** `users/{uid}`
  profile document, created automatically on registration.
- Isolate every business's data (`products`, `sales`, `customers`,
  `employees`, `expenses`, `payrollRecords`, `settings`) by a `businessId`
  field, so one customer's account can never see another's.

### ⚠️ Migrating existing data (only relevant if you had data before this)

If `products`, `sales`, `customers`, etc. already had documents in them
*before* multi-tenancy was added, those documents have **no `businessId`
field** — the new rules above will make them invisible to everyone,
including you, the moment you deploy. New documents created from now on
get `businessId` automatically; only pre-existing ones need a one-time
backfill.

To fix it: for each existing document in those collections, set
`businessId` to the uid of whichever account should own that data (almost
always your own, if you were the only one using it). Easiest ways to do
this once:
- **Firebase Console**: open each collection, edit each document, add the
  `businessId` field manually (fine for a handful of documents).
- **A short Admin SDK script**: loop over each collection with
  `db.collection('products').get()` and `doc.ref.update({ businessId: OWNER_UID })`
  for each doc — ask an AI coding assistant (or Claude) to write this for
  you if you have more than a few documents; it's a 15-line Node.js script
  run once with `firebase-admin`.

If you're starting fresh (no real data yet), you can ignore this section
entirely.

## 4. Serve the site over http(s), not file://

The pages use native ES module `<script type="module">` imports, which most
browsers block under the `file://` protocol due to CORS. Use any static
file server while testing, for example:

```bash
npx serve .
# or
python3 -m http.server 8080
```

For production, **Firebase Hosting** is a natural fit since you're already
using Firebase:

```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # point the public directory at this folder
firebase deploy
```

## What's wired up

| Page                    | Behavior |
|-------------------------|----------|
| `register.html`         | Creates a Firebase Auth user + a `users/{uid}` Firestore doc, then redirects to `dashboard.html`. |
| `login.html`            | Signs in with Firebase Auth, redirects to `dashboard.html`. |
| `forgot-password.html`  | Sends a Firebase Auth password-reset email. |
| `contact.html`          | Writes each submission to the `contactMessages` Firestore collection. |
| `dashboard.html`        | Protected page — redirects to `login.html` if not signed in. Shows the signed-in user's name/email, a logout button, placeholder cards for future modules (POS, Inventory, HR, Accounting, AI Assistant, Reports, Settings), and a live list of the 5 most recent contact messages read from Firestore. |
| Every other page's nav  | Automatically swaps "Sign In / Start Free Trial" for "Go to Dashboard / Logout" once a user is signed in (via `assets/js/site-auth.js`). |

## Files added for this integration

```
assets/js/firebase-config.js   ← put YOUR Firebase project config here
assets/js/firebase-init.js     ← initializes the Firebase app (auth + db)
assets/js/site-auth.js         ← nav auth-state toggle, used on every page
assets/js/auth-forms.js        ← login/register/forgot-password logic
assets/js/contact-firestore.js ← contact form → Firestore
assets/js/dashboard.js         ← dashboard guard + recent-messages widget
dashboard.html                 ← protected placeholder dashboard
forgot-password.html           ← password reset page
firestore.rules                ← security rules to deploy
```

## Next steps for a full dashboard

This gives you the base plumbing (auth, protected route, one working
Firestore read/write loop) so the next phase — building out the real POS,
Inventory, Customers, HR, Accounting, and AI Assistant modules as Firestore
collections/queries inside `dashboard.html` — can be layered on directly.
