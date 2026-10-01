// Backups de la BD ERD Turnos ARSWEB: catálogos maestros (export/import íntegros)
// + tablas de trabajo (export/purga/import por rango de fechas de negocio).
// El árbol de dependencias (children / FK_EDGES) refleja las FK reales del esquema;
// donde no existe FK real en BD (asignaciones_servicios, asignaciones_borrador_servicios)
// se gestiona igualmente para mantener la integridad al purgar/reimportar.
const fs = require('fs/promises');
const path = require('path');
const db = require('../config/db');

const BASE_DIR = path.resolve(
  process.env.BACKUP_BASE_DIR ||
    path.join(__dirname, '..', '..', 'data', 'backups')
);

// ═══════════════════════════════════════════════════════
//  Catálogos maestros (sin fecha: export/import íntegros, sin purga por esta vía)
// ═══════════════════════════════════════════════════════
const CATALOGOS = [
  { key: 'provincias', table: 'provincias', label: 'Provincias', pk: 'id', noSequence: true },
  { key: 'comunidades', table: 'comunidades', label: 'Comunidades', pk: 'id', noSequence: true },
  { key: 'ars', table: 'ars', label: 'ARS (unidades)', pk: 'id_unidad', noSequence: true },
  { key: 'agentes_empleo', table: 'agentes_empleo', label: 'Empleos', pk: 'id_empleo', noSequence: true },
  { key: 'agentes_peloton', table: 'agentes_peloton', label: 'Pelotones', pk: 'id_peloton', noSequence: true },
  { key: 'agentes_situacion', table: 'agentes_situacion', label: 'Situaciones de agente', pk: 'id_situacion', noSequence: true },
  { key: 'niveles_grupo', table: 'niveles_grupo', label: 'Niveles de grupo', pk: 'id', noSequence: true },
  {
    key: 'grupos_actividad',
    table: 'grupos_actividad',
    label: 'Grupos de actividad',
    pk: 'id_grupo',
    // Auto-referencia (parent_id_grupo); se insertan primero los niveles superiores.
    ordenarFilas: (rows) => [...rows].sort((a, b) => (a.nivel_id ?? 0) - (b.nivel_id ?? 0)),
  },
  {
    key: 'grupos_actividad_closure',
    table: 'grupos_actividad_closure',
    label: 'Cierre transitivo de grupos',
    pk: ['ancestro_id_grupo', 'descendiente_id_grupo'],
    noSequence: true,
  },
  { key: 'jerarquias', table: 'jerarquias', label: 'Jerarquías', pk: 'id', identityAlways: true },
  { key: 'roles', table: 'roles', label: 'Roles', pk: 'id' },
  { key: 'permisos', table: 'permisos', label: 'Permisos', pk: 'id' },
  { key: 'roles_permisos', table: 'roles_permisos', label: 'Matriz roles-permisos', pk: 'id' },
  { key: 'usuarios', table: 'usuarios', label: 'Usuarios (incluye hash de contraseña)', pk: 'id' },
  { key: 'usuarios_ars', table: 'usuarios_ars', label: 'Usuarios por ARS', pk: 'id' },
  { key: 'turnos', table: 'turnos', label: 'Catálogo de turnos', pk: 'id_turno' },
  { key: 'calendarios', table: 'calendarios', label: 'Calendarios', pk: 'id' },
  { key: 'festivos', table: 'festivos', label: 'Festivos', pk: 'id' },
  { key: 'actividades', table: 'actividades', label: 'Actividades / servicios', pk: 'id_actividad' },
  { key: 'agentes', table: 'agentes', label: 'Agentes (ficha de personal)', pk: 'id' },
  { key: 'asignaciones_reglas', table: 'asignaciones_reglas', label: 'Reglas de devengos', pk: 'id' },
  {
    key: 'agentes_requisitos_plantillas',
    table: 'agentes_requisitos_plantillas',
    label: 'Plantillas de requisitos periódicos',
    pk: 'id',
    children: [
      {
        key: 'agentes_requisitos_plantilla_objetivos',
        table: 'agentes_requisitos_plantilla_objetivos',
        label: 'Objetivos de la plantilla',
        pk: 'id',
        fk: 'plantilla_id',
      },
    ],
  },
  { key: 'help_items', table: 'help_items', label: 'Contenidos de ayuda', pk: 'id' },
];

