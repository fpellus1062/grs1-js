/**
 * Motor canonical de cálculo de devengos.
 *
 * Centraliza: resolución de regla aplicable + cálculo de cantidad + persistencia en ledger.
 * Reutilizable desde consolidación automática (worker), consolidación manual y futuros endpoints.
 *
 * ─── Modelo de cálculo ────────────────────────────────────────────────────────
 * La unidad de procesamiento es el GRUPO: (agente, empleo, actividad) dentro de un borrador.
 * Para cada grupo se calcula UNA cantidad total (no una por día), alineado con calculatePreviewImpacto:
 *
 *   aplica_cruce_festivo = true  →  cruces_festivos × valor
 *   condicion_tipo = 'consecutivos'  →  sum(floor(streak / condicion_dias)) × valor
 *   default (en_periodo)  →  floor(dias_trabajados / condicion_dias) × valor
 *
 * ─── Resolución de solapamiento modular ───────────────────────────────────────
 * Cuando varias reglas compiten (ej: 6 días → 2, 10 días → 3, 15 días → 4),
 * se filtra por condicion_dias <= dias_trabajados y se ordena DESC para elegir
 * la más específica que el agente haya alcanzado.
 *
 * ─── Concurrencia ─────────────────────────────────────────────────────────────
 * - Llamar SIEMPRE dentro de una transacción activa (el caller hace BEGIN/COMMIT).
 * - El borrador debe estar bloqueado con SELECT FOR UPDATE antes de llamar
 *   (ya es así en consolidarDevengosBorradorConClient).
 * - Los saldos_mensuales se recalculan al final via actualizarSaldosMensualesConClient.
 * - Ledger append-only: no se hacen UPDATE/DELETE de asientos históricos.
 */

'use strict';

const { randomUUID } = require('crypto');
const reglasService = require('./asignaciones-reglas.service');

// ── Helpers internos ──────────────────────────────────────────────────────────

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeEmpleoId(raw) {
  if (raw == null) return null;
  const v = String(raw).trim();
  return v && v.toLowerCase() !== 'null' ? v : null;
}

/**
 * Versión interna del cálculo de rachas (pure JS, sin dependencia de DB).
 * Equivalente a calcularDetalleRachasConsecutivas en asignaciones-reglas.service.
 */
function calcularRachas(fechas, n) {
  const { DateTime } = require('luxon');
  const diasModulo = Number(n);
  if (!Number.isFinite(diasModulo) || diasModulo <= 0) {
    return { modulos_totales: 0, rachas: [] };
  }
  const ordered = Array.from(new Set((fechas || []).map((f) => String(f).slice(0, 10)))).sort();
  if (!ordered.length) return { modulos_totales: 0, rachas: [] };

  let total = 0;
  let streak = 1;
  let streakStart = ordered[0];
  const rachas = [];

  const cerrar = (end) => {
    const mod = Math.floor(streak / diasModulo);
    rachas.push({ inicio: streakStart, fin: end, dias: streak, modulos: mod });
    total += mod;
  };

  for (let i = 1; i < ordered.length; i++) {
    const prev = DateTime.fromISO(ordered[i - 1], { zone: 'utc' });
    const curr = DateTime.fromISO(ordered[i], { zone: 'utc' });
    if (curr.diff(prev, 'days').days === 1) {
      streak++;
    } else {
      cerrar(ordered[i - 1]);
      streak = 1;
      streakStart = ordered[i];
    }
  }
  cerrar(ordered[ordered.length - 1]);

  return { modulos_totales: total, rachas };
}

// ── Queries DB ────────────────────────────────────────────────────────────────

/**
 * Devuelve los grupos (agente, empleo, actividad) de un borrador con
 * su conteo de días y lista de fechas para el cálculo.
 */
