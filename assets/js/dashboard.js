// ---------------------------------------------------------------------------
// Dashboard: auth guard + user info + logout (via app-shell.js), live KPI
// cards (today's sales, product count, low stock, 30-day net profit), and
// the recent sales widget.
//
// Note: contact-form submissions (contactMessages) used to have a "Recent
// Contact Messages" widget bolted onto this dashboard for the platform
// admin. That's now its own full admin panel — see admin-messages.html —
// so this file no longer touches contactMessages at all.
// ---------------------------------------------------------------------------
import { db } from "./firebase-init.js";
import { requireAuth, escapeHtml, formatTaka } from "./app-shell.js";
import { collection, query, where, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

requireAuth(async (user, ctx) => {
    const businessId = ctx.businessId;
    await Promise.all([loadSalesAndKpis(businessId), loadProductKpis(businessId), loadExpenseKpis(businessId)]);
});

function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(0, 0, 0, 0);
    return d;
}

async function loadSalesAndKpis(businessId) {
    const list = document.getElementById('recentSalesList');
    try {
        const q = query(collection(db, 'sales'), where('businessId', '==', businessId), orderBy('createdAt', 'desc'), limit(50));
        const snap = await getDocs(q);

        const today = startOfToday();
        const since30 = daysAgo(30);
        let todayTotal = 0, todayCount = 0, income30 = 0;
        const rows = [];

        snap.forEach((docSnap) => {
            const d = docSnap.data();
            const created = d.createdAt ? d.createdAt.toDate() : null;
            const total = Number(d.total) || 0;
            if (created && created >= today) { todayTotal += total; todayCount += 1; }
            if (created && created >= since30) { income30 += total; }
            if (rows.length < 5) rows.push({ d, created });
        });

        const kpiTodaySales = document.getElementById('kpiTodaySales');
        const kpiTodayCount = document.getElementById('kpiTodayCount');
        if (kpiTodaySales) kpiTodaySales.textContent = formatTaka(todayTotal);
        if (kpiTodayCount) kpiTodayCount.textContent = `${todayCount} sale${todayCount === 1 ? '' : 's'}`;

        window.__income30 = income30;
        updateNetProfitIfReady();

        if (!list) return;
        if (rows.length === 0) {
            list.innerHTML = '<p class="text-sm" style="color:var(--text-secondary)">No sales yet — <a href="pos.html" class="text-primary font-medium">ring up your first sale</a>.</p>';
            return;
        }
        list.innerHTML = '';
        rows.forEach(({ d, created }) => {
            const itemCount = Array.isArray(d.items) ? d.items.reduce((s, it) => s + (Number(it.qty) || 0), 0) : 0;
            const row = document.createElement('div');
            row.className = 'flex items-start justify-between gap-3 py-3 border-b';
            row.style.borderColor = 'var(--border-subtle)';
            row.innerHTML = `
                <div>
                    <p class="text-sm font-semibold">${itemCount} item${itemCount === 1 ? '' : 's'} · ${escapeHtml(d.paymentMethod || 'cash')}</p>
                    <p class="text-xs" style="color:var(--text-secondary)">${escapeHtml(d.cashierName || '')}</p>
                </div>
                <div class="text-right shrink-0">
                    <p class="text-sm font-semibold font-mono-fig">${formatTaka(d.total)}</p>
                    <span class="text-xs" style="color:var(--text-secondary)">${created ? created.toLocaleDateString() : '—'}</span>
                </div>
            `;
            list.appendChild(row);
        });
    } catch (err) {
        console.error(err);
        if (list) list.innerHTML = '<p class="text-sm text-red-500">Could not load sales.</p>';
    }
}

async function loadProductKpis(businessId) {
    try {
        const snap = await getDocs(query(collection(db, 'products'), where('businessId', '==', businessId)));
        let low = 0;
        snap.forEach((docSnap) => {
            const d = docSnap.data();
            const threshold = Number(d.lowStockThreshold) || 5;
            if ((Number(d.stock) || 0) <= threshold) low += 1;
        });
        const kpiProductCount = document.getElementById('kpiProductCount');
        const kpiLowStock = document.getElementById('kpiLowStock');
        if (kpiProductCount) kpiProductCount.textContent = snap.size;
        if (kpiLowStock) kpiLowStock.textContent = low;
    } catch (err) {
        console.error(err);
    }
}

async function loadExpenseKpis(businessId) {
    try {
        const q = query(collection(db, 'expenses'), where('businessId', '==', businessId), orderBy('createdAt', 'desc'), limit(200));
        const snap = await getDocs(q);
        const since30 = daysAgo(30);
        let expense30 = 0;
        snap.forEach((docSnap) => {
            const d = docSnap.data();
            const created = d.createdAt ? d.createdAt.toDate() : null;
            if (created && created >= since30) expense30 += Number(d.amount) || 0;
        });
        window.__expense30 = expense30;
        updateNetProfitIfReady();
    } catch (err) {
        console.error(err);
    }
}

function updateNetProfitIfReady() {
    if (typeof window.__income30 !== 'number' || typeof window.__expense30 !== 'number') return;
    const el = document.getElementById('kpiNetProfit');
    if (!el) return;
    const net = window.__income30 - window.__expense30;
    el.textContent = formatTaka(net);
    el.style.color = net < 0 ? '#EF4444' : '';
}
