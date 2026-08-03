// ---------------------------------------------------------------------------
// Settings page.
//
// Business Profile: one doc per business at settings/{businessId} (used to
// be a single shared "settings/business" doc back when the whole platform
// was single-tenant — see README-firebase.md for the migration note).
//
// Billing & Plan: owner-only. "Switch to Starter/Pro" opens an in-page
// modal that submits a manual bKash/Nagad payment proof — the same flow
// and `orders` document shape as a brand-new signup (register-wizard.js).
// Only the owner can act here since billing always applies to the whole
// business, not the individual signed-in user.
//
// Team: owner-only invite flow. Inviting a teammate writes an `invites`
// doc; the teammate accepts it automatically the moment they register with
// that same email (see register-wizard.js) and joins as staff on this
// business — no new business, no separate trial/plan, same data. The
// number of active members + pending invites is capped by the plan's
// login limit (assets/js/plan-features.js), matching what pricing.html
// promises for each plan.
// ---------------------------------------------------------------------------
import { auth, db } from "./firebase-init.js";
import { requireAuth, toast, escapeHtml } from "./app-shell.js";
import { updateProfile } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
    doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where, limit, getDocs,
    serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { PAYMENT_METHODS, PLAN_PRICES } from "./payment-config.js";
import { loginLimitFor } from "./plan-features.js";
import { PERMISSION_MODULES, EXTRA_PERMISSIONS, ensureSystemRoles, subscribeRoles } from "./roles-utils.js";

const TRIAL_DAYS = 14;
const PLAN_LABEL = { trial: 'Free Trial', starter: 'Starter', pro: 'Pro', enterprise: 'Enterprise' };

let upgradePlanId = null;
let upgradeBillingCycle = 'monthly';
let upgradeMethod = PAYMENT_METHODS[0]?.id || 'bkash';
let currentBusinessId = null;
let currentRole = 'owner';
let allRoles = [];
let staffDefaultRoleId = null;

requireAuth(async (user, ctx) => {
    currentBusinessId = ctx.businessId;
    currentRole = ctx.role;

    document.getElementById('accName').value = user.displayName || '';
    document.getElementById('accEmail').value = user.email || '';

    await loadBillingStatus();
    applyOwnerOnlyUI();

    if (currentRole === 'owner') {
        try {
            const sys = await ensureSystemRoles(currentBusinessId);
            staffDefaultRoleId = sys.staffRoleId;
        } catch (err) {
            console.error('Could not set up default roles:', err);
        }
        subscribeRoles(currentBusinessId, (list) => {
            allRoles = list;
            renderRoles();
            populateInviteRoleSelect();
            loadTeam(); // re-render member rows with up-to-date role names now that roles are known
        });
        initRoles();
    }

    document.querySelectorAll('[data-plan-btn]').forEach((btn) => {
        btn.addEventListener('click', () => { if (currentRole === 'owner') openUpgradeModal(btn.dataset.planBtn); });
    });
    initUpgradeModal(user);

    try {
        const snap = await getDoc(doc(db, 'settings', currentBusinessId));
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

    await loadTeam();
    initTeam(user);

    document.getElementById('businessForm').addEventListener('submit', onSaveBusiness);
    document.getElementById('accountForm').addEventListener('submit', (e) => onSaveAccount(e, user));
});

function applyOwnerOnlyUI() {
    const isOwner = currentRole === 'owner';
    document.getElementById('billingOwnerOnlyNote').classList.toggle('hidden', isOwner);
    document.getElementById('teamInviteForm').classList.toggle('hidden', !isOwner);
    document.getElementById('teamStaffNote').classList.toggle('hidden', isOwner);
    document.getElementById('rolesSection').classList.toggle('hidden', !isOwner);
    if (!isOwner) {
        document.querySelectorAll('[data-plan-btn]').forEach((btn) => { btn.disabled = true; });
    }
}

async function hasPendingOrder(businessId) {
    const snap = await getDocs(query(
        collection(db, 'orders'),
        where('uid', '==', businessId),
        where('status', '==', 'pending_verification'),
        limit(1)
    ));
    return !snap.empty;
}

async function loadBillingStatus() {
    const badge = document.getElementById('planBadge');
    const statusText = document.getElementById('planStatusText');
    try {
        const ref = doc(db, 'users', currentBusinessId);
        const snap = await getDoc(ref);
        const data = snap.exists() ? snap.data() : {};
        const plan = data.plan || 'trial';
        const isExpired = plan !== 'trial' && data.planExpiresAt instanceof Timestamp && Date.now() >= data.planExpiresAt.toMillis();
        const pending = await hasPendingOrder(currentBusinessId);

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
            btn.disabled = isCurrent || pending || currentRole !== 'owner';
            btn.textContent = pending ? 'Review Pending' : (isCurrent ? 'Current Plan' : (isRenewable ? `Renew ${PLAN_LABEL[btn.dataset.planBtn]}` : `Switch to ${PLAN_LABEL[btn.dataset.planBtn]}`));
            btn.classList.toggle('opacity-60', isCurrent || pending);
        });

        return plan;
    } catch (err) {
        console.error(err);
        statusText.textContent = 'Could not load your plan status.';
        return 'trial';
    }
}

