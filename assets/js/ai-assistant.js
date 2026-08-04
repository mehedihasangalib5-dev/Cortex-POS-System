// ---------------------------------------------------------------------------
// AI Assistant page. Keeps live copies of the business's Firestore
// collections in memory so it can answer instantly either way:
//
//   - No provider connected (Settings > AI Assistant): answers come from
//     the built-in `generateAnswer()` pattern matcher below — free, works
//     offline, no key needed.
//   - Provider connected: the question plus a compact text summary of the
//     same data (`snapshotSummary()`) is sent straight from the browser to
//     the business's own OpenAI/Gemini account using their API key (never
//     our servers — see settings.js / firestore settings doc). This is
//     what pricing.html's "AI Business Assistant (bring your own API key)"
//     line refers to.
//
// Network hiccups, a bad key, or a provider outage all fall back to the
// offline matcher rather than leaving the user with an error.
// ---------------------------------------------------------------------------
import { db } from "./firebase-init.js";
import { requireAuth, escapeHtml, formatTaka, toast } from "./app-shell.js";
import {
    collection, doc, getDoc, onSnapshot, query, where, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let sales = [];
let expenses = [];
let products = [];
let customers = [];
let employees = [];
let aiProvider = '';
let aiApiKey = '';

const SUGGESTIONS = [
    "What were today's sales?",
    "What's low on stock?",
    "Who owes me money?",
    "What's this month's net profit?",
    "How many employees do I have?",
    "Top selling products?",
];

requireAuth(async (user, ctx) => {
    const businessId = ctx.businessId;
    onSnapshot(query(collection(db, 'sales'), where('businessId', '==', businessId), orderBy('createdAt', 'desc'), limit(1000)), (snap) => {
        sales = []; snap.forEach((d) => sales.push({ id: d.id, ...d.data() }));
    });
    onSnapshot(query(collection(db, 'expenses'), where('businessId', '==', businessId), orderBy('createdAt', 'desc'), limit(500)), (snap) => {
        expenses = []; snap.forEach((d) => expenses.push({ id: d.id, ...d.data() }));
    });
    onSnapshot(query(collection(db, 'products'), where('businessId', '==', businessId)), (snap) => {
        products = []; snap.forEach((d) => products.push({ id: d.id, ...d.data() }));
    });
    onSnapshot(query(collection(db, 'customers'), where('businessId', '==', businessId)), (snap) => {
        customers = []; snap.forEach((d) => customers.push({ id: d.id, ...d.data() }));
    });
    onSnapshot(query(collection(db, 'employees'), where('businessId', '==', businessId)), (snap) => {
        employees = []; snap.forEach((d) => employees.push({ id: d.id, ...d.data() }));
    });

    try {
        const settingsSnap = await getDoc(doc(db, 'settings', businessId));
        if (settingsSnap.exists()) {
            aiProvider = settingsSnap.data().aiProvider || '';
            aiApiKey = settingsSnap.data().aiApiKey || '';
        }
    } catch (err) {
        console.error('Could not load AI provider settings:', err);
    }
    updateStatusBanner();

    renderSuggestions();
    addBotMessage(aiProvider
        ? `Hi! I'm your business assistant, connected to ${aiProvider === 'openai' ? 'OpenAI' : 'Google Gemini'}. Ask me anything about your business.`
        : "Hi! I'm your business assistant. Ask me about sales, stock, dues, payroll, or profit — try one of the suggestions below.");

    document.getElementById('chatForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('chatInput');
        const text = input.value.trim();
        if (!text) return;
        addUserMessage(text);
        input.value = '';
        await askAndReply(text);
    });
});

function updateStatusBanner() {
    const el = document.getElementById('aiStatusBanner');
    if (!el) return;
    if (aiProvider && aiApiKey) {
        el.innerHTML = `<i class="fa-solid fa-circle-check mr-1.5" style="color:var(--emerald,#10B981)"></i>Connected to ${aiProvider === 'openai' ? 'OpenAI' : 'Google Gemini'} — questions and a summary of your business data are sent to your own account.`;
    } else {
        el.innerHTML = `<i class="fa-solid fa-circle-info mr-1.5"></i>Running the free built-in assistant (no data leaves your browser). <a class="text-primary font-medium underline" href="settings.html">Connect an API key</a> for smarter, open-ended answers.`;
    }
}

