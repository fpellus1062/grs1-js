const db = require('../config/db');

function normalizeJerarquiaPath(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;
  if (/^[0-9]{7}$/.test(raw)) return raw;
  if (/^\d+(\.\d+)*$/.test(raw)) return raw;
  throw new Error(
    'Jerarquía inválida. Use formato 7 dígitos (ej: 1210000) o por niveles (ej: 0.1.1.2).'
  );
}

// ─── Empleos ────────────────────────────────────────────────────────────────

exports.getAllEmpleos = async () => {
  const r = await db.query(
    `SELECT id_empleo,
            descripcion,
            color,
            COALESCE(grupo, '') AS escala,
            COALESCE(grupo, '') AS grupo,
            COALESCE(TRIM(jerarquia::text), '') AS jerarquia
     FROM agentes_empleo
     ORDER BY jerarquia, id_empleo`
  );
  return r.rows;
};

exports.getEmpleosJerarquiaTree = async (root = null) => {
  const r = await db.query(
    `SELECT jerarquia, jerarquia_padre, nivel, empleos_en_nodo, empleos, orden_path
     FROM public.get_empleos_jerarquia_tree($1)`,
    [root || null]
  );
  return r.rows;
};

exports.createEmpleo = async ({
  id_empleo,
  descripcion,
  color = null,
  escala,
  grupo,
  jerarquia,
}) => {
  const nEscala = escala || grupo || null;
  const nJerarquia = normalizeJerarquiaPath(jerarquia);
  const r = await db.query(
    `INSERT INTO agentes_empleo (id_empleo, descripcion, color, grupo, jerarquia)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id_empleo,
               descripcion,
               color,
               COALESCE(grupo, '') AS escala,
               COALESCE(grupo, '') AS grupo,
               COALESCE(TRIM(jerarquia::text), '') AS jerarquia`,
    [id_empleo, descripcion, color, nEscala, nJerarquia]
  );
  return r.rows[0];
};

exports.updateEmpleo = async (
  id,
  { descripcion, color, escala, grupo, jerarquia }
) => {
  const nEscala = escala || grupo || null;
  const nJerarquia = normalizeJerarquiaPath(jerarquia);
  const r = await db.query(
    `UPDATE agentes_empleo
     SET descripcion = $1,
         color = $2,
         grupo = $3,
         jerarquia = $4
     WHERE id_empleo = $5
     RETURNING id_empleo,
               descripcion,
               color,
               COALESCE(grupo, '') AS escala,
               COALESCE(grupo, '') AS grupo,
               COALESCE(TRIM(jerarquia::text), '') AS jerarquia`,
    [descripcion, color, nEscala, nJerarquia, id]
  );
  if (!r.rows.length) throw new Error('Empleo no encontrado');
  return r.rows[0];
};

exports.deleteEmpleo = async (id) => {
  const r = await db.query(
    'DELETE FROM agentes_empleo WHERE id_empleo = $1 RETURNING id_empleo',
    [id]
  );
  if (!r.rows.length) throw new Error('Empleo no encontrado');
};

// ─── Pelotones ───────────────────────────────────────────────────────────────

exports.getAllPelotones = async () => {
  const r = await db.query(
    'SELECT id_peloton, descripcion, color FROM agentes_peloton ORDER BY id_peloton'
  );
  return r.rows;
};

exports.createPeloton = async ({ id_peloton, descripcion, color = null }) => {
  const r = await db.query(
    'INSERT INTO agentes_peloton (id_peloton, descripcion, color) VALUES ($1, $2, $3) RETURNING id_peloton, descripcion, color',
    [id_peloton, descripcion, color]
  );
  return r.rows[0];
};

exports.updatePeloton = async (id, { descripcion, color }) => {
  const r = await db.query(
    'UPDATE agentes_peloton SET descripcion = $1, color = $2 WHERE id_peloton = $3 RETURNING id_peloton, descripcion, color',
    [descripcion, color, id]
  );
  if (!r.rows.length) throw new Error('Pelotón no encontrado');
  return r.rows[0];
};

exports.deletePeloton = async (id) => {
  const r = await db.query(
    'DELETE FROM agentes_peloton WHERE id_peloton = $1 RETURNING id_peloton',
    [id]
  );
  if (!r.rows.length) throw new Error('Pelotón no encontrado');
};

// ─── Situaciones ─────────────────────────────────────────────────────────────

exports.getAllSituaciones = async () => {
  const r = await db.query(
    'SELECT id_situacion, descripcion, color FROM agentes_situacion ORDER BY id_situacion'
  );
  return r.rows;
};

exports.createSituacion = async ({
  id_situacion,
  descripcion,
  color = null,
}) => {
  const r = await db.query(
    'INSERT INTO agentes_situacion (id_situacion, descripcion, color) VALUES ($1, $2, $3) RETURNING id_situacion, descripcion, color',
    [id_situacion, descripcion, color]
  );
  return r.rows[0];
};

