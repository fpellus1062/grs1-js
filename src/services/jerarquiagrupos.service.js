const db = require('../config/db');

const TABLA_GRUPOS_CANDIDATAS = ['grupos_actividad'];
const TABLA_NIVELES = 'niveles_grupo';
const TABLA_ACTIVIDADES = 'actividades';

let tablaGruposCache = null;

async function getTablaGrupos() {
  if (tablaGruposCache) return tablaGruposCache;

  const result = await db.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
      ORDER BY CASE table_name
        WHEN 'grupos_actividad' THEN 1
        ELSE 99
      END
      LIMIT 1`,
    [TABLA_GRUPOS_CANDIDATAS]
  );

  const found =
    result.rows && result.rows[0] ? result.rows[0].table_name : null;
  if (!found) {
    throw new Error('No existe la tabla grupos_actividad en schema public');
  }

  tablaGruposCache = found;
  return found;
}

async function getColumns(tableName) {
  const result = await db.query(
    `SELECT column_name
		   FROM information_schema.columns
		  WHERE table_schema = 'public'
		    AND table_name = $1`,
    [tableName]
  );
  return new Set(
    (result.rows || []).map((row) => String(row.column_name || '').trim())
  );
}

async function getSchemaColumns() {
  const tablaGrupos = await getTablaGrupos();
  const [gruposCols, nivelesCols] = await Promise.all([
    getColumns(tablaGrupos),
    getColumns(TABLA_NIVELES),
  ]);

  const grupoNivelCol = gruposCols.has('nivel_id')
    ? 'nivel_id'
    : gruposCols.has('nivel')
      ? 'nivel'
      : null;

  const nivelIdCol = nivelesCols.has('id')
    ? 'id'
    : nivelesCols.has('id_nivel')
      ? 'id_nivel'
      : null;

  const nivelNombreCol = nivelesCols.has('nombre')
    ? 'nombre'
    : nivelesCols.has('descripcion')
      ? 'descripcion'
      : null;

  const nivelColorCol = nivelesCols.has('color')
    ? 'color'
    : nivelesCols.has('color_hex')
      ? 'color_hex'
      : null;

  if (!grupoNivelCol) {
    throw new Error(
      `La tabla ${tablaGrupos} no tiene columna de nivel compatible`
    );
  }

  if (!nivelIdCol || !nivelNombreCol) {
    throw new Error('La tabla niveles_grupo no tiene columnas compatibles');
  }

  const grupoColorCol = gruposCols.has('color') ? 'color' : null;
  const grupoCodigoCol = gruposCols.has('codigo') ? 'codigo' : null;

  return {
    tablaGrupos,
    grupoNivelCol,
    grupoColorCol,
    grupoCodigoCol,
    nivelIdCol,
    nivelNombreCol,
    nivelColorCol,
  };
}

function buildTree(rows, parentId) {
  return rows
    .filter((r) => {
      const rParent =
        r.parent_id_grupo === null || r.parent_id_grupo === undefined
          ? null
          : Number(r.parent_id_grupo);
      const target = parentId === null ? null : Number(parentId);
      return rParent === target;
    })
    .map((node) => ({
      ...node,
      _children: buildTree(rows, node.id_grupo),
    }));
}

exports.getNiveles = async () => {
  const schema = await getSchemaColumns();
  const result = await db.query(
    `SELECT ${schema.nivelIdCol} AS id,
				${schema.nivelNombreCol} AS nombre,
				${schema.nivelColorCol ? `CAST(${schema.nivelColorCol} AS text)` : 'NULL::text'} AS color
			 FROM ${TABLA_NIVELES}
			ORDER BY ${schema.nivelIdCol}`
  );
  return result.rows;
};

exports.getGruposFlat = async () => {
  const schema = await getSchemaColumns();
  const result = await db.query(
    `SELECT g.id_grupo,
				g.nombre,
        ${schema.grupoColorCol ? `g.${schema.grupoColorCol}` : 'NULL::text'} AS color,
        ${schema.grupoCodigoCol ? `g.${schema.grupoCodigoCol}` : 'NULL::text'} AS codigo,
				g.parent_id_grupo,
				g.${schema.grupoNivelCol} AS nivel,
				n.${schema.nivelIdCol} AS nivel_id,
				n.${schema.nivelNombreCol} AS nivel_nombre,
				${schema.nivelColorCol ? `CAST(n.${schema.nivelColorCol} AS text)` : 'NULL::text'} AS nivel_color,
				g.orden,
				g.activo,
				parent.nombre AS parent_nombre
       FROM ${schema.tablaGrupos} g
			 LEFT JOIN ${TABLA_NIVELES} n ON n.${schema.nivelIdCol} = g.${schema.grupoNivelCol}
       LEFT JOIN ${schema.tablaGrupos} parent ON parent.id_grupo = g.parent_id_grupo
			ORDER BY g.${schema.grupoNivelCol}, g.orden, g.nombre`
  );
  return result.rows;
};

exports.getGruposTree = async () => {
  const rows = await exports.getGruposFlat();
  return buildTree(rows, null);
};

exports.getGrupoPath = async (id) => {
  const schema = await getSchemaColumns();
  const result = await db.query(
    `WITH RECURSIVE path AS (
			 SELECT g.id_grupo,
						g.nombre,
						g.${schema.grupoNivelCol} AS nivel,
						n.${schema.nivelIdCol} AS nivel_id,
						n.${schema.nivelNombreCol} AS nivel_nombre,
						${schema.nivelColorCol ? `CAST(n.${schema.nivelColorCol} AS text)` : 'NULL::text'} AS nivel_color,
						g.parent_id_grupo,
						0 AS profundidad
         FROM ${schema.tablaGrupos} g
			   LEFT JOIN ${TABLA_NIVELES} n ON n.${schema.nivelIdCol} = g.${schema.grupoNivelCol}
			  WHERE g.id_grupo = $1
			 UNION ALL
			 SELECT g.id_grupo,
						g.nombre,
						g.${schema.grupoNivelCol} AS nivel,
						n.${schema.nivelIdCol} AS nivel_id,
						n.${schema.nivelNombreCol} AS nivel_nombre,
						${schema.nivelColorCol ? `CAST(n.${schema.nivelColorCol} AS text)` : 'NULL::text'} AS nivel_color,
						g.parent_id_grupo,
						p.profundidad + 1
         FROM ${schema.tablaGrupos} g
			   LEFT JOIN ${TABLA_NIVELES} n ON n.${schema.nivelIdCol} = g.${schema.grupoNivelCol}
			   JOIN path p ON g.id_grupo = p.parent_id_grupo
		 )
		 SELECT id_grupo, nombre, nivel, nivel_id, nivel_nombre, nivel_color, profundidad
		   FROM path
		  ORDER BY profundidad DESC`,
    [id]
  );
  return result.rows;
};

exports.createGrupo = async (data) => {
  const schema = await getSchemaColumns();
  const {
    nombre,
    parent_id_grupo = null,
    nivel,
    codigo = null,
    color = null,
    orden = 0,
    activo = true,
  } = data;
  const normalizedCodigo =
    codigo == null || String(codigo).trim() === ''
      ? null
      : String(codigo).trim();
  const normalizedColor =
    color == null || String(color).trim() === '' ? null : String(color).trim();

  const insertColumns = [
    'nombre',
    'parent_id_grupo',
    schema.grupoNivelCol,
    'orden',
    'activo',
  ];
  const insertValues = [
    nombre.trim(),
    parent_id_grupo || null,
    nivel,
    orden,
    activo,
  ];
  if (schema.grupoCodigoCol) {
    insertColumns.push(schema.grupoCodigoCol);
    insertValues.push(normalizedCodigo);
  }
  if (schema.grupoColorCol) {
    insertColumns.push(schema.grupoColorCol);
    insertValues.push(normalizedColor);
  }
  const insertPlaceholders = insertValues
    .map((_, idx) => `$${idx + 1}`)
    .join(', ');

  try {
    const result = await db.query(
      `INSERT INTO ${schema.tablaGrupos} (${insertColumns.join(', ')})
			 VALUES (${insertPlaceholders})
			 RETURNING *`,
      insertValues
    );
    if (!result.rows.length) throw new Error('Error al crear el grupo');
    return result.rows[0];
  } catch (error) {
    if (error.code === '23505')
      throw new Error('Ya existe un grupo con ese nombre en el mismo nivel');
    if (error.code === '23514')
      throw new Error(
        error.message || 'Error de validación en el nivel del grupo'
      );
    throw error;
  }
};

exports.updateGrupo = async (id, data) => {
  const schema = await getSchemaColumns();
  const existing = await db.query(
    `SELECT * FROM ${schema.tablaGrupos} WHERE id_grupo = $1`,
    [id]
  );
  if (!existing.rows.length) throw new Error('Grupo no encontrado');
  const row = existing.rows[0];

  let parent_id_grupo = row.parent_id_grupo;
  let nivel = row[schema.grupoNivelCol];

  if (Object.hasOwn(data, 'parent_id_grupo')) {
    parent_id_grupo = data.parent_id_grupo || null;

    if (parent_id_grupo != null && Number(parent_id_grupo) === Number(id)) {
      throw new Error('El grupo no puede ser padre de sí mismo');
    }

    if (parent_id_grupo != null) {
      const parentResult = await db.query(
        `SELECT id_grupo, ${schema.grupoNivelCol} AS nivel
           FROM ${schema.tablaGrupos}
          WHERE id_grupo = $1`,
        [parent_id_grupo]
      );

      if (!parentResult.rows.length) {
        throw new Error('El grupo padre seleccionado no existe');
      }

      const descendants = await db.query(
        `WITH RECURSIVE tree AS (
           SELECT id_grupo
             FROM ${schema.tablaGrupos}
            WHERE parent_id_grupo = $1
           UNION ALL
           SELECT g.id_grupo
             FROM ${schema.tablaGrupos} g
             JOIN tree t ON g.parent_id_grupo = t.id_grupo
         )
         SELECT id_grupo FROM tree`,
        [id]
      );

      const isDescendant = descendants.rows.some(
        (item) => Number(item.id_grupo) === Number(parent_id_grupo)
      );
      if (isDescendant) {
        throw new Error('No se puede mover el grupo dentro de su propio árbol');
      }
    }
  }

  const nombre = Object.hasOwn(data, 'nombre')
    ? data.nombre.trim()
    : row.nombre;
  const orden = Object.hasOwn(data, 'orden') ? data.orden : row.orden;
  const activo = Object.hasOwn(data, 'activo') ? data.activo : row.activo;
  const codigo = Object.hasOwn(data, 'codigo')
    ? data.codigo == null || String(data.codigo).trim() === ''
      ? null
      : String(data.codigo).trim()
    : schema.grupoCodigoCol
      ? row[schema.grupoCodigoCol]
      : null;
  const color = Object.hasOwn(data, 'color')
    ? data.color == null || String(data.color).trim() === ''
      ? null
      : String(data.color).trim()
    : schema.grupoColorCol
      ? row[schema.grupoColorCol]
      : null;
  if (Object.hasOwn(data, 'nivel')) {
    nivel = data.nivel;
  }

  const updateFields = [
    'nombre = $1',
    'parent_id_grupo = $2',
    `${schema.grupoNivelCol} = $3`,
    'orden = $4',
    'activo = $5',
  ];
  const updateValues = [nombre, parent_id_grupo, nivel, orden, activo];
  if (schema.grupoCodigoCol) {
    updateFields.push(`${schema.grupoCodigoCol} = $${updateValues.length + 1}`);
    updateValues.push(codigo);
  }
  if (schema.grupoColorCol) {
    updateFields.push(`${schema.grupoColorCol} = $${updateValues.length + 1}`);
    updateValues.push(color);
  }
  updateValues.push(id);
  const idPlaceholder = `$${updateValues.length}`;

  try {
    const result = await db.query(
      `UPDATE ${schema.tablaGrupos}
          SET ${updateFields.join(',\n              ')}
        WHERE id_grupo = ${idPlaceholder}
      RETURNING *`,
      updateValues
    );
    if (!result.rows.length) throw new Error('No se pudo actualizar el grupo');
    return result.rows[0];
  } catch (error) {
    if (error.code === '23505')
      throw new Error('Ya existe un grupo con ese nombre en el mismo nivel');
    if (error.code === '23503')
      throw new Error('El grupo padre seleccionado no existe');
    if (error.code === '23514')
      throw new Error(
        error.message ||
          'Relación padre-hijo inválida para el nivel seleccionado'
      );
    throw error;
  }
};

exports.deleteGrupo = async (id) => {
  const schema = await getSchemaColumns();
  try {
    const result = await db.query(
      `DELETE FROM ${schema.tablaGrupos} WHERE id_grupo = $1 RETURNING id_grupo`,
      [id]
    );
    if (!result.rows.length)
      throw new Error('Grupo no encontrado o ya eliminado');
    return { id_grupo: Number(id) };
  } catch (error) {
    if (error.code === 'P0001')
      throw new Error(
        error.message || 'No se puede eliminar: el grupo tiene subgrupos'
      );
    if (error.code === '23503')
      throw new Error(
        'No se puede eliminar: el grupo tiene actividades asociadas'
      );
    throw error;
  }
};

exports.getActividadesByGrupo = async (grupoId) => {
  const result = await db.query(
    `SELECT id_actividad, actividad, nombre, disponible, grupo_id, horario, hora_inicio, hora_fin, color, fecha_baja
     FROM ${TABLA_ACTIVIDADES}
     WHERE grupo_id = $1
     ORDER BY nombre, id_actividad`,
    [grupoId]
  );
  return result.rows;
};

exports.createActividad = async (data, userId) => {
  const {
    actividad,
    nombre,
    disponible = '',
    grupo_id,
    horario = null,
    hora_inicio = null,
    hora_fin = null,
    color = null,
  } = data;

  const actividadCodigo = String(actividad || '').trim();
  if (!actividadCodigo) throw new Error('El código es requerido');

  try {
    const result = await db.query(
      `INSERT INTO ${TABLA_ACTIVIDADES} (actividad, nombre, disponible, grupo_id, horario, hora_inicio, hora_fin, color, create_user)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        actividadCodigo,
        nombre.trim(),
        disponible || '',
        grupo_id,
        horario || null,
        hora_inicio || null,
        hora_fin || null,
        color || null,
        userId,
      ]
    );
    if (!result.rows.length) throw new Error('Error al crear la actividad');
    return result.rows[0];
  } catch (error) {
    if (error.code === '23505')
      throw new Error('Ya existe una actividad con ese código');
    if (error.code === '23503')
      throw new Error('El grupo seleccionado no existe');
    throw error;
  }
};

