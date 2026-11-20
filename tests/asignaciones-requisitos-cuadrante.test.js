const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const service = require('../src/services/asignaciones.service');
const controller = require('../src/controllers/asignaciones.controller');

test('el resumen filtra requisitos pendientes y completos por la ventana del cuadrante', async (t) => {
  const calls = [];
  const client = {
    release() {},
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM cuadrantes_planificacion')) {
        return { rows: [{ fecha_inicio: '2026-08-03', fecha_fin: '2026-08-30' }] };
      }
      if (sql.includes('AS requisitos_detalle_pct')) {
        return { rows: [{
          agente_id: 3,
          requisitos_completado_total: 3,
          requisitos_objetivo_total: 4,
          requisitos_pct: 75,
          requisitos_detalle_pct: [
            { plantilla_id: 1, completado_total: 1, objetivo_total: 2, pct: 50 },
            { plantilla_id: 2, completado_total: 2, objetivo_total: 2, pct: 100 },
          ],
        }] };
      }
      return { rows: [] };
    },
  };
  t.mock.method(db, 'connect', async () => client);
  const data = await service.getCuadrante(
    2026, 8, null, { id: 1 }, 'GRS1',
    { source: 'definitivo', requisitos_cuadrante_id: 12 }
  );
  const windowQuery = calls.find((call) => call.sql.includes('FROM cuadrantes_planificacion'));
  assert.deepEqual(windowQuery.params, [12, 'GRS1']);
  const summaryQuery = calls.find((call) => call.sql.includes('AS requisitos_detalle_pct'));
  assert.deepEqual(summaryQuery.params, ['GRS1', '2026-08-03', '2026-08-30']);
  assert.match(
    summaryQuery.sql,
    /\$2::date IS NULL\s+OR \(p\.periodo_inicio <= \$3::date AND p\.periodo_fin >= \$2::date\)\s+\)/
  );
  assert.equal(data.requisitosByAgente[3].pct, 75);
  assert.equal(data.requisitosByAgente[3].detalle.length, 2);
});

test('el controlador transmite el cuadrante de requisitos y rechaza identificadores inválidos', async (t) => {
  const getCuadrante = t.mock.method(service, 'getCuadrante', async () => ({}));
  const req = {
    params: { anio: '2026', mes: '8' },
    query: { requisitos_cuadrante_id: '12' },
    user: { id: 1 },
    arsId: 'GRS1',
  };
  await controller.getCuadrante(req, { json() {} }, (error) => { throw error; });
  assert.equal(getCuadrante.mock.calls[0].arguments[5].requisitos_cuadrante_id, 12);
  let error;
  await controller.getCuadrante(
    { ...req, query: { requisitos_cuadrante_id: 'abc' } },
    { json() { assert.fail('No debe aceptar el identificador inválido'); } },
    (value) => { error = value; }
  );
  assert.match(error.message, /identificador válido/);
  assert.equal(getCuadrante.mock.calls.length, 1);
});
