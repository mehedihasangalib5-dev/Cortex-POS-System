// ---------------------------------------------------------------------------
// HR & Payroll page: employee CRUD (employees collection) + a payroll log
// (payrollRecords collection). Logging a payment optionally also writes a
// matching "Salary" expense so it shows up on the Accounting page.
// ---------------------------------------------------------------------------
import { db } from "./firebase-init.js";
import { requireAuth, escapeHtml, formatTaka, toast } from "./app-shell.js";
import {
    collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy, query, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let allEmployees = [];
let allPayroll = [];
let currentUser = null;

requireAuth((user) => {
    currentUser = user;
    document.getElementById('pDate').valueAsDate = new Date();
    const now = new Date();
    document.getElementById('pMonth').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    onSnapshot(query(collection(db, 'employees'), orderBy('name')), (snap) => {
        allEmployees = [];
        snap.forEach((d) => allEmployees.push({ id: d.id, ...d.data() }));
        renderEmployees();
        renderEmployeeOptions();
        renderKpis();
    }, (err) => {
        console.error(err);
        document.getElementById('employeeTableBody').innerHTML =
            `<tr><td class="px-4 py-6 text-center text-red-500" colspan="6">Could not load employees — check Firestore rules.</td></tr>`;
    });

    onSnapshot(query(collection(db, 'payrollRecords'), orderBy('createdAt', 'desc')), (snap) => {
        allPayroll = [];
        snap.forEach((d) => allPayroll.push({ id: d.id, ...d.data() }));
        renderPayroll();
        renderKpis();
    }, (err) => {
        console.error(err);
        document.getElementById('payrollTableBody').innerHTML =
            `<tr><td class="px-4 py-6 text-center text-red-500" colspan="5">Could not load payroll history — check Firestore rules.</td></tr>`;
    });

    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('lang-active', b === btn));
            document.getElementById('tab-employees').classList.toggle('hidden', btn.dataset.tab !== 'employees');
            document.getElementById('tab-payroll').classList.toggle('hidden', btn.dataset.tab !== 'payroll');
        });
    });

    document.getElementById('addEmployeeBtn').addEventListener('click', () => openEmployeeModal());
    document.getElementById('closeEmployeeModal').addEventListener('click', closeEmployeeModal);
    document.getElementById('employeeModal').addEventListener('click', (e) => { if (e.target.id === 'employeeModal') closeEmployeeModal(); });
    document.getElementById('employeeForm').addEventListener('submit', onSubmitEmployee);
    document.getElementById('employeeTableBody').addEventListener('click', (e) => {
        const editBtn = e.target.closest('[data-edit]');
        const delBtn = e.target.closest('[data-del]');
        if (editBtn) openEmployeeModal(allEmployees.find((x) => x.id === editBtn.dataset.edit));
        if (delBtn) onDeleteEmployee(delBtn.dataset.del, delBtn.dataset.name);
    });

    document.getElementById('payRunBtn').addEventListener('click', () => openPayrollModal());
    document.getElementById('closePayrollModal').addEventListener('click', closePayrollModal);
    document.getElementById('payrollModal').addEventListener('click', (e) => { if (e.target.id === 'payrollModal') closePayrollModal(); });
    document.getElementById('payrollForm').addEventListener('submit', onSubmitPayroll);
    document.getElementById('pEmployee').addEventListener('change', (e) => {
        const emp = allEmployees.find((x) => x.id === e.target.value);
        if (emp) document.getElementById('pAmount').value = emp.monthlySalary ?? '';
    });
    document.getElementById('payrollTableBody').addEventListener('click', (e) => {
        const delBtn = e.target.closest('[data-del-payroll]');
        if (delBtn) onDeletePayroll(delBtn.dataset.delPayroll);
    });
});

function renderKpis() {
    const active = allEmployees.filter((e) => (e.status || 'active') === 'active');
    const budget = active.reduce((sum, e) => sum + (Number(e.monthlySalary) || 0), 0);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const paidThisMonth = allPayroll.reduce((sum, p) => {
        const created = p.createdAt ? p.createdAt.toDate() : null;
        if (created && created >= monthStart) return sum + (Number(p.amount) || 0);
        return sum;
    }, 0);

    document.getElementById('kpiEmployeeCount').textContent = active.length;
    document.getElementById('kpiMonthlyBudget').textContent = formatTaka(budget);
    document.getElementById('kpiPaidThisMonth').textContent = formatTaka(paidThisMonth);
}

