const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ExcelJS = require('exceljs');
const db = require('../src/config/db');
const informeAgentesActividadesService = require('../src/services/informeAgentesActividades.service');
const asignacionesController = require('../src/controllers/asignaciones.controller');
const {
  buildReport,
  buildWeeks,
  parsePositiveIds,
} = informeAgentesActividadesService;
const informeAgentesActividadesExcelService = require('../src/services/informeAgentesActividadesExcel.service');

test('normaliza actividades seleccionadas sin duplicados', () => {
  assert.deepEqual(parsePositiveIds('4, 7,4,no,0,-2'), [4, 7]);
});

test('construye semanas, total calculado y ajuste temporal por agente y actividad', () => {
  const report = buildReport({
    cuadrante: { id: 9, nombre: 'Noviembre' },
    semanas: [
      { num_semana: 1, fecha_inicio: '2026-11-02', fecha_fin: '2026-11-08' },
      { num_semana: 2, fecha_inicio: '2026-11-09', fecha_fin: '2026-11-15' },
      { num_semana: 3, fecha_inicio: '2026-11-16', fecha_fin: '2026-11-22' },
    ],
    actividades: [
      { id_actividad: 21, actividad: 'MEL', nombre: 'Melilla' },
      { id_actividad: 22, actividad: 'GRA', nombre: 'Granada' },
    ],
    counts: [
      {
        agente_id: 3,
        tip: 'A123',
        nombre: 'Agente Uno',
        empleo: 'Guardia',
        peloton: 'Primer pelotón',
        actividad_id: 21,
        num_semana: 1,
        dias_distintos: 2,
      },
      {
        agente_id: 3,
        tip: 'A123',
        nombre: 'Agente Uno',
        empleo: 'Guardia',
        actividad_id: 21,
        num_semana: 2,
        dias_distintos: 3,
      },
    ],
  });

  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].peloton, 'Primer pelotón');
  assert.deepEqual(report.actividades.map((activity) => activity.id_actividad), [21]);
  assert.equal(report.rows[0].a21_total, 5);
  assert.equal(report.rows[0].a21_s3, 0);
  assert.equal(report.rows[0].a21_ajuste, 0);
  assert.equal(report.rows[0].a21_final, 5);
  assert.equal(report.rows[0].a22_total, 0);
  assert.equal(report.rows[0].total_calculado, 5);
  assert.equal(report.rows[0].total_ajuste, 0);
  assert.equal(report.rows[0].total_final, 5);
});

test('genera semanas naturales recortadas en los extremos y al cambiar de año', () => {
  assert.deepEqual(buildWeeks('2026-12-30', '2027-01-05'), [
    { num_semana: 1, fecha_inicio: '2026-12-30', fecha_fin: '2027-01-03' },
    { num_semana: 2, fecha_inicio: '2027-01-04', fecha_fin: '2027-01-05' },
  ]);
  assert.throws(() => buildWeeks('2026-02-30', '2026-03-01'), /fechas.*válidas/);
  assert.throws(() => buildWeeks('2026-03-02', '2026-03-01'), /fechas.*válidas/);
});

