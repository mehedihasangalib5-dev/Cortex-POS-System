// ---------------------------------------------------------------------------
// Warehouses page: manage locations (add/edit/delete/set default) and move
// stock between them. See warehouse-utils.js for the shared data model
// notes (products/{id}.stock stays the authoritative TOTAL; stockByWarehouse
// holds the per-location breakdown).
// ---------------------------------------------------------------------------
import { db } from "./firebase-init.js";
import { requireAuth, escapeHtml, toast } from "./app-shell.js";
import {
    collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, runTransaction,
    serverTimestamp, query, where, orderBy, limit, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { warehouseLimitFor } from "./plan-features.js";
import { ensureDefaultWarehouse, resolveStockMap, sumStock } from "./warehouse-utils.js";

let businessId = null;
let currentPlan = 'trial';
let allWarehouses = [];
let allProducts = [];
let defaultWarehouseId = null;

requireAuth(async (user, ctx) => {
    businessId = ctx.businessId;
    currentPlan = ctx.ownerData?.plan || 'trial';

    defaultWarehouseId = await ensureDefaultWarehouse(businessId);

    onSnapshot(query(collection(db, 'warehouses'), where('businessId', '==', businessId), orderBy('name')), (snap) => {
        allWarehouses = [];
        snap.forEach((d) => allWarehouses.push({ id: d.id, ...d.data() }));
        renderWarehouses();
        populateTransferSelects();
    }, (err) => {
        console.error(err);
        document.getElementById('warehouseTableBody').innerHTML =
            `<tr><td class="px-4 py-6 text-center text-red-500" colspan="4">Could not load warehouses — check Firestore rules.</td></tr>`;
    });

    onSnapshot(query(collection(db, 'products'), where('businessId', '==', businessId), orderBy('name')), (snap) => {
        allProducts = [];
        snap.forEach((d) => allProducts.push({ id: d.id, ...d.data() }));
        populateProductSelect();
    });

    onSnapshot(query(collection(db, 'stockTransfers'), where('businessId', '==', businessId), orderBy('createdAt', 'desc'), limit(50)), (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
        renderTransfers(rows);
    }, (err) => {
        console.error(err);
        document.getElementById('transferTableBody').innerHTML =
            `<tr><td class="px-4 py-6 text-center text-red-500" colspan="6">Could not load transfers.</td></tr>`;
    });

    document.getElementById('addWarehouseBtn').addEventListener('click', () => openWarehouseModal());
    document.getElementById('closeWarehouseModal').addEventListener('click', closeWarehouseModal);
    document.getElementById('warehouseModal').addEventListener('click', (e) => { if (e.target.id === 'warehouseModal') closeWarehouseModal(); });
    document.getElementById('warehouseForm').addEventListener('submit', onSubmitWarehouse);

    document.getElementById('warehouseTableBody').addEventListener('click', (e) => {
        const editBtn = e.target.closest('[data-edit]');
        const delBtn = e.target.closest('[data-del]');
        const defBtn = e.target.closest('[data-setdefault]');
        if (editBtn) openWarehouseModal(allWarehouses.find((w) => w.id === editBtn.dataset.edit));
        if (delBtn) onDeleteWarehouse(delBtn.dataset.del, delBtn.dataset.name);
        if (defBtn) onSetDefault(defBtn.dataset.setdefault);
    });

    document.getElementById('transferStockBtn').addEventListener('click', () => openTransferModal());
    document.getElementById('closeTransferModal').addEventListener('click', closeTransferModal);
    document.getElementById('transferModal').addEventListener('click', (e) => { if (e.target.id === 'transferModal') closeTransferModal(); });
    document.getElementById('transferForm').addEventListener('submit', onSubmitTransfer);
    document.getElementById('tProduct').addEventListener('change', updateAvailableLabel);
    document.getElementById('tFrom').addEventListener('change', updateAvailableLabel);
});

// ---- Warehouse list -------------------------------------------------------

function renderWarehouses() {
    const tbody = document.getElementById('warehouseTableBody');
    const limitVal = warehouseLimitFor(currentPlan);
    document.getElementById('warehouseLimitLabel').textContent = limitVal === null
        ? `${allWarehouses.length} warehouse${allWarehouses.length === 1 ? '' : 's'} · unlimited on your plan`
        : `${allWarehouses.length} of ${limitVal} warehouse${limitVal === 1 ? '' : 's'} used on your plan — see Settings > Billing & Plan to upgrade.`;

    if (allWarehouses.length === 0) {
        tbody.innerHTML = `<tr><td class="px-4 py-8 text-center" colspan="4" style="color:var(--text-secondary)">No warehouses yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = allWarehouses.map((w) => `
        <tr class="border-b" style="border-color:var(--border-subtle)">
            <td class="px-4 py-3 font-medium">${escapeHtml(w.name || '')}</td>
            <td class="px-4 py-3" style="color:var(--text-secondary)">${escapeHtml(w.address || '—')}</td>
            <td class="px-4 py-3">${w.isDefault
                ? '<span class="text-xs font-semibold px-2 py-1 rounded-full bg-primary/10 text-primary">Default</span>'
                : `<button class="text-xs font-medium hover:underline" style="color:var(--text-secondary)" data-setdefault="${w.id}" type="button">Set as default</button>`}
            </td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
                <button class="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5" data-edit="${w.id}" title="Edit"><i class="fa-solid fa-pen text-xs"></i></button>
                <button class="h-8 w-8 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500" data-del="${w.id}" data-name="${escapeHtml(w.name || '')}" title="Delete"><i class="fa-solid fa-trash text-xs"></i></button>
            </td>
        </tr>
    `).join('');
}

function openWarehouseModal(warehouse) {
    const form = document.getElementById('warehouseForm');
    form.reset();
    document.getElementById('warehouseFormError').classList.add('hidden');
    if (warehouse) {
        document.getElementById('warehouseModalTitle').textContent = 'Edit Warehouse';
        document.getElementById('warehouseId').value = warehouse.id;
        document.getElementById('wName').value = warehouse.name || '';
        document.getElementById('wAddress').value = warehouse.address || '';
        document.getElementById('wIsDefault').checked = !!warehouse.isDefault;
        document.getElementById('wIsDefault').disabled = !!warehouse.isDefault; // already default — nothing to toggle here
    } else {
        document.getElementById('warehouseModalTitle').textContent = 'Add Warehouse';
        document.getElementById('warehouseId').value = '';
        document.getElementById('wIsDefault').disabled = false;
    }
    document.getElementById('warehouseModal').classList.remove('hidden');
    document.getElementById('warehouseModal').classList.add('flex');
}

function closeWarehouseModal() {
    document.getElementById('warehouseModal').classList.add('hidden');
    document.getElementById('warehouseModal').classList.remove('flex');
}

async function onSubmitWarehouse(e) {
    e.preventDefault();
    const errEl = document.getElementById('warehouseFormError');
    errEl.classList.add('hidden');
    const btn = document.getElementById('warehouseSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const id = document.getElementById('warehouseId').value;
    const makeDefault = document.getElementById('wIsDefault').checked && !document.getElementById('wIsDefault').disabled;

    if (!id) {
        const limitVal = warehouseLimitFor(currentPlan);
        if (limitVal !== null && allWarehouses.length >= limitVal) {
            errEl.textContent = `Your plan allows up to ${limitVal} warehouse${limitVal === 1 ? '' : 's'}. Upgrade to add more — see Settings > Billing & Plan.`;
            errEl.classList.remove('hidden');
            btn.disabled = false;
            btn.textContent = 'Save Warehouse';
            return;
        }
    }

    const payload = {
        businessId,
        name: document.getElementById('wName').value.trim(),
        address: document.getElementById('wAddress').value.trim(),
        updatedAt: serverTimestamp(),
    };

    try {
        if (id) {
            await updateDoc(doc(db, 'warehouses', id), payload);
            if (makeDefault) await setDefaultWarehouse(id);
            toast('Warehouse updated');
        } else {
            payload.isDefault = allWarehouses.length === 0; // first warehouse is always default
            payload.createdAt = serverTimestamp();
            const ref = await addDoc(collection(db, 'warehouses'), payload);
            if (makeDefault && !payload.isDefault) await setDefaultWarehouse(ref.id);
            toast('Warehouse added');
        }
        closeWarehouseModal();
    } catch (err) {
        console.error(err);
        errEl.textContent = 'Could not save warehouse. Please try again.';
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Warehouse';
    }
}

async function setDefaultWarehouse(id) {
    const batch = writeBatch(db);
    allWarehouses.forEach((w) => {
        if (w.isDefault && w.id !== id) batch.update(doc(db, 'warehouses', w.id), { isDefault: false });
    });
    batch.update(doc(db, 'warehouses', id), { isDefault: true });
    await batch.commit();
}

async function onSetDefault(id) {
    try {
        await setDefaultWarehouse(id);
        toast('Default warehouse updated');
    } catch (err) {
        console.error(err);
        toast('Could not update default warehouse', 'error');
    }
}

async function onDeleteWarehouse(id, name) {
    const w = allWarehouses.find((x) => x.id === id);
    if (w?.isDefault) { toast('Set a different warehouse as default before deleting this one', 'error'); return; }
    if (allWarehouses.length <= 1) { toast('You need at least one warehouse', 'error'); return; }

    // Guard: don't delete a warehouse that still holds stock somewhere.
    const stillHasStock = allProducts.some((p) => {
        const map = resolveStockMap(p, defaultWarehouseId);
        return (Number(map[id]) || 0) > 0;
    });
    if (stillHasStock) {
        toast('Transfer out all remaining stock before deleting this warehouse', 'error');
        return;
    }

    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
        await deleteDoc(doc(db, 'warehouses', id));
        toast('Warehouse deleted');
    } catch (err) {
        console.error(err);
        toast('Could not delete warehouse', 'error');
    }
}

// ---- Stock transfers --------------------------------------------------

function renderTransfers(rows) {
    const tbody = document.getElementById('transferTableBody');
    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td class="px-4 py-8 text-center" colspan="6" style="color:var(--text-secondary)">No stock transfers yet.</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map((t) => {
        const d = t.createdAt?.toDate ? t.createdAt.toDate() : null;
        const dateStr = d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
        return `
        <tr class="border-b" style="border-color:var(--border-subtle)">
            <td class="px-4 py-3 whitespace-nowrap" style="color:var(--text-secondary)">${dateStr}</td>
            <td class="px-4 py-3 font-medium">${escapeHtml(t.productName || '')}</td>
            <td class="px-4 py-3">${escapeHtml(t.fromWarehouseName || '')}</td>
            <td class="px-4 py-3">${escapeHtml(t.toWarehouseName || '')}</td>
            <td class="px-4 py-3 text-right font-mono-fig">${Number(t.qty) || 0}</td>
            <td class="px-4 py-3" style="color:var(--text-secondary)">${escapeHtml(t.note || '—')}</td>
        </tr>`;
    }).join('');
}

function populateProductSelect() {
    const sel = document.getElementById('tProduct');
    const current = sel.value;
    sel.innerHTML = allProducts.map((p) => `<option value="${p.id}">${escapeHtml(p.name || '')}${p.sku ? ` (${escapeHtml(p.sku)})` : ''}</option>`).join('');
    if (current) sel.value = current;
    updateAvailableLabel();
}

function populateTransferSelects() {
    const opts = allWarehouses.map((w) => `<option value="${w.id}">${escapeHtml(w.name || '')}</option>`).join('');
    const from = document.getElementById('tFrom');
    const to = document.getElementById('tTo');
    const fromCur = from.value, toCur = to.value;
    from.innerHTML = opts;
    to.innerHTML = opts;
    if (fromCur) from.value = fromCur;
    if (toCur) to.value = toCur;
    updateAvailableLabel();
}

function openTransferModal(productId) {
    document.getElementById('transferForm').reset();
    document.getElementById('transferFormError').classList.add('hidden');
    if (productId) document.getElementById('tProduct').value = productId;
    updateAvailableLabel();
    document.getElementById('transferModal').classList.remove('hidden');
    document.getElementById('transferModal').classList.add('flex');
}

function closeTransferModal() {
    document.getElementById('transferModal').classList.add('hidden');
    document.getElementById('transferModal').classList.remove('flex');
}

function updateAvailableLabel() {
    const label = document.getElementById('tAvailableLabel');
    const p = allProducts.find((x) => x.id === document.getElementById('tProduct').value);
    const fromId = document.getElementById('tFrom').value;
    if (!p || !fromId) { label.textContent = ''; return; }
    const map = resolveStockMap(p, defaultWarehouseId);
    label.textContent = `Available in selected source: ${Number(map[fromId]) || 0} ${escapeHtml(p.unit || 'pcs')}`;
}

async function onSubmitTransfer(e) {
    e.preventDefault();
    const errEl = document.getElementById('transferFormError');
    errEl.classList.add('hidden');

    const productId = document.getElementById('tProduct').value;
    const fromId = document.getElementById('tFrom').value;
    const toId = document.getElementById('tTo').value;
    const qty = Number(document.getElementById('tQty').value) || 0;
    const note = document.getElementById('tNote').value.trim();

    if (!productId || !fromId || !toId) { errEl.textContent = 'Please select a product and both warehouses.'; errEl.classList.remove('hidden'); return; }
    if (fromId === toId) { errEl.textContent = 'Source and destination warehouses must be different.'; errEl.classList.remove('hidden'); return; }
    if (qty <= 0) { errEl.textContent = 'Quantity must be greater than zero.'; errEl.classList.remove('hidden'); return; }

    const btn = document.getElementById('transferSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Transferring...';

    try {
        const productRef = doc(db, 'products', productId);
        await runTransaction(db, async (tx) => {
            const snap = await tx.get(productRef);
            if (!snap.exists()) throw new Error('Product no longer exists.');
            const data = snap.data();
            const map = resolveStockMap(data, defaultWarehouseId);
            const available = Number(map[fromId]) || 0;
            if (available < qty) throw new Error(`Only ${available} available in the source warehouse.`);

            map[fromId] = available - qty;
            map[toId] = (Number(map[toId]) || 0) + qty;

            tx.update(productRef, { stockByWarehouse: map, stock: sumStock(map) });

            const from = allWarehouses.find((w) => w.id === fromId);
            const to = allWarehouses.find((w) => w.id === toId);
            const transferRef = doc(collection(db, 'stockTransfers'));
            tx.set(transferRef, {
                businessId,
                productId,
                productName: data.name || '',
                fromWarehouseId: fromId,
                fromWarehouseName: from?.name || '',
                toWarehouseId: toId,
                toWarehouseName: to?.name || '',
                qty,
                note,
                createdAt: serverTimestamp(),
            });
        });

        toast('Stock transferred');
        closeTransferModal();
    } catch (err) {
        console.error(err);
        errEl.textContent = err.message || 'Transfer failed. Please try again.';
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Transfer Stock';
    }
}
