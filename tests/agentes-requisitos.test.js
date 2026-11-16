const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');

function dashboardHarness() {
  class Control {
    constructor(value = '') {
      this.value = value;
      this.dataset = {};
      this.innerHTML = '';
    }
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
    reqPlantillaNombre: new Control('Tiro'),
    reqPlantillaPeriodicidad: new Control('anual'),
    reqPlantillaTipo: new Control('tiro'),
    reqPlantillaObjetivoTotal: new Control('1'),
    reqPlantillaObjetivosRaw: new Control('Prueba:1'),
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
    if (url === '/api/agentes/requisitos/asignaciones') {
      return { ok: true, json: async () => ({ ok: true, result: { created: 2, skipped: 0 } }) };
    }
    if (url.startsWith('/api/agentes/requisitos')) {
      return { ok: true, json: async () => ({ requisitos: [] }) };
    }
    throw new Error('Petición inesperada: ' + url);
  };
  const app = {};
  const filename = path.join(root, 'public', 'js', 'dashboard-agentes-requisitos.js');
  const source = fs.readFileSync(filename, 'utf8').replace(
    /\}\)\(\);\s*$/,
    'app.testHooks = { state, loadMeta, crearPlantilla, asignarPlantilla }; })();'
  );
  const context = {
    window: { GRS1Dashboard: app },
    document: { getElementById: (id) => elements[id] || null },
    HTMLInputElement: Control,
    HTMLSelectElement: Select,
    HTMLTextAreaElement: Control,
    HTMLButtonElement: Control,
    bootstrap: { Modal: { getInstance: () => ({ hide() {} }) } },
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
