const API = '/api/help';

let helpModal, deleteModal;
let pendingDeleteId = null;
let allItems = [];

// --- Bootstrap modals init ---
document.addEventListener('DOMContentLoaded', () => {
  helpModal = new bootstrap.Modal(document.getElementById('helpItemModal'));
  deleteModal = new bootstrap.Modal(document.getElementById('deleteModal'));

  // Reset form on modal hidden
  document
    .getElementById('helpItemModal')
    .addEventListener('hidden.bs.modal', () => {
      document.getElementById('helpForm').reset();
      document.getElementById('editId').value = '';
      document.getElementById('helpItemModalLabel').textContent =
        'Nuevo help item';
    });

  // Submit form
  document.getElementById('helpForm').addEventListener('submit', handleSubmit);

  // Confirm delete
  document
    .getElementById('btnConfirmDelete')
    .addEventListener('click', confirmDelete);

  // Reload button
  document.getElementById('btnReload').addEventListener('click', loadData);

  // Filter
  document.getElementById('filterType').addEventListener('change', renderTable);

  // Event delegation for edit/delete buttons in table
  document.getElementById('tableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    const item = allItems.find((i) => i.id === id);
    if (!item) return;
    if (action === 'edit') openEditModal(item);
    if (action === 'delete') openDeleteModal(item);
  });

  loadData();
});

// --- Load data from API ---
async function loadData() {
  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error(`Error ${res.status}`);
    const data = await res.json();
    allItems = data.result || [];
    renderTable();
  } catch (err) {
    showTableError(err.message);
  }
}

// --- Render table with optional type filter ---
function renderTable() {
  const filter = document.getElementById('filterType').value;
  const items = filter ? allItems.filter((i) => i.type === filter) : allItems;
  const tbody = document.getElementById('tableBody');

  document.getElementById('badgeCount').textContent = allItems.length;

  if (items.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="text-center text-muted py-4">Sin resultados</td></tr>';
    return;
  }

  const TYPE_BADGE = {
    tooltip: 'bg-info text-dark',
    modal: 'bg-warning text-dark',
    page: 'bg-secondary',
  };

  tbody.innerHTML = '';
  items.forEach((item) => {
    const tr = document.createElement('tr');

    const tdId = document.createElement('td');
    tdId.textContent = item.id;

    const tdTitle = document.createElement('td');
    tdTitle.textContent = item.title;

    const tdContent = document.createElement('td');
    const preview = document.createElement('span');
    preview.className = 'help-content-preview';
    preview.textContent = item.content;
    tdContent.appendChild(preview);

    const tdType = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge type-badge ${TYPE_BADGE[item.type] || 'bg-secondary'}`;
    badge.textContent = item.type;
    tdType.appendChild(badge);

    const tdCtx = document.createElement('td');
    tdCtx.textContent = item.context;

    const tdActions = document.createElement('td');
    tdActions.className = 'text-end';
    tdActions.innerHTML = `
      <button class="btn btn-outline-warning btn-sm py-0 px-1 me-1" style="font-size:.75rem"
        data-action="edit" data-id="${item.id}" title="Editar">
        <i class="bi bi-pencil"></i>
      </button>
      <button class="btn btn-outline-danger btn-sm py-0 px-1" style="font-size:.75rem"
        data-action="delete" data-id="${item.id}" title="Eliminar">
        <i class="bi bi-trash"></i>
      </button>`;

    tr.append(tdId, tdTitle, tdContent, tdType, tdCtx, tdActions);
    tbody.appendChild(tr);
  });
}

// --- Open edit modal ---
function openEditModal(item) {
  document.getElementById('editId').value = item.id;
  document.getElementById('inputTitle').value = item.title;
  document.getElementById('inputContent').value = item.content;
  document.getElementById('inputType').value = item.type;
  document.getElementById('inputContext').value = item.context;
  document.getElementById('helpItemModalLabel').textContent =
    'Editar help item';
  helpModal.show();
}

// --- Open delete confirmation modal ---
function openDeleteModal(item) {
  pendingDeleteId = item.id;
  document.getElementById('deleteItemTitle').textContent = `"${item.title}"`;
  deleteModal.show();
}

// --- Form submit (create / update) ---
async function handleSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('editId').value;
  const payload = {
    title: document.getElementById('inputTitle').value.trim(),
    content: document.getElementById('inputContent').value.trim(),
    type: document.getElementById('inputType').value,
    context: document.getElementById('inputContext').value.trim(),
  };

  if (!payload.title || !payload.content || !payload.context) return;

  try {
    const url = id ? `${API}/${id}` : API;
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    helpModal.hide();
    await loadData();
  } catch (err) {
    alert(`No se pudo guardar: ${err.message}`);
  }
}

// --- Confirm delete ---
async function confirmDelete() {
  if (!pendingDeleteId) return;
  try {
    const res = await fetch(`${API}/${pendingDeleteId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    deleteModal.hide();
    pendingDeleteId = null;
    await loadData();
  } catch (err) {
    alert(`No se pudo eliminar: ${err.message}`);
  }
}

// --- Show error in table ---
function showTableError(msg) {
  const tbody = document.getElementById('tableBody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4"><i class="bi bi-exclamation-triangle me-1"></i>${msg}</td></tr>`;
  }
}