function renderEmployees() {
    const tbody = document.getElementById('employeeTableBody');
    if (allEmployees.length === 0) {
        tbody.innerHTML = `<tr><td class="px-4 py-8 text-center" colspan="6" style="color:var(--text-secondary)">No employees yet — click "Add Employee" to get started.</td></tr>`;
        return;
    }
    tbody.innerHTML = allEmployees.map((e) => `
        <tr class="border-b" style="border-color:var(--border-subtle)">
            <td class="px-4 py-3 font-medium">${escapeHtml(e.name || '')}</td>
            <td class="px-4 py-3" style="color:var(--text-secondary)">${escapeHtml(e.role || '—')}</td>
            <td class="px-4 py-3 font-mono-fig" style="color:var(--text-secondary)">${escapeHtml(e.phone || '—')}</td>
            <td class="px-4 py-3 text-right font-mono-fig font-semibold">${formatTaka(e.monthlySalary)}</td>
            <td class="px-4 py-3">
                <span class="text-xs font-semibold px-2 py-0.5 rounded-full ${(e.status || 'active') === 'active' ? 'bg-emerald/10 text-emerald' : 'bg-red-500/10 text-red-500'}">
                    ${(e.status || 'active') === 'active' ? 'Active' : 'Inactive'}
                </span>
            </td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
                <button class="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5" data-edit="${e.id}" title="Edit"><i class="fa-solid fa-pen text-xs"></i></button>
                <button class="h-8 w-8 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500" data-del="${e.id}" data-name="${escapeHtml(e.name || '')}" title="Delete"><i class="fa-solid fa-trash text-xs"></i></button>
            </td>
        </tr>
    `).join('');
}

function renderEmployeeOptions() {
    const select = document.getElementById('pEmployee');
    const active = allEmployees.filter((e) => (e.status || 'active') === 'active');
    select.innerHTML = active.length
        ? active.map((e) => `<option value="${e.id}">${escapeHtml(e.name || '')}</option>`).join('')
        : '<option value="">No active employees — add one first</option>';
}

function renderPayroll() {
    const tbody = document.getElementById('payrollTableBody');
    if (allPayroll.length === 0) {
        tbody.innerHTML = `<tr><td class="px-4 py-8 text-center" colspan="5" style="color:var(--text-secondary)">No salary payments logged yet.</td></tr>`;
        return;
    }
    tbody.innerHTML = allPayroll.map((p) => {
        const created = p.createdAt ? p.createdAt.toDate() : null;
        return `
        <tr class="border-b" style="border-color:var(--border-subtle)">
            <td class="px-4 py-3" style="color:var(--text-secondary)">${created ? created.toLocaleDateString() : '—'}</td>
            <td class="px-4 py-3 font-medium">${escapeHtml(p.employeeName || '')}</td>
            <td class="px-4 py-3" style="color:var(--text-secondary)">${escapeHtml(p.month || '—')}</td>
            <td class="px-4 py-3 text-right font-mono-fig font-semibold">${formatTaka(p.amount)}</td>
            <td class="px-4 py-3 text-right">
                <button class="h-8 w-8 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500" data-del-payroll="${p.id}" title="Delete"><i class="fa-solid fa-trash text-xs"></i></button>
            </td>
        </tr>
    `;
    }).join('');
}

function openEmployeeModal(employee) {
    const form = document.getElementById('employeeForm');
    form.reset();
    document.getElementById('employeeFormError').classList.add('hidden');
    if (employee) {
        document.getElementById('employeeModalTitle').textContent = 'Edit Employee';
        document.getElementById('employeeId').value = employee.id;
        document.getElementById('eName').value = employee.name || '';
        document.getElementById('eRole').value = employee.role || '';
        document.getElementById('ePhone').value = employee.phone || '';
        document.getElementById('eSalary').value = employee.monthlySalary ?? '';
        document.getElementById('eJoinDate').value = employee.joinDate || '';
        document.getElementById('eStatus').value = employee.status || 'active';
    } else {
        document.getElementById('employeeModalTitle').textContent = 'Add Employee';
        document.getElementById('employeeId').value = '';
    }
    document.getElementById('employeeModal').classList.remove('hidden');
    document.getElementById('employeeModal').classList.add('flex');
}