// ---------------------------------------------------------------------------
// Team — list current members, invite new ones, enforce the plan's login limit.
// ---------------------------------------------------------------------------
async function loadTeam() {
    const listEl = document.getElementById('teamMembersList');
    const countEl = document.getElementById('teamLoginCount');
    const limitNoteEl = document.getElementById('teamLimitNote');
    try {
        const [ownerSnap, membersSnap, invitesSnap] = await Promise.all([
            getDoc(doc(db, 'users', currentBusinessId)),
            getDocs(query(collection(db, 'users'), where('businessId', '==', currentBusinessId))),
            getDocs(query(collection(db, 'invites'), where('businessId', '==', currentBusinessId), where('status', '==', 'pending'))),
        ]);

        const plan = (ownerSnap.exists() && ownerSnap.data().plan) || 'trial';
        const limit = loginLimitFor(plan);
        const members = membersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const invites = invitesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const usedSeats = members.length + invites.length;

        countEl.textContent = limit === null ? `${usedSeats} logins` : `${usedSeats} of ${limit} logins used`;

        listEl.innerHTML = members
            .sort((a, b) => (a.role === 'owner' ? -1 : 1) - (b.role === 'owner' ? -1 : 1))
            .map((m) => {
                if (m.role === 'owner') {
                    return `
                    <div class="flex items-center justify-between gap-3 py-2 border-b" style="border-color:var(--border-subtle)">
                        <div>
                            <p class="text-sm font-medium">${escapeHtml(m.name || m.email || 'Unknown')} ${m.id === auth.currentUser.uid ? '<span style="color:var(--text-secondary)">(you)</span>' : ''}</p>
                            <p class="text-xs" style="color:var(--text-secondary)">${escapeHtml(m.email || '')}</p>
                        </div>
                        <span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">Owner</span>
                    </div>`;
                }
                const roleName = allRoles.find((r) => r.id === m.roleId)?.name || 'Staff';
                const roleSelect = currentRole === 'owner' && allRoles.length
                    ? `<select class="input-field !w-auto !py-1 !text-xs" data-member-role="${m.id}">
                         ${allRoles.map((r) => `<option value="${r.id}" ${(m.roleId || staffDefaultRoleId) === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('')}
                       </select>`
                    : `<span class="text-xs font-semibold px-2 py-0.5 rounded-full" style="background:var(--bg-surface-alt); color:var(--text-secondary)">${escapeHtml(roleName)}</span>`;
                return `
                <div class="flex items-center justify-between gap-3 py-2 border-b" style="border-color:var(--border-subtle)">
                    <div>
                        <p class="text-sm font-medium">${escapeHtml(m.name || m.email || 'Unknown')} ${m.id === auth.currentUser.uid ? '<span style="color:var(--text-secondary)">(you)</span>' : ''}</p>
                        <p class="text-xs" style="color:var(--text-secondary)">${escapeHtml(m.email || '')}</p>
                    </div>
                    <div class="flex items-center gap-2">
                        ${roleSelect}
                        ${currentRole === 'owner' ? `<button class="h-7 w-7 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500" data-remove-member="${m.id}" title="Remove"><i class="fa-solid fa-user-minus text-xs"></i></button>` : ''}
                    </div>
                </div>`;
            }).join('') + invites.map((inv) => `
                <div class="flex items-center justify-between gap-3 py-2 border-b" style="border-color:var(--border-subtle)">
                    <div>
                        <p class="text-sm font-medium">${escapeHtml(inv.email)}</p>
                        <p class="text-xs" style="color:var(--text-secondary)">Invited — waiting for them to sign up</p>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-semibold px-2 py-0.5 rounded-full" style="background:#F5A62322; color:#F5A623">Pending</span>
                        ${currentRole === 'owner' ? `<button class="h-7 w-7 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500" data-cancel-invite="${inv.id}" title="Cancel invite"><i class="fa-solid fa-xmark text-xs"></i></button>` : ''}
                    </div>
                </div>
            `).join('');

        const inviteBtn = document.getElementById('teamInviteBtn');
        const atLimit = limit !== null && usedSeats >= limit;
        inviteBtn.disabled = atLimit;
        limitNoteEl.classList.toggle('hidden', !atLimit);
        if (atLimit) {
            limitNoteEl.innerHTML = `You\u2019ve used all ${limit} logins on the ${PLAN_LABEL[plan] || plan} plan. <a href="#" class="text-primary font-medium" id="teamLimitUpgradeLink">Upgrade</a> to invite more.`;
            document.getElementById('teamLimitUpgradeLink')?.addEventListener('click', (e) => {
                e.preventDefault();
                openUpgradeModal(plan === 'starter' ? 'pro' : 'starter');
            });
        }
    } catch (err) {
        console.error(err);
        listEl.innerHTML = '<p class="text-sm text-red-500">Could not load team members.</p>';
    }
}

function initTeam(user) {
    document.getElementById('teamInviteForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('teamError');
        const okEl = document.getElementById('teamInviteSuccess');
        errEl.classList.add('hidden');
        okEl.classList.add('hidden');

        const email = document.getElementById('teamInviteEmail').value.trim().toLowerCase();
        if (!email) return;
        if (email === user.email.toLowerCase()) {
            errEl.textContent = "That's your own email — invite a teammate's email instead.";
            errEl.classList.remove('hidden');
            return;
        }

        const btn = document.getElementById('teamInviteBtn');
        btn.disabled = true;
        btn.textContent = 'Sending...';
        try {
            // Re-check the limit right before writing — loadTeam() already
            // disables the button when at capacity, but plans/members can
            // change between page load and submit.
            const [ownerSnap, membersSnap, invitesSnap, existingInviteSnap] = await Promise.all([
                getDoc(doc(db, 'users', currentBusinessId)),
                getDocs(query(collection(db, 'users'), where('businessId', '==', currentBusinessId))),
                getDocs(query(collection(db, 'invites'), where('businessId', '==', currentBusinessId), where('status', '==', 'pending'))),
                getDocs(query(collection(db, 'invites'), where('businessId', '==', currentBusinessId), where('email', '==', email), where('status', '==', 'pending'), limit(1))),
            ]);
            const plan = (ownerSnap.exists() && ownerSnap.data().plan) || 'trial';
            const loginLimit = loginLimitFor(plan);
            const usedSeats = membersSnap.size + invitesSnap.size;

            if (!existingInviteSnap.empty) {
                errEl.textContent = 'An invite is already pending for that email.';
                errEl.classList.remove('hidden');
                return;
            }
            if (loginLimit !== null && usedSeats >= loginLimit) {
                errEl.textContent = `Your ${PLAN_LABEL[plan] || plan} plan allows up to ${loginLimit} logins. Upgrade to invite more teammates.`;
                errEl.classList.remove('hidden');
                return;
            }

            await addDoc(collection(db, 'invites'), {
                businessId: currentBusinessId,
                email,
                role: 'staff',
                roleId: document.getElementById('teamInviteRole').value || staffDefaultRoleId || null,
                status: 'pending',
                invitedBy: user.uid,
                createdAt: serverTimestamp(),
            });
            document.getElementById('teamInviteForm').reset();
            okEl.textContent = `Invite sent. ${email} can now sign up with that email at register.html and they'll join your business automatically.`;
            okEl.classList.remove('hidden');
            toast('Invite sent');
            await loadTeam();
        } catch (err) {
            console.error(err);
            errEl.textContent = 'Could not send the invite. Please try again.';
            errEl.classList.remove('hidden');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Send Invite';
        }
    });

    document.getElementById('teamMembersList').addEventListener('click', async (e) => {
        const cancelBtn = e.target.closest('[data-cancel-invite]');
        const removeBtn = e.target.closest('[data-remove-member]');
        if (cancelBtn) {
            if (!confirm('Cancel this invite?')) return;
            try {
                await deleteDoc(doc(db, 'invites', cancelBtn.getAttribute('data-cancel-invite')));
                toast('Invite cancelled');
                await loadTeam();
            } catch (err) {
                console.error(err);
                toast('Could not cancel invite', 'error');
            }
        }
        if (removeBtn) {
            if (!confirm('Remove this teammate? They will lose access immediately.')) return;
            try {
                // Removing a teammate deletes their users/{uid} doc — they
                // stay a valid Firebase Auth login, but with no businessId
                // they have no business to see, so app-shell.js's guard
                // will just bounce them back to a blank/locked state.
                await deleteDoc(doc(db, 'users', removeBtn.getAttribute('data-remove-member')));
                toast('Teammate removed');
                await loadTeam();
            } catch (err) {
                console.error(err);
                toast('Could not remove teammate', 'error');
            }
        }
    });

    document.getElementById('teamMembersList').addEventListener('change', async (e) => {
        const sel = e.target.closest('[data-member-role]');
        if (!sel) return;
        try {
            await setDoc(doc(db, 'users', sel.getAttribute('data-member-role')), { roleId: sel.value }, { merge: true });
            toast('Role updated');
        } catch (err) {
            console.error(err);
            toast('Could not update role', 'error');
            await loadTeam();
        }
    });
}

