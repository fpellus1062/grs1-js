const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');

function dashboardHarness(options = {}) {
  class Control {
    constructor(value = '') {
      this.value = value;
      this.dataset = {};
      this.innerHTML = '';
      this.listeners = {};
    }
    addEventListener(name, callback) { this.listeners[name] = callback; }
  }
  class Select extends Control {
    set innerHTML(html) {
      this.html = html;
      const match = html.match(/<option value="([^"]*)"/);
      this.value = match ? match[1] : '';
    }
    get innerHTML() { return this.html; }
  }
  const elements = {
    reqAsignarPlantilla: new Select(),
    reqAsignarFechaRef: new Control('2026-01-01'),
    reqAsignarSelCount: new Control(),
    alertContainerAgentesRequisitos: new Control(),
    reqPlantillaModal: new Control(),
    reqPlantillaId: new Control(),
    reqPlantillaNombre: new Control('Tiro'),
    reqPlantillaPeriodicidad: new Control('anual'),
    reqPlantillaPlazoDias: new Control(),
    reqPlantillaPeriodoInicio: new Control(),
    reqPlantillaPeriodoFin: new Control(),
    reqPlantillaTipo: new Control('tiro'),
    reqPlantillaObjetivoTotal: new Control('1'),
    reqPlantillaObjetivosRaw: new Control('Prueba:1'),
    reqPlantillaDescripcion: new Control(),
    reqConfirmDeactivateModal: new Control(),
    reqConfirmDeactivateLabel: new Control(),
    reqConfirmDeactivateText: new Control(),
    reqConfirmDeactivateDetail: new Control(),
    btnReqConfirmDeactivate: new Control(),
    btnReqEliminarAsignaciones: new Control(),
  };
  const table = {
    rows: [{ id: 11 }, { id: 12 }],
    selected: [{ id: 11 }, { id: 12 }],
    getSelectedData() { return this.selected; },
    async replaceData(rows) { this.rows = rows; this.selected = []; },
    selectRow(ids) { this.selected = this.rows.filter((row) => ids.includes(Number(row.id))); },
    deselectRow() { this.selected = []; },
  };
  const requests = [];
  let plantillas = [];
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/agentes/requisitos/plantillas' && options.method === 'POST') {
      plantillas = [{ id: 17, nombre: 'Tiro' }];
      return { ok: true, json: async () => ({ ok: true, plantilla: plantillas[0] }) };
    }
    if (url === '/api/agentes/requisitos/meta') {
      return { ok: true, json: async () => ({ plantillas, agentes: [{ id: 11 }, { id: 12 }] }) };
    }
    if (url.includes('/plantillas?')) {
      return { ok: true, json: async () => ({ plantillas }) };
    }
    if (url === '/api/agentes/requisitos/asignaciones' && options.method === 'DELETE') {
      if (failure.deleteAsignaciones) {
        return { ok: false, json: async () => ({ ok: false, message: 'No se eliminó ninguna.' }) };
      }
      return { ok: true, json: async () => ({ ok: true, result: { deleted: 2 } }) };
    }
    if (url === '/api/agentes/requisitos/asignaciones') {
      return { ok: true, json: async () => ({ ok: true, result: { created: 2, skipped: 0 } }) };
    }
    if (url.startsWith('/api/agentes/requisitos')) {
      return { ok: true, json: async () => ({ requisitos: [] }) };
    }
    throw new Error('Petición inesperada: ' + url);
  };
  const app = {};
  const failure = options;
  const filename = path.join(root, 'public', 'js', 'dashboard-agentes-requisitos.js');
  const source = fs.readFileSync(filename, 'utf8').replace(
    /\}\)\(\);\s*$/,
    'app.testHooks = { state, loadMeta, crearPlantilla, asignarPlantilla, prepararCopiaPlantilla, fillPlantillaForm, confirmarEliminarAsignaciones, refreshSelectedActions }; })();'
  );
  const bootstrap = { Modal: { getInstance: () => ({ hide() {} }), getOrCreateInstance: () => ({ hide() {}, show() {} }) } };
  const context = {
    window: { GRS1Dashboard: app, luxon: require('luxon'), bootstrap },
    document: { getElementById: (id) => elements[id] || null, querySelector: () => null },
    HTMLInputElement: Control,
    HTMLSelectElement: Select,
    HTMLTextAreaElement: Control,
    HTMLButtonElement: Control,
    bootstrap,
    URLSearchParams,
    fetch,
  };
  vm.runInNewContext(source, context, { filename });
  app.testHooks.state.assignAgentesTable = table;
  return { hooks: app.testHooks, elements, table, requests };
}

test('crear una plantilla conserva agentes, la selecciona y permite asignarla', async () => {
  const { hooks, elements, table, requests } = dashboardHarness();
  await hooks.crearPlantilla();
  assert.equal(elements.reqAsignarPlantilla.value, '17');
  assert.deepEqual(table.selected.map((row) => row.id), [11, 12]);
  await hooks.asignarPlantilla();
  const request = requests.find((entry) => entry.url === '/api/agentes/requisitos/asignaciones');
  assert.deepEqual(JSON.parse(request.options.body), {
    plantilla_id: 17,
    agente_ids: [11, 12],
    fecha_referencia: '2026-01-01',
  });
  assert.deepEqual(table.selected, []);
});

