#!/usr/bin/env node
const readline = require('readline');
const db = require('../src/config/db');

const TABLES = [
  'asignaciones_borrador_servicios',
  'asignaciones_servicios',
  'asignaciones_borrador',
  'asignaciones',
  'asignaciones_borradores',
  'asignaciones_log',
  'asignaciones_control',
  'cuadrantes_planificacion',
  'cuadrantes_planificacion_dias',
  'asignaciones_ledger_movimientos',
  'asignaciones_ledger_saldos_mensuales',
  'plan',
  'plan_audit_log',
  'plan_borrador',
  'plan_borrador_asignacion',
  'plan_borrador_version',
  'plan_final_asignacion',
  'agentes_requisitos_ejecuciones',
  'agentes_requisitos_periodos',
  'agentes_requisitos_plantilla_objetivos',
  'cuadrantes_planificacion_importaciones',
  'audit_login'
];

function hasYesFlag() {
  return process.argv.includes('--yes') || process.argv.includes('-y');
}

function askForConfirmation() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(
      'Esto vaciara las tablas de asignaciones. Escriba "SI" para continuar: ',
      (answer) => {
        rl.close();
        resolve(
          String(answer || '')
            .trim()
            .toUpperCase() === 'SI'
        );
      }
    );
  });
}

async function printCounts(title) {
  console.log(title);
  for (const tableName of TABLES) {
    const result = await db.query(
      `SELECT COUNT(*)::int AS c FROM ${tableName}`
    );
    console.log(`  ${tableName}: ${result.rows[0].c}`);
  }
}

async function truncateAll() {
  await db.query('BEGIN');
  await db.query(`
   TRUNCATE TABLE     
   asignaciones_borrador_servicios,
   asignaciones_servicios,
   asignaciones_borrador,
   asignaciones,
   asignaciones_borradores,
   asignaciones_log,
   asignaciones_control,
   cuadrantes_planificacion,
   cuadrantes_planificacion_dias,
   asignaciones_ledger_movimientos,
   asignaciones_ledger_saldos_mensuales,
   plan,
   plan_audit_log,
   plan_borrador,
   plan_borrador_asignacion,
   plan_borrador_version,
   plan_final_asignacion,
   agentes_requisitos_ejecuciones,
   agentes_requisitos_periodos,
   agentes_requisitos_plantilla_objetivos,
   cuadrantes_planificacion_importaciones,
   audit_login
    RESTART  IDENTITY
    CASCADE
  `);
  await db.query('COMMIT');
}

(async () => {
  try {
    if (!hasYesFlag()) {
      const ok = await askForConfirmation();
      if (!ok) {
        console.log('Operacion cancelada.');
        process.exit(0);
      }
    }

    await printCounts('CONTEO_ANTES');
    await truncateAll();
    await printCounts('CONTEO_DESPUES');
    console.log('LIMPIEZA_OK');
  } catch (error) {
    try {
      await db.query('ROLLBACK');
    } catch (_) {
      // Ignore rollback errors if no active transaction.
    }
    console.error('ERROR_LIMPIEZA:', error.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