exports.updateActividad = async (id, data) => {
  const existing = await db.query(
    `SELECT * FROM ${TABLA_ACTIVIDADES} WHERE id_actividad = $1`,
    [id]
  );
  if (!existing.rows.length) throw new Error('Actividad no encontrada');
  const row = existing.rows[0];

  if (Object.hasOwn(data, 'actividad')) {
    throw new Error('El código no se puede modificar');
  }

  const nombre = Object.hasOwn(data, 'nombre')
    ? data.nombre.trim()
    : row.nombre;
  const disponible = Object.hasOwn(data, 'disponible')
    ? data.disponible || ''
    : row.disponible;
  const grupo_id = Object.hasOwn(data, 'grupo_id')
    ? data.grupo_id
    : row.grupo_id;
  const horario = Object.hasOwn(data, 'horario')
    ? data.horario || null
    : row.horario;
  const hora_inicio = Object.hasOwn(data, 'hora_inicio')
    ? data.hora_inicio || null
    : row.hora_inicio;
  const hora_fin = Object.hasOwn(data, 'hora_fin')
    ? data.hora_fin || null
    : row.hora_fin;
  const color = Object.hasOwn(data, 'color') ? data.color || null : row.color;

  try {
    const result = await db.query(
      `UPDATE ${TABLA_ACTIVIDADES}
       SET nombre = $1, disponible = $2, grupo_id = $3,
           horario = $4, hora_inicio = $5, hora_fin = $6, color = $7
       WHERE id_actividad = $8 RETURNING *`,
      [nombre, disponible, grupo_id, horario, hora_inicio, hora_fin, color, id]
    );
    if (!result.rows.length)
      throw new Error('No se pudo actualizar la actividad');
    return result.rows[0];
  } catch (error) {
    if (error.code === '23505')
      throw new Error('Ya existe una actividad con ese código');
    if (error.code === '23503')
      throw new Error('El grupo seleccionado no existe');
    throw error;
  }
};