test('copia la plantilla al año siguiente sin asignar agentes ni alterar el original', async () => {
  const { hooks, elements, requests } = dashboardHarness();
  const original = {
    id: 8, nombre: 'Tiro 2026', descripcion: 'Descripción',
    fecha_inicio_manual: '2026-01-01', fecha_fin_manual: '2026-12-31',
    objetivo_total: 3, tipo_requisito: 'tiro', requiere_aprobacion: true,
    objetivos: [{ subtipo: 'corta', objetivo: 1 }, { subtipo: 'larga', objetivo: 2 }],
  };
  const copia = hooks.prepararCopiaPlantilla(original);
  hooks.fillPlantillaForm(copia, { copy: true });
  assert.equal(elements.reqPlantillaId.value, '');
  assert.equal(elements.reqPlantillaNombre.value, 'Tiro 2027');
  assert.equal(elements.reqPlantillaPeriodoInicio.value, '2027-01-01');
  assert.equal(elements.reqPlantillaPeriodoFin.value, '2027-12-31');
  assert.equal(original.nombre, 'Tiro 2026');
  await hooks.crearPlantilla();
  const post = requests.find((entry) => entry.url === '/api/agentes/requisitos/plantillas' && entry.options.method === 'POST');
  const payload = JSON.parse(post.options.body);
  assert.equal(payload.requiere_aprobacion, true);
  assert.equal(payload.nombre, 'Tiro 2027');
  assert.equal(payload.descripcion, 'Descripción');
  assert.deepEqual(payload.objetivos.map(({ subtipo, objetivo }) => ({ subtipo, objetivo })), [
    { subtipo: 'corta', objetivo: 1 }, { subtipo: 'larga', objetivo: 2 },
  ]);
  assert.equal(requests.some((entry) => entry.url === '/api/agentes/requisitos/asignaciones'), false);
});

test('copia fechas bisiestas y usa el año de fin; rechaza períodos sin fechas', () => {
  const { hooks } = dashboardHarness();
  const copia = hooks.prepararCopiaPlantilla({
    nombre: 'Curso', fecha_inicio_manual: '2024-02-29', fecha_fin_manual: '2025-01-31',
  });
  assert.equal(copia.fecha_inicio_manual, '2025-02-28');
  assert.equal(copia.fecha_fin_manual, '2026-01-31');
  assert.equal(copia.nombre, 'Curso 2026');
  assert.equal(hooks.prepararCopiaPlantilla({
    nombre: 'Curso-2024', fecha_inicio_manual: '2024-01-01', fecha_fin_manual: '2024-12-31',
  }).nombre, 'Curso-2025');
  assert.throws(() => hooks.prepararCopiaPlantilla({
    nombre: 'Curso', fecha_inicio_manual: null, fecha_fin_manual: '2025-01-31',
  }), /fechas de inicio y fin válidas/);
});

test('no envía una asignación sin plantilla o fecha', async () => {
  const { hooks, elements, requests } = dashboardHarness();
  await hooks.loadMeta({ preserveAgentes: true });
  assert.match(elements.reqAsignarPlantilla.innerHTML, /Sin plantillas activas/);
  await assert.rejects(hooks.asignarPlantilla(), /Seleccione una plantilla activa/);
  elements.reqAsignarPlantilla.value = '17';
  elements.reqAsignarFechaRef.value = '';
  await assert.rejects(hooks.asignarPlantilla(), /fecha de referencia/);
  assert.equal(requests.some((entry) => entry.url === '/api/agentes/requisitos/asignaciones'), false);
});

test('solicita confirmación antes de borrar solo las filas seleccionadas', async () => {
  const { hooks, elements, requests } = dashboardHarness();
  hooks.state.selectedPeriodoIds = [101, 202];
  hooks.refreshSelectedActions();
  assert.equal(elements.btnReqEliminarAsignaciones.disabled, false);
  hooks.confirmarEliminarAsignaciones();
  assert.equal(requests.length, 0);
  assert.match(elements.reqConfirmDeactivateDetail.textContent, /pruebas registradas/);
  elements.btnReqConfirmDeactivate.onclick();
  await new Promise((resolve) => setImmediate(resolve));
  const request = requests.find((entry) => entry.options.method === 'DELETE');
  assert.deepEqual(JSON.parse(request.options.body), { periodo_ids: [101, 202] });
  assert.equal(hooks.state.selectedPeriodoIds.length, 0);
  assert.equal(elements.btnReqEliminarAsignaciones.disabled, true);
  assert.match(elements.alertContainerAgentesRequisitos.innerHTML, /Asignaciones eliminadas: 2/);
});