async function getGruposAsignacion(client, borradorId, arsId) {
  const { rows } = await client.query(
    `SELECT
       ab.agente_id,
       ag.empleo_id,
       bs.actividad_id,
       COUNT(DISTINCT ab.fecha)::int                                              AS dias_trabajados,
       MAX(ab.fecha)::text                                                        AS fecha_max,
       MIN(ab.fecha)::text                                                        AS fecha_min,
       array_agg(DISTINCT ab.fecha::text ORDER BY ab.fecha::text)                AS fechas
     FROM asignaciones_borrador ab
     JOIN agentes ag ON ag.id = ab.agente_id
     JOIN asignaciones_borrador_servicios bs ON bs.asignacion_borrador_id = ab.id
    WHERE ab.borrador_id        = $1
      AND ab.ars_unidad_id::text = $2::text
    GROUP BY ab.agente_id, ag.empleo_id, bs.actividad_id`,
    [borradorId, arsId]
  );
  return rows;
}

/**
 * Selecciona la regla aplicable para un grupo dentro de una transacción activa.
 *
 * Con diasTrabajados:
 *   - Filtra WHERE condicion_dias <= diasTrabajados  (solo reglas alcanzadas)
 *   - Ordena  condicion_dias DESC antes de prioridad (elige la más específica)
 *
 * Esto resuelve el solapamiento modular: si hay reglas para 6→2, 10→3, 15→4
 * y el agente trabajó 12 días, se selecciona la de umbral 10 (más específica
 * que 6 y no superada por 15).
 */
async function resolveRegla(
  client,
  {
    arsId,
    actividadId,
    empleoId,
    fecha,
    fechaHasta,
    diasTrabajados,
    reglaIdsIncluir,
  }
) {
  const empNorm = normalizeEmpleoId(empleoId);
  const params = [arsId, actividadId, fecha, empNorm, fechaHasta || null];

  const reglaIds = Array.isArray(reglaIdsIncluir)
    ? Array.from(
        new Set(
          reglaIdsIncluir
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0)
        )
      )
    : [];

  let diasWhere = '';
  let diasOrder = '';
  if (diasTrabajados != null && Number.isFinite(Number(diasTrabajados))) {
    params.push(Number(diasTrabajados));
    diasWhere = `AND (r.condicion_dias IS NULL OR r.condicion_dias <= $${params.length}::numeric)`;
    diasOrder = 'r.condicion_dias DESC,';
  }

  let categoriaWhere =
    "AND (r.categoria_regla IS NULL OR r.categoria_regla = 'Regla_Normal')";
  if (reglaIds.length) {
    params.push(reglaIds);
    categoriaWhere = `AND r.id = ANY($${params.length}::int[])`;
  }

  const { rows } = await client.query(
    `WITH RECURSIVE grp AS (
       SELECT a.grupo_id AS id_grupo, 0 AS depth
         FROM actividades a
        WHERE a.id_actividad = $2::integer AND a.grupo_id IS NOT NULL
       UNION ALL
       SELECT g.parent_id_grupo, grp.depth + 1
         FROM grupos_actividad g
         JOIN grp ON grp.id_grupo = g.id_grupo
        WHERE g.parent_id_grupo IS NOT NULL
     )
     SELECT r.*,
            a.nombre      AS actividad_nombre,
            a.actividad   AS actividad_codigo,
            ga.nombre     AS grupo_nombre,
            e.descripcion AS empleo_nombre,
            CASE
              WHEN r.actividad_id = $2::integer THEN 0
              WHEN r.grupo_id IS NOT NULL THEN 1
              ELSE 2
            END AS scope_rank,
            COALESCE((SELECT MIN(grp.depth) FROM grp WHERE grp.id_grupo = r.grupo_id), 9999) AS group_depth,
            CASE WHEN r.empleo_id::text = $4::text THEN 0 ELSE 1 END AS empleo_rank
       FROM asignaciones_reglas r
  LEFT JOIN actividades     a  ON a.id_actividad        = r.actividad_id
  LEFT JOIN grupos_actividad ga ON ga.id_grupo           = r.grupo_id
  LEFT JOIN agentes_empleo   e  ON e.id_empleo::text     = r.empleo_id::text
      WHERE r.ars_unidad_id::text = $1::text
        AND r.activo = true
        ${categoriaWhere}
        AND r.vigencia_desde <= $3::date
        AND (r.vigencia_hasta IS NULL OR r.vigencia_hasta >= $5::date)
        AND (r.empleo_id IS NULL OR r.empleo_id::text = $4::text)
        AND (
          r.actividad_id = $2::integer
          OR (r.grupo_id IS NOT NULL AND EXISTS (SELECT 1 FROM grp WHERE grp.id_grupo = r.grupo_id))
        )
        ${diasWhere}
      ORDER BY scope_rank ASC, group_depth ASC, empleo_rank ASC, ${diasOrder} r.prioridad ASC, r.id DESC
      LIMIT 1`,
    params
  );
  return rows[0] || null;
}

