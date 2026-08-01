// ---------------------------------------------------------------------------
// Customers page: live customer list (onSnapshot), add / edit / delete,
// plus a quick "Record Payment" action that reduces a customer's due
// (বাকি) balance.
// ---------------------------------------------------------------------------
import { db } from "./firebase-init.js";
import { requireAuth, escapeHtml, formatTaka, toast } from "./app-shell.js";
import {
    collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy, query, increment,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let allCustomers = [];
let searchTerm = '';

requireAuth(() => {
    const q = query(collection(db, 'customers'), orderBy('name'));
    onSnapshot(q, (snap) => {
        allCustomers = [];
        snap.forEach((docSnap) => allCustomers.push({ id: docSnap.id, ...docSnap.data() }));
        render();
    }, (err) => {
        console.error(err);
        document.getElementById('customerTableBody').innerHTML =
            `<tr><td class="px-4 py-6 text-center text-red-500" colspan="5">Could not load customers — check Firestore rules.</td></tr>`;
    });

    document.getElementById('customerSearch').addEventListener('input', (e) => {
        searchTerm = e.target.value.trim().toLowerCase();
        render();
    });

    document.getElementById('addCustomerBtn').addEventListener('click', () => openModal());
    document.getElementById('closeCustomerModal').addEventListener('click', closeModal);
    document.getElementById('customerModal').addEventListener('click', (e) => {
        if (e.target.id === 'customerModal') closeModal();
    });
    document.getElementById('customerForm').addEventListener('submit', onSubmit);

    document.getElementById('customerTableBody').addEventListener('click', (e) => {
        const editBtn = e.target.closest('[data-edit]');
        const delBtn = e.target.closest('[data-del]');
        const payBtn = e.target.closest('[data-pay]');
        if (editBtn) openModal(allCustomers.find((c) => c.id === editBtn.dataset.edit));
        if (delBtn) onDelete(delBtn.dataset.del, delBtn.dataset.name);
        if (payBtn) onRecordPayment(payBtn.dataset.pay, payBtn.dataset.name, Number(payBtn.dataset.due) || 0);
    });
});

function render() {
    const tbody = document.getElementById('customerTableBody');
    let list = allCustomers;
    if (searchTerm) {
        list = list.filter((c) =>
            (c.name || '').toLowerCase().includes(searchTerm) ||
            (c.phone || '').toLowerCase().includes(searchTerm));
    }

    const totalDue = allCustomers.reduce((sum, c) => sum + (Number(c.dueAmount) || 0), 0);
    const dueCount = allCustomers.filter((c) => (Number(c.dueAmount) || 0) > 0).length;

    document.getElementById('kpiCustomerCount').textContent = allCustomers.length;
    document.getElementById('kpiTotalDue').textContent = formatTaka(totalDue);
    document.getElementById('kpiDueCount').textContent = dueCount;
    document.getElementById('customerCountLabel').textContent =
        `${list.length} of ${allCustomers.length} customer${allCustomers.length === 1 ? '' : 's'}`;

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td class="px-4 py-8 text-center" colspan="5" style="color:var(--text-secondary)">
            ${allCustomers.length === 0 ? 'No customers yet — click "Add Customer" to get started.' : 'No customers match your search.'}
        </td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((c) => {
        const due = Number(c.dueAmount) || 0;
        return `
        <tr class="border-b" style="border-color:var(--border-subtle)">
            <td class="px-4 py-3 font-medium">${escapeHtml(c.name || '')}${c.note ? `<span class="block text-xs font-normal" style="color:var(--text-secondary)">${escapeHtml(c.note)}</span>` : ''}</td>
            <td class="px-4 py-3 font-mono-fig" style="color:var(--text-secondary)">${escapeHtml(c.phone || '—')}</td>
            <td class="px-4 py-3" style="color:var(--text-secondary)">${escapeHtml(c.address || '—')}</td>
            <td class="px-4 py-3 text-right font-mono-fig font-semibold ${due > 0 ? 'text-red-500' : ''}">${formatTaka(due)}</td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
                ${due > 0 ? `<button class="h-8 w-8 rounded-lg hover:bg-emerald/10 text-emerald" data-pay="${c.id}" data-name="${escapeHtml(c.name || '')}" data-due="${due}" title="Record Payment"><i class="fa-solid fa-money-bill-wave text-xs"></i></button>` : ''}
                <button class="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5" data-edit="${c.id}" title="Edit"><i class="fa-solid fa-pen text-xs"></i></button>
                <button class="h-8 w-8 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500" data-del="${c.id}" data-name="${escapeHtml(c.name || '')}" title="Delete"><i class="fa-solid fa-trash text-xs"></i></button>
            </td>
        </tr>
    `;
    }).join('');
}

function openModal(customer) {
    const form = document.getElementById('customerForm');
    form.reset();
    document.getElementById('customerFormError').classList.add('hidden');
    if (customer) {
        document.getElementById('customerModalTitle').textContent = 'Edit Customer';
        document.getElementById('customerId').value = customer.id;
        document.getElementById('cName').value = customer.name || '';
        document.getElementById('cPhone').value = customer.phone || '';
        document.getElementById('cAddress').value = customer.address || '';
        document.getElementById('cDue').value = customer.dueAmount ?? 0;
        document.getElementById('cNote').value = customer.note || '';
    } else {
        document.getElementById('customerModalTitle').textContent = 'Add Customer';
        document.getElementById('customerId').value = '';
        document.getElementById('cDue').value = 0;
    }
    document.getElementById('customerModal').classList.remove('hidden');
    document.getElementById('customerModal').classList.add('flex');
}

function closeModal() {
    document.getElementById('customerModal').classList.add('hidden');
    document.getElementById('customerModal').classList.remove('flex');
}

async function onSubmit(e) {
    e.preventDefault();
    const errEl = document.getElementById('customerFormError');
    errEl.classList.add('hidden');
    const btn = document.getElementById('customerSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const id = document.getElementById('customerId').value;
    const payload = {
        name: document.getElementById('cName').value.trim(),
        phone: document.getElementById('cPhone').value.trim(),
        address: document.getElementById('cAddress').value.trim(),
        dueAmount: Number(document.getElementById('cDue').value) || 0,
        note: document.getElementById('cNote').value.trim(),
        updatedAt: serverTimestamp(),
    };

    try {
        if (id) {
            await updateDoc(doc(db, 'customers', id), payload);
            toast('Customer updated');
        } else {
            payload.createdAt = serverTimestamp();
            await addDoc(collection(db, 'customers'), payload);
            toast('Customer added');
        }
        closeModal();
    } catch (err) {
        console.error(err);
        errEl.textContent = 'Could not save customer. Please try again.';
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Customer';
    }
}

async function onDelete(id, name) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
        await deleteDoc(doc(db, 'customers', id));
        toast('Customer deleted');
    } catch (err) {
        console.error(err);
        toast('Could not delete customer', 'error');
    }
}

async function onRecordPayment(id, name, currentDue) {
    const input = prompt(`Record payment from ${name} (current due: ৳${currentDue}):`, currentDue);
    if (input === null) return;
    const amount = Number(input);
    if (!amount || amount <= 0) { toast('Enter a valid payment amount', 'error'); return; }
    try {
        await updateDoc(doc(db, 'customers', id), {
            dueAmount: increment(-Math.min(amount, currentDue)),
            updatedAt: serverTimestamp(),
        });
        toast('Payment recorded');
    } catch (err) {
        console.error(err);
        toast('Could not record payment', 'error');
    }
}
