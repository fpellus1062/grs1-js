const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  const app = {
    agentesState: { empleos: [{ id_empleo: '1', descripcion: 'Capitán', color: '#ff0000' }] },
    globalState: {},
  };
  const utils = {
    renderColorBadgeHtml: (text, color) => `${text}:${color}`,
    renderSemanticBadgeHtml: (text, tone) => `${tone}:${text}`,
  };
  const tables = [];
  class Tabulator {
    constructor(_selector, options) { this.options = options; tables.push(this); }
    on() {}
    getData() { return this.options.data; }
    getSelectedData() { return []; }
  }
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'dashboard-agentes-acciones.js'), 'utf8')
    .replace(/\}\)\(\);\s*$/, 'app.testHooks = { state, loadSelectionForBajas, getColumnsForMode, publishExecutionDetail }; })();');
  const context = {
    window: { GRS1Dashboard: app, GRS1Utils: utils, luxon: require('luxon') },
    document: { getElementById: () => null, documentElement: { contains: () => false } },
    Tabulator,
    setTimeout: () => {},
  };
  vm.runInNewContext(source, context);
  return { app, context, tables, hooks: app.testHooks };
}

for (const source of ['listado', 'api']) {
  test(`bajas conserva escalafón y fechas desde ${source} y excluye agentes de baja`, async () => {
    const { app, context, tables, hooks } = harness();
    const rows = [
      { id: 1, tip: 'A', nombre: 'Ana', empleo_id: '1', escalafon: '003', created_at: '2026-03-05T10:20:30', fecha_baja: null },
      { id: 2, tip: 'B', fecha_baja: '2026-04-01' },
    ];
    if (source === 'listado') app.tabulatorAgentes = { getData: () => rows };
    else context.fetch = async () => ({ ok: true, json: async () => ({ agentes: rows }) });

    await hooks.loadSelectionForBajas();
    const table = tables[0].options;
    assert.equal(table.data.length, 1);
    assert.equal(table.data[0].escalafon, '003');
    assert.equal(table.data[0].created_at, '2026-03-05T10:20:30');
    const columns = Object.fromEntries(table.columns.filter(c => c.field).map(c => [c.field, c]));
    const cell = value => ({ getValue: () => value, getRow: () => ({ getData: () => table.data[0] }) });
    assert.equal(columns.escalafon.formatter(cell('003')), '003:#ff0000');
    assert.equal(columns.created_at.formatter(cell(table.data[0].created_at)), '05/03/2026 10:20:30');
    assert.equal(columns.fecha_baja.formatter(cell(null)), 'success:Agente Activo');
    assert.equal(columns.fecha_baja.formatter(cell('2026-04-01T12:00:00')), 'danger:01/04/2026 12:00:00');
  });
}

test('resultado de alta conserva fecha de alta y baja del CSV', () => {
  const { hooks, tables } = harness();
  hooks.state.altasRows = [{ _line: 2, created_at: '2025-01-02T03:04:05', fecha_baja: '2026-02-03' }];
  hooks.publishExecutionDetail('Alta CSV', [{ line: 2, status: 'error' }]);
  const options = tables[0].options;
  assert.equal(options.data[0].created_at, '2025-01-02T03:04:05');
  assert.equal(options.data[0].fecha_baja, '2026-02-03');
  assert.ok(options.columns.some(column => column.field === 'created_at' && column.title === 'Fecha Alta'));
});