test('consulta por fechas y aplica el filtro de pernoctas sin depender de cuadrantes', async (t) => {
  const query = t.mock.method(db, 'query', async (sql, params) => {
    if (sql.includes('WITH RECURSIVE')) {
      assert.deepEqual(params, [[1, 2]]);
      return { rows: [
        { id_actividad: 21, actividad: 'MEL', nombre: 'Melilla' },
        { id_actividad: 22, actividad: 'GRA', nombre: 'Granada' },
      ] };
    }
    assert.match(sql, /asig\.fecha BETWEEN \$3::date AND \$4::date/);
    assert.match(sql, /NOT \$5::boolean OR asig\.turno_id = 99999/);
    assert.doesNotMatch(sql, /cuadrantes_planificacion/);
    assert.deepEqual(params, ['GRS1', [21, 22], '2026-12-30', '2027-01-05', true]);
    return {
      rows: [
        { agente_id: 3, peloton: 'Primer pelotón', actividad_id: 21, num_semana: 2, dias_distintos: 1 },
        { agente_id: 3, peloton: 'Primer pelotón', actividad_id: 22, num_semana: 1, dias_distintos: 2 },
      ],
    };
  });
  const report = await informeAgentesActividadesService.getInforme({
    arsUnidadId: 'GRS1',
    fechaInicio: '2026-12-30',
    fechaFin: '2027-01-05',
    soloPernoctas: true,
    grupoIds: [1, 2],
    actividadIds: [21, 22],
  });
  assert.equal(query.mock.calls.length, 2);
  assert.deepEqual(report.periodo, {
    fecha_inicio: '2026-12-30',
    fecha_fin: '2027-01-05',
    solo_pernoctas: true,
  });
  assert.equal(report.rows[0].peloton, 'Primer pelotón');
  assert.equal(report.rows[0].a21_s1, 0);
  assert.equal(report.rows[0].a21_s2, 1);
  assert.equal(report.rows[0].a22_s1, 2);
});

test('el controlador acepta pernoctas sí y no, y rechaza fechas inválidas', async (t) => {
  const getInforme = t.mock.method(informeAgentesActividadesService, 'getInforme', async (params) => params);
  const query = {
    fecha_inicio: '2026-08-03',
    fecha_fin: '2026-08-16',
    grupo_ids: '1,2',
    actividad_ids: '21',
  };
  for (const [value, expected] of [['true', true], ['false', false]]) {
    let response;
    await asignacionesController.getInformeAgentesActividades(
      { method: 'GET', query: { ...query, solo_pernoctas: value }, arsId: 'GRS1' },
      { json(data) { response = data; } },
      (error) => { throw error; }
    );
    assert.equal(response.soloPernoctas, expected);
    assert.deepEqual(response.grupoIds, [1, 2]);
  }
  assert.equal(getInforme.mock.calls.length, 2);

  let receivedError;
  await asignacionesController.getInformeAgentesActividades(
    { method: 'GET', query: { ...query, fecha_inicio: '2026-02-30' }, arsId: 'GRS1' },
    { json() { assert.fail('No debe generar un informe con fechas inválidas'); } },
    (error) => { receivedError = error; }
  );
  assert.match(receivedError.message, /fechas.*válidas/);
  assert.equal(getInforme.mock.calls.length, 2);
});

test('el controlador acepta varios grupos y mantiene compatibilidad con un grupo', async (t) => {
  const getActividades = t.mock.method(
    informeAgentesActividadesService, 'getActividadesGrupo', async (ids) => ids
  );
  for (const [query, expected] of [
    [{ grupo_ids: '1,2,1' }, [1, 2]],
    [{ grupo_id: '3' }, [3]],
  ]) {
    let response;
    await asignacionesController.getInformeAgentesActividadesOpciones(
      { query },
      { json(data) { response = data; } },
      (error) => { throw error; }
    );
    assert.deepEqual(response.actividades, expected);
  }
  assert.equal(getActividades.mock.calls.length, 2);
});

test('la columna Pelotón ordena códigos numéricos y nombres de forma natural', () => {
  const app = {};
  const filename = path.join(__dirname, '..', 'public', 'js', 'dashboard-informes.js');
  const source = fs.readFileSync(filename, 'utf8').replace(
    /\}\)\(\);\s*$/,
    'app.testColumnsAA = buildColumnsAA; })();'
  );
  vm.runInNewContext(source, { window: { GRS1Dashboard: app } }, { filename });
  const column = app.testColumnsAA({ actividades: [] }).find((item) => item.field === 'peloton');
  const values = ['ESCOLTAS (MODULO 10)', '111', '12', '11', 'ESCOLTAS (MODULO 2)', '2'];
  assert.deepEqual(values.sort(column.sorter), [
    '2', '11', '12', '111', 'ESCOLTAS (MODULO 2)', 'ESCOLTAS (MODULO 10)',
  ]);
  assert.ok(column.sorter('ÁGUILA', 'Zapadores') < 0);
});

