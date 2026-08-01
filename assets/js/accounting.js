// ---------------------------------------------------------------------------
// Accounting page: income is derived automatically from the "sales"
// collection (written by pos.js); expenses are logged manually here into an
// "expenses" collection. Shows a merged, sortable ledger + summary KPIs.
// ---------------------------------------------------------------------------
import { db } from "./firebase-init.js";
import { requireAuth, escapeHtml, formatTaka, toast } from "./app-shell.js";
import {
    collection, query, orderBy, limit, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let sales = [];
let expenses = [];
let range = 'month'; // 'month' | 'all'
let currentUser = null;

requireAuth((user) => {
    currentUser = user;
    document.getElementById('eDate').valueAsDate = new Date();

    onSnapshot(query(collection(db, 'sales'), orderBy('createdAt', 'desc'), limit(300)), (snap) => {
        sales = [];
        snap.forEach((d) => sales.push({ id: d.id, ...d.data() }));
        render();
    }, (err) => { console.error(err); toast('Could not load sales data', 'error'); });

    onSnapshot(query(collection(db, 'expenses'), orderBy('createdAt', 'desc'), limit(300)), (snap) => {
        expenses = [];
        snap.forEach((d) => expenses.push({ id: d.id, ...d.data() }));
        render();
    }, (err) => { console.error(err); toast('Could not load expenses — check Firestore rules', 'error'); });

    document.querySelectorAll('.range-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            range = btn.dataset.range;
            document.querySelectorAll('.range-btn').forEach((b) => b.classList.toggle('lang-active', b === btn));
            render();
        });
    });

    document.getElementById('addExpenseBtn').addEventListener('click', () => {
        document.getElementById('expenseModal').classList.remove('hidden');
        document.getElementById('expenseModal').classList.add('flex');
    });
    document.getElementById('closeExpenseModal').addEventListener('click', closeExpenseModal);
    document.getElementById('expenseModal').addEventListener('click', (e) => {
        if (e.target.id === 'expenseModal') closeExpenseModal();
    });
    document.getElementById('expenseForm').addEventListener('submit', onAddExpense);

    document.getElementById('txTableBody').addEventListener('click', (e) => {
        const del = e.target.closest('[data-del-expense]');
        if (del) onDeleteExpense(del.dataset.delExpense);
    });
});

function closeExpenseModal() {
    document.getElementById('expenseModal').classList.add('hidden');
    document.getElementById('expenseModal').classList.remove('flex');
    document.getElementById('expenseForm').reset();
    document.getElementById('eDate').valueAsDate = new Date();
    document.getElementById('expenseFormError').classList.add('hidden');
}

function monthStart() {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
}

function inRange(dateObj) {
    if (range === 'all') return true;
    if (!dateObj) return false;
    return dateObj >= monthStart();
}

function render() {
    const rows = [];
    let income = 0, expenseTotal = 0;

    sales.forEach((s) => {
        const created = s.createdAt ? s.createdAt.toDate() : null;
        if (!inRange(created)) return;
        income += Number(s.total) || 0;
        const itemCount = Array.isArray(s.items) ? s.items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0) : 0;
        rows.push({
            date: created,
            type: 'income',
            desc: `Sale · ${itemCount} item${itemCount === 1 ? '' : 's'} (${s.paymentMethod || 'cash'})`,
            amount: Number(s.total) || 0,
        });
    });

    expenses.forEach((e) => {
        const created = e.createdAt ? e.createdAt.toDate() : (e.date ? new Date(e.date) : null);
        if (!inRange(created)) return;
        expenseTotal += Number(e.amount) || 0;
        rows.push({
            date: created,
            type: 'expense',
            desc: `${e.category || 'Expense'}${e.note ? ' · ' + e.note : ''}`,
            amount: Number(e.amount) || 0,
            id: e.id,
        });
    });

    rows.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));

    document.getElementById('sumIncome').textContent = formatTaka(income);
    document.getElementById('sumExpense').textContent = formatTaka(expenseTotal);
    const netEl = document.getElementById('sumNet');
    netEl.textContent = formatTaka(income - expenseTotal);
    netEl.style.color = (income - expenseTotal) < 0 ? '#EF4444' : '';

    const tbody = document.getElementById('txTableBody');
    document.getElementById('txCountLabel').textContent = `${rows.length} transaction${rows.length === 1 ? '' : 's'}`;

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td class="px-4 py-8 text-center" colspan="5" style="color:var(--text-secondary)">No transactions in this period yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map((r) => `
        <tr class="border-b" style="border-color:var(--border-subtle)">
            <td class="px-4 py-3" style="color:var(--text-secondary)">${r.date ? r.date.toLocaleDateString() : '—'}</td>
            <td class="px-4 py-3">
                <span class="text-xs font-semibold px-2 py-0.5 rounded-full ${r.type === 'income' ? 'bg-emerald/10 text-emerald' : 'bg-red-500/10 text-red-500'}">
                    ${r.type === 'income' ? 'Income' : 'Expense'}
                </span>
            </td>
            <td class="px-4 py-3">${escapeHtml(r.desc)}</td>
            <td class="px-4 py-3 text-right font-mono-fig font-semibold ${r.type === 'income' ? 'text-emerald' : 'text-red-500'}">
                ${r.type === 'income' ? '+' : '−'}${formatTaka(r.amount)}
            </td>
            <td class="px-4 py-3 text-right">
                ${r.type === 'expense' ? `<button class="h-8 w-8 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500" data-del-expense="${r.id}" title="Delete"><i class="fa-solid fa-trash text-xs"></i></button>` : ''}
            </td>
        </tr>
    `).join('');
}

async function onAddExpense(e) {
    e.preventDefault();
    const errEl = document.getElementById('expenseFormError');
    errEl.classList.add('hidden');
    const btn = document.getElementById('expenseSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const dateVal = document.getElementById('eDate').value;
        await addDoc(collection(db, 'expenses'), {
            category: document.getElementById('eCategory').value,
            amount: Number(document.getElementById('eAmount').value) || 0,
            note: document.getElementById('eNote').value.trim(),
            date: dateVal,
            createdBy: currentUser.uid,
            createdByName: currentUser.displayName || currentUser.email,
            createdAt: dateVal ? Timestamp.fromDate(new Date(dateVal)) : serverTimestamp(),
        });
        toast('Expense added');
        closeExpenseModal();
    } catch (err) {
        console.error(err);
        errEl.textContent = 'Could not save expense. Please try again.';
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Expense';
    }
}

async function onDeleteExpense(id) {
    if (!confirm('Delete this expense entry?')) return;
    try {
        await deleteDoc(doc(db, 'expenses', id));
        toast('Expense deleted');
    } catch (err) {
        console.error(err);
        toast('Could not delete expense', 'error');
    }
}