// Aristas FK reales entre catálogos (hijo depende de padre): [tabla_hija, tabla_padre].
// Se usan solo para ordenar el INSERT en importación; la autorreferencia de
// grupos_actividad se resuelve aparte con `ordenarFilas`.
const CATALOGO_FK_EDGES = [
  ['agentes', 'ars'],
  ['agentes', 'agentes_empleo'],
  ['agentes', 'agentes_peloton'],
  ['agentes', 'provincias'],
  ['agentes', 'agentes_situacion'],
  ['agentes_requisitos_plantillas', 'ars'],
  ['agentes_requisitos_plantillas', 'usuarios'],
  ['asignaciones_reglas', 'actividades'],
  ['asignaciones_reglas', 'ars'],
  ['asignaciones_reglas', 'agentes_empleo'],
  ['asignaciones_reglas', 'grupos_actividad'],
  ['calendarios', 'ars'],
  ['festivos', 'calendarios'],
  ['grupos_actividad', 'niveles_grupo'],
  ['grupos_actividad_closure', 'grupos_actividad'],
  ['roles_permisos', 'permisos'],
  ['roles_permisos', 'roles'],
  ['turnos', 'usuarios'],
  ['usuarios', 'roles'],
  ['usuarios_ars', 'ars'],
  ['usuarios_ars', 'usuarios'],
];