exports.updateSituacion = async (id, { descripcion, color }) => {
  const r = await db.query(
    'UPDATE agentes_situacion SET descripcion = $1, color = $2 WHERE id_situacion = $3 RETURNING id_situacion, descripcion, color',
    [descripcion, color, id]
  );
  if (!r.rows.length) throw new Error('Situación no encontrada');
  return r.rows[0];
};

exports.deleteSituacion = async (id) => {
  const r = await db.query(
    'DELETE FROM agentes_situacion WHERE id_situacion = $1 RETURNING id_situacion',
    [id]
  );
  if (!r.rows.length) throw new Error('Situación no encontrada');
};

// ─── Grupos de Actividad ─────────────────────────────────────────────────────

exports.getAllGrupos = async () => {
  const r = await db.query(
    'SELECT id_grupo, nombre, color FROM grupos_actividad ORDER BY nombre'
  );
  return r.rows;
};

exports.createGrupo = async ({ nombre, color = null }) => {
  const r = await db.query(
    'INSERT INTO grupos_actividad (nombre, color) VALUES ($1, $2) RETURNING id_grupo, nombre, color',
    [nombre, color]
  );
  return r.rows[0];
};

exports.updateGrupo = async (id, { nombre, color }) => {
  const r = await db.query(
    'UPDATE grupos_actividad SET nombre = $1, color = $2 WHERE id_grupo = $3 RETURNING id_grupo, nombre, color',
    [nombre, color, id]
  );
  if (!r.rows.length) throw new Error('Grupo no encontrado');
  return r.rows[0];
};

exports.deleteGrupo = async (id) => {
  const r = await db.query(
    'DELETE FROM grupos_actividad WHERE id_grupo = $1 RETURNING id_grupo',
    [id]
  );
  if (!r.rows.length) throw new Error('Grupo no encontrado');
};

// ─── ARS (Unidades) ─────────────────────────────────────────────────────────

exports.getAllArs = async () => {
  const r = await db.query(
    `SELECT a.id_unidad, a.color, a.domicilio, a.poblacion, a.codigo_postal, a.provincia,
            a.telefono, a.email, a.oficial_mando,
            TRIM(COALESCE(ag.apellido_1,'') || ' ' || COALESCE(ag.apellido_2,'') || ' ' || COALESCE(ag.nombre,'')) AS oficial_mando_nombre,
            ae.descripcion AS oficial_mando_empleo,
            ae.color AS oficial_mando_empleo_color
     FROM ars a
     LEFT JOIN agentes ag ON ag.id = a.oficial_mando
     LEFT JOIN agentes_empleo ae ON ae.id_empleo = ag.empleo_id
     ORDER BY a.id_unidad`
  );
  return r.rows;
};

exports.createArs = async (
  {
    id_unidad,
    color,
    domicilio,
    poblacion,
    codigo_postal,
    provincia,
    telefono,
    email,
    oficial_mando,
  },
  userId
) => {
  const r = await db.query(
    `INSERT INTO ars (id_unidad, color, domicilio, poblacion, codigo_postal, provincia, telefono, email, oficial_mando, created_user)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      id_unidad,
      color || null,
      domicilio || null,
      poblacion || null,
      codigo_postal || null,
      provincia || null,
      telefono || null,
      email || null,
      oficial_mando || null,
      userId,
    ]
  );
  return r.rows[0];
};

exports.updateArs = async (
  id,
  {
    color,
    domicilio,
    poblacion,
    codigo_postal,
    provincia,
    telefono,
    email,
    oficial_mando,
  }
) => {
  const r = await db.query(
    `UPDATE ars
     SET color = $1, domicilio = $2, poblacion = $3, codigo_postal = $4, provincia = $5,
         telefono = $6, email = $7, oficial_mando = $8
     WHERE id_unidad = $9
     RETURNING *`,
    [
      color || null,
      domicilio || null,
      poblacion || null,
      codigo_postal || null,
      provincia || null,
      telefono || null,
      email || null,
      oficial_mando || null,
      id,
    ]
  );
  if (!r.rows.length) throw new Error('Unidad ARS no encontrada');
  return r.rows[0];
};

exports.deleteArs = async (id) => {
  const r = await db.query(
    'DELETE FROM ars WHERE id_unidad = $1 RETURNING id_unidad',
    [id]
  );
  if (!r.rows.length) throw new Error('Unidad ARS no encontrada');
};

// ─── Provincias ──────────────────────────────────────────────────────────────

exports.getAllProvincias = async () => {
  const r = await db.query('SELECT id, nombre FROM provincias ORDER BY nombre');
  return r.rows;
};
