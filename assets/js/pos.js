// ---------------------------------------------------------------------------
// POS page: shows in-stock products, builds a cart in memory, and on
// checkout runs a Firestore transaction that verifies + decrements stock on
// every line item and writes a single "sales" document.
// ---------------------------------------------------------------------------
import { db } from "./firebase-init.js";
import { requireAuth, escapeHtml, formatTaka, toast } from "./app-shell.js";
import {
    collection, onSnapshot, doc, runTransaction, serverTimestamp, query, where, orderBy,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { ensureDefaultWarehouse, subscribeWarehouses, resolveStockMap, sumStock } from "./warehouse-utils.js";

let allProducts = [];
let cart = {}; // productId -> { id, name, sku, price, qty, stock }
let searchTerm = '';
let currentUser = null;
let businessId = null;
let allWarehouses = [];
let defaultWarehouseId = null;
let selectedWarehouseId = null;

function warehouseStorageKey() { return `posWarehouse:${businessId}`; }

/** Stock available for a product at the currently selected warehouse. */
function stockAt(p) {
    if (!selectedWarehouseId) return Number(p.stock) || 0;
    const map = resolveStockMap(p, defaultWarehouseId);
    return Number(map[selectedWarehouseId]) || 0;
}

requireAuth(async (user, ctx) => {
    currentUser = user;
    businessId = ctx.businessId;
    defaultWarehouseId = await ensureDefaultWarehouse(businessId);
    selectedWarehouseId = localStorage.getItem(warehouseStorageKey()) || defaultWarehouseId;

    subscribeWarehouses(businessId, (list) => {
        allWarehouses = list;
        const sel = document.getElementById('posWarehouse');
        if (!allWarehouses.some((w) => w.id === selectedWarehouseId)) {
            selectedWarehouseId = allWarehouses.find((w) => w.isDefault)?.id || allWarehouses[0]?.id || defaultWarehouseId;
        }
        if (allWarehouses.length <= 1) {
            sel.parentElement.classList.add('hidden');
        } else {
            sel.parentElement.classList.remove('hidden');
        }
        sel.innerHTML = allWarehouses.map((w) => `<option value="${w.id}">${escapeHtml(w.name || '')}</option>`).join('');
        sel.value = selectedWarehouseId;
        renderProducts();
        renderCart();
    });

    document.getElementById('posWarehouse').addEventListener('change', (e) => {
        selectedWarehouseId = e.target.value;
        localStorage.setItem(warehouseStorageKey(), selectedWarehouseId);
        cart = {}; // selling location changed — start a fresh cart to avoid mixing stock from two locations
        renderProducts();
        renderCart();
    });

    const q = query(collection(db, 'products'), where('businessId', '==', businessId), orderBy('name'));
    onSnapshot(q, (snap) => {
        allProducts = [];
        snap.forEach((docSnap) => allProducts.push({ id: docSnap.id, ...docSnap.data() }));
        // keep cart quantities in sync with latest known stock, drop items that vanished
        Object.keys(cart).forEach((id) => {
            const p = allProducts.find((x) => x.id === id);
            if (!p) delete cart[id];
            else cart[id].stock = stockAt(p);
        });
        renderProducts();
        renderCart();
    }, (err) => {
        console.error(err);
        document.getElementById('posProductGrid').innerHTML =
            `<p class="col-span-full text-sm py-6 text-center text-red-500">Could not load products — check Firestore rules.</p>`;
    });

    document.getElementById('posSearch').addEventListener('input', (e) => {
        searchTerm = e.target.value.trim().toLowerCase();
        renderProducts();
    });

    document.getElementById('posProductGrid').addEventListener('click', (e) => {
        const card = e.target.closest('[data-add]');
        if (card) addToCart(card.dataset.add);
    });

    document.getElementById('cartItems').addEventListener('click', (e) => {
        const inc = e.target.closest('[data-inc]');
        const dec = e.target.closest('[data-dec]');
        const rem = e.target.closest('[data-remove]');
        if (inc) changeQty(inc.dataset.inc, 1);
        if (dec) changeQty(dec.dataset.dec, -1);
        if (rem) removeFromCart(rem.dataset.remove);
    });

    document.getElementById('cartDiscount').addEventListener('input', renderCart);
    document.getElementById('clearCartBtn').addEventListener('click', () => { cart = {}; renderProducts(); renderCart(); });
    document.getElementById('checkoutBtn').addEventListener('click', onCheckout);
    document.getElementById('saleSuccessOk').addEventListener('click', () => {
        document.getElementById('saleSuccessModal').classList.add('hidden');
        document.getElementById('saleSuccessModal').classList.remove('flex');
    });
});

function renderProducts() {
    const grid = document.getElementById('posProductGrid');
    let list = allProducts;
    if (searchTerm) {
        list = list.filter((p) =>
            (p.name || '').toLowerCase().includes(searchTerm) ||
            (p.sku || '').toLowerCase().includes(searchTerm));
    }
    if (list.length === 0) {
        grid.innerHTML = `<p class="col-span-full text-sm py-6 text-center" style="color:var(--text-secondary)">
            ${allProducts.length === 0 ? 'No products yet — add some in Inventory first.' : 'No products match your search.'}
        </p>`;
        return;
    }
    grid.innerHTML = list.map((p) => {
        const stock = stockAt(p);
        const out = stock <= 0;
        return `
            <button class="surface p-3 text-left flex flex-col ${out ? 'opacity-40 cursor-not-allowed' : 'hover:shadow-lg transition'}"
                ${out ? 'disabled' : `data-add="${p.id}"`} type="button">
                <span class="text-sm font-semibold mb-1 line-clamp-2">${escapeHtml(p.name || '')}</span>
                <span class="text-xs mb-2" style="color:var(--text-secondary)">${escapeHtml(p.sku || '')}</span>
                <span class="font-mono-fig font-bold text-primary mt-auto">${formatTaka(p.sellPrice)}</span>
                <span class="text-[11px] mt-1" style="color:var(--text-secondary)">${out ? 'Out of stock' : `${stock} ${escapeHtml(p.unit || 'pcs')} left`}</span>
            </button>
        `;
    }).join('');
}

function addToCart(id) {
    const p = allProducts.find((x) => x.id === id);
    if (!p) return;
    const stock = stockAt(p);
    if (stock <= 0) return;
    if (!cart[id]) cart[id] = { id, name: p.name, sku: p.sku || '', price: Number(p.sellPrice) || 0, qty: 0, stock };
    if (cart[id].qty >= stock) { toast(`Only ${stock} in stock`, 'error'); return; }
    cart[id].qty += 1;
    renderCart();
}

function changeQty(id, delta) {
    if (!cart[id]) return;
    const next = cart[id].qty + delta;
    if (next <= 0) { delete cart[id]; }
    else if (next > cart[id].stock) { toast(`Only ${cart[id].stock} in stock`, 'error'); return; }
    else { cart[id].qty = next; }
    renderCart();
}

function removeFromCart(id) {
    delete cart[id];
    renderCart();
}

function cartTotals() {
    const items = Object.values(cart);
    const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
    const discount = Math.max(0, Number(document.getElementById('cartDiscount').value) || 0);
    const total = Math.max(0, subtotal - discount);
    return { items, subtotal, discount, total };
}

function renderCart() {
    const { items, subtotal, total } = cartTotals();
    const wrap = document.getElementById('cartItems');
    const checkoutBtn = document.getElementById('checkoutBtn');

    if (items.length === 0) {
        wrap.innerHTML = '<p class="text-sm py-4 text-center" style="color:var(--text-secondary)">Cart is empty. Tap a product to add it.</p>';
        checkoutBtn.disabled = true;
    } else {
        wrap.innerHTML = items.map((it) => `
            <div class="flex items-center gap-2 py-2 border-b" style="border-color:var(--border-subtle)">
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">${escapeHtml(it.name)}</p>
                    <p class="text-xs font-mono-fig" style="color:var(--text-secondary)">${formatTaka(it.price)} × ${it.qty}</p>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <button class="h-6 w-6 rounded-md flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5" data-dec="${it.id}" type="button">−</button>
                    <span class="w-5 text-center text-sm font-mono-fig">${it.qty}</span>
                    <button class="h-6 w-6 rounded-md flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5" data-inc="${it.id}" type="button">+</button>
                    <button class="h-6 w-6 rounded-md flex items-center justify-center hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500 ml-1" data-remove="${it.id}" type="button"><i class="fa-solid fa-xmark text-xs"></i></button>
                </div>
            </div>
        `).join('');
        checkoutBtn.disabled = false;
    }

    document.getElementById('cartSubtotal').textContent = formatTaka(subtotal);
    document.getElementById('cartTotal').textContent = formatTaka(total);
}

async function onCheckout() {
    const { items, subtotal, discount, total } = cartTotals();
    if (items.length === 0) return;

    const btn = document.getElementById('checkoutBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i>Processing...';

    try {
        const warehouseId = selectedWarehouseId;
        const warehouseName = allWarehouses.find((w) => w.id === warehouseId)?.name || '';

        await runTransaction(db, async (tx) => {
            const productRefs = items.map((it) => doc(db, 'products', it.id));
            const snaps = await Promise.all(productRefs.map((ref) => tx.get(ref)));

            const newMaps = snaps.map((snap, i) => {
                if (!snap.exists()) throw new Error(`${items[i].name} no longer exists.`);
                const map = resolveStockMap(snap.data(), defaultWarehouseId);
                const currentStock = Number(map[warehouseId]) || 0;
                if (currentStock < items[i].qty) {
                    throw new Error(`Not enough stock for ${items[i].name} at ${warehouseName || 'this location'} (only ${currentStock} left).`);
                }
                map[warehouseId] = currentStock - items[i].qty;
                return map;
            });

            snaps.forEach((snap, i) => {
                tx.update(productRefs[i], { stockByWarehouse: newMaps[i], stock: sumStock(newMaps[i]) });
            });

            const saleRef = doc(collection(db, 'sales'));
            tx.set(saleRef, {
                businessId,
                items: items.map((it) => ({ productId: it.id, name: it.name, sku: it.sku, qty: it.qty, price: it.price, lineTotal: it.price * it.qty })),
                subtotal,
                discount,
                total,
                paymentMethod: document.getElementById('paymentMethod').value,
                warehouseId,
                warehouseName,
                cashierUid: currentUser.uid,
                cashierName: currentUser.displayName || currentUser.email,
                createdAt: serverTimestamp(),
            });
        });

        document.getElementById('saleSuccessAmount').textContent = `Total collected: ${formatTaka(total)}`;
        document.getElementById('saleSuccessModal').classList.remove('hidden');
        document.getElementById('saleSuccessModal').classList.add('flex');
        cart = {};
        document.getElementById('cartDiscount').value = 0;
        renderCart();
    } catch (err) {
        console.error(err);
        toast(err.message || 'Checkout failed — please try again.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-circle-check mr-1.5"></i>Checkout';
    }
}
