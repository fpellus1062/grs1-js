const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function cargarHelpers() {
  const app = {
    _asig: {},
    asignacionesState: {
      meta: {
        actividades: [
          { id_actividad: 1, disponible: 'Normal' },
          { id_actividad: 2, disponible: 'Pernocta' },
          { id_actividad: 3, disponible: null },
        ],
      },
    },
  };
  const filename = path.join(__dirname, '..', 'public', 'js', 'dashboard-asignaciones-modals.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { window: { GRS1Dashboard: app } }, { filename });
  return app._asig;
}

test('el turno responde al switch y al tipo de todas las actividades seleccionadas', () => {
  const { getTurnoAsignacion } = cargarHelpers();
  assert.equal(getTurnoAsignacion([1, 3], false), 1);
  assert.equal(getTurnoAsignacion([1, 3], true), 99999);
  assert.equal(getTurnoAsignacion([2], false), 99999);
  assert.equal(getTurnoAsignacion([1, 2], false), 99999);
  assert.equal(getTurnoAsignacion([1], false), 1);
});

test('el switch restaura su estado e indica Sí o No al cambiar', () => {
  const { configurarPernoctas } = cargarHelpers();
  const input = { checked: false, onchange: null };
  const label = { textContent: '' };
  configurarPernoctas(input, label, true);
  assert.equal(input.checked, true);
  assert.equal(label.textContent, 'Sí');
  input.checked = false;
  input.onchange();
  assert.equal(label.textContent, 'No');
  configurarPernoctas(input, label, false);
  assert.equal(input.checked, false);
});

test('el modal individual envía el turno de pernocta según la actividad seleccionada', async () => {
  const requests = [];
  let html = '';
  const elements = {};
  const element = () => ({
    value: '',
    dataset: {},
    classList: { add() {} },
    setAttribute() {},
    addEventListener() {},
  });
  [
    'asigCellModal', 'asigCellContext', 'asigCellTurno', 'asigCellActividades',
    'asigCellPernoctas', 'asigCellPernoctasLabel', 'asigCellObservaciones', 'btnSaveAsigCell',
  ].forEach((id) => { elements[id] = element(); });
  elements.asigCellModal.parentNode = { removeChild() {} };
  elements.asigCellModal.contains = () => false;
  elements.asigCellActividades.querySelectorAll = (selector) =>
    selector === '.asig-act-item.selected' ? [{ dataset: { value: '2' } }] : [];
  elements.btnSaveAsigCell.cloneNode = () => element();
  elements.btnSaveAsigCell.parentNode = {
    replaceChild(newButton) { elements.btnSaveAsigCell = newButton; },
  };
  const app = {
    _asig: {
      makeModalDraggable() {},
      getPeriodo: () => ({ anio: 2026, mes: 8 }),
      getSelectedBorradorId: () => 1,
      showAlert() {},
    },
    globalState: { token: 'test' },
    asignacionesState: {
      meta: {
        actividades: [{ id_actividad: 2, nombre: 'Actividad', disponible: 'Pernocta' }],
        turnos: [],
      },
    },
    escapeHtml: (value) => String(value),
  };
  const document = {
    getElementById: (id) => elements[id] || null,
    createElement: () => ({
      set innerHTML(value) { html = value; },
      firstElementChild: elements.asigCellModal,
    }),
    body: { appendChild() {} },
    activeElement: null,
  };
  const modal = { show() {}, hide() {} };
  const filename = path.join(__dirname, '..', 'public', 'js', 'dashboard-asignaciones-modals.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    window: { GRS1Dashboard: app },
    document,
    bootstrap: { Modal: { getOrCreateInstance: () => modal } },
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  }, { filename });

  app.openAsignacionCellModal({
    agente_id: 3, fecha: '2026-08-03', turno_id: 1, actividad_ids: [2],
  });
  assert.ok(html.indexOf('id="asigCellPernoctas"') < html.indexOf('id="asigCellObservaciones"'));
  assert.equal(elements.asigCellPernoctas.checked, false);
  await elements.btnSaveAsigCell.onclick();
  assert.equal(requests[0].url, '/api/asignaciones/upsert');
  assert.equal(requests[0].body.turno_id, 99999);
  assert.deepEqual(requests[0].body.actividad_ids, [2]);
});
