// ---------------------------------------------------------------------------
// Multi-tenant business context.
//
// Every signed-in user belongs to exactly one "business", identified by
// `businessId` — a plain string equal to the OWNER's uid. The owner's own
// businessId is their own uid; an invited staff member's businessId is the
// owner's uid (set once, at signup, from the invite they accepted — see
// register-wizard.js).
//
// Billing (plan / trialStartedAt / planExpiresAt) only ever lives on the
// OWNER's users/{uid} doc — staff docs don't carry their own copy. So
// resolving "what can this signed-in person do" always means: find my
// businessId, then read the doc AT that businessId for plan info. For an
// owner, businessId === their own uid, so this is a single read either way.
//
// Every business-data collection (products, sales, customers, employees,
// expenses, payrollRecords) and the shared settings doc are keyed by this
// same businessId — see firestore.rules.
// ---------------------------------------------------------------------------
import { db } from "./firebase-init.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { ensureSystemRoles, resolvePermissions, fullPermissions } from "./roles-utils.js";

let cached = null; // { uid, businessId, role, ownerData } — cleared on reload, fine for a single page session.

/**
 * Resolves { businessId, role, ownerData } for the signed-in user.
 * `ownerData` is the business owner's users/{businessId} doc data (plan,
 * trialStartedAt, planExpiresAt, businessName, etc.) — for an owner this is
 * just their own doc.
 *
 * Self-heals legacy accounts created before multi-tenancy (no `businessId`
 * field yet): they become the owner of their own business, businessId =
 * their own uid, exactly matching how they already behaved (single shared
 * pool). This does NOT retroactively fix old data that has no `businessId`
 * field on it — see the migration note in README-firebase.md.
 */
export async function getBusinessContext(uid) {
    if (cached && cached.uid === uid) return cached;

    const myRef = doc(db, 'users', uid);
    const mySnap = await getDoc(myRef);
    let myData = mySnap.exists() ? mySnap.data() : {};

    if (!myData.businessId) {
        // Legacy account (predates multi-tenancy) or a brand-new owner
        // doc written before this field existed for some other reason.
        // Self-heal: they own their own business.
        await setDoc(myRef, { businessId: uid, role: myData.role || 'owner' }, { merge: true });
        myData = { ...myData, businessId: uid, role: myData.role || 'owner' };
    }

    const businessId = myData.businessId;
    const role = myData.role || 'owner';

    let ownerData = myData;
    if (businessId !== uid) {
        const ownerSnap = await getDoc(doc(db, 'users', businessId));
        ownerData = ownerSnap.exists() ? ownerSnap.data() : {};
    }

    let permissions;
    if (role === 'owner') {
        permissions = fullPermissions();
        // Best-effort: make sure this business's "Owner"/"Staff" system
        // roles exist so Settings > Roles & Permissions has something to
        // show. Fire-and-forget — never blocks or breaks sign-in.
        ensureSystemRoles(businessId).catch((err) => console.error('ensureSystemRoles failed:', err));
    } else {
        permissions = await resolvePermissions(myData.roleId);
    }

    cached = { uid, businessId, role, ownerData, roleId: myData.roleId || null, permissions };
    return cached;
}

/** Clears the in-memory cache — call after anything that changes businessId/role/plan mid-session. */
export function clearBusinessContextCache() {
    cached = null;
}