// ═══════════════════════════════════════════════════════
//  Tablas de trabajo (con fecha de negocio: export/preview/purga/import por rango)
//  dateColumn/dateExpr siempre reflejan el hecho de negocio, nunca created_at/changed_at
//  salvo que la tabla no tenga otra fecha propia (son el propio hecho auditado).
// ═══════════════════════════════════════════════════════
const TRABAJO = [
  {
    key: 'asignaciones',
    table: 'asignaciones',
    label: 'Asignaciones validadas',
    pk: 'id',
    identityAlways: true,
    dateColumn: 'fecha',
    columnType: 'date',
    children: [
      {
        key: 'asignaciones_servicios',
        table: 'asignaciones_servicios',
        label: 'Servicios de asignación',
        pk: 'id',
        identityAlways: true,
        fk: 'asignacion_id', // sin FK real en BD; se gestiona igualmente aquí
      },
    ],
  },
  {
    key: 'asignaciones_borrador',
    table: 'asignaciones_borrador',
    label: 'Asignaciones en borrador',
    pk: 'id',
    identityAlways: true,
    dateColumn: 'fecha',
    columnType: 'date',
    children: [
      {
        key: 'asignaciones_borrador_servicios',
        table: 'asignaciones_borrador_servicios',
        label: 'Servicios de asignación (borrador)',
        pk: 'id',
        identityAlways: true,
        fk: 'asignacion_borrador_id', // sin FK real en BD; se gestiona igualmente aquí
      },
    ],
  },
  {
    key: 'asignaciones_borradores',
    table: 'asignaciones_borradores',
    label: 'Cabeceras de borradores de asignación',
    pk: 'id',
    dateExpr: 'make_date(anio, mes, 1)',
    columnType: 'date',
    dateFromRow: (row) => (row.anio && row.mes ? `${row.anio}-${String(row.mes).padStart(2, '0')}-01` : null),
  },
  {
    key: 'asignaciones_control',
    table: 'asignaciones_control',
    label: 'Control mensual de asignaciones',
    pk: 'id',
    identityAlways: true,
    dateExpr: 'make_date(anio, mes, 1)',
    columnType: 'date',
    dateFromRow: (row) => (row.anio && row.mes ? `${row.anio}-${String(row.mes).padStart(2, '0')}-01` : null),
  },
  {
    key: 'asignaciones_log',
    table: 'asignaciones_log',
    label: 'Auditoría de asignaciones',
    pk: 'id',
    identityAlways: true,
    // Fecha del servicio auditado, no created_at (que es cuándo se escribió el log
    // y puede no coincidir, p. ej. en correcciones tardías de días pasados).
    dateColumn: 'fecha',
    columnType: 'date',
  },
  {
    key: 'asignaciones_ledger_movimientos',
    table: 'asignaciones_ledger_movimientos',
    label: 'Movimientos de devengos (ledger)',
    pk: 'id',
    dateColumn: 'fecha',
    columnType: 'date',
  },
  {
    key: 'asignaciones_ledger_saldos_mensuales',
    table: 'asignaciones_ledger_saldos_mensuales',
    label: 'Saldos mensuales de devengos (ledger)',
    pk: 'id',
    dateExpr: 'make_date(anio, mes, 1)',
    columnType: 'date',
    dateFromRow: (row) => (row.anio && row.mes ? `${row.anio}-${String(row.mes).padStart(2, '0')}-01` : null),
  },
  {
    key: 'audit_login',
    table: 'audit_login',
    label: 'Auditoría de accesos (login)',
    pk: 'id',
    // Aquí created_at SÍ es el hecho de negocio: el instante del login.
    dateColumn: 'created_at',
    columnType: 'timestamptz',
  },
  {
    key: 'turnos_log',
    table: 'turnos_log',
    label: 'Auditoría de turnos',
    pk: 'id_log',
    // Tabla de catálogo (turnos) sin fecha propia: el hecho es el propio cambio.
    dateColumn: 'created_at',
    columnType: 'timestamptz',
  },
  {
    key: 'plan_audit_log',
    table: 'plan_audit_log',
    label: 'Auditoría de planificación',
    pk: 'id',
    // Log genérico sobre varias tablas; no hay fecha de negocio única extraíble.
    dateColumn: 'changed_at',
    columnType: 'timestamptz',
  },
  {
    key: 'agentes_requisitos_periodos',
    table: 'agentes_requisitos_periodos',
    label: 'Periodos de requisitos de agentes',
    pk: 'id',
    dateColumn: 'periodo_inicio',
    columnType: 'date',
    children: [
      {
        key: 'agentes_requisitos_ejecuciones',
        table: 'agentes_requisitos_ejecuciones',
        label: 'Ejecuciones de requisitos periódicos',
        pk: 'id',
        fk: 'periodo_id',
      },
    ],
  },
  {
    key: 'plan',
    table: 'plan',
    label: 'Planes de planificación',
    pk: 'id_plan',
    dateColumn: 'fecha_inicio',
    columnType: 'date',
    children: [
      {
        key: 'plan_borrador',
        table: 'plan_borrador',
        label: 'Borradores de plan',
        pk: 'id',
        fk: 'plan_id',
        children: [
          {
            key: 'plan_borrador_version',
            table: 'plan_borrador_version',
            label: 'Versiones de borrador de plan',
            pk: 'id',
            fk: 'borrador_id',
            children: [
              {
                key: 'plan_borrador_asignacion',
                table: 'plan_borrador_asignacion',
                label: 'Asignaciones de borrador de plan',
                pk: 'id',
                fk: 'version_id',
              },
            ],
          },
        ],
      },
      {
        key: 'plan_final_asignacion',
        table: 'plan_final_asignacion',
        label: 'Asignaciones finales de planificación',
        pk: 'id',
        fk: 'plan_id',
      },
    ],
  },
  {
    key: 'cuadrantes_planificacion',
    table: 'cuadrantes_planificacion',
    label: 'Cuadrantes de planificación',
    pk: 'id',
    dateColumn: 'fecha_inicio',
    columnType: 'date',
    children: [
      {
        key: 'cuadrantes_planificacion_dias',
        table: 'cuadrantes_planificacion_dias',
        label: 'Días del cuadrante',
        pk: 'id',
        fk: 'cuadrante_id',
      },
      {
        key: 'cuadrantes_planificacion_importaciones',
        table: 'cuadrantes_planificacion_importaciones',
        label: 'Importaciones del cuadrante',
        pk: 'id',
        fk: 'cuadrante_id',
      },
    ],
  },
];

// Nota: se excluyen deliberadamente del catálogo `jerarquia` y `mi_jeraruia`:
// tablas residuales sin PK/FK, no usadas por la aplicación.

