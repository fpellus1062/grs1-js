const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');

function dashboardHarness() {
  class Element {
    constructor() {
      this.dataset = {};
      this.listeners = {};
      this.innerHTML = '';
      this.value = '';
    }
    setAttribute(name, value) { this[name] = value; }
    appendChild(child) { this.child = child; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
  }
  const elements = {
    reqConfirmDeactivateModal: new Element(),
    reqConfirmDeactivateText: new Element(),
    btnReqConfirmDeactivate: new Element(),
    alertReqPlantillasCrud: new Element(),
    reqAsignarPlantilla: new Element(),
  };
  const modal = {
    show() {},
    hide() {
      const callback = elements.reqConfirmDeactivateModal.listeners['hidden.bs.modal'];
      if (callback) callback();
    },
  };
  let template = { id: 17, nombre: 'Tiro', activo: true };
  let shouldFail = false;
  const requests = [];
  const app = {};
  class Table {
    constructor(selector, options) { this.options = options; }
    replaceData(data) { this.data = data; }
  }
  const filename = path.join(root, 'public', 'js', 'dashboard-agentes-requisitos.js');
  const source = fs.readFileSync(filename, 'utf8').replace(
    /\}\)\(\);\s*$/,
    'app.testHooks = { state, ensurePlantillasTable }; })();'
  );
  const context = {
    window: { GRS1Dashboard: app, bootstrap: { Modal: { getOrCreateInstance: () => modal } } },
    document: {
      getElementById: (id) => elements[id] || null,
      createElement: () => new Element(),
      documentElement: { contains: () => true },
    },
    Tabulator: Table,
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (options.method === 'PATCH') {
        if (shouldFail) return { ok: false, json: async () => ({ message: 'Error al cambiar estado' }) };
        template = { ...template, activo: JSON.parse(options.body).activo };
        return { ok: true, json: async () => ({ ok: true, plantilla: template }) };
      }
      if (url.endsWith('/meta')) {
        return { ok: true, json: async () => ({ plantillas: template.activo ? [template] : [], agentes: [] }) };
      }
      if (url.includes('/plantillas?')) {
        return { ok: true, json: async () => ({ plantillas: [template] }) };
      }
      throw new Error('Petición inesperada: ' + url);
    },
  };
  vm.runInNewContext(source, context, { filename });
  const table = app.testHooks.ensurePlantillasTable();
  const row = {
    data: { ...template },
    getData() { return this.data; },
    async update(value) { Object.assign(this.data, value); },
  };
  const column = table.options.columns.find((item) => item.field === 'activo');
  const input = column.formatter({ getRow: () => row }).child;
  return {
    input, row, elements, requests, state: app.testHooks.state,
    failRequests() { shouldFail = true; },
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test('el interruptor confirma la desactivación y permite reactivar la plantilla', async () => {
  const { input, row, elements, requests, state } = dashboardHarness();
  assert.equal(input.checked, true);
  assert.equal(input.role, 'switch');

  input.checked = false;
  input.listeners.change();
  assert.equal(input.checked, true);
  assert.equal(requests.length, 0);
  elements.btnReqConfirmDeactivate.onclick();
  await settle();
  assert.equal(row.data.activo, false);
  assert.equal(state.meta.plantillas.length, 0);
  assert.deepEqual(JSON.parse(requests[0].options.body), { activo: false });

  input.checked = true;
  input.listeners.change();
  await settle();
  assert.equal(row.data.activo, true);
  assert.equal(state.meta.plantillas[0].id, 17);
  assert.deepEqual(JSON.parse(requests[3].options.body), { activo: true });
});

test('al cancelar o fallar el cambio, se conserva el estado y se muestra el error', async () => {
  const { input, row, elements, requests, failRequests } = dashboardHarness();
  input.checked = false;
  input.listeners.change();
  elements.reqConfirmDeactivateModal.listeners['hidden.bs.modal']();
  assert.equal(input.checked, true);
  assert.equal(requests.length, 0);

  failRequests();
  input.checked = false;
  input.listeners.change();
  elements.btnReqConfirmDeactivate.onclick();
  await settle();
  assert.equal(input.checked, true);
  assert.equal(input.disabled, false);
  assert.equal(row.data.activo, true);
  assert.match(elements.alertReqPlantillasCrud.innerHTML, /Error al cambiar estado/);
});

test('el servicio cambia solo el estado de la plantilla de la unidad y mantiene DELETE', async () => {
  const filename = path.join(root, 'src', 'services', 'agentes-requisitos.service.js');
  const originalRequire = createRequire(filename);
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params: Array.from(params) });
      return { rows: [{ id: 17, activo: params[0] }] };
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: (id) => id === '../config/db' ? db : originalRequire(id),
    module, exports: module.exports, console, Buffer, process,
  }, { filename });
  const service = module.exports;
  await service.updatePlantillaEstado('ARS1', 17, true, 9);
  await service.deletePlantilla('ARS1', 17, 9);
  assert.deepEqual(queries.map((entry) => entry.params), [
    [true, 9, 17, 'ARS1'], [false, 9, 17, 'ARS1'],
  ]);
  assert.match(queries[0].sql, /WHERE id = \$3 AND ars_unidad_id = \$4/);
  assert.doesNotMatch(queries[0].sql, /objetivos|periodos/);
  db.query = async () => ({ rows: [] });
  await assert.rejects(service.updatePlantillaEstado('ARS2', 17, true, 9), /Plantilla no encontrada/);
});

test('la validación exige un estado booleano y la edición no establece un estado por defecto', () => {
  const validator = require('../src/validators/agentes-requisitos.validator');
  assert.ok(validator.plantillaEstadoSchema.validate({ activo: true }).value.activo);
  assert.ok(validator.plantillaEstadoSchema.validate({}).error);
  assert.ok(validator.plantillaEstadoSchema.validate({ activo: 'false' }).error);
  const payload = {
    nombre: 'Tiro', periodicidad: 'anual', tipo_requisito: 'tiro',
    objetivo_total: 1, objetivos: [{ subtipo: 'Prueba', objetivo: 1 }],
  };
  const result = validator.updatePlantillaSchema.validate(payload);
  assert.ifError(result.error);
  assert.equal(result.value.activo, undefined);
});

test('editar una plantilla sin estado no modifica su estado existente', async () => {
  const filename = path.join(root, 'src', 'services', 'agentes-requisitos.service.js');
  const originalRequire = createRequire(filename);
  let update;
  const client = {
    async query(sql, params) {
      if (sql.includes('UPDATE agentes_requisitos_plantillas')) {
        update = { sql, params: Array.from(params) };
        return { rows: [{ id: 17, activo: false }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: (id) => id === '../config/db' ? { connect: async () => client } : originalRequire(id),
    module, exports: module.exports, console, Buffer, process,
  }, { filename });
  await module.exports.updatePlantilla('ARS1', 17, {
    nombre: 'Tiro', periodicidad: 'anual', tipo_requisito: 'tiro',
    objetivo_total: 1, objetivos: [{ subtipo: 'Prueba', objetivo: 1 }],
  }, 9);
  assert.match(update.sql, /activo = COALESCE\(\$10, activo\)/);
  assert.equal(update.params[9], null);
});
