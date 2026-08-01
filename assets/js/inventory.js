// ---------------------------------------------------------------------------
// Inventory page: live product list (onSnapshot), add / edit / delete
// products, client-side search + low-stock filter.
// ---------------------------------------------------------------------------
import { db } from "./firebase-init.js";
import { requireAuth, escapeHtml, formatTaka, toast } from "./app-shell.js";
import {
    collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy, query,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let allProducts = [];
let searchTerm = '';
let lowStockOnly = false;

requireAuth(() => {
    const q = query(collection(db, 'products'), orderBy('name'));
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
});

function isLow(p) {
    const threshold = Number(p.lowStockThreshold) || 5;
    return (Number(p.stock) || 0) <= threshold;
}

function render() {
    const tbody = document.getElementById('productTableBody');
    let list = allProducts;
    if (searchTerm) {
        list = list.filter((p) =>
            (p.name || '').toLowerCase().includes(searchTerm) ||
            (p.sku || '').toLowerCase().includes(searchTerm));
    }
    if (lowStockOnly) list = list.filter(isLow);

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
                <span class="font-mono-fig font-semibold ${isLow(p) ? 'text-red-500' : ''}">${Number(p.stock) || 0}</span>
                <span class="text-xs" style="color:var(--text-secondary)"> ${escapeHtml(p.unit || 'pcs')}</span>
                ${isLow(p) ? '<i class="fa-solid fa-triangle-exclamation text-amber ml-1" title="Low stock"></i>' : ''}
            </td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
                <button class="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5" data-edit="${p.id}" title="Edit"><i class="fa-solid fa-pen text-xs"></i></button>
                <button class="h-8 w-8 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500" data-del="${p.id}" data-name="${escapeHtml(p.name || '')}" title="Delete"><i class="fa-solid fa-trash text-xs"></i></button>
            </td>
        </tr>
    `).join('');
}

function openModal(product) {
    const form = document.getElementById('productForm');
    form.reset();
    document.getElementById('productFormError').classList.add('hidden');
    document.getElementById('pLowStock').value = 5;
    if (product) {
        document.getElementById('productModalTitle').textContent = 'Edit Product';
        document.getElementById('productId').value = product.id;
        document.getElementById('pName').value = product.name || '';
        document.getElementById('pSku').value = product.sku || '';
        document.getElementById('pCategory').value = product.category || '';
        document.getElementById('pCost').value = product.costPrice ?? '';
        document.getElementById('pPrice').value = product.sellPrice ?? '';
        document.getElementById('pStock').value = product.stock ?? 0;
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
    const payload = {
        name: document.getElementById('pName').value.trim(),
        sku: document.getElementById('pSku').value.trim(),
        category: document.getElementById('pCategory').value.trim(),
        costPrice: Number(document.getElementById('pCost').value) || 0,
        sellPrice: Number(document.getElementById('pPrice').value) || 0,
        stock: Number(document.getElementById('pStock').value) || 0,
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
