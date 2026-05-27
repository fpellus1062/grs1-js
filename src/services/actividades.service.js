const db = require('../config/db');

function normalizeNullableString(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const normalizedValue = String(value).trim();
  return normalizedValue === '' ? null : normalizedValue;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeRequiredString(value, fieldName) {
  const normalizedValue = normalizeNullableString(value);
  if (!normalizedValue) {
    throw new Error(`${fieldName} es requerido`);
  }

  return normalizedValue;
}

function normalizeNullableInteger(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsedValue = Number.parseInt(value, 10);
  if (Number.isNaN(parsedValue)) {
    throw new Error(`${fieldName} debe ser un número entero`);
  }

  return parsedValue;
}

function normalizeDisponibilidad(value) {
  if (value === undefined || value === null) {
    return '';
  }

  const normalizedValue = String(value).trim();
  if (['', '--a--', '--d--'].includes(normalizedValue)) {
    return normalizedValue;
  }

  throw new Error('Disponible debe usar un valor permitido');
}

function normalizeTime(value, fieldName, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new Error(`${fieldName} es requerida`);
    }

    return null;
  }

  const normalizedValue = String(value).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(normalizedValue)) {
    throw new Error(`${fieldName} debe tener formato HH:MM`);
  }

  return normalizedValue;
}

function normalizeActividadColor(value) {
  if (value === undefined || value === null || value === '') {
    return '#6c757d';
  }

  const normalizedValue = String(value).trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(normalizedValue)) {
    throw new Error('El color debe tener formato hexadecimal (#RRGGBB)');
  }

  return normalizedValue;
}

function timeToMinutes(value) {
  if (!value) {
    return null;
  }

  const [hours, minutes] = value
    .split(':')
    .map((part) => Number.parseInt(part, 10));
  return hours * 60 + minutes;
}

async function ensureActividadIsAvailable(actividad, excludedId = null) {
  if (!actividad) {
    return;
  }

  const params = excludedId === null ? [actividad] : [actividad, excludedId];
  const query =
    excludedId === null
      ? 'SELECT id_actividad FROM actividades WHERE actividad = $1'
      : 'SELECT id_actividad FROM actividades WHERE actividad = $1 AND id_actividad <> $2';

  const result = await db.query(query, params);
  if (result.rows.length > 0) {
    throw new Error('Ya existe una actividad registrada con este código');
  }
}

function validateTimeRange(horaInicio, horaFin) {
  if (!horaInicio || !horaFin) {
    return;
  }

  if (timeToMinutes(horaFin) <= timeToMinutes(horaInicio)) {
    throw new Error('La hora fin debe ser mayor que la hora inicio');
  }
}

async function ensureGrupoExists(grupoId) {
  if (grupoId === null) {
    return;
  }

  const result = await db.query(
    'SELECT id_grupo FROM grupos_actividad WHERE id_grupo = $1',
    [grupoId]
  );

  if (!result.rows.length) {
    throw new Error('El grupo seleccionado no existe');
  }
}

async function resolveActividadNivelSelectParts() {
  const gruposColsRes = await db.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'grupos_actividad'`
  );
  const gruposCols = new Set(
    (gruposColsRes.rows || []).map((row) => String(row.column_name || ''))
  );

  const grupoNivelCol = gruposCols.has('nivel_id')
    ? 'nivel_id'
    : gruposCols.has('nivel')
      ? 'nivel'
      : null;

  const nivelesTableRes = await db.query(
    `SELECT to_regclass('public.niveles_grupo')::text AS table_name`
  );
  const nivelesTableName =
    (nivelesTableRes.rows &&
      nivelesTableRes.rows[0] &&
      nivelesTableRes.rows[0].table_name) ||
    null;

  let nivelesJoinSql = '';
  let nivelNombreSql = "'Sin nivel'";
  let nivelOrdenSql = 'NULL::int';
  let nivelColorSql = 'NULL::text';

  if (grupoNivelCol) {
    nivelOrdenSql = `g.${grupoNivelCol}::int`;
    nivelNombreSql = `('Nivel ' || COALESCE(g.${grupoNivelCol}::text, '?'))`;
  }

  if (nivelesTableName && grupoNivelCol) {
    const nivelesTableOnly = String(nivelesTableName).split('.').pop();
    const nivelesColsRes = await db.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1`,
      [nivelesTableOnly]
    );
    const nivelesCols = new Set(
      (nivelesColsRes.rows || []).map((row) => String(row.column_name || ''))
    );
    const nivelIdCol = nivelesCols.has('id_nivel')
      ? 'id_nivel'
      : nivelesCols.has('id')
        ? 'id'
        : null;
    const nivelDescCol = nivelesCols.has('descripcion')
      ? 'descripcion'
      : nivelesCols.has('nombre')
        ? 'nombre'
        : null;
    const nivelColorCol = nivelesCols.has('color')
      ? 'color'
      : nivelesCols.has('color_hex')
        ? 'color_hex'
        : null;

    if (nivelIdCol) {
      nivelesJoinSql = `LEFT JOIN ${nivelesTableName} ng ON ng.${nivelIdCol} = g.${grupoNivelCol}`;
      if (nivelDescCol) {
        nivelNombreSql = `COALESCE(NULLIF(TRIM(ng.${nivelDescCol}::text), ''), ('Nivel ' || COALESCE(g.${grupoNivelCol}::text, '?')))`;
      }
      if (nivelColorCol) {
        nivelColorSql = `NULLIF(TRIM(ng.${nivelColorCol}::text), '')`;
      }
    }
  }

  return {
    nivelesJoinSql,
    nivelNombreSql,
    nivelOrdenSql,
    nivelColorSql,
  };
}