function populateInviteRoleSelect() {
    const sel = document.getElementById('teamInviteRole');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = allRoles.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
    sel.value = current && allRoles.some((r) => r.id === current) ? current : (staffDefaultRoleId || '');
}

// ---------------------------------------------------------------------------
// Roles & Permissions — owner-only. Two system roles (Owner/Staff) always
// exist; the owner can edit Staff's permissions and add custom roles.
// ---------------------------------------------------------------------------
function permissionSummary(perms) {
    if (!perms) return 'Full access';
    const grantedModules = PERMISSION_MODULES.filter((m) => perms[m.key] !== false).map((m) => m.label);
    if (grantedModules.length === PERMISSION_MODULES.length) return 'Full page access';
    if (grantedModules.length === 0) return 'No page access';
    return grantedModules.join(', ');
}

function renderRoles() {
    const el = document.getElementById('rolesList');
    if (!allRoles.length) {
        el.innerHTML = '<p class="text-sm" style="color:var(--text-secondary)">Setting up default roles...</p>';
        return;
    }
    el.innerHTML = allRoles.map((r) => `
        <div class="flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg" style="background:var(--bg-surface-alt)">
            <div class="min-w-0">
                <p class="text-sm font-medium">${escapeHtml(r.name)} ${r.isSystem ? `<span class="text-xs font-normal" style="color:var(--text-secondary)">(built-in)</span>` : ''}</p>
                <p class="text-xs truncate" style="color:var(--text-secondary)">${escapeHtml(permissionSummary(r.permissions))}</p>
            </div>
            <div class="flex items-center gap-1 shrink-0">
                ${r.name === 'Owner' ? '' : `<button class="h-7 w-7 rounded-lg hover:bg-black/5 dark:hover:bg-white/5" data-edit-role="${r.id}" title="Edit"><i class="fa-solid fa-pen text-xs"></i></button>`}
                ${!r.isSystem ? `<button class="h-7 w-7 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500" data-del-role="${r.id}" data-role-name="${escapeHtml(r.name)}" title="Delete"><i class="fa-solid fa-trash text-xs"></i></button>` : ''}
            </div>
        </div>
    `).join('');
}

