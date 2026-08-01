// ---------------------------------------------------------------------------
// AI Assistant page: a lightweight, fully client-side Q&A assistant. It
// keeps live copies of the business's Firestore collections in memory and
// answers common questions with pattern matching — no external API key or
// network call is required, so this works the moment the app is deployed.
//
// Want to swap in a real LLM later? Add your API key server-side (never in
// this client bundle) and replace `generateAnswer()` below with a fetch to
// your own backend, passing the same `snapshotSummary()` context.
// ---------------------------------------------------------------------------
import { db } from "./firebase-init.js";
import { requireAuth, escapeHtml, formatTaka } from "./app-shell.js";
import {
    collection, onSnapshot, query, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let sales = [];
let expenses = [];
let products = [];
let customers = [];
let employees = [];

const SUGGESTIONS = [
    "What were today's sales?",
    "What's low on stock?",
    "Who owes me money?",
    "What's this month's net profit?",
    "How many employees do I have?",
    "Top selling products?",
];

requireAuth(() => {
    onSnapshot(query(collection(db, 'sales'), orderBy('createdAt', 'desc'), limit(1000)), (snap) => {
        sales = []; snap.forEach((d) => sales.push({ id: d.id, ...d.data() }));
    });
    onSnapshot(query(collection(db, 'expenses'), orderBy('createdAt', 'desc'), limit(500)), (snap) => {
        expenses = []; snap.forEach((d) => expenses.push({ id: d.id, ...d.data() }));
    });
    onSnapshot(collection(db, 'products'), (snap) => {
        products = []; snap.forEach((d) => products.push({ id: d.id, ...d.data() }));
    });
    onSnapshot(collection(db, 'customers'), (snap) => {
        customers = []; snap.forEach((d) => customers.push({ id: d.id, ...d.data() }));
    });
    onSnapshot(collection(db, 'employees'), (snap) => {
        employees = []; snap.forEach((d) => employees.push({ id: d.id, ...d.data() }));
    });

    renderSuggestions();
    addBotMessage("Hi! I'm your business assistant. Ask me about sales, stock, dues, payroll, or profit — try one of the suggestions below.");

    document.getElementById('chatForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('chatInput');
        const text = input.value.trim();
        if (!text) return;
        addUserMessage(text);
        input.value = '';
        setTimeout(() => addBotMessage(generateAnswer(text)), 250);
    });
});

function renderSuggestions() {
    const row = document.getElementById('suggestionRow');
    row.innerHTML = SUGGESTIONS.map((s) => `<button class="text-xs px-3 py-1.5 rounded-full" data-suggestion="${escapeHtml(s)}" style="background:var(--bg-surface-alt); border:1px solid var(--border-subtle)" type="button">${escapeHtml(s)}</button>`).join('');
    row.querySelectorAll('[data-suggestion]').forEach((btn) => {
        btn.addEventListener('click', () => {
            addUserMessage(btn.dataset.suggestion);
            setTimeout(() => addBotMessage(generateAnswer(btn.dataset.suggestion)), 250);
        });
    });
}

function addUserMessage(text) {
    const log = document.getElementById('chatLog');
    log.insertAdjacentHTML('beforeend', `
        <div class="flex justify-end">
            <div class="max-w-[80%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm bg-primary text-white">${escapeHtml(text)}</div>
        </div>
    `);
    log.scrollTop = log.scrollHeight;
}

function addBotMessage(html) {
    const log = document.getElementById('chatLog');
    log.insertAdjacentHTML('beforeend', `
        <div class="flex items-start gap-2.5">
            <div class="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5"><i class="fa-solid fa-wand-magic-sparkles text-xs"></i></div>
            <div class="max-w-[80%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm surface" style="border-color:var(--border-subtle)">${html}</div>
        </div>
    `);
    log.scrollTop = log.scrollHeight;
}

function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function monthStart() {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
}