async function buildActividadSelectSql(whereClause = '') {
  const {
    nivelesJoinSql,
    nivelNombreSql,
    nivelOrdenSql,
    nivelColorSql,
  } = await resolveActividadNivelSelectParts();

  return `SELECT a.*,
            g.nombre AS grupo_nombre,
            NULLIF(TRIM(g.color::text), '') AS grupo_color,
            ${nivelOrdenSql} AS nivel_grupo_orden,
            ${nivelNombreSql} AS nivel_grupo_nombre,
            ${nivelColorSql} AS nivel_grupo_color
          FROM actividades a
          LEFT JOIN grupos_actividad g ON g.id_grupo = a.grupo_id
          ${nivelesJoinSql}
          ${whereClause}`;
}

exports.create = async (data, userId) => {
  try {
    const actividad = normalizeNullableString(data.actividad);
    const nombre = normalizeRequiredString(data.nombre, 'El nombre');
    const disponible = normalizeDisponibilidad(data.disponible);
    const grupoId = normalizeNullableInteger(data.grupo_id, 'Grupo ID');
    const horario = normalizeNullableString(data.horario);
    const horaInicio = normalizeTime(data.hora_inicio, 'Hora inicio', false);
    const horaFin = normalizeTime(data.hora_fin, 'Hora fin', false);
    const color = normalizeActividadColor(data.color);

    validateTimeRange(horaInicio, horaFin);
    await ensureActividadIsAvailable(actividad);
    await ensureGrupoExists(grupoId);

    const result = await db.query(
      `INSERT INTO actividades
      (actividad, nombre, disponible, grupo_id, horario, hora_inicio, hora_fin, color, create_user)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        actividad,
        nombre,
        disponible,
        grupoId,
        horario,
        horaInicio,
        horaFin,
        color,
        userId,
      ]
    );

    if (!result.rows.length) {
      throw new Error('Error al crear la actividad en la base de datos');
    }

    return result.rows[0];
  } catch (error) {
    if (error.code === '23505') {
      throw new Error('Esta actividad ya existe en el sistema');
    }

    if (error.code === '23503') {
      throw new Error('Uno o más datos referenciados no existen en el sistema');
    }

    throw error;
  }
};

exports.getAll = async () => {
  try {
    const { nivelOrdenSql } = await resolveActividadNivelSelectParts();
    const sql = await buildActividadSelectSql(
      `ORDER BY COALESCE(${nivelOrdenSql}, 9999), g.nombre, a.nombre, a.id_actividad`
    );
    const result = await db.query(sql);
    return result.rows;
  } catch (error) {
    throw new Error(`Error al obtener las actividades: ${error.message}`);
  }
};

exports.getMeta = async () => {
  try {
    const [gruposResult, disponiblesResult] = await Promise.all([
      db.query(
        'SELECT id_grupo, nombre, color FROM grupos_actividad ORDER BY nombre, id_grupo'
      ),
      db.query(
        "SELECT DISTINCT COALESCE(disponible, '') AS disponible FROM actividades ORDER BY disponible"
      ),
    ]);

    return {
      grupos: gruposResult.rows,
      disponibilidadOptions: Array.from(
        new Set([
          '',
          '--a--',
          '--d--',
          ...disponiblesResult.rows.map((row) => row.disponible || ''),
        ])
      ),
    };
  } catch (error) {
    throw new Error(
      `Error al obtener los metadatos de actividades: ${error.message}`
    );
  }
};

exports.getById = async (id) => {
  if (!id || Number.isNaN(Number(id))) {
    throw new Error('ID de actividad inválido');
  }

  const sql = await buildActividadSelectSql('WHERE a.id_actividad = $1');
  const result = await db.query(sql, [id]);
  if (!result.rows.length) {
    throw new Error('Actividad no encontrada');
  }

  return result.rows[0];
};

exports.update = async (id, data) => {
  try {
    if (!id || Number.isNaN(Number(id))) {
      throw new Error('ID de actividad inválido');
    }

    const existing = await exports.getById(id);

    const hasActividad = hasOwn(data, 'actividad');
    const hasNombre = hasOwn(data, 'nombre');
    const hasDisponible = hasOwn(data, 'disponible');
    const hasGrupoId = hasOwn(data, 'grupo_id');
    const hasHorario = hasOwn(data, 'horario');
    const hasHoraInicio = hasOwn(data, 'hora_inicio');
    const hasHoraFin = hasOwn(data, 'hora_fin');
    const hasColor = hasOwn(data, 'color');

    const actividad = hasActividad
      ? normalizeNullableString(data.actividad)
      : existing.actividad;
    const nombre = hasNombre
      ? normalizeRequiredString(data.nombre, 'El nombre')
      : existing.nombre;
    const disponible = hasDisponible
      ? normalizeDisponibilidad(data.disponible)
      : existing.disponible;
    const grupoId = hasGrupoId
      ? normalizeNullableInteger(data.grupo_id, 'Grupo ID')
      : existing.grupo_id;
    const horario = hasHorario
      ? normalizeNullableString(data.horario)
      : existing.horario;
    const horaInicio = hasHoraInicio
      ? normalizeTime(data.hora_inicio, 'Hora inicio', false)
      : existing.hora_inicio;
    const horaFin = hasHoraFin
      ? normalizeTime(data.hora_fin, 'Hora fin', false)
      : existing.hora_fin;
    const color = hasColor
      ? normalizeActividadColor(data.color)
      : normalizeActividadColor(existing.color);

    validateTimeRange(horaInicio, horaFin);
    await ensureActividadIsAvailable(actividad, id);
    await ensureGrupoExists(grupoId);

    const result = await db.query(
      `UPDATE actividades
      SET actividad = $1,
          nombre = $2,
          disponible = $3,
          grupo_id = $4,
          horario = $5,
          hora_inicio = $6,
          hora_fin = $7,
          color = $8
      WHERE id_actividad = $9
      RETURNING *`,
      [
        actividad,
        nombre,
        disponible,
        grupoId,
        horario,
        horaInicio,
        horaFin,
        color,
        id,
      ]
    );

    if (!result.rows.length) {
      throw new Error('No se pudo actualizar la actividad');
    }

    return result.rows[0];
  } catch (error) {
    if (error.code === '23505') {
      throw new Error('Esta actividad ya existe en el sistema');
    }

    if (error.code === '23503') {
      throw new Error('Uno o más datos referenciados no existen en el sistema');
    }

    throw error;
  }
};

exports.delete = async (id) => {
  if (!id || Number.isNaN(Number(id))) {
    throw new Error('ID de actividad inválido');
  }

  const existing = await db.query(
    'SELECT id_actividad, fecha_baja FROM actividades WHERE id_actividad = $1',
    [id]
  );
  if (!existing.rows.length) {
    throw new Error('Actividad no encontrada');
  }

  const isBaja = !!existing.rows[0].fecha_baja;

  const result = await db.query(
    `UPDATE actividades
     SET fecha_baja = CASE WHEN fecha_baja IS NULL THEN NOW() ELSE NULL END
     WHERE id_actividad = $1
     RETURNING id_actividad, fecha_baja`,
    [id]
  );
  if (!result.rows.length) {
    throw new Error('No se pudo cambiar el estado de la actividad');
  }

  return {
    id_actividad: Number(id),
    fecha_baja: result.rows[0].fecha_baja,
    message: isBaja
      ? 'Actividad reactivada exitosamente'
      : 'Actividad dada de baja exitosamente',
  };
};