function buildPermCheckboxes(containerId, list, permissions) {
    const container = document.getElementById(containerId);
    container.innerHTML = list.map((item) => `
        <label class="flex items-center gap-2 text-sm" style="color:var(--text-secondary)">
            <input type="checkbox" data-perm="${item.key}" ${!permissions || permissions[item.key] !== false ? 'checked' : ''}/> ${escapeHtml(item.label)}
        </label>
    `).join('');
}

function openRoleModal(role) {
    const form = document.getElementById('roleForm');
    form.reset();
    document.getElementById('roleFormError').classList.add('hidden');
    document.getElementById('roleId').value = role?.id || '';
    document.getElementById('roleName').value = role?.name || '';
    document.getElementById('roleName').disabled = !!role?.isSystem;
    document.getElementById('roleModalTitle').textContent = role ? `Edit ${role.name} Role` : 'Add Role';
    buildPermCheckboxes('rolePagePerms', PERMISSION_MODULES, role?.permissions);
    buildPermCheckboxes('roleExtraPerms', EXTRA_PERMISSIONS, role?.permissions);
    document.getElementById('roleModal').classList.remove('hidden');
    document.getElementById('roleModal').classList.add('flex');
}

function closeRoleModal() {
    document.getElementById('roleModal').classList.add('hidden');
    document.getElementById('roleModal').classList.remove('flex');
}

