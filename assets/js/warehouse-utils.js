// ---------------------------------------------------------------------------
// Shared multi-warehouse helpers.
//
// A "warehouse" is a business-scoped location: warehouses/{id} = { businessId,
// name, address, isDefault, createdAt }. Every business gets exactly one
// default warehouse auto-created the first time any page calls
// ensureDefaultWarehouse() — this keeps single-location businesses working
// with zero setup, exactly like before this feature existed.
//
// Product stock model:
//   products/{id}.stock             -> TOTAL across all warehouses (kept in
//                                       sync on every write; every other page
//                                       — dashboard, reports, accounting —
//                                       reads this field unchanged).
//   products/{id}.stockByWarehouse  -> { [warehouseId]: qty }, the per-
//                                       location breakdown. NEW.
//
// Legacy products (created before this feature) have no stockByWarehouse
// field yet. resolveStockMap() below treats their whole `stock` value as
// sitting in the default warehouse until the product is next saved or
// transferred, at which point the map is written for real.
// ---------------------------------------------------------------------------
import { db } from "./firebase-init.js";
import {
    collection, onSnapshot, addDoc, doc, getDocs, query, where, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let ensureCache = null; // { businessId, warehouseId } — avoids re-checking every page load in the same session

/**
 * Guarantees at least one warehouse exists for this business and returns its
 * id (the default one). Safe to call from every page that touches stock.
 */
export async function ensureDefaultWarehouse(businessId) {
    if (ensureCache && ensureCache.businessId === businessId) return ensureCache.warehouseId;

    const q = query(collection(db, 'warehouses'), where('businessId', '==', businessId));
    const snap = await getDocs(q);
    if (!snap.empty) {
        const def = snap.docs.find((d) => d.data().isDefault) || snap.docs[0];
        ensureCache = { businessId, warehouseId: def.id };
        return def.id;
    }

    const ref = await addDoc(collection(db, 'warehouses'), {
        businessId,
        name: 'Main Warehouse',
        address: '',
        isDefault: true,
        createdAt: serverTimestamp(),
    });
    ensureCache = { businessId, warehouseId: ref.id };
    return ref.id;
}

/** Live subscription to a business's warehouses, sorted by name. Returns the unsubscribe function. */
export function subscribeWarehouses(businessId, callback) {
    const q = query(collection(db, 'warehouses'), where('businessId', '==', businessId), orderBy('name'));
    return onSnapshot(q, (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        callback(list);
    });
}

/**
 * Returns { [warehouseId]: qty } for a product, falling back to putting its
 * entire legacy `stock` value under `fallbackWarehouseId` if the product has
 * no stockByWarehouse map yet.
 */
export function resolveStockMap(product, fallbackWarehouseId) {
    if (product.stockByWarehouse && typeof product.stockByWarehouse === 'object') {
        return { ...product.stockByWarehouse };
    }
    return { [fallbackWarehouseId]: Number(product.stock) || 0 };
}

/** Sums a stock-by-warehouse map into the total that products/{id}.stock should hold. */
export function sumStock(stockMap) {
    return Object.values(stockMap).reduce((s, v) => s + (Number(v) || 0), 0);
}