test('mantiene la selección y muestra el error si falla el borrado', async () => {
  const { hooks, elements } = dashboardHarness({ deleteAsignaciones: true });
  hooks.state.selectedPeriodoIds = [101, 202];
  hooks.confirmarEliminarAsignaciones();
  elements.btnReqConfirmDeactivate.onclick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(Array.from(hooks.state.selectedPeriodoIds), [101, 202]);
  assert.match(elements.alertContainerAgentesRequisitos.innerHTML, /No se eliminó ninguna/);
  assert.equal(elements.btnReqEliminarAsignaciones.disabled, false);
});

function loadService(filename, db, extraExport) {
  const fullPath = path.join(root, 'src', 'services', filename);
  const originalRequire = createRequire(fullPath);
  const module = { exports: {} };
  const source = fs.readFileSync(fullPath, 'utf8') + (extraExport || '');
  vm.runInNewContext(source, {
    require: (id) => id === '../config/db' ? db : originalRequire(id),
    module,
    exports: module.exports,
    console,
    Buffer,
    process,
  }, { filename: fullPath });
  return module.exports;
}

test('asignar vincula plantilla y agentes en períodos y omite duplicados', async () => {
  const periods = new Map();
  const plantilla = {
    id: 17, periodicidad: 'anual', objetivo_total: 1,
    fecha_inicio_manual: null, fecha_fin_manual: null, plazo_dias: null,
  };
  const client = {
    async query(sql, params = []) {
      if (sql.includes('FROM agentes_requisitos_plantillas')) return { rows: [plantilla] };
      if (sql.includes('FROM agentes')) return { rows: params[0] === 11 || params[0] === 12 ? [{ id: params[0] }] : [] };
      if (sql.includes('INSERT INTO agentes_requisitos_periodos')) {
        const key = params.slice(0, 5).join('|');
        if (periods.has(key)) return { rows: [] };
        periods.set(key, params);
        return { rows: [{ id: periods.size }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const service = loadService('agentes-requisitos.service.js', { connect: async () => client });
  const payload = { plantilla_id: 17, agente_ids: [11, 12], fecha_referencia: '2026-03-01' };
  const first = await service.assignPlantilla('ARS1', payload, 1);
  assert.equal(first.created, 2);
  assert.equal(first.skipped, 0);
  assert.deepEqual(Array.from(periods.values(), (params) => Array.from(params.slice(0, 5))), [
    ['ARS1', 17, 11, '2026-01-01', '2026-12-31'],
    ['ARS1', 17, 12, '2026-01-01', '2026-12-31'],
  ]);
  const second = await service.assignPlantilla('ARS1', payload, 1);
  assert.equal(second.created, 0);
  assert.equal(second.skipped, 2);
});

test('el borrado es atómico y limitado a los períodos de la unidad activa', async () => {
  const calls = [];
  let encontrados = [101, 202];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('SELECT id FROM agentes_requisitos_periodos')) return { rows: encontrados.map((id) => ({ id })) };
      if (sql.includes('DELETE FROM agentes_requisitos_periodos')) return { rows: encontrados.map((id) => ({ id })) };
      return { rows: [] };
    },
    release() {},
  };
  const service = loadService('agentes-requisitos.service.js', { connect: async () => client });
  const result = await service.deleteAsignaciones('ARS1', [101, 202]);
  assert.equal(result.deleted, 2);
  const deleteCall = calls.find(({ sql }) => sql.includes('DELETE FROM'));
  assert.match(deleteCall.sql, /ars_unidad_id = \$1 AND id = ANY\(\$2::bigint\[\]\)/);
  assert.deepEqual(Array.from(deleteCall.params[1]), [101, 202]);
  assert.equal(deleteCall.params[0], 'ARS1');
  assert.equal(calls.some(({ sql }) => sql === 'COMMIT'), true);

  calls.length = 0;
  encontrados = [101];
  await assert.rejects(service.deleteAsignaciones('ARS1', [101, 202]), /No se eliminó ninguna/);
  assert.equal(calls.some(({ sql }) => sql.includes('DELETE FROM')), false);
  assert.equal(calls.some(({ sql }) => sql === 'ROLLBACK'), true);
});

test('la validación rechaza listas vacías, duplicadas o con identificadores inválidos', () => {
  const { deleteAsignacionesSchema } = require('../src/validators/agentes-requisitos.validator');
  assert.equal(deleteAsignacionesSchema.validate({ periodo_ids: [101, 202] }).error, undefined);
  for (const ids of [[], [1, 1], [0], [-1], [1.5]]) {
    assert.ok(deleteAsignacionesSchema.validate({ periodo_ids: ids }).error);
  }
});

test('el resumen de asignaciones exige un período del agente y de su unidad', async () => {
  let query = '';
  const service = loadService('asignaciones.service.js', {}, '\nexports.testResumen = getRequisitosResumenByAgente;');
  const result = await service.testResumen({
    async query(sql) { query = sql; return { rows: [] }; },
  }, 'ARS1');
  assert.match(query, /INNER JOIN agentes_requisitos_periodos p/);
  assert.match(query, /p\.plantilla_id = t\.id/);
  assert.match(query, /p\.agente_id = a\.id/);
  assert.match(query, /p\.ars_unidad_id = a\.ars_unidad_id/);
  assert.equal(Object.keys(result).length, 0);
});
