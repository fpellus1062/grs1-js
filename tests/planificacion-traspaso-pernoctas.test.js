const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const service = require('../src/services/planificacion.service');

function mockTraspaso(t, rows, turnoPernoctaActivo = true) {
  const inserts = [];
  const logs = [];
  const commands = [];
  const client = {
    release() {},
    async query(sql, params = []) {
      commands.push(sql.trim());
      if (sql.includes('FROM plan_borrador_version pbv')) {
        return { rows: [{ version_id: 1, borrador_id: 2, plan_id: 3 }] };
      }
      if (sql.includes('FROM cuadrantes_planificacion cp')) {
        return { rows: [{ id: 4, estado: 'activo', anio_referencia: 2026, mes_referencia: 8 }] };
      }
      if (sql.includes('COUNT(*)::int AS total')) return { rows: [{ total: rows.length }] };
      if (sql.includes('FROM asignaciones_borradores') && sql.includes('estado <>')) {
        return { rows: [{ id: 5, nombre: 'Borrador', version: 1, estado: 'borrador' }] };
      }
      if (sql.includes('SELECT pba.id,')) return { rows };
      if (sql.includes('WHERE id_turno = $1 AND baja_at IS NULL')) {
        return { rows: turnoPernoctaActivo ? [{ id_turno: 99999 }] : [] };
      }
      if (sql.includes('ORDER BY t.id_turno') && !sql.includes('FROM actividades a')) {
        return { rows: [{ id_turno: 1 }] };
      }
      if (sql.includes('FROM actividades a') && sql.includes('LEFT JOIN LATERAL')) {
        return { rows: [{ id_actividad: 21, turno_id: 1 }, { id_actividad: 22, turno_id: 7 }] };
      }
      if (sql.includes('SELECT id, turno_id') && sql.includes('FROM asignaciones_borrador')) {
        return { rows: [2, 4].includes(params[2]) ? [{ id: 100 + params[2], turno_id: 8 }] : [] };
      }
      if (sql.includes('SELECT actividad_id') && sql.includes('FROM asignaciones_borrador_servicios')) {
        return { rows: [{ actividad_id: 30 }] };
      }
      if (sql.includes('INSERT INTO asignaciones_borrador\n')) {
        inserts.push(params);
        return { rows: [{ id: 100 + params[4] }] };
      }
      if (sql.includes('INSERT INTO asignaciones_log')) logs.push(params);
      return { rows: [] };
    },
  };
  t.mock.method(db, 'connect', async () => client);
  return { inserts, logs, commands };
}

function traspasar() {
  return service.traspasarCuadranteChunk({
    versionId: 1, cuadranteId: 4, arsId: 'GRS1', userId: 3, offset: 0, limit: 100,
  });
}

test('traspasa actividades Pernocta con turno 99999 al insertar y reemplazar', async (t) => {
  const rows = [
    { fecha: '2026-08-03', agente_id: 1, actividad_id: 21, actividad_disponible: 'Pernocta' },
    { fecha: '2026-08-03', agente_id: 2, actividad_id: 21, actividad_disponible: ' pernocta ' },
    { fecha: '2026-08-03', agente_id: 3, actividad_id: 22, actividad_disponible: 'Normal' },
    { fecha: '2026-08-03', agente_id: 4, actividad_id: 22, actividad_disponible: 'Normal' },
  ];
  const { inserts, logs } = mockTraspaso(t, rows);
  const result = await traspasar();

  assert.equal(result.errores, 0);
  assert.equal(result.copiadas, 4);
  assert.equal(result.reemplazadas, 2);
  assert.deepEqual(inserts.map((params) => params[5]), [99999, 99999, 7, 8]);
  assert.equal(JSON.parse(logs[1][11]).fechas['2026-08-03'].turno_id, 99999);
  assert.equal(JSON.parse(logs[1][10]).fechas['2026-08-03'].turno_id, 8);
});

test('si falta el turno de Pernocta activo, revierte el traspaso antes de insertar', async (t) => {
  const { inserts, commands } = mockTraspaso(t, [
    { fecha: '2026-08-03', agente_id: 1, actividad_id: 21, actividad_disponible: 'Pernocta' },
  ], false);
  await assert.rejects(traspasar(), /Pernocta \(99999\).*no existe o no está activo/);
  assert.equal(inserts.length, 0);
  assert.ok(commands.includes('ROLLBACK'));
});

test('no exige el turno de Pernocta para traspasar actividades normales', async (t) => {
  const { inserts, commands } = mockTraspaso(t, [
    { fecha: '2026-08-03', agente_id: 3, actividad_id: 22, actividad_disponible: 'Normal' },
  ], false);
  const result = await traspasar();
  assert.equal(result.errores, 0);
  assert.equal(inserts[0][5], 7);
  assert.equal(commands.some((sql) => sql.includes('WHERE id_turno = $1 AND baja_at IS NULL')), false);
});