const CATALOGOS_INDEX = new Map(CATALOGOS.map((e) => [e.key, e]));
const TRABAJO_INDEX = new Map(TRABAJO.map((e) => [e.key, e]));

function pkColumns(entry) {
  return Array.isArray(entry.pk) ? entry.pk : [entry.pk];
}

function pkConflictClause(entry) {
  return pkColumns(entry)
    .map((c) => `"${c}"`)
    .join(', ');
}

function normalizarClaves(tablas, indice, etiquetaError) {
  const arr = Array.isArray(tablas) ? tablas : [];
  const unicas = [...new Set(arr.map(String))];
  const desconocidas = unicas.filter((k) => !indice.has(k));
  if (desconocidas.length) {
    throw new Error(`${etiquetaError}: ${desconocidas.join(', ')}`);
  }
  return unicas;
}

// Orden topológico simple (Kahn) para que los catálogos referenciados por FK
// se inserten antes que los que dependen de ellos.
function ordenarCatalogosTopologicamente(keys) {
  const set = new Set(keys);
  const adyacencia = new Map();
  const gradoEntrada = new Map();
  set.forEach((k) => {
    adyacencia.set(k, []);
    gradoEntrada.set(k, 0);
  });
  CATALOGO_FK_EDGES.forEach(([hijo, padre]) => {
    if (set.has(hijo) && set.has(padre)) {
      adyacencia.get(padre).push(hijo);
      gradoEntrada.set(hijo, gradoEntrada.get(hijo) + 1);
    }
  });
  const cola = [...set].filter((k) => gradoEntrada.get(k) === 0);
  const resultado = [];
  while (cola.length) {
    const actual = cola.shift();
    resultado.push(actual);
    (adyacencia.get(actual) || []).forEach((vecino) => {
      gradoEntrada.set(vecino, gradoEntrada.get(vecino) - 1);
      if (gradoEntrada.get(vecino) === 0) cola.push(vecino);
    });
  }
  if (resultado.length !== set.size) {
    // Ciclo inesperado (no debería ocurrir): se añade el resto al final como salvaguarda.
    set.forEach((k) => {
      if (!resultado.includes(k)) resultado.push(k);
    });
  }
  return resultado;
}

// Autocomprobación al cargar el módulo: detecta errores de grafo cuanto antes.
if (ordenarCatalogosTopologicamente([...CATALOGOS_INDEX.keys()]).length !== CATALOGOS.length) {
  throw new Error('[backup] Grafo de dependencias de catálogos inconsistente');
}

function validarRango(desde, hasta) {
  if (!desde || !hasta) throw new Error('Debe indicar fecha "desde" y "hasta"');
  const d1 = new Date(desde);
  const d2 = new Date(hasta);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) {
    throw new Error('Fechas inválidas');
  }
  if (d1 > d2) {
    throw new Error('La fecha "desde" no puede ser posterior a "hasta"');
  }
}

function buildDateFilterSql(entry, idx1, idx2) {
  const expr = entry.dateExpr ? `(${entry.dateExpr})` : `"${entry.dateColumn}"`;
  if (entry.columnType === 'date') {
    return `${expr} BETWEEN $${idx1}::date AND $${idx2}::date`;
  }
  return `${expr} >= $${idx1}::date AND ${expr} < ($${idx2}::date + INTERVAL '1 day')`;
}

function sanitizeRelativeFolder(input) {
  const raw = String(input || '')
    .trim()
    .replace(/\\/g, '/');
  const segments = raw
    .split('/')
    .filter((s) => s && s !== '.' && s !== '..');
  return segments.join('/');
}

function resolveWithinBase(relativeFolder) {
  const cleaned = sanitizeRelativeFolder(relativeFolder);
  const target = path.resolve(BASE_DIR, cleaned);
  if (target !== BASE_DIR && !target.startsWith(BASE_DIR + path.sep)) {
    throw new Error('Ruta de carpeta inválida');
  }
  return { cleaned, target };
}

function buildTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

