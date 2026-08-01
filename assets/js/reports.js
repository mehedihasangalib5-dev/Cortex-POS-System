// ---------------------------------------------------------------------------
// Reports page: read-only analytics built from the existing sales, expenses,
// and products collections. No new writes — just aggregation + charts.
// ---------------------------------------------------------------------------
import { db } from "./firebase-init.js";
import { requireAuth, escapeHtml, formatTaka, toast } from "./app-shell.js";
import {
    collection, onSnapshot, query, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let sales = [];
let expenses = [];
let products = [];
let salesChart, expenseChart, paymentChart;

requireAuth(() => {
    onSnapshot(query(collection(db, 'sales'), orderBy('createdAt', 'desc'), limit(1000)), (snap) => {
        sales = [];
        snap.forEach((d) => sales.push({ id: d.id, ...d.data() }));
        render();
    }, (err) => { console.error(err); toast('Could not load sales data', 'error'); });

    onSnapshot(query(collection(db, 'expenses'), orderBy('createdAt', 'desc'), limit(500)), (snap) => {
        expenses = [];
        snap.forEach((d) => expenses.push({ id: d.id, ...d.data() }));
        render();
    }, (err) => { console.error(err); toast('Could not load expense data', 'error'); });

    onSnapshot(query(collection(db, 'products')), (snap) => {
        products = [];
        snap.forEach((d) => products.push({ id: d.id, ...d.data() }));
        render();
    }, (err) => { console.error(err); toast('Could not load product data', 'error'); });

    document.getElementById('exportSalesBtn').addEventListener('click', exportSalesCsv);
});

function dayKey(d) {
    return d.toISOString().slice(0, 10);
}

function render() {
    renderKpis();
    renderSalesTrend();
    renderExpenseChart();
    renderTopProducts();
    renderPaymentMethods();
}

function renderKpis() {
    const cutoff14 = new Date();
    cutoff14.setDate(cutoff14.getDate() - 14);

    const recent = sales.filter((s) => {
        const created = s.createdAt ? s.createdAt.toDate() : null;
        return created && created >= cutoff14;
    });
    const total14 = recent.reduce((sum, s) => sum + (Number(s.total) || 0), 0);

    document.getElementById('kpiSales14d').textContent = formatTaka(total14);
    document.getElementById('kpiTx14d').textContent = recent.length;
    document.getElementById('kpiAvgSale').textContent = formatTaka(recent.length ? total14 / recent.length : 0);

    const lowStockCount = products.filter((p) => (Number(p.stock) || 0) <= (Number(p.lowStockThreshold) || 5)).length;
    document.getElementById('kpiLowStockReport').textContent = lowStockCount;
}

function renderSalesTrend() {
    const days = [];
    const totals = {};
    for (let i = 13; i >= 0; i--) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - i);
        const key = dayKey(d);
        days.push(key);
        totals[key] = 0;
    }
    sales.forEach((s) => {
        const created = s.createdAt ? s.createdAt.toDate() : null;
        if (!created) return;
        const d = new Date(created);
        d.setHours(0, 0, 0, 0);
        const key = dayKey(d);
        if (key in totals) totals[key] += Number(s.total) || 0;
    });

    const labels = days.map((k) => new Date(k).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    const data = days.map((k) => totals[k]);

    const ctx = document.getElementById('salesTrendChart');
    if (salesChart) salesChart.destroy();
    salesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Sales (৳)',
                data,
                borderColor: '#2454FF',
                backgroundColor: 'rgba(36,84,255,0.12)',
                fill: true,
                tension: 0.3,
                pointRadius: 2,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } },
        },
    });
}

function renderExpenseChart() {
    const byCategory = {};
    expenses.forEach((e) => {
        const cat = e.category || 'Other';
        byCategory[cat] = (byCategory[cat] || 0) + (Number(e.amount) || 0);
    });
    const labels = Object.keys(byCategory);
    const data = Object.values(byCategory);
    const palette = ['#2454FF', '#10B981', '#F5A623', '#EF4444', '#8B5CF6', '#EC4899', '#0EA5E9'];

    const ctx = document.getElementById('expenseChart');
    if (expenseChart) expenseChart.destroy();
    expenseChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels.length ? labels : ['No expenses yet'],
            datasets: [{
                data: data.length ? data : [1],
                backgroundColor: labels.length ? palette : ['#E6E9F0'],
                borderWidth: 0,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
        },
    });
}

function renderPaymentMethods() {
    const cutoff30 = new Date();
    cutoff30.setDate(cutoff30.getDate() - 30);
    const byMethod = {};
    sales.forEach((s) => {
        const created = s.createdAt ? s.createdAt.toDate() : null;
        if (!created || created < cutoff30) return;
        const m = s.paymentMethod || 'cash';
        byMethod[m] = (byMethod[m] || 0) + (Number(s.total) || 0);
    });
    const labels = Object.keys(byMethod).map((m) => m.charAt(0).toUpperCase() + m.slice(1));
    const data = Object.values(byMethod);
    const palette = ['#2454FF', '#10B981', '#F5A623', '#EF4444', '#8B5CF6'];

    const ctx = document.getElementById('paymentMethodChart');
    if (paymentChart) paymentChart.destroy();
    paymentChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels.length ? labels : ['No sales yet'],
            datasets: [{
                data: data.length ? data : [1],
                backgroundColor: labels.length ? palette : ['#E6E9F0'],
                borderWidth: 0,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
        },
    });
}

function renderTopProducts() {
    const counts = {};
    sales.forEach((s) => {
        (s.items || []).forEach((it) => {
            const key = it.name || it.productId || 'Unknown';
            if (!counts[key]) counts[key] = { qty: 0, revenue: 0 };
            counts[key].qty += Number(it.qty) || 0;
            counts[key].revenue += Number(it.lineTotal) || (Number(it.price) || 0) * (Number(it.qty) || 0);
        });
    });
    const top = Object.entries(counts).sort((a, b) => b[1].qty - a[1].qty).slice(0, 8);
    const el = document.getElementById('topProductsList');

    if (top.length === 0) {
        el.innerHTML = `<p class="text-sm" style="color:var(--text-secondary)">No sales recorded yet.</p>`;
        return;
    }

    const maxQty = top[0][1].qty || 1;
    el.innerHTML = top.map(([name, v]) => `
        <div class="mb-3 last:mb-0">
            <div class="flex items-center justify-between text-sm mb-1">
                <span class="font-medium">${escapeHtml(name)}</span>
                <span class="font-mono-fig" style="color:var(--text-secondary)">${v.qty} sold · ${formatTaka(v.revenue)}</span>
            </div>
            <div class="h-2 rounded-full" style="background:var(--bg-surface-alt)">
                <div class="h-2 rounded-full bg-primary" style="width:${Math.max(4, (v.qty / maxQty) * 100)}%"></div>
            </div>
        </div>
    `).join('');
}

function exportSalesCsv() {
    if (sales.length === 0) { toast('No sales to export yet', 'error'); return; }
    const rows = [['Date', 'Items', 'Payment Method', 'Total']];
    sales.forEach((s) => {
        const created = s.createdAt ? s.createdAt.toDate() : null;
        const itemsDesc = (s.items || []).map((it) => `${it.name} x${it.qty}`).join('; ');
        rows.push([
            created ? created.toISOString() : '',
            itemsDesc,
            s.paymentMethod || '',
            String(Number(s.total) || 0),
        ]);
    });
    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
