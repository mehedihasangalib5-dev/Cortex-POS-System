// ---------------------------------------------------------------------------
// Custom roles & permissions.
//
// A "role" is a business-scoped set of module/action permissions:
// roles/{id} = { businessId, name, permissions: { [key]: bool }, isSystem, createdAt }.
//
// Every business gets two system roles the first time an owner loads any
// page (see business-context.js): "Owner" (always full access — hardcoded
// for the owner account regardless of this doc, so it exists mainly so it
// shows up consistently in the Roles & Permissions list) and "Staff"
// (full access by default too, matching how team members already behaved
// before this feature existed — see the note in resolvePermissions below).
// The business owner can then edit the "Staff" role's permissions and/or
// create additional custom roles (e.g. "Cashier") and assign them to
// individual teammates from Settings > Team.
// ---------------------------------------------------------------------------
import { db } from "./firebase-init.js";
import {
    collection, doc, addDoc, getDoc, getDocs, onSnapshot, query, where, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

export const PERMISSION_MODULES = [
    { key: 'pos', label: 'Point of Sale' },
    { key: 'inventory', label: 'Inventory' },
    { key: 'warehouses', label: 'Warehouses' },
    { key: 'customers', label: 'Customers' },
    { key: 'reports', label: 'Reports' },
    { key: 'hr-payroll', label: 'HR & Payroll' },
    { key: 'accounting', label: 'Accounting' },
    { key: 'ai-assistant', label: 'AI Assistant' },
];

export const EXTRA_PERMISSIONS = [
    { key: 'deleteRecords', label: 'Delete products & customers' },
];

export const ALL_PERMISSION_KEYS = [...PERMISSION_MODULES.map((m) => m.key), ...EXTRA_PERMISSIONS.map((p) => p.key)];

/** Every permission granted — the safe default (matches pre-feature behavior). */
export function fullPermissions() {
    const p = {};
    ALL_PERMISSION_KEYS.forEach((k) => { p[k] = true; });
    return p;
}

let ensureCache = null; // { businessId, ownerRoleId, staffRoleId }

/**
 * Guarantees the "Owner" and "Staff" system roles exist for a business.
 * Only the owner's writes will actually succeed (Firestore rules restrict
 * `roles` writes to myRole() == 'owner') — safe to call for anyone, it's a
 * no-op (caught upstream) for staff.
 */
export async function ensureSystemRoles(businessId) {
    if (ensureCache && ensureCache.businessId === businessId) return ensureCache;

    const snap = await getDocs(query(collection(db, 'roles'), where('businessId', '==', businessId), where('isSystem', '==', true)));
    let ownerDoc = snap.docs.find((d) => d.data().name === 'Owner');
    let staffDoc = snap.docs.find((d) => d.data().name === 'Staff');

    if (!ownerDoc) {
        const ref = await addDoc(collection(db, 'roles'), {
            businessId, name: 'Owner', permissions: fullPermissions(), isSystem: true, createdAt: serverTimestamp(),
        });
        ownerDoc = { id: ref.id };
    }
    if (!staffDoc) {
        const ref = await addDoc(collection(db, 'roles'), {
            businessId, name: 'Staff', permissions: fullPermissions(), isSystem: true, createdAt: serverTimestamp(),
        });
        staffDoc = { id: ref.id };
    }

    ensureCache = { businessId, ownerRoleId: ownerDoc.id, staffRoleId: staffDoc.id };
    return ensureCache;
}

/** Live subscription to a business's roles, sorted by name. Returns the unsubscribe function. */
export function subscribeRoles(businessId, callback) {
    const q = query(collection(db, 'roles'), where('businessId', '==', businessId), orderBy('name'));
    return onSnapshot(q, (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        callback(list);
    });
}

/**
 * Resolves the effective permission set for a signed-in STAFF user given
 * their roleId. Fails open (full access) if there's no roleId yet (legacy
 * teammates from before this feature) or the role doc can't be read — an
 * over-broad permission on a hiccup is much safer than accidentally locking
 * a paying business out of its own dashboard.
 */
export async function resolvePermissions(roleId) {
    if (!roleId) return fullPermissions();
    try {
        const snap = await getDoc(doc(db, 'roles', roleId));
        if (snap.exists() && snap.data().permissions) return snap.data().permissions;
    } catch (err) {
        console.error('Could not resolve role permissions, failing open:', err);
    }
    return fullPermissions();
}