/**
 * Cuenta festivos dentro de [fechaMin, fechaMax] para la ARS dada.
 * Usado cuando aplica_cruce_festivo = true.
 */
function normalizeIsoDays(fechas) {
  return Array.from(new Set((fechas || []).map((f) => String(f).slice(0, 10)))).sort();
}

function resolverFechasMovimientoDesdeAsignadas({ fechasAsignadas, condicionTipo, condicionDias }) {
  const fechas = normalizeIsoDays(fechasAsignadas);
  if (!fechas.length) return [];

  const n = Math.max(0.1, Math.round(Number(condicionDias || 1) * 10) / 10);
  const tipo = String(condicionTipo || 'en_periodo');

  if (tipo === 'consecutivos') {
    const { DateTime } = require('luxon');
    const out = [];
    let streak = 1;
    let previousModulo = Math.floor((streak - 1) / n);
    if (Math.floor(streak / n) > previousModulo) out.push(fechas[0]);

    for (let i = 1; i < fechas.length; i++) {
      const prev = DateTime.fromISO(fechas[i - 1], { zone: 'utc' });
      const curr = DateTime.fromISO(fechas[i], { zone: 'utc' });
      if (curr.diff(prev, 'days').days === 1) {
        streak += 1;
      } else {
        streak = 1;
      }
      const currentModulo = Math.floor(streak / n);
      if (currentModulo > previousModulo) {
        out.push(fechas[i]);
        previousModulo = currentModulo;
      }
    }

    return out;
  }

  const out = [];
  for (let i = 0; i < fechas.length; i++) {
    if (Math.floor((i + 1) / n) > Math.floor(i / n)) {
      out.push(fechas[i]);
    }
  }
  return out;
}

async function getSaldoAnterior({ arsUnidadId, agenteId, empleoId, fecha }) {
  const db = require('../config/db');
  const empleoIdNormalized = normalizeEmpleoId(empleoId);
  const result = await db.query(
    `SELECT COALESCE(SUM(signo * cantidad_dias), 0)::numeric(12,2) AS saldo
       FROM asignaciones_ledger_movimientos
      WHERE ars_unidad_id::text = $1::text
        AND agente_id = $2
        AND COALESCE(empleo_id::text, '__NULL__') = COALESCE($3::text, '__NULL__')
        AND fecha < $4::date`,
    [arsUnidadId, agenteId, empleoIdNormalized, fecha]
  );

  return Number(result.rows[0]?.saldo || 0);
}

async function countCrucesFestivosEnRango({ arsUnidadId, fechaDesde, fechaHasta }) {
  const db = require('../config/db');
  const from = String(fechaDesde).slice(0, 10);
  const to = String(fechaHasta).slice(0, 10);
  const result = await db.query(
    `SELECT COUNT(*)::int AS cruces
       FROM generate_series($2::date, $3::date, interval '1 day') d(fecha)
      WHERE EXISTS (
        SELECT 1
          FROM festivos f
          JOIN calendarios c ON c.id = f.calendario_id
         WHERE c.ars_unidad_id::text = $1::text
           AND c.activo = true
           AND (
             (f.es_recurrente = false AND f.fecha::date = d.fecha::date)
             OR (
               f.es_recurrente = true
               AND EXTRACT(MONTH FROM f.fecha::date) = EXTRACT(MONTH FROM d.fecha::date)
               AND EXTRACT(DAY FROM f.fecha::date) = EXTRACT(DAY FROM d.fecha::date)
             )
           )
      )`,
    [arsUnidadId, from, to]
  );
  return Number(result.rows[0]?.cruces || 0);
}