async function askAndReply(text) {
    if (aiProvider && aiApiKey) {
        const typingEl = addBotMessage('<i class="fa-solid fa-ellipsis fa-fade"></i>');
        try {
            const answer = await askProvider(text);
            typingEl.innerHTML = escapeHtml(answer).replace(/\n/g, '<br>');
            return;
        } catch (err) {
            console.error('AI provider call failed, falling back to offline assistant:', err);
            toast('Could not reach the AI provider — answering from local data instead', 'error');
            typingEl.innerHTML = generateAnswer(text);
            return;
        }
    }
    setTimeout(() => addBotMessage(generateAnswer(text)), 250);
}

/** Compact text summary of the business's live data, given to the LLM as context. */
function snapshotSummary() {
    const now = new Date();
    const todays = sales.filter((s) => s.createdAt && isSameDay(s.createdAt.toDate(), now));
    const todaysTotal = todays.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
    const low = products.filter((p) => (Number(p.stock) || 0) <= (Number(p.lowStockThreshold) || 5));
    const withDue = customers.filter((c) => (Number(c.dueAmount) || 0) > 0);
    const dueTotal = withDue.reduce((sum, c) => sum + (Number(c.dueAmount) || 0), 0);
    const start = monthStart();
    const monthIncome = sales.filter((s) => s.createdAt && s.createdAt.toDate() >= start).reduce((sum, s) => sum + (Number(s.total) || 0), 0);
    const monthExpense = expenses.filter((e) => e.createdAt && e.createdAt.toDate() >= start).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const activeEmployees = employees.filter((e) => (e.status || 'active') === 'active');

    return [
        `Today's sales: ${todays.length} sale(s) totaling ${formatTaka(todaysTotal)}.`,
        `Products in inventory: ${products.length}. Low on stock (${low.length}): ${low.slice(0, 15).map((p) => `${p.name || 'Unnamed'} (${Number(p.stock) || 0} left)`).join(', ') || 'none'}.`,
        `Customers: ${customers.length}. ${withDue.length} owe a combined ${formatTaka(dueTotal)}.`,
        `This month so far: income ${formatTaka(monthIncome)}, expenses ${formatTaka(monthExpense)}, net ${formatTaka(monthIncome - monthExpense)}.`,
        `Active employees: ${activeEmployees.length}, combined monthly salary budget ${formatTaka(activeEmployees.reduce((sum, e) => sum + (Number(e.monthlySalary) || 0), 0))}.`,
    ].join('\n');
}

async function askProvider(question) {
    const systemPrompt = `You are a helpful business assistant inside a POS & inventory app. Answer the owner's question using ONLY the business data summary below. Be concise (2-4 sentences), use plain text (no markdown), and mention concrete numbers where relevant.\n\nBusiness data summary:\n${snapshotSummary()}`;

    if (aiProvider === 'openai') {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiApiKey}` },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: question }],
                max_tokens: 400,
            }),
        });
        if (!res.ok) throw new Error(`OpenAI request failed: ${res.status}`);
        const data = await res.json();
        const answer = data.choices?.[0]?.message?.content;
        if (!answer) throw new Error('OpenAI returned no answer');
        return answer.trim();
    }

    if (aiProvider === 'gemini') {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(aiApiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `${systemPrompt}\n\nOwner's question: ${question}` }] }],
            }),
        });
        if (!res.ok) throw new Error(`Gemini request failed: ${res.status}`);
        const data = await res.json();
        const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!answer) throw new Error('Gemini returned no answer');
        return answer.trim();
    }

    throw new Error(`Unknown AI provider: ${aiProvider}`);
}

function renderSuggestions() {
    const row = document.getElementById('suggestionRow');
    row.innerHTML = SUGGESTIONS.map((s) => `<button class="text-xs px-3 py-1.5 rounded-full" data-suggestion="${escapeHtml(s)}" style="background:var(--bg-surface-alt); border:1px solid var(--border-subtle)" type="button">${escapeHtml(s)}</button>`).join('');
    row.querySelectorAll('[data-suggestion]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            addUserMessage(btn.dataset.suggestion);
            await askAndReply(btn.dataset.suggestion);
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

/** Appends a bot message bubble and returns its inner content element, so callers can update it later (e.g. typing indicator -> real answer). */
function addBotMessage(html) {
    const log = document.getElementById('chatLog');
    const wrapper = document.createElement('div');
    wrapper.className = 'flex items-start gap-2.5';
    wrapper.innerHTML = `
        <div class="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5"><i class="fa-solid fa-wand-magic-sparkles text-xs"></i></div>
        <div class="max-w-[80%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm surface" style="border-color:var(--border-subtle)">${html}</div>
    `;
    log.appendChild(wrapper);
    log.scrollTop = log.scrollHeight;
    return wrapper.querySelector('div:last-child');
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