async function leerJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function leerManifest(dir) {
  try {
    return await leerJson(path.join(dir, 'manifest.json'));
  } catch (_e) {
    throw new Error(
      'No se encontró un manifiesto de backup válido en la ruta indicada'
    );
  }
}

// ═══════════════════════════════════════════════════════
//  Catálogo expuesto al cliente
// ═══════════════════════════════════════════════════════

function resumenEntryArbol(entry) {
  return {
    key: entry.key,
    table: entry.table,
    label: entry.label,
    dateColumn: entry.dateColumn || null,
    dateExpr: entry.dateExpr || null,
    hijos: (entry.children || []).map(resumenEntryArbol),
  };
}

exports.getCatalog = () => ({
  catalogos: CATALOGOS.map(resumenEntryArbol),
  trabajo: TRABAJO.map(resumenEntryArbol),
});

// ═══════════════════════════════════════════════════════
//  Recolección recursiva de ids (usada por preview y por eliminar)
// ═══════════════════════════════════════════════════════

// filtro: undefined (todo) | { modo:'rango', desde, hasta } | { modo:'padres', ids }
async function recolectarIdsArbol(runner, entry, filtro) {
  let whereSql = '1 = 1';
  let params = [];
  if (filtro && filtro.modo === 'rango') {
    whereSql = buildDateFilterSql(entry, 1, 2);
    params = [filtro.desde, filtro.hasta];
  } else if (filtro && filtro.modo === 'padres') {
    if (!filtro.ids.length) {
      whereSql = '1 = 0';
    } else {
      whereSql = `"${entry.fk}" = ANY($1::bigint[])`;
      params = [filtro.ids];
    }
  }
  const pkCol = pkColumns(entry)[0];
  const res = await runner.query(
    `SELECT "${pkCol}" AS pk_val FROM "${entry.table}" WHERE ${whereSql}`,
    params
  );
  const ids = res.rows.map((r) => r.pk_val);
  const nodo = { entry, ids, hijos: [] };
  for (const child of entry.children || []) {
    nodo.hijos.push(await recolectarIdsArbol(runner, child, { modo: 'padres', ids }));
  }
  return nodo;
}

function resumenNodoIds(nodo) {
  return {
    key: nodo.entry.key,
    table: nodo.entry.table,
    label: nodo.entry.label,
    total: nodo.ids.length,
    hijos: nodo.hijos.map(resumenNodoIds),
  };
}

exports.preview = async ({ desde, hasta, tablasTrabajo, tablasCatalogo }) => {
  const resumen = { trabajo: [], catalogos: [] };
  const trabajoKeys = tablasTrabajo && tablasTrabajo.length
    ? normalizarClaves(tablasTrabajo, TRABAJO_INDEX, 'Tabla de trabajo no reconocida')
    : [];
  if (trabajoKeys.length) {
    validarRango(desde, hasta);
    for (const key of trabajoKeys) {
      const nodo = await recolectarIdsArbol(db, TRABAJO_INDEX.get(key), {
        modo: 'rango',
        desde,
        hasta,
      });
      resumen.trabajo.push(resumenNodoIds(nodo));
    }
  }
  const catalogoKeys = tablasCatalogo && tablasCatalogo.length
    ? normalizarClaves(tablasCatalogo, CATALOGOS_INDEX, 'Catálogo no reconocido')
    : [];
  for (const key of catalogoKeys) {
    const nodo = await recolectarIdsArbol(db, CATALOGOS_INDEX.get(key), undefined);
    resumen.catalogos.push(resumenNodoIds(nodo));
  }
  if (!trabajoKeys.length && !catalogoKeys.length) {
    throw new Error('Debe seleccionar al menos una tabla');
  }
  return resumen;
};

// ═══════════════════════════════════════════════════════
//  Exportación (árbol recursivo; catálogos sin filtro, trabajo por rango)
// ═══════════════════════════════════════════════════════

