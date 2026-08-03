// ---------------------------------------------------------------------------
// Inventory page: live product list (onSnapshot), add / edit / delete
// products, client-side search + low-stock filter.
// ---------------------------------------------------------------------------
import { db } from "./firebase-init.js";
import { requireAuth, escapeHtml, formatTaka, toast } from "./app-shell.js";
import { exportTableToPdf, exportTableToExcel, pdfMoney } from "./export-utils.js";
import {
    collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy, query, where,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { productLimitFor } from "./plan-features.js";
import { ensureDefaultWarehouse, subscribeWarehouses, resolveStockMap, sumStock } from "./warehouse-utils.js";

let allProducts = [];
let searchTerm = '';
let lowStockOnly = false;
let businessId = null;
let businessName = 'CorPOS & IMS';
let currentPlan = 'trial';
let allWarehouses = [];
let defaultWarehouseId = null;
let warehouseFilter = ''; // '' = all warehouses combined
let canDelete = true;

requireAuth(async (user, ctx) => {
    businessId = ctx.businessId;
    businessName = ctx.ownerData?.businessName || businessName;
    currentPlan = ctx.ownerData?.plan || 'trial';
    canDelete = ctx.permissions ? ctx.permissions.deleteRecords !== false : true;
    defaultWarehouseId = await ensureDefaultWarehouse(businessId);

    subscribeWarehouses(businessId, (list) => {
        allWarehouses = list;
        populateWarehouseFilter();
        render();
    });

    document.getElementById('warehouseFilter').addEventListener('change', (e) => {
        warehouseFilter = e.target.value;
        render();
    });

    const q = query(collection(db, 'products'), where('businessId', '==', businessId), orderBy('name'));
    onSnapshot(q, (snap) => {
        allProducts = [];
        snap.forEach((docSnap) => allProducts.push({ id: docSnap.id, ...docSnap.data() }));
        render();
    }, (err) => {
        console.error(err);
        document.getElementById('productTableBody').innerHTML =
            `<tr><td class="px-4 py-6 text-center text-red-500" colspan="7">Could not load products — check Firestore rules.</td></tr>`;
    });

    document.getElementById('productSearch').addEventListener('input', (e) => {
        searchTerm = e.target.value.trim().toLowerCase();
        render();
    });
    document.getElementById('lowStockFilter').addEventListener('change', (e) => {
        lowStockOnly = e.target.checked;
        render();
    });

    document.getElementById('addProductBtn').addEventListener('click', () => openModal());
    document.getElementById('closeProductModal').addEventListener('click', closeModal);
    document.getElementById('productModal').addEventListener('click', (e) => {
        if (e.target.id === 'productModal') closeModal();
    });
    document.getElementById('productForm').addEventListener('submit', onSubmit);

    document.getElementById('productTableBody').addEventListener('click', (e) => {
        const editBtn = e.target.closest('[data-edit]');
        const delBtn = e.target.closest('[data-del]');
        if (editBtn) openModal(allProducts.find((p) => p.id === editBtn.dataset.edit));
        if (delBtn) onDelete(delBtn.dataset.del, delBtn.dataset.name);
    });

    document.getElementById('exportInventoryPdfBtn').addEventListener('click', exportInventoryPdf);
    document.getElementById('exportInventoryExcelBtn').addEventListener('click', exportInventoryExcel);
});

function populateWarehouseFilter() {
    const sel = document.getElementById('warehouseFilter');
    const current = sel.value;
    sel.innerHTML = '<option value="">All Warehouses</option>' +
        allWarehouses.map((w) => `<option value="${w.id}">${escapeHtml(w.name || '')}</option>`).join('');
    sel.value = current && allWarehouses.some((w) => w.id === current) ? current : '';
    warehouseFilter = sel.value;
}

/** Stock count to display/compare for a product, respecting the current warehouse filter. */
function stockFor(p) {
    if (!warehouseFilter) return Number(p.stock) || 0;
    const map = resolveStockMap(p, defaultWarehouseId);
    return Number(map[warehouseFilter]) || 0;
}

function isLow(p) {
    const threshold = Number(p.lowStockThreshold) || 5;
    return stockFor(p) <= threshold;
}

/** The currently visible product list, respecting search + low-stock + warehouse filters. Shared by render() and the exports so "export" always means "export what I'm looking at". */
function filteredProducts() {
    let list = allProducts;
    if (searchTerm) {
        list = list.filter((p) =>
            (p.name || '').toLowerCase().includes(searchTerm) ||
            (p.sku || '').toLowerCase().includes(searchTerm));
    }
    if (lowStockOnly) list = list.filter(isLow);
    return list;
}

function render() {
    const tbody = document.getElementById('productTableBody');
    const list = filteredProducts();

    document.getElementById('productCountLabel').textContent =
        `${list.length} of ${allProducts.length} product${allProducts.length === 1 ? '' : 's'}`;

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td class="px-4 py-8 text-center" colspan="7" style="color:var(--text-secondary)">
            ${allProducts.length === 0 ? 'No products yet — click "Add Product" to get started.' : 'No products match your filter.'}
        </td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((p) => `
        <tr class="border-b" style="border-color:var(--border-subtle)">
            <td class="px-4 py-3 font-medium">${escapeHtml(p.name || '')}</td>
            <td class="px-4 py-3 font-mono-fig" style="color:var(--text-secondary)">${escapeHtml(p.sku || '—')}</td>
            <td class="px-4 py-3" style="color:var(--text-secondary)">${escapeHtml(p.category || '—')}</td>
            <td class="px-4 py-3 text-right font-mono-fig">${formatTaka(p.costPrice)}</td>
            <td class="px-4 py-3 text-right font-mono-fig font-semibold">${formatTaka(p.sellPrice)}</td>
            <td class="px-4 py-3 text-right">
                <span class="font-mono-fig font-semibold ${isLow(p) ? 'text-red-500' : ''}">${stockFor(p)}</span>
                <span class="text-xs" style="color:var(--text-secondary)"> ${escapeHtml(p.unit || 'pcs')}</span>
                ${isLow(p) ? '<i class="fa-solid fa-triangle-exclamation text-amber ml-1" title="Low stock"></i>' : ''}
            </td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
                <button class="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5" data-edit="${p.id}" title="Edit"><i class="fa-solid fa-pen text-xs"></i></button>
                ${canDelete ? `<button class="h-8 w-8 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500" data-del="${p.id}" data-name="${escapeHtml(p.name || '')}" title="Delete"><i class="fa-solid fa-trash text-xs"></i></button>` : ''}
            </td>
        </tr>
    `).join('');
}

function buildStockFields(product) {
    const simpleWrap = document.getElementById('stockSimpleWrap');
    const multiWrap = document.getElementById('stockMultiWrap');
    const stockMap = product ? resolveStockMap(product, defaultWarehouseId) : {};

    if (allWarehouses.length <= 1) {
        simpleWrap.classList.remove('hidden');
        multiWrap.classList.add('hidden');
        multiWrap.innerHTML = '<label class="block text-sm font-medium mb-1">Stock by Warehouse</label>';
        document.getElementById('pStock').removeAttribute('data-warehouse');
        document.getElementById('pStock').required = true;
        document.getElementById('pStock').value = product ? (Number(product.stock) || 0) : 0;
        return;
    }

    simpleWrap.classList.add('hidden');
    document.getElementById('pStock').required = false;
    multiWrap.classList.remove('hidden');
    multiWrap.innerHTML = '<label class="block text-sm font-medium mb-1">Stock by Warehouse</label>' +
        allWarehouses.map((w) => `
            <div class="flex items-center justify-between gap-2">
                <span class="text-sm flex-1 truncate" style="color:var(--text-secondary)">${escapeHtml(w.name || '')}${w.isDefault ? ' (default)' : ''}</span>
                <input class="input-field !w-24 !py-1.5 text-right" data-wstock="${w.id}" min="0" step="1" type="number" value="${Number(stockMap[w.id]) || 0}"/>
            </div>
        `).join('') +
        `<div class="flex items-center justify-between gap-2 pt-1 text-sm font-semibold border-t mt-1" style="border-color:var(--border-subtle)">
            <span>Total</span><span id="stockMultiTotal" class="font-mono-fig">${sumStock(stockMap)}</span>
        </div>`;

    multiWrap.querySelectorAll('[data-wstock]').forEach((input) => {
        input.addEventListener('input', () => {
            const total = [...multiWrap.querySelectorAll('[data-wstock]')].reduce((s, el) => s + (Number(el.value) || 0), 0);
            document.getElementById('stockMultiTotal').textContent = total;
        });
    });
}

function openModal(product) {
    const form = document.getElementById('productForm');
    form.reset();
    document.getElementById('productFormError').classList.add('hidden');
    document.getElementById('pLowStock').value = 5;
    buildStockFields(product);
    if (product) {
        document.getElementById('productModalTitle').textContent = 'Edit Product';
        document.getElementById('productId').value = product.id;
        document.getElementById('pName').value = product.name || '';
        document.getElementById('pSku').value = product.sku || '';
        document.getElementById('pCategory').value = product.category || '';
        document.getElementById('pCost').value = product.costPrice ?? '';
        document.getElementById('pPrice').value = product.sellPrice ?? '';
        document.getElementById('pUnit').value = product.unit || '';
        document.getElementById('pLowStock').value = product.lowStockThreshold ?? 5;
    } else {
        document.getElementById('productModalTitle').textContent = 'Add Product';
        document.getElementById('productId').value = '';
    }
    document.getElementById('productModal').classList.remove('hidden');
    document.getElementById('productModal').classList.add('flex');
}

function closeModal() {
    document.getElementById('productModal').classList.add('hidden');
    document.getElementById('productModal').classList.remove('flex');
}

async function onSubmit(e) {
    e.preventDefault();
    const errEl = document.getElementById('productFormError');
    errEl.classList.add('hidden');
    const btn = document.getElementById('productSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const id = document.getElementById('productId').value;

    if (!id) {
        const limit = productLimitFor(currentPlan);
        if (limit !== null && allProducts.length >= limit) {
            errEl.textContent = `Your plan allows up to ${limit} products. Upgrade to add more — see Settings > Billing & Plan.`;
            errEl.classList.remove('hidden');
            btn.disabled = false;
            btn.textContent = 'Save Product';
            return;
        }
    }

    let stockByWarehouse;
    let totalStock;
    if (allWarehouses.length <= 1) {
        const qty = Number(document.getElementById('pStock').value) || 0;
        const whId = allWarehouses[0]?.id || defaultWarehouseId;
        stockByWarehouse = { [whId]: qty };
        totalStock = qty;
    } else {
        stockByWarehouse = {};
        document.querySelectorAll('#stockMultiWrap [data-wstock]').forEach((input) => {
            stockByWarehouse[input.dataset.wstock] = Number(input.value) || 0;
        });
        totalStock = sumStock(stockByWarehouse);
    }

    const payload = {
        businessId,
        name: document.getElementById('pName').value.trim(),
        sku: document.getElementById('pSku').value.trim(),
        category: document.getElementById('pCategory').value.trim(),
        costPrice: Number(document.getElementById('pCost').value) || 0,
        sellPrice: Number(document.getElementById('pPrice').value) || 0,
        stock: totalStock,
        stockByWarehouse,
        unit: document.getElementById('pUnit').value.trim() || 'pcs',
        lowStockThreshold: Number(document.getElementById('pLowStock').value) || 5,
        updatedAt: serverTimestamp(),
    };

    try {
        if (id) {
            await updateDoc(doc(db, 'products', id), payload);
            toast('Product updated');
        } else {
            payload.createdAt = serverTimestamp();
            await addDoc(collection(db, 'products'), payload);
            toast('Product added');
        }
        closeModal();
    } catch (err) {
        console.error(err);
        errEl.textContent = 'Could not save product. Please try again.';
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Product';
    }
}

function inventorySubtitle(list) {
    const bits = [`${list.length} product${list.length === 1 ? '' : 's'}`];
    if (searchTerm) bits.push(`search: "${searchTerm}"`);
    if (lowStockOnly) bits.push('low stock only');
    if (warehouseFilter) {
        const w = allWarehouses.find((wh) => wh.id === warehouseFilter);
        if (w) bits.push(`warehouse: ${w.name}`);
    }
    return bits.join(' · ');
}

function exportInventoryPdf() {
    const list = filteredProducts();
    if (list.length === 0) { toast('Nothing to export yet', 'error'); return; }
    const stockValue = list.reduce((sum, p) => sum + stockFor(p) * (Number(p.sellPrice) || 0), 0);
    exportTableToPdf({
        filename: 'inventory-report',
        title: 'Inventory Report',
        businessName,
        subtitle: inventorySubtitle(list),
        columns: ['Product', 'SKU', 'Category', 'Cost Price', 'Sell Price', 'Stock', 'Unit'],
        rows: list.map((p) => [
            p.name || '',
            p.sku || '—',
            p.category || '—',
            pdfMoney(p.costPrice),
            pdfMoney(p.sellPrice),
            String(stockFor(p)),
            p.unit || 'pcs',
        ]),
        summaryLines: [`Stock value (at sell price): ${pdfMoney(stockValue)}`],
    });
}

function exportInventoryExcel() {
    const list = filteredProducts();
    if (list.length === 0) { toast('Nothing to export yet', 'error'); return; }
    exportTableToExcel({
        filename: 'inventory-report',
        sheetName: 'Inventory',
        columns: ['Product', 'SKU', 'Category', 'Cost Price', 'Sell Price', 'Stock', 'Unit', 'Low Stock Threshold'],
        rows: list.map((p) => [
            p.name || '',
            p.sku || '',
            p.category || '',
            Number(p.costPrice) || 0,
            Number(p.sellPrice) || 0,
            stockFor(p),
            p.unit || 'pcs',
            Number(p.lowStockThreshold) || 5,
        ]),
    });
}

async function onDelete(id, name) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
        await deleteDoc(doc(db, 'products', id));
        toast('Product deleted');
    } catch (err) {
        console.error(err);
        toast('Could not delete product', 'error');
    }
}