function initRoles() {
    document.getElementById('addRoleBtn').addEventListener('click', () => openRoleModal(null));
    document.getElementById('closeRoleModal').addEventListener('click', closeRoleModal);
    document.getElementById('roleModal').addEventListener('click', (e) => { if (e.target.id === 'roleModal') closeRoleModal(); });

    document.getElementById('roleForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('roleFormError');
        errEl.classList.add('hidden');
        const btn = document.getElementById('roleSubmitBtn');
        btn.disabled = true;
        btn.textContent = 'Saving...';

        const id = document.getElementById('roleId').value;
        const permissions = {};
        [...PERMISSION_MODULES, ...EXTRA_PERMISSIONS].forEach((item) => {
            permissions[item.key] = document.querySelector(`#roleForm [data-perm="${item.key}"]`).checked;
        });

        try {
            if (id) {
                const existing = allRoles.find((r) => r.id === id);
                const payload = { permissions };
                if (!existing?.isSystem) payload.name = document.getElementById('roleName').value.trim();
                await updateDoc(doc(db, 'roles', id), payload);
                toast('Role updated');
            } else {
                await addDoc(collection(db, 'roles'), {
                    businessId: currentBusinessId,
                    name: document.getElementById('roleName').value.trim(),
                    permissions,
                    isSystem: false,
                    createdAt: serverTimestamp(),
                });
                toast('Role created');
            }
            closeRoleModal();
        } catch (err) {
            console.error(err);
            errEl.textContent = 'Could not save this role. Please try again.';
            errEl.classList.remove('hidden');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Save Role';
        }
    });

    document.getElementById('rolesList').addEventListener('click', async (e) => {
        const editBtn = e.target.closest('[data-edit-role]');
        const delBtn = e.target.closest('[data-del-role]');
        if (editBtn) openRoleModal(allRoles.find((r) => r.id === editBtn.dataset.editRole));
        if (delBtn) {
            const id = delBtn.dataset.delRole;
            const name = delBtn.dataset.roleName;
            try {
                const inUse = await getDocs(query(collection(db, 'users'), where('businessId', '==', currentBusinessId), where('roleId', '==', id), limit(1)));
                if (!inUse.empty) {
                    toast(`Reassign teammates using "${name}" to a different role first`, 'error');
                    return;
                }
            } catch (err) {
                console.error(err);
                toast('Could not check if this role is in use', 'error');
                return;
            }
            if (!confirm(`Delete the "${name}" role?`)) return;
            try {
                await deleteDoc(doc(db, 'roles', id));
                toast('Role deleted');
            } catch (err) {
                console.error(err);
                toast('Could not delete role', 'error');
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Upgrade modal — manual bKash/Nagad payment proof for an existing account.
// Owner-only (buttons that open this are disabled for staff — see above).
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
    if (currentRole !== 'owner') return;
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
                uid: currentBusinessId,
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
            await loadBillingStatus();
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
        await setDoc(doc(db, 'settings', currentBusinessId), {
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