exports.deleteActividad = async (id) => {
  const current = await db.query(
    `SELECT id_actividad, fecha_baja
     FROM ${TABLA_ACTIVIDADES}
     WHERE id_actividad = $1`,
    [id]
  );
  if (!current.rows.length) throw new Error('Actividad no encontrada');

  const wasBaja = !!current.rows[0].fecha_baja;

  const result = await db.query(
    `UPDATE ${TABLA_ACTIVIDADES}
     SET fecha_baja = CASE WHEN fecha_baja IS NULL THEN NOW() ELSE NULL END
     WHERE id_actividad = $1
     RETURNING id_actividad, fecha_baja`,
    [id]
  );
  if (!result.rows.length)
    throw new Error('No se pudo cambiar estado de actividad');
  return {
    id_actividad: Number(id),
    fecha_baja: result.rows[0].fecha_baja,
    message: wasBaja
      ? 'Actividad reactivada correctamente'
      : 'Actividad dada de baja correctamente',
  };
};

exports.toggleActividadBaja = async (id) => {
  return exports.deleteActividad(id);
};

exports.getMeta = async () => {
  const [niveles, grupos] = await Promise.all([
    exports.getNiveles(),
    exports.getGruposFlat(),
  ]);
  return {
    niveles,
    grupos,
  };
};