async function exportarArbol(entry, exportDir, manifestNodo, rango, parentIds) {
  let whereSql = '1 = 1';
  let params = [];
  if (parentIds !== undefined) {
    if (!parentIds.length) {
      whereSql = '1 = 0';
    } else {
      whereSql = `"${entry.fk}" = ANY($1::bigint[])`;
      params = [parentIds];
    }
  } else if (rango) {
    whereSql = buildDateFilterSql(entry, 1, 2);
    params = [rango.desde, rango.hasta];
  }

  const res = await db.query(
    `SELECT * FROM "${entry.table}" WHERE ${whereSql} ORDER BY ${pkConflictClause(entry)}`,
    params
  );
  const archivo = `${entry.table}.json`;
  await fs.writeFile(
    path.join(exportDir, archivo),
    JSON.stringify({
      table: entry.table,
      pk: entry.pk,
      identityAlways: !!entry.identityAlways,
      rows: res.rows,
    })
  );

  manifestNodo.key = entry.key;
  manifestNodo.table = entry.table;
  manifestNodo.label = entry.label;
  manifestNodo.archivo = archivo;
  manifestNodo.total = res.rows.length;
  manifestNodo.hijos = [];

  if (entry.children && entry.children.length) {
    const pkCol = pkColumns(entry)[0];
    const ids = res.rows.map((r) => r[pkCol]);
    for (const child of entry.children) {
      const hijoManifest = {};
      await exportarArbol(child, exportDir, hijoManifest, undefined, ids);
      manifestNodo.hijos.push(hijoManifest);
    }
  }
}