async function countDiasEnRango({ fechaDesde, fechaHasta }) {
  const db = require('../config/db');
  const from = String(fechaDesde).slice(0, 10);
  const to = String(fechaHasta).slice(0, 10);
  const result = await db.query(
    `SELECT COUNT(*)::int AS total
       FROM generate_series($1::date, $2::date, interval '1 day') d(fecha)`,
    [from, to]
  );
  return Number(result.rows[0]?.total || 0);
}

function repartirCantidadPorMovimientos(cantidadTotal, cantidadMovimientos) {
  const total = Number(cantidadTotal || 0);
  const count = Number(cantidadMovimientos || 0);
  if (count <= 0 || total <= 0) return [];

  const unit = Number((total / count).toFixed(2));
  const distribucion = [];
  let acumulado = 0;
  for (let i = 0; i < count; i++) {
    if (i === count - 1) {
      distribucion.push(Number((total - acumulado).toFixed(2)));
    } else {
      distribucion.push(unit);
      acumulado = Number((acumulado + unit).toFixed(2));
    }
  }
  return distribucion;
}

/**
 * Calcula la cantidad de días a devengar para un grupo dada su regla.
 * Retorna { cantidad, base_origen, base_calculo, modulos, ...extra }.
 *
 * Alineado con calculatePreviewImpacto:
 *   aplica_cruce_festivo → cruces × valor
 *   consecutivos         → Σ floor(racha / condicion_dias) × valor
 *   en_periodo (default) → floor(dias_trabajados / condicion_dias) × valor
 */
async function calcularCantidad(regla, grupo, fechasAplicables) {
  const valor = Number(regla.valor);
  const condicionDias = Math.max(1, Number(regla.condicion_dias || 1));
  const condicionTipo = String(regla.condicion_tipo || 'en_periodo');
  const fechasFiltradas = Array.isArray(fechasAplicables)
    ? fechasAplicables
    : normalizeIsoDays(grupo.fechas);

  if (regla.aplica_cruce_festivo) {
    const cruces = fechasFiltradas.length;
    return {
      cantidad: Number((cruces * valor).toFixed(2)),
      base_origen: 'borrador_asignaciones',
      base_calculo: cruces,
      modulos: cruces,
    };
  }

  if (condicionTipo === 'consecutivos') {
    const detalle = calcularRachas(fechasFiltradas, condicionDias);
    const modulos = detalle.modulos_totales;
    return {
      cantidad: Number((modulos * valor).toFixed(2)),
      base_origen: 'consecutivos',
      base_calculo: fechasFiltradas.length,
      modulos,
      detalle_rachas: detalle.rachas,
    };
  }

  // en_periodo (default)
  const modulos = Math.floor(fechasFiltradas.length / condicionDias);
  return {
    cantidad: Number((modulos * valor).toFixed(2)),
    base_origen: 'dias_en_periodo',
    base_calculo: fechasFiltradas.length,
    modulos,
  };
}