function closeEmployeeModal() {
    document.getElementById('employeeModal').classList.add('hidden');
    document.getElementById('employeeModal').classList.remove('flex');
}

async function onSubmitEmployee(e) {
    e.preventDefault();
    const errEl = document.getElementById('employeeFormError');
    errEl.classList.add('hidden');
    const btn = document.getElementById('employeeSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const id = document.getElementById('employeeId').value;
    const payload = {
        name: document.getElementById('eName').value.trim(),
        role: document.getElementById('eRole').value.trim(),
        phone: document.getElementById('ePhone').value.trim(),
        monthlySalary: Number(document.getElementById('eSalary').value) || 0,
        joinDate: document.getElementById('eJoinDate').value,
        status: document.getElementById('eStatus').value,
        updatedAt: serverTimestamp(),
    };

    try {
        if (id) {
            await updateDoc(doc(db, 'employees', id), payload);
            toast('Employee updated');
        } else {
            payload.createdAt = serverTimestamp();
            await addDoc(collection(db, 'employees'), payload);
            toast('Employee added');
        }
        closeEmployeeModal();
    } catch (err) {
        console.error(err);
        errEl.textContent = 'Could not save employee. Please try again.';
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Employee';
    }
}

async function onDeleteEmployee(id, name) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
        await deleteDoc(doc(db, 'employees', id));
        toast('Employee deleted');
    } catch (err) {
        console.error(err);
        toast('Could not delete employee', 'error');
    }
}

function openPayrollModal() {
    document.getElementById('payrollForm').reset();
    document.getElementById('payrollFormError').classList.add('hidden');
    document.getElementById('pDate').valueAsDate = new Date();
    renderEmployeeOptions();
    if (allEmployees.length) {
        const first = allEmployees.find((e) => (e.status || 'active') === 'active');
        if (first) document.getElementById('pAmount').value = first.monthlySalary ?? '';
    }
    document.getElementById('payrollModal').classList.remove('hidden');
    document.getElementById('payrollModal').classList.add('flex');
}

function closePayrollModal() {
    document.getElementById('payrollModal').classList.add('hidden');
    document.getElementById('payrollModal').classList.remove('flex');
}

async function onSubmitPayroll(e) {
    e.preventDefault();
    const errEl = document.getElementById('payrollFormError');
    errEl.classList.add('hidden');
    const btn = document.getElementById('payrollSubmitBtn');

    const empId = document.getElementById('pEmployee').value;
    const emp = allEmployees.find((x) => x.id === empId);
    if (!emp) {
        errEl.textContent = 'Please add an employee first.';
        errEl.classList.remove('hidden');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving...';
    const dateVal = document.getElementById('pDate').value;
    const amount = Number(document.getElementById('pAmount').value) || 0;
    const monthVal = document.getElementById('pMonth').value;
    const addExpense = document.getElementById('pAddExpense').checked;

    try {
        await addDoc(collection(db, 'payrollRecords'), {
            employeeId: emp.id,
            employeeName: emp.name,
            month: monthVal,
            amount,
            createdBy: currentUser.uid,
            createdAt: dateVal ? Timestamp.fromDate(new Date(dateVal)) : serverTimestamp(),
        });

        if (addExpense) {
            await addDoc(collection(db, 'expenses'), {
                category: 'Salary',
                amount,
                note: `Salary · ${emp.name}${monthVal ? ' · ' + monthVal : ''}`,
                date: dateVal,
                createdBy: currentUser.uid,
                createdByName: currentUser.displayName || currentUser.email,
                createdAt: dateVal ? Timestamp.fromDate(new Date(dateVal)) : serverTimestamp(),
            });
        }

        toast('Salary payment logged');
        closePayrollModal();
    } catch (err) {
        console.error(err);
        errEl.textContent = 'Could not save payment. Please try again.';
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Payment';
    }
}

async function onDeletePayroll(id) {
    if (!confirm('Delete this payroll record? (Any linked expense entry will remain and must be removed separately from Accounting.)')) return;
    try {
        await deleteDoc(doc(db, 'payrollRecords', id));
        toast('Payroll record deleted');
    } catch (err) {
        console.error(err);
        toast('Could not delete record', 'error');
    }
}