exports.exportar = async ({ desde, hasta, tablasTrabajo, tablasCatalogo, carpeta }) => {
  const trabajoKeys = tablasTrabajo && tablasTrabajo.length
    ? normalizarClaves(tablasTrabajo, TRABAJO_INDEX, 'Tabla de trabajo no reconocida')
    : [];
  const catalogoKeys = tablasCatalogo && tablasCatalogo.length
    ? normalizarClaves(tablasCatalogo, CATALOGOS_INDEX, 'Catálogo no reconocido')
    : [];
  if (!trabajoKeys.length && !catalogoKeys.length) {
    throw new Error('Debe seleccionar al menos una tabla');
  }
  if (trabajoKeys.length) validarRango(desde, hasta);

  const { cleaned, target: baseTarget } = resolveWithinBase(carpeta);
  const exportId = buildTimestamp();
  const exportDir = path.join(baseTarget, `backup_${exportId}`);
  await fs.mkdir(exportDir, { recursive: true });

  const manifest = {
    generatedAt: new Date().toISOString(),
    exportId,
    desde: trabajoKeys.length ? desde : null,
    hasta: trabajoKeys.length ? hasta : null,
    carpeta: cleaned,
    trabajo: [],
    catalogos: [],
  };

  for (const key of trabajoKeys) {
    const nodoManifest = {};
    await exportarArbol(TRABAJO_INDEX.get(key), exportDir, nodoManifest, { desde, hasta }, undefined);
    manifest.trabajo.push(nodoManifest);
  }

  for (const key of ordenarCatalogosTopologicamente(catalogoKeys)) {
    const nodoManifest = {};
    await exportarArbol(CATALOGOS_INDEX.get(key), exportDir, nodoManifest, undefined, undefined);
    manifest.catalogos.push(nodoManifest);
  }

  await fs.writeFile(
    path.join(exportDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  return {
    rutaRelativa: `${cleaned ? cleaned + '/' : ''}backup_${exportId}`,
    manifest,
  };
};

// ═══════════════════════════════════════════════════════
//  Eliminación de datos ya exportados (solo tablas de trabajo; requiere manifiesto real en disco)
// ═══════════════════════════════════════════════════════

async function borrarArbol(client, nodo) {
  const hijos = [];
  for (const hijoNodo of nodo.hijos) {
    hijos.push(await borrarArbol(client, hijoNodo));
  }
  const pkCol = pkColumns(nodo.entry)[0];
  let eliminadas = 0;
  if (nodo.ids.length) {
    const r = await client.query(
      `DELETE FROM "${nodo.entry.table}" WHERE "${pkCol}" = ANY($1::bigint[])`,
      [nodo.ids]
    );
    eliminadas = r.rowCount;
  }
  return { key: nodo.entry.key, table: nodo.entry.table, eliminadas, hijos };
}

exports.eliminarExportado = async ({ rutaRelativa, tablas }) => {
  const { target } = resolveWithinBase(rutaRelativa);
  const manifest = await leerManifest(target);
  const keys = normalizarClaves(tablas, TRABAJO_INDEX, 'Tabla de trabajo no reconocida');

  const disponibles = new Set((manifest.trabajo || []).map((t) => t.key));
  const faltantes = keys.filter((k) => !disponibles.has(k));
  if (faltantes.length) {
    throw new Error(
      `Las tablas ${faltantes.join(', ')} no existen como tablas de trabajo en la copia de seguridad seleccionada`
    );
  }
  if (!manifest.desde || !manifest.hasta) {
    throw new Error('La copia de seguridad no tiene un rango de fechas de trabajo asociado');
  }

  const client = await db.connect();
  const resumen = [];
  try {
    await client.query('BEGIN');
    for (const key of keys) {
      const nodo = await recolectarIdsArbol(client, TRABAJO_INDEX.get(key), {
        modo: 'rango',
        desde: manifest.desde,
        hasta: manifest.hasta,
      });
      resumen.push(await borrarArbol(client, nodo));
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { resumen, desde: manifest.desde, hasta: manifest.hasta };
};

// ═══════════════════════════════════════════════════════
//  Listado de backups disponibles (para importación)
// ═══════════════════════════════════════════════════════

function resumenNodoManifest(n) {
  return {
    key: n.key,
    table: n.table,
    label: n.label,
    total: n.total,
    hijos: (n.hijos || []).map(resumenNodoManifest),
  };
}

exports.listarBackups = async () => {
  await fs.mkdir(BASE_DIR, { recursive: true });
  const carpetas = await fs.readdir(BASE_DIR, { withFileTypes: true });
  const resultado = [];

  for (const carpetaDirent of carpetas) {
    if (!carpetaDirent.isDirectory()) continue;
    const carpetaPath = path.join(BASE_DIR, carpetaDirent.name);
    const subdirs = await fs.readdir(carpetaPath, { withFileTypes: true });

    for (const sub of subdirs) {
      if (!sub.isDirectory() || !sub.name.startsWith('backup_')) continue;
      try {
        const manifest = await leerManifest(path.join(carpetaPath, sub.name));
        resultado.push({
          rutaRelativa: `${carpetaDirent.name}/${sub.name}`,
          carpeta: carpetaDirent.name,
          exportId: manifest.exportId,
          generatedAt: manifest.generatedAt,
          desde: manifest.desde,
          hasta: manifest.hasta,
          trabajo: (manifest.trabajo || []).map(resumenNodoManifest),
          catalogos: (manifest.catalogos || []).map(resumenNodoManifest),
        });
      } catch (_e) {
        // Carpeta sin manifiesto válido: se ignora.
      }
    }
  }

  resultado.sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1));
  return resultado;
};

// ═══════════════════════════════════════════════════════
//  Importación (catálogos primero, en orden topológico; luego árboles de trabajo)
// ═══════════════════════════════════════════════════════

function normalizeParam(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

async function insertRows(client, tableCfg, rows) {
  if (!rows || !rows.length) return 0;
  const overriding = tableCfg.identityAlways ? 'OVERRIDING SYSTEM VALUE ' : '';
  const conflictClause = pkConflictClause(tableCfg);
  let inserted = 0;
  for (const row of rows) {
    const columns = Object.keys(row);
    const colList = columns.map((c) => `"${c}"`).join(', ');
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const values = columns.map((c) => normalizeParam(row[c]));
    const sql =
      `INSERT INTO "${tableCfg.table}" (${colList}) ${overriding}` +
      `VALUES (${placeholders}) ON CONFLICT (${conflictClause}) DO NOTHING`;
    const r = await client.query(sql, values);
    inserted += r.rowCount;
  }
  return inserted;
}

async function resyncSequence(client, table, pk) {
  try {
    await client.query(
      `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT MAX("${pk}") FROM "${table}"), 1))`,
      [`public.${table}`, pk]
    );
  } catch (error) {
    console.warn(
      `[backup] No se pudo resincronizar la secuencia de ${table}.${pk}:`,
      error.message
    );
  }
}

async function resyncSecuenciasSiProcede(client, tableCfg) {
  if (tableCfg.noSequence || Array.isArray(tableCfg.pk)) return;
  await resyncSequence(client, tableCfg.table, tableCfg.pk);
}

function valorFechaDeFila(entry, row) {
  if (typeof entry.dateFromRow === 'function') return entry.dateFromRow(row);
  return row[entry.dateColumn];
}

// Filtra filas de un JSON exportado por un subrango de fechas (desde/hasta opcionales).
function filtrarFilasPorRango(rows, entry, desde, hasta) {
  if (!desde && !hasta) return rows || [];
  return (rows || []).filter((row) => {
    const raw = valorFechaDeFila(entry, row);
    if (raw === null || raw === undefined) return false;
    const valor = String(raw).slice(0, 10);
    if (desde && valor < desde) return false;
    if (hasta && valor > hasta) return false;
    return true;
  });
}

async function importarArbol(client, entry, nodoManifest, exportDir, rango, parentIdsPermitidos) {
  const data = await leerJson(path.join(exportDir, nodoManifest.archivo));
  let filas = data.rows || [];
  if (parentIdsPermitidos !== undefined) {
    filas = filas.filter((r) => parentIdsPermitidos.has(r[entry.fk]));
  } else if (rango) {
    filas = filtrarFilasPorRango(filas, entry, rango.desde, rango.hasta);
  }
  if (typeof entry.ordenarFilas === 'function') filas = entry.ordenarFilas(filas);

  const insertadas = await insertRows(client, entry, filas);
  await resyncSecuenciasSiProcede(client, entry);

  const pkCol = pkColumns(entry)[0];
  const idsPermitidosHijos = new Set(filas.map((r) => r[pkCol]));
  const hijosResumen = [];
  for (const childEntry of entry.children || []) {
    const hijoManifest = (nodoManifest.hijos || []).find((h) => h.key === childEntry.key);
    if (hijoManifest) {
      hijosResumen.push(
        await importarArbol(client, childEntry, hijoManifest, exportDir, undefined, idsPermitidosHijos)
      );
    }
  }

  return {
    key: entry.key,
    table: entry.table,
    insertadas,
    total: filas.length,
    totalDisponible: (data.rows || []).length,
    hijos: hijosResumen,
  };
}

exports.importar = async ({ rutaRelativa, tablas, desde, hasta }) => {
  if (desde && hasta && desde > hasta) {
    throw new Error('La fecha "desde" no puede ser posterior a "hasta"');
  }
  const { target } = resolveWithinBase(rutaRelativa);
  const manifest = await leerManifest(target);
  const keys = Array.isArray(tablas) ? [...new Set(tablas.map(String))] : [];
  if (!keys.length) throw new Error('Debe seleccionar al menos una tabla');

  const catalogosEnManifest = new Map((manifest.catalogos || []).map((n) => [n.key, n]));
  const trabajoEnManifest = new Map((manifest.trabajo || []).map((n) => [n.key, n]));

  const catalogoKeys = keys.filter((k) => catalogosEnManifest.has(k));
  const trabajoKeys = keys.filter((k) => trabajoEnManifest.has(k));
  const desconocidas = keys.filter((k) => !catalogosEnManifest.has(k) && !trabajoEnManifest.has(k));
  if (desconocidas.length) {
    throw new Error(`Las tablas ${desconocidas.join(', ')} no existen en la copia de seguridad seleccionada`);
  }

  const client = await db.connect();
  const resumen = { catalogos: [], trabajo: [] };
  try {
    await client.query('BEGIN');

    for (const key of ordenarCatalogosTopologicamente(catalogoKeys)) {
      resumen.catalogos.push(
        await importarArbol(client, CATALOGOS_INDEX.get(key), catalogosEnManifest.get(key), target)
      );
    }
    for (const key of trabajoKeys) {
      resumen.trabajo.push(
        await importarArbol(client, TRABAJO_INDEX.get(key), trabajoEnManifest.get(key), target, {
          desde,
          hasta,
        })
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { resumen };
};