exports.calcularPreviewImpacto = async function calcularPreviewImpacto(input, arsUnidadId) {
  const reglasHelpers = /** @type {any} */ (reglasService.__previewLegacy || {});
  const agenteId = Number(input.agente_id);
  const actividadId = Number(input.actividad_id);
  const borradorId = input.borrador_id ? Number(input.borrador_id) : null;
  const shouldUseBorradorRange = Boolean(borradorId);

  if (typeof reglasHelpers.resolvePreviewRange !== 'function' ||
      typeof reglasHelpers.resolveBorradorRangeForAgente !== 'function' ||
      typeof reglasHelpers.getAgenteContext !== 'function' ||
      typeof reglasHelpers.resolveApplicableRule !== 'function' ||
      typeof reglasHelpers.getDiasBorrador !== 'function' ||
      typeof reglasHelpers.getDiasCuadranteEnRango !== 'function' ||
      typeof reglasHelpers.calcularDetalleRachasConsecutivas !== 'function') {
    throw new Error('No se pudieron cargar los helpers de preview');
  }

  const { from: fecha, to: fechaHasta } = shouldUseBorradorRange
    ? await reglasHelpers.resolveBorradorRangeForAgente({
        arsUnidadId,
        borradorId,
        agenteId,
      })
    : await reglasHelpers.resolvePreviewRange({
        arsUnidadId,
        borradorId,
        agenteId,
        actividadId,
        fecha: input.fecha || null,
        fechaHasta: input.fecha_hasta || null,
      });

  const agente = await reglasHelpers.getAgenteContext(agenteId, arsUnidadId);

  const normalizeTipoMovimiento = (value) => {
    const tipo = String(value || '').trim().toLowerCase();
    if (tipo === 'devengo' || tipo === 'disfrute' || tipo === 'descanso') {
      return tipo;
    }
    throw new Error('Tipo de movimiento inválido para cálculo de preview');
  };

  let regla;
  if (input.regla_override) {
    const ov = input.regla_override;
    const tipoDiaOverride = String(
      hasOwn(ov, 'tipo_dia')
        ? ov.tipo_dia
        : ov.aplica_cruce_festivo
          ? 'festivo'
          : 'periodo'
    ).trim().toLowerCase();
    const aplicaCruceFestivoOverride = hasOwn(ov, 'aplica_cruce_festivo')
      ? Boolean(ov.aplica_cruce_festivo)
      : tipoDiaOverride === 'festivo';
    regla = {
      id: ov._regla_id != null && ov._regla_id !== '' ? Number(ov._regla_id) : 0,
      actividad_id:
        ov.actividad_id != null && ov.actividad_id !== ''
          ? Number(ov.actividad_id)
          : actividadId,
      actividad_codigo: null,
      actividad_nombre: null,
      grupo_id: ov.grupo_id || null,
      grupo_nombre: null,
      empleo_id: ov.empleo_id || null,
      empleo_nombre: null,
      tipo_movimiento: normalizeTipoMovimiento(ov.tipo_movimiento),
      unidad: 'dias',
      valor: Number(ov.valor),
      aplica_cruce_festivo: aplicaCruceFestivoOverride,
      tipo_dia: tipoDiaOverride,
      condicion_dias: Number(ov.condicion_dias || 6),
      condicion_tipo: ov.condicion_tipo || null,
      condicion_alcance: ov.condicion_alcance || null,
      excluir_festivos: hasOwn(ov, 'excluir_festivos')
        ? Boolean(ov.excluir_festivos)
        : true,
      prioridad: ov.prioridad != null ? Number(ov.prioridad) : 0,
      activo: true,
    };
  } else {
    regla = await reglasHelpers.resolveApplicableRule({
      arsUnidadId,
      actividadId,
      empleoId: agente.empleo_id || null,
      fecha,
      fechaHasta,
      diasTrabajados: input.borrador_id ? Number(input.dias_trabajados || 0) : null,
    });

    if (!regla) {
      return {
        aplica: false,
        motivo:
          'No existe regla activa para la actividad/empleo/fecha seleccionados',
        agente: {
          id: agente.agente_id,
          empleo_id: agente.empleo_id,
          empleo_nombre: agente.empleo_nombre,
        },
        fecha,
      };
    }
  }

  const saldoAnterior = await getSaldoAnterior({
    arsUnidadId,
    agenteId: agente.agente_id,
    empleoId: agente.empleo_id || null,
    fecha,
  });

  let crucesFestivos = 0;
  let baseCalculo = 0;
  let baseOrigen = 'regla_fechas';
  let modulos = 0;
  let detalleConsecutivos = null;

  const condicionTipo = String(regla.condicion_tipo || '').trim();
  const usaMotorNuevo = Boolean(condicionTipo);

  if (usaMotorNuevo) {
    const condicionDias = Math.max(0.1, Math.round(Number(regla.condicion_dias || 6) * 10) / 10);

    const fechasAsignadas = await reglasHelpers.getDiasCuadranteEnRango({
      arsUnidadId,
      fechaDesde: fecha,
      fechaHasta,
      soloFestivos: Boolean(regla.aplica_cruce_festivo),
      excluirFestivos: Boolean(regla.excluir_festivos),
      tipoDia: regla.tipo_dia,
    });

    baseCalculo = fechasAsignadas.length;
    baseOrigen = String(regla.tipo_dia || '').trim().toLowerCase() === 'festivo'
      ? 'preview_cuadrante_festivos'
      : String(regla.tipo_dia || '').trim().toLowerCase() === 'fin_semana'
        ? 'preview_cuadrante_fin_semana'
        : String(regla.tipo_dia || '').trim().toLowerCase() === 'laborable'
          ? 'preview_cuadrante_laborable'
          : 'preview_cuadrante';
    crucesFestivos = String(regla.tipo_dia || '').trim().toLowerCase() === 'festivo' ? baseCalculo : 0;
    modulos =
      condicionTipo === 'consecutivos'
        ? (() => {
            detalleConsecutivos = reglasHelpers.calcularDetalleRachasConsecutivas(
              fechasAsignadas,
              condicionDias
            );
            return detalleConsecutivos.modulos_totales;
          })()
        : Math.floor(baseCalculo / condicionDias);
  } else if (regla.aplica_cruce_festivo) {
    crucesFestivos = await countCrucesFestivosEnRango({
      arsUnidadId,
      fechaDesde: fecha,
      fechaHasta,
    });
    baseCalculo = crucesFestivos;
    baseOrigen = 'festivos_calendario';
    modulos = baseCalculo;
  } else {
    baseCalculo = await countDiasEnRango({
      fechaDesde: fecha,
      fechaHasta,
    });
    modulos = baseCalculo;
  }

  const factor = Number(regla.valor);
  const cantidad = Number((factor * modulos).toFixed(2));
  const tipoMovimiento = normalizeTipoMovimiento(regla.tipo_movimiento);
  regla.tipo_movimiento = tipoMovimiento;
  const signo =
    tipoMovimiento === 'disfrute' ? -1 : 1;

  const saldoProyectado = Number((saldoAnterior + signo * cantidad).toFixed(2));
  const impacto = Number((signo * cantidad).toFixed(2));
  
  return {
    aplica: true,
    motivo: 'Regla aplicable encontrada',
    agente: {
      id: agente.agente_id,
      empleo_id: agente.empleo_id,
      empleo_nombre: agente.empleo_nombre,
    },
    regla,
    cantidad,
    impacto,
    modulos,
    base_origen: baseOrigen,
    base_calculo: baseCalculo,
    cruces_festivos: crucesFestivos,
    detalle_consecutivos: detalleConsecutivos,
    fecha,
    fecha_hasta: fechaHasta,
    saldo_anterior: saldoAnterior,
    saldo_proyectado: saldoProyectado,
    bloquea_por_saldo: saldoProyectado < 0,
  };
};

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Procesa completamente los devengos de un borrador dentro de una transacción activa.
 *
 * Flujo:
 *   0. Elimina la proyección provisional previa del borrador para que el recálculo sea idempotente.
 *   1. Agrupa asignaciones por (agente, empleo, actividad).
 *   2. Para cada grupo: selecciona la regla más específica (con filtro condicion_dias),
 *      calcula la cantidad total y persiste movimientos por CADA día que devenga/disfruta.
 *   3. Recalcula saldos_mensuales para todos los agentes/empleos afectados.
 *
 * @param {object} client  - Cliente pg con transacción activa.
 * @param {number} borradorId
 * @param {string} arsId
 * @param {number|null} userId
 * @param {number} anio    - Año contable del borrador.
 * @param {number} mes     - Mes contable del borrador.
 * @returns {Promise<number>} Número de movimientos insertados/actualizados.
 */