test('las columnas fijas del informe disponen de filtros de texto', () => {
  const app = {};
  const filename = path.join(__dirname, '..', 'public', 'js', 'dashboard-informes.js');
  const source = fs.readFileSync(filename, 'utf8').replace(
    /\}\)\(\);\s*$/,
    'app.testColumnsAA = buildColumnsAA; })();'
  );
  vm.runInNewContext(source, { window: { GRS1Dashboard: app } }, { filename });
  const columns = app.testColumnsAA({ actividades: [] });
  for (const field of ['peloton', 'tip', 'nombre', 'empleo']) {
    const column = columns.find((item) => item.field === field);
    assert.equal(column.frozen, true);
    assert.equal(column.headerFilter, 'input');
  }
});

test('el selector marca todos los grupos e ignora respuestas antiguas de actividades', async () => {
  const elements = {};
  const node = () => ({
    dataset: {},
    classList: { add() {}, toggle() {} },
    style: {},
    addEventListener(event, callback) { this[event] = callback; },
    setAttribute() {},
  });
  for (const id of [
    'aaGrupo', 'aaGrupoChecklist', 'aaGrupoLabel', 'aaGrupoCount',
    'aaActividades', 'aaActividadesChecklist', 'aaActividadesLabel',
    'aaActividadesCount', 'aaActividadesToggle', 'aaGrupoPanel',
    'aaTabla', 'aaError', 'btnAaGenerar', 'btnAaExcel', 'aaResumen',
  ]) elements[id] = node();
  const groups = elements.aaGrupo;
  groups.options = [{ value: '1', selected: false }, { value: '2', selected: false }];
  Object.defineProperty(groups, 'selectedOptions', { get() { return this.options.filter((option) => option.selected); } });
  const activities = elements.aaActividades;
  activities.options = [];
  Object.defineProperty(activities, 'selectedOptions', { get() { return this.options.filter((option) => option.selected); } });
  Object.defineProperty(activities, 'innerHTML', {
    set(value) {
      this.options = Array.from(value.matchAll(/<option value="(\d+)">([^<]*)<\/option>/g))
        .map((match) => ({ value: match[1], textContent: match[2], selected: false }));
    },
  });
  const inputs = [
    { value: '1', checked: false, dataset: {} },
    { value: '2', checked: false, dataset: {} },
  ];
  elements.aaGrupoChecklist.querySelectorAll = (selector) =>
    selector === 'input:checked' ? inputs.filter((input) => input.checked) : inputs;
  const requests = [];
  const app = { getHeaders: () => ({}), escapeHtml: (value) => String(value) };
  const filename = path.join(__dirname, '..', 'public', 'js', 'dashboard-informes.js');
  const source = fs.readFileSync(filename, 'utf8').replace(
    /\}\)\(\);\s*$/,
    'app.testAA = { bindEventosAA, renderAAChecklist }; })();'
  );
  vm.runInNewContext(source, {
    window: { GRS1Dashboard: app },
    document: {
      getElementById: (id) => elements[id] || null,
      addEventListener() {},
    },
    fetch: (url) => new Promise((resolve) => requests.push({ url, resolve })),
  }, { filename });

  app.testAA.bindEventosAA();
  app.testAA.renderAAChecklist('aaGrupo', [
    { value: 1, label: 'Grupo 1' }, { value: 2, label: 'Grupo 2' },
  ]);
  assert.match(elements.aaGrupoChecklist.innerHTML, /Todos los grupos/);
  elements.aaGrupoChecklist.change({
    target: { checked: true, dataset: { aaToggleAll: '1' } },
  });
  assert.deepEqual(groups.options.map((option) => option.selected), [true, true]);
  assert.match(requests[0].url, /grupo_ids=1%2C2/);

  inputs[1].checked = false;
  elements.aaGrupoChecklist.change({ target: inputs[1] });
  assert.match(requests[1].url, /grupo_ids=1$/);
  requests[1].resolve({ ok: true, json: async () => ({
    actividades: [{ id_actividad: 21, actividad: 'A', nombre: 'Actual' }],
  }) });
  await new Promise(setImmediate);
  requests[0].resolve({ ok: true, json: async () => ({
    actividades: [{ id_actividad: 99, actividad: 'B', nombre: 'Antigua' }],
  }) });
  await new Promise(setImmediate);
  assert.deepEqual(activities.options.map((option) => option.value), ['21']);
  assert.equal(elements.btnAaGenerar.disabled, false);
});