function generateAnswer(rawText) {
    const q = rawText.toLowerCase();

    // Today's sales
    if (/today.*sale|sale.*today/.test(q)) {
        const now = new Date();
        const todays = sales.filter((s) => s.createdAt && isSameDay(s.createdAt.toDate(), now));
        const total = todays.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
        return `Today you've made <b>${formatTaka(total)}</b> across <b>${todays.length}</b> sale${todays.length === 1 ? '' : 's'}.`;
    }

    // Low stock
    if (/low stock|running low|restock|out of stock/.test(q)) {
        const low = products.filter((p) => (Number(p.stock) || 0) <= (Number(p.lowStockThreshold) || 5));
        if (low.length === 0) return `Nothing is low on stock right now — all ${products.length} product${products.length === 1 ? '' : 's'} are healthily stocked.`;
        const list = low.slice(0, 8).map((p) => `${escapeHtml(p.name || 'Unnamed')} (${Number(p.stock) || 0} left)`).join(', ');
        return `${low.length} item${low.length === 1 ? ' is' : 's are'} low on stock: <b>${list}</b>${low.length > 8 ? '…' : ''}`;
    }

    // Customer dues
    if (/owe|due|বাকি|credit balance/.test(q)) {
        const withDue = customers.filter((c) => (Number(c.dueAmount) || 0) > 0);
        const total = withDue.reduce((sum, c) => sum + (Number(c.dueAmount) || 0), 0);
        if (withDue.length === 0) return `No customers currently owe you money — all dues are clear.`;
        const list = withDue.slice(0, 8).map((c) => `${escapeHtml(c.name || 'Unnamed')} (${formatTaka(c.dueAmount)})`).join(', ');
        return `${withDue.length} customer${withDue.length === 1 ? '' : 's'} owe a total of <b>${formatTaka(total)}</b>: ${list}${withDue.length > 8 ? '…' : ''}`;
    }

    // Net profit / expenses this month
    if (/profit|net income|how.*doing financially/.test(q)) {
        const start = monthStart();
        const income = sales.filter((s) => s.createdAt && s.createdAt.toDate() >= start).reduce((sum, s) => sum + (Number(s.total) || 0), 0);
        const exp = expenses.filter((e) => e.createdAt && e.createdAt.toDate() >= start).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
        return `This month: income <b>${formatTaka(income)}</b>, expenses <b>${formatTaka(exp)}</b>, net profit <b>${formatTaka(income - exp)}</b>.`;
    }
    if (/expense/.test(q)) {
        const start = monthStart();
        const exp = expenses.filter((e) => e.createdAt && e.createdAt.toDate() >= start).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
        return `You've logged <b>${formatTaka(exp)}</b> in expenses so far this month.`;
    }

    // Employees / payroll
    if (/employee|staff|payroll|salary/.test(q)) {
        const active = employees.filter((e) => (e.status || 'active') === 'active');
        const budget = active.reduce((sum, e) => sum + (Number(e.monthlySalary) || 0), 0);
        if (active.length === 0) return `You haven't added any employees yet — do that from the HR &amp; Payroll page.`;
        return `You have <b>${active.length}</b> active employee${active.length === 1 ? '' : 's'}, with a combined monthly salary budget of <b>${formatTaka(budget)}</b>.`;
    }

    // Top selling products
    if (/top sell|best sell|most popular|which product/.test(q)) {
        const counts = {};
        sales.forEach((s) => (s.items || []).forEach((it) => {
            const key = it.name || 'Unknown';
            counts[key] = (counts[key] || 0) + (Number(it.qty) || 0);
        }));
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (top.length === 0) return `No sales recorded yet, so there's no ranking to show.`;
        return `Your top sellers: ${top.map(([name, qty]) => `${escapeHtml(name)} (${qty} sold)`).join(', ')}.`;
    }

    // Product / inventory count
    if (/how many product|inventory count|stock count/.test(q)) {
        return `You currently have <b>${products.length}</b> product${products.length === 1 ? '' : 's'} in inventory.`;
    }

    // Customer count
    if (/how many customer/.test(q)) {
        return `You have <b>${customers.length}</b> customer${customers.length === 1 ? '' : 's'} on file.`;
    }

    // Greeting
    if (/^(hi|hello|hey)\b/.test(q)) {
        return `Hello! Ask me about sales, stock levels, customer dues, payroll, or profit.`;
    }

    return `I couldn't match that to something I track yet. Try asking about <b>today's sales</b>, <b>low stock</b>, <b>customer dues</b>, <b>net profit</b>, or <b>payroll</b> — or use one of the suggestions below.`;
}