exports.procesarBorradorCompleto = async function procesarBorradorCompleto(
  client,
  borradorId,
  arsId,
  userId,
  anio,
  mes,
  options = {}
) {
  const consolidacionRunId = randomUUID();
  const saldosAActualizar = new Set();
  const processedAgentDayKeys = new Set();
  const reglaIdsIncluir = Array.isArray(options.reglaIdsIncluir)
    ? options.reglaIdsIncluir
    : null;

  // La proyección del borrador es recalculable: se reemplaza completa en cada corrida.
  await client.query(
    `DELETE FROM asignaciones_ledger_movimientos
      WHERE ars_unidad_id::text = $1::text
        AND borrador_id = $2
        AND origen = 'borrador'`,
    [arsId, borradorId]
  );

  // 1. Obtener grupos de asignaciones.
  const grupos = await getGruposAsignacion(client, borradorId, arsId);

  if (!grupos.length) {
    return 0;
  }

  let insertados = 0;

  // 2. Procesar cada grupo.
  for (const grupo of grupos) {
    const { agente_id, empleo_id, actividad_id, dias_trabajados, fecha_min, fecha_max } = grupo;

    // 3a. Buscar regla con resolución de solapamiento modular.
    const regla = await resolveRegla(client, {
      arsId,
      actividadId: Number(actividad_id),
      empleoId: empleo_id || null,
      fecha: fecha_min,
      fechaHasta: fecha_max,
      diasTrabajados: dias_trabajados,
      reglaIdsIncluir,
    });
    if (!regla) continue;

    const condicionAlcance = String(regla.condicion_alcance || 'cualquier_actividad');
    const dedupeByScope = condicionAlcance !== 'actividad';

    const fechasAplicables = await reglasService.getDiasBorrador({
      arsUnidadId: arsId,
      borradorId,
      agenteId: Number(agente_id),
      condicionAlcance: regla.condicion_alcance || 'cualquier_actividad',
      actividadIdFiltro: regla.actividad_id || null,
      grupoIdFiltro: regla.grupo_id || null,
      excluirFestivos: Boolean(regla.excluir_festivos),
      tipoDia: regla.tipo_dia,
    });

    const fechasAplicablesEfectivas = dedupeByScope
      ? fechasAplicables.filter((fecha) => {
          const fechaIso = String(fecha).slice(0, 10);
          const key = [
            String(arsId),
            String(borradorId),
            String(agente_id),
            String(empleo_id || ''),
            fechaIso,
          ].join('|');
          if (processedAgentDayKeys.has(key)) return false;
          processedAgentDayKeys.add(key);
          return true;
        })
      : fechasAplicables;

    if (!fechasAplicablesEfectivas.length) {
      continue;
    }

    // 3b. Calcular cantidad alineada con preview.
    const calculo = await calcularCantidad(
      regla,
      { ...grupo, fechas: fechasAplicablesEfectivas },
      fechasAplicablesEfectivas
    );
    if (!calculo.cantidad || calculo.cantidad <= 0) continue;

    const signo = regla.tipo_movimiento === 'devengo' ? 1 : -1;

    let fechasMovimiento = [];
    if (regla.aplica_cruce_festivo) {
      fechasMovimiento = fechasAplicablesEfectivas;
    } else {
      fechasMovimiento = resolverFechasMovimientoDesdeAsignadas({
        fechasAsignadas: fechasAplicablesEfectivas,
        condicionTipo: regla.condicion_tipo,
        condicionDias: regla.condicion_dias,
      });
    }

    if (!fechasMovimiento.length) continue;
    if (Number(calculo.modulos) > 0 && fechasMovimiento.length !== Number(calculo.modulos)) {
      fechasMovimiento = fechasMovimiento.slice(0, Number(calculo.modulos));
    }
    const cantidadesPorMovimiento = repartirCantidadPorMovimientos(
      Number(calculo.cantidad),
      fechasMovimiento.length
    );

    const fechaMinAplicable = fechasAplicablesEfectivas.length
      ? String(fechasAplicablesEfectivas[0]).slice(0, 10)
      : fecha_min;
    const fechaMaxAplicable = fechasAplicablesEfectivas.length
      ? String(fechasAplicablesEfectivas[fechasAplicablesEfectivas.length - 1]).slice(0, 10)
      : fecha_max;
    const actividadContexto = dedupeByScope ? null : Number(actividad_id);
    const diasContexto = dedupeByScope
      ? Number(fechasAplicablesEfectivas.length)
      : Number(dias_trabajados);

    // 3d. Metadata base para auditoría.
    const metadataBase = {
      origen: 'borrador',
      automatico: true,
      calculado_por_regla: true,
      motor: 'reglas-motor/v2',
      contexto: {
        borrador_id: Number(borradorId),
        ars_unidad_id: arsId,
        agente_id: Number(agente_id),
        empleo_id: empleo_id || null,
        actividad_id: actividadContexto,
        fecha_min: fechaMinAplicable,
        fecha_max: fechaMaxAplicable,
        dias_trabajados: diasContexto,
        anio,
        mes,
      },
      regla: {
        id: Number(regla.id),
        tipo_movimiento: regla.tipo_movimiento,
        valor: Number(regla.valor),
        condicion_dias: Number(regla.condicion_dias),
        condicion_tipo: regla.condicion_tipo,
        aplica_cruce_festivo: Boolean(regla.aplica_cruce_festivo),
        prioridad: Number(regla.prioridad),
      },
      calculo: {
        ...calculo,
        signo,
      },
    };

    // 3e. Persistir un movimiento por cada día de devengo/disfrute.
    for (let i = 0; i < fechasMovimiento.length; i++) {
      const fechaMovimiento = fechasMovimiento[i];
      const cantidadMovimiento = Number(cantidadesPorMovimiento[i] || 0);
      if (!cantidadMovimiento || cantidadMovimiento <= 0) continue;

      const { rows: saldoRowsDia } = await client.query(
        `SELECT COALESCE(SUM(signo * cantidad_dias), 0)::numeric(12,2) AS saldo
           FROM asignaciones_ledger_movimientos
          WHERE ars_unidad_id::text = $1::text
            AND agente_id = $2
            AND COALESCE(empleo_id::text, '__NULL__') = COALESCE($3::text, '__NULL__')
            AND fecha < $4::date`,
        [arsId, agente_id, empleo_id || null, fechaMovimiento]
      );
      const saldoAntesDia = Number(saldoRowsDia[0]?.saldo || 0);
      const saldoDespuesDia = Number(
        (saldoAntesDia + signo * cantidadMovimiento).toFixed(2)
      );

      const metadata = {
        ...metadataBase,
        calculo: {
          ...metadataBase.calculo,
          impacto: Number((signo * cantidadMovimiento).toFixed(2)),
          saldo_antes: saldoAntesDia,
          saldo_despues: saldoDespuesDia,
          cantidad_movimiento: cantidadMovimiento,
          indice_movimiento: i + 1,
          total_movimientos: fechasMovimiento.length,
        },
        fecha_movimiento: fechaMovimiento,
      };

      const sourceKey = `borrador:${borradorId}:run:${consolidacionRunId}:${agente_id}:dia:${actividad_id}:${fechaMovimiento}`;

      await client.query(
        `INSERT INTO asignaciones_ledger_movimientos
            (ars_unidad_id, agente_id, empleo_id, actividad_id, regla_id,
             borrador_id, anio, mes, fecha, origen, tipo_movimiento,
             signo, cantidad_dias, saldo_antes, saldo_despues,
             source_kind, source_key, metadata, usuario_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,'borrador',$10,$11,$12,$13,$14,
           'borrador',$15,$16::jsonb,$17)`,
        [
          arsId,
          agente_id,
          empleo_id || null,
          actividad_id,
          regla.id,
          borradorId,
          anio,
          mes,
          fechaMovimiento,
          regla.tipo_movimiento,
          signo,
          cantidadMovimiento,
          saldoAntesDia,
          saldoDespuesDia,
          sourceKey,
          JSON.stringify(metadata),
          userId || null,
        ]
      );

      insertados++;
    }

    saldosAActualizar.add(
      JSON.stringify({ agente_id, empleo_id: empleo_id || null, anio, mes })
    );
  }

  // 3. Recalcular saldos_mensuales para todos los afectados.
  for (const key of saldosAActualizar) {
    const s = JSON.parse(key);
    await reglasService.actualizarSaldosMensualesConClient(client, {
      arsUnidadId: arsId,
      agenteId: s.agente_id,
      empleoId: s.empleo_id,
      anio: s.anio,
      mes: s.mes,
    });
  }

  return insertados;
};