test('omite conteos de actividades que no forman parte de la selección', () => {
  const report = buildReport({
    cuadrante: { id: 9 },
    semanas: [{ num_semana: 1 }],
    actividades: [{ id_actividad: 21 }],
    counts: [{ agente_id: 3, actividad_id: 99, num_semana: 1, dias_distintos: 5 }],
  });

  assert.deepEqual(report.rows, []);
});

test('omite agentes cuyo total calculado de fila es cero', () => {
  const report = buildReport({
    cuadrante: { id: 9 },
    semanas: [{ num_semana: 1 }],
    actividades: [{ id_actividad: 21 }],
    counts: [
      { agente_id: 3, actividad_id: 21, num_semana: 1, dias_distintos: 0 },
      { agente_id: 4, actividad_id: 21, num_semana: 1, dias_distintos: 2 },
    ],
  });

  assert.deepEqual(report.rows.map((row) => row.agente_id), [4]);
});

test('el Excel omite semanas con total de columna cero por actividad', async () => {
  let buffer;
  const response = {
    setHeader() {},
    send(value) {
      buffer = value;
    },
  };
  await informeAgentesActividadesExcelService.exportar(
    response,
    {
      periodo: { fecha_inicio: '2026-08-03', fecha_fin: '2026-08-16', solo_pernoctas: true },
      semanas: [
        { num_semana: 1, fecha_inicio: '2026-08-03', fecha_fin: '2026-08-09' },
        { num_semana: 2, fecha_inicio: '2026-08-10', fecha_fin: '2026-08-16' },
      ],
      actividades: [
        { id_actividad: 21, actividad: 'MEL', nombre: 'Melilla' },
        { id_actividad: 22, actividad: 'GRA', nombre: 'Granada' },
      ],
      rows: [
        {
          agente_id: 3,
          peloton: 'Primer pelotón',
          tip: 'A123',
          nombre: 'Agente Uno',
          empleo: 'Guardia',
          a21_s1: 2,
          a21_s2: 0,
          a21_total: 2,
          a21_ajuste: 0,
          a21_final: 2,
          a22_s1: 0,
          a22_s2: 3,
          a22_total: 3,
          a22_ajuste: 0,
          a22_final: 3,
          total_calculado: 5,
          total_ajuste: 0,
          total_final: 5,
        },
      ],
    },
    { '3:21': 2, '3:22': -1 }
  );

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Agentes por actividad');
  assert.equal(sheet.getCell('A5').value, 'Pelotón');
  assert.equal(sheet.getCell('A7').value, 'Primer pelotón');
  assert.match(sheet.getCell('A2').value, /2026-08-03 a 2026-08-16.*Solo Pernoctas/);
  assert.equal(sheet.getCell('H7').value, 2);
  assert.equal(sheet.getCell('L7').value, 3);
  assert.equal(sheet.getCell('H8').value, 2);
  assert.equal(sheet.getCell('F7').value, 1);
  assert.equal(sheet.getCell('G7').value, 6);
  assert.equal(sheet.getCell('K7').value, 4);
  assert.equal(sheet.getCell('O7').value, 2);
  assert.deepEqual(sheet.getRow(6).values.slice(8), [
    'Semana 1\n2026-08-03 a 2026-08-09',
    'Total calculado',
    'Ajuste',
    'Total final',
    'Semana 2\n2026-08-10 a 2026-08-16',
    'Total calculado',
    'Ajuste',
    'Total final',
  ]);
});
