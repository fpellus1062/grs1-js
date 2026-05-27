const db = require('../config/db');
const { DateTime } = require('luxon');
const sharp = require('sharp');
const fs = require('node:fs/promises');
const path = require('node:path');

const AVATAR_OUTPUT_DIR = path.resolve(__dirname, '../../public/avatars');

const CREATE_DEFAULTS = Object.freeze({
  pei: false,
  paef: false,
  fecha_ant_empleo: () => DateTime.utc().toISODate(),
  domicilio: 'Mi Calle',
  codigo_postal: '28342',
  poblacion: 'Madrid',
  provincia: '28',
});

function normalizeAvatarTip(tipInput) {
  return String(tipInput == null ? '' : tipInput)
    .trim()
    .toUpperCase();
}

exports.uploadAvatarByTip = async ({
  tip,
  arsUnidadId,
  fileBuffer,
  mimeType,
}) => {
  const normalizedTip = normalizeAvatarTip(tip);
  if (!/^[A-Z][0-9]{5}[A-Z]$/.test(normalizedTip)) {
    throw new Error('El TIP debe tener formato A99999A');
  }
  if (!arsUnidadId) {
    throw new Error('Agrupacion no resuelta para subir avatar');
  }
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
    throw new Error('No se recibió un fichero de avatar válido');
  }
  if (mimeType && !String(mimeType).toLowerCase().startsWith('image/')) {
    throw new Error('El archivo de avatar debe ser una imagen');
  }

  const agenteRes = await db.query(
    `SELECT id, tip
     FROM agentes
     WHERE ars_unidad_id = $1
       AND UPPER(COALESCE(tip, '')) = $2
     LIMIT 1`,
    [arsUnidadId, normalizedTip]
  );

  if (!agenteRes.rows.length) {
    throw new Error('No existe un agente con ese TIP en la agrupación activa');
  }

  await fs.mkdir(AVATAR_OUTPUT_DIR, { recursive: true });
  const filename = normalizedTip + '.webp';
  const outputPath = path.join(AVATAR_OUTPUT_DIR, filename);

  try {
    await sharp(fileBuffer)
      .rotate()
      .resize(256, 256, { fit: 'cover', position: 'centre' })
      .webp({ quality: 88 })
      .toFile(outputPath);
  } catch (error) {
    throw new Error('No se pudo procesar la imagen de avatar');
  }

  return {
    tip: normalizedTip,
    filename,
    url: '/avatars/' + encodeURIComponent(normalizedTip) + '.webp',
  };
};

async function insertAgenteWithClient(client, arsUnidadId, createPayload) {
  const result = await client.query(
    `INSERT INTO agentes
      (ars_unidad_id, nombre, apellido_1, apellido_2, email, peloton_id, empleo_id, orden_gc, tip, nif, telefono, aptitudes, situacion_id, comentarios, pei, paef, fecha_ant_empleo, domicilio, codigo_postal, poblacion, provincia)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    RETURNING *`,
    [
      arsUnidadId,
      createPayload.nombre,
      createPayload.apellido_1,
      createPayload.apellido_2,
      createPayload.email,
      createPayload.peloton_id,
      createPayload.empleo_id,
      createPayload.orden_gc,
      createPayload.tip,
      createPayload.nif,
      createPayload.telefono,
      createPayload.aptitudes,
      createPayload.situacion_id,
      createPayload.comentarios,
      createPayload.pei,
      createPayload.paef,
      createPayload.fecha_ant_empleo,
      createPayload.domicilio,
      createPayload.codigo_postal,
      createPayload.poblacion,
      createPayload.provincia,
    ]
  );

  if (!result.rows.length) {
    throw new Error('Error al crear el agente en la base de datos');
  }

  return result.rows[0];
}

/**
 * Crear un nuevo agente
 * @param {Object} data - Datos del agente
 * @returns {Promise<Object>} Agente creado
 * @throws {Error} Si hay error en validación o base de datos
 */
exports.create = async (data, arsUnidadId) => {
  if (!arsUnidadId) {
    throw new Error('Agrupacion no resuelta para crear agente');
  }

  const payload = buildNormalizedAgentePayload(data);
  const missingCreateFields = buildMissingCreateFields(payload);
  if (missingCreateFields.length) {
    throw new Error(
      'Faltan campos obligatorios para crear agente: ' +
        missingCreateFields.join(', ')
    );
  }
  const createPayload = applyCreateDefaults(payload);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '10s'");
    const inserted = await insertAgenteWithClient(
      client,
      arsUnidadId,
      createPayload
    );

    await client.query('COMMIT');
    return inserted;
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      throw new Error('Este agente ya existe en el sistema');
    }
    if (error.code === '23503') {
      throw new Error('Uno o más datos referenciados no existen en el sistema');
    }
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Obtener todos los agentes
 * @returns {Promise<Array>} Lista de agentes
 */
exports.getAll = async (arsUnidadId) => {
  try {
    const result = await db.query(
      'SELECT * FROM agentes WHERE ars_unidad_id = $1 ORDER BY escalafon, apellido_1, apellido_2, nombre',
      [arsUnidadId]
    );

    return result.rows;
  } catch (error) {
    throw new Error('Error al obtener los agentes: ' + error.message);
  }
};

/**
 * Obtener agente por ID
 * @param {number} id - ID del agente
 * @returns {Promise<Object>} Agente encontrado
 */
exports.getById = async (id, arsUnidadId) => {
  if (!id || isNaN(id)) {
    throw new Error('ID de agente inválido');
  }

  const result = await db.query(
    'SELECT * FROM agentes WHERE id = $1 AND ars_unidad_id = $2',
    [id, arsUnidadId]
  );

  if (!result.rows.length || result.rows[0].fecha_baja !== null) {
    throw new Error('Agente no encontrado o dado de baja');
  }

  return result.rows[0];
};

/**
 * Actualizar agente
 * @param {number} id - ID del agente
 * @param {Object} data - Datos a actualizar
 * @returns {Promise<Object>} Agente actualizado
 */
exports.update = async (id, data, arsUnidadId) => {
  if (!id || isNaN(id)) {
    throw new Error('ID de agente inválido');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '10s'");

    const existingResult = await client.query(
      'SELECT * FROM agentes WHERE id = $1 AND ars_unidad_id = $2',
      [id, arsUnidadId]
    );
    if (!existingResult.rows.length) {
      throw new Error('Agente no encontrado');
    }
    const existing = existingResult.rows[0];

    const {
      nombre = existing.nombre,
      apellido_1 = existing.apellido_1,
      apellido_2 = existing.apellido_2,
      email = existing.email,
      peloton_id = existing.peloton_id,
      empleo_id = existing.empleo_id,
      orden_gc = existing.orden_gc,
      tip = existing.tip,
      nif = existing.nif,
      telefono = existing.telefono,
      aptitudes = existing.aptitudes,
      situacion_id = existing.situacion_id,
      comentarios = existing.comentarios,
      pei = existing.pei,
      paef = existing.paef,
      fecha_ant_empleo = existing.fecha_ant_empleo,
      domicilio = existing.domicilio,
      codigo_postal = existing.codigo_postal,
      poblacion = existing.poblacion,
      provincia = existing.provincia,
      fecha_baja: rawFechaBaja = existing.fecha_baja,
    } = data;

    // Normalizar fecha_baja con Luxon: aceptar ISO string, Date o null
    let fecha_baja = null;
    if (rawFechaBaja != null) {
      const dt =
        rawFechaBaja instanceof Date
          ? DateTime.fromJSDate(rawFechaBaja, { zone: 'UTC' })
          : DateTime.fromISO(String(rawFechaBaja), { zone: 'UTC' });
      if (!dt.isValid) {
        throw new Error('La fecha de baja no tiene un formato válido');
      }
      fecha_baja = dt.toISO({ suppressMilliseconds: true });
    }

    if (nombre && nombre.trim().length < 2) {
      throw new Error('El nombre debe tener al menos 2 caracteres');
    }
    if (apellido_1 && apellido_1.trim().length < 2) {
      throw new Error('El apellido 1 debe tener al menos 2 caracteres');
    }

    const result = await client.query(
      `UPDATE agentes 
      SET nombre = $1, apellido_1 = $2, apellido_2 = $3, email = $4, 
          peloton_id = $5, empleo_id = $6, orden_gc = $7, tip = $8, 
          nif = $9, telefono = $10, aptitudes = $11, situacion_id = $12, comentarios = $13,
          pei = $14, paef = $15, fecha_ant_empleo = $16, domicilio = $17, codigo_postal = $18, poblacion = $19, provincia = $20,
          fecha_baja = $21::timestamptz
      WHERE id = $22 AND ars_unidad_id = $23
      RETURNING *`,
      [
        nombre,
        apellido_1,
        apellido_2,
        email,
        peloton_id,
        empleo_id,
        orden_gc,
        tip,
        nif,
        telefono,
        aptitudes,
        situacion_id,
        comentarios,
        pei,
        paef,
        fecha_ant_empleo,
        domicilio,
        codigo_postal,
        poblacion,
        provincia,
        fecha_baja,
        id,
        arsUnidadId,
      ]
    );

    if (!result.rows.length) {
      throw new Error('No se pudo actualizar el agente');
    }

    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Obtener metadatos (situaciones)
 */
exports.getMeta = async () => {
  try {
    const [situaciones, pelotones, empleos] = await Promise.all([
      db.query(
        'SELECT id_situacion, descripcion, color FROM agentes_situacion ORDER BY descripcion'
      ),
      db.query(
        'SELECT id_peloton, descripcion, color FROM agentes_peloton ORDER BY descripcion'
      ),
      db.query(
        `SELECT id_empleo,
                descripcion,
                color,
                grupo AS escala,
                grupo,
                jerarquia
         FROM agentes_empleo
         ORDER BY jerarquia, descripcion`
      ),
    ]);
    return {
      situaciones: situaciones.rows,
      pelotones: pelotones.rows,
      empleos: empleos.rows,
    };
  } catch (error) {
    throw new Error('Error al obtener metadatos: ' + error.message);
  }
};

/**
 * Eliminar agente
 * @param {number} id - ID del agente
 */
exports.delete = async (id, arsUnidadId) => {
  if (!id || isNaN(id)) {
    throw new Error('ID de agente inválido');
  }

  const result = await db.query(
    `UPDATE agentes
     SET fecha_baja = CASE WHEN fecha_baja IS NULL THEN NOW() ELSE NULL END
     WHERE id = $1 AND ars_unidad_id = $2
     RETURNING id, fecha_baja`,
    [id, arsUnidadId]
  );

  if (!result.rows.length) {
    throw new Error('Agente no encontrado');
  }

  return {
    id,
    fecha_baja: result.rows[0].fecha_baja,
    message: result.rows[0].fecha_baja
      ? 'Agente dado de baja exitosamente'
      : 'Agente reactivado exitosamente',
  };
};

function normalizeNullableString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function normalizeUpperNullableString(value) {
  const text = normalizeNullableString(value);
  return text == null ? null : text.toUpperCase();
}

function normalizeLowerNullableString(value) {
  const text = normalizeNullableString(value);
  return text == null ? null : text.toLowerCase();
}

function normalizeOptionalInteger(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  return parsed;
}

function normalizeOptionalDate(value) {
  if (value == null || value === '') return null;
  const dt = DateTime.fromISO(String(value), { zone: 'UTC' });
  if (!dt.isValid) return null;
  return dt.toISODate();
}

function normalizeTip(value) {
  return String(value == null ? '' : value)
    .trim()
    .toUpperCase();
}

function buildNormalizedAgentePayload(data) {
  const row = data || {};
  return {
    nombre: normalizeNullableString(row.nombre),
    apellido_1: normalizeNullableString(row.apellido_1),
    apellido_2: normalizeNullableString(row.apellido_2),
    email: normalizeLowerNullableString(row.email),
    peloton_id: normalizeNullableString(row.peloton_id),
    empleo_id: normalizeNullableString(row.empleo_id),
    orden_gc: normalizeOptionalInteger(row.orden_gc),
    tip: normalizeTip(row.tip),
    nif: normalizeUpperNullableString(row.nif),
    telefono: normalizeNullableString(row.telefono),
    aptitudes: normalizeNullableString(row.aptitudes),
    situacion_id: normalizeNullableString(row.situacion_id),
    comentarios: normalizeNullableString(row.comentarios),
    pei: row.pei == null ? null : Boolean(row.pei),
    paef: row.paef == null ? null : Boolean(row.paef),
    fecha_ant_empleo: normalizeOptionalDate(row.fecha_ant_empleo),
    domicilio: normalizeNullableString(row.domicilio),
    codigo_postal: normalizeNullableString(row.codigo_postal),
    poblacion: normalizeNullableString(row.poblacion),
    provincia: normalizeUpperNullableString(row.provincia),
  };
}

function applyCreateDefaults(payload) {
  return {
    ...payload,
    pei: payload.pei == null ? CREATE_DEFAULTS.pei : payload.pei,
    paef: payload.paef == null ? CREATE_DEFAULTS.paef : payload.paef,
    fecha_ant_empleo:
      payload.fecha_ant_empleo || CREATE_DEFAULTS.fecha_ant_empleo(),
    domicilio: payload.domicilio || CREATE_DEFAULTS.domicilio,
    codigo_postal: payload.codigo_postal || CREATE_DEFAULTS.codigo_postal,
    poblacion: payload.poblacion || CREATE_DEFAULTS.poblacion,
    provincia: payload.provincia || CREATE_DEFAULTS.provincia,
  };
}

function buildMissingCreateFields(payload) {
  const requiredFields = [
    ['nombre', payload.nombre],
    ['apellido_1', payload.apellido_1],
    ['apellido_2', payload.apellido_2],
    ['email', payload.email],
    ['peloton_id', payload.peloton_id],
    ['empleo_id', payload.empleo_id],
    ['orden_gc', payload.orden_gc],
    ['nif', payload.nif],
    ['telefono', payload.telefono],
    ['situacion_id', payload.situacion_id],
  ];

  return requiredFields
    .filter((entry) => entry[1] == null || entry[1] === '')
    .map((entry) => entry[0]);
}

function normalizeLookupToken(value) {
  return String(value == null ? '' : value)
    .trim()
    .toUpperCase();
}

function createBulkFieldError(column, code, message, value, expected) {
  return {
    column,
    code,
    message,
    value: value == null ? null : String(value),
    expected: expected || '',
  };
}

function summarizeBulkErrors(errors) {
  if (!Array.isArray(errors) || !errors.length) {
    return 'Error desconocido en fila masiva';
  }
  return errors
    .map((err) => (err && err.message ? String(err.message) : 'Error de validación'))
    .join(' | ');
}

function buildRefResolvers(meta) {
  function buildResolver(items, idKey, label) {
    const byId = new Map();
    const byLiteral = new Map();

    items.forEach((row) => {
      const idToken = normalizeLookupToken(row[idKey]);
      const descToken = normalizeLookupToken(row.descripcion);
      if (idToken) {
        byId.set(idToken, row[idKey]);
      }
      if (descToken) {
        if (!byLiteral.has(descToken)) byLiteral.set(descToken, []);
        byLiteral.get(descToken).push(row[idKey]);
      }
    });

    return function resolve(column, rawValue) {
      const token = normalizeLookupToken(rawValue);
      if (!token) {
        return {
          value: null,
          errors: [
            createBulkFieldError(
              column,
              'REQUIRED_MISSING',
              'Campo obligatorio sin valor',
              rawValue,
              label + ' válido'
            ),
          ],
        };
      }

      if (byId.has(token)) {
        return { value: byId.get(token), errors: [] };
      }

      const candidates = byLiteral.get(token) || [];
      if (!candidates.length) {
        return {
          value: null,
          errors: [
            createBulkFieldError(
              column,
              'REF_NOT_FOUND',
              'Referencia no encontrada',
              rawValue,
              label + ' existente'
            ),
          ],
        };
      }

      if (candidates.length > 1) {
        return {
          value: null,
          errors: [
            createBulkFieldError(
              column,
              'REF_AMBIGUOUS',
              'Referencia ambigua: hay más de una coincidencia',
              rawValue,
              'Valor único. Candidatos: ' + candidates.join(', ')
            ),
          ],
        };
      }

      return { value: candidates[0], errors: [] };
    };
  }

  return {
    empleo: buildResolver(meta.empleos, 'id_empleo', 'Empleo'),
    peloton: buildResolver(meta.pelotones, 'id_peloton', 'Pelotón'),
    situacion: buildResolver(meta.situaciones, 'id_situacion', 'Situación'),
  };
}

exports.altasMasivas = async (rows, arsUnidadId) => {
  if (!arsUnidadId) {
    throw new Error('Agrupacion no resuelta para altas masivas');
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('No hay filas para procesar en altas masivas');
  }

  const client = await db.connect();
  const detail = [];
  let created = 0;
  let errors = 0;

  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SET LOCAL lock_timeout = '10s'");

    const [situacionesRes, pelotonesRes, empleosRes] = await Promise.all([
      client.query('SELECT id_situacion, descripcion FROM agentes_situacion'),
      client.query('SELECT id_peloton, descripcion FROM agentes_peloton'),
      client.query('SELECT id_empleo, descripcion FROM agentes_empleo'),
    ]);

    const refResolvers = buildRefResolvers({
      situaciones: situacionesRes.rows,
      pelotones: pelotonesRes.rows,
      empleos: empleosRes.rows,
    });

    const seenTip = new Map();
    const seenEmail = new Map();
    const seenNif = new Map();

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] || {};
      const line = Number(row._line || i + 1);
      const tipToken = normalizeTip(row.tip);
      const emailToken = normalizeLookupToken(row.email);
      const nifToken = normalizeLookupToken(row.nif);

      if (tipToken) {
        if (!seenTip.has(tipToken)) seenTip.set(tipToken, []);
        seenTip.get(tipToken).push(line);
      }
      if (emailToken) {
        if (!seenEmail.has(emailToken)) seenEmail.set(emailToken, []);
        seenEmail.get(emailToken).push(line);
      }
      if (nifToken) {
        if (!seenNif.has(nifToken)) seenNif.set(nifToken, []);
        seenNif.get(nifToken).push(line);
      }
    }

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] || {};
      const line = Number(row._line || i + 1);
      const tip = normalizeTip(row.tip);

      await client.query(`SAVEPOINT agente_bulk_${i}`);
      try {
        const rowErrors = [];

        if (!tip) {
          rowErrors.push(
            createBulkFieldError('tip', 'REQUIRED_MISSING', 'TIP obligatorio para alta masiva', row.tip, 'Formato A99999A')
          );
        }

        if (tip && (seenTip.get(tip) || []).length > 1) {
          rowErrors.push(
            createBulkFieldError('tip', 'DUPLICATE_IN_FILE', 'TIP duplicado en el CSV', row.tip, 'TIP único en archivo')
          );
        }

        const payload = buildNormalizedAgentePayload({
          ...row,
          tip,
        });

        if (payload.email && (seenEmail.get(normalizeLookupToken(payload.email)) || []).length > 1) {
          rowErrors.push(
            createBulkFieldError('email', 'DUPLICATE_IN_FILE', 'Email duplicado en el CSV', row.email, 'Email único en archivo')
          );
        }
        if (payload.nif && (seenNif.get(normalizeLookupToken(payload.nif)) || []).length > 1) {
          rowErrors.push(
            createBulkFieldError('nif', 'DUPLICATE_IN_FILE', 'NIF duplicado en el CSV', row.nif, 'NIF único en archivo')
          );
        }

        const missingCreateFields = buildMissingCreateFields(payload);
        missingCreateFields.forEach((field) => {
          rowErrors.push(
            createBulkFieldError(field, 'REQUIRED_MISSING', 'Campo obligatorio sin valor', row[field], 'Valor requerido por DDL')
          );
        });

        if (payload.tip && !/^[A-Z][0-9]{5}[A-Z]$/.test(payload.tip)) {
          rowErrors.push(
            createBulkFieldError('tip', 'INVALID_FORMAT', 'TIP debe tener formato A99999A', row.tip, 'A99999A')
          );
        }

        const empleoResolved = refResolvers.empleo('empleo_id', payload.empleo_id);
        const pelotonResolved = refResolvers.peloton('peloton_id', payload.peloton_id);
        const situacionResolved = refResolvers.situacion('situacion_id', payload.situacion_id);
        rowErrors.push(...empleoResolved.errors, ...pelotonResolved.errors, ...situacionResolved.errors);

        payload.empleo_id = empleoResolved.value;
        payload.peloton_id = pelotonResolved.value;
        payload.situacion_id = situacionResolved.value;

        if (tip) {
          const tipExistsRes = await client.query(
            `SELECT id
               FROM agentes
              WHERE UPPER(COALESCE(tip, '')) = $1
              LIMIT 1`,
            [tip]
          );
          if (tipExistsRes.rows.length) {
            rowErrors.push(
              createBulkFieldError('tip', 'TIP_ALREADY_EXISTS', 'El TIP ya existe en el sistema', row.tip, 'TIP nuevo no existente')
            );
          }
        }

        if (payload.email) {
          const emailExistsRes = await client.query(
            `SELECT id
               FROM agentes
              WHERE LOWER(COALESCE(email, '')) = LOWER($1)
              LIMIT 1`,
            [payload.email]
          );
          if (emailExistsRes.rows.length) {
            rowErrors.push(
              createBulkFieldError('email', 'EMAIL_ALREADY_EXISTS', 'El email ya existe en el sistema', row.email, 'Email nuevo no existente')
            );
          }
        }

        if (payload.nif) {
          const nifExistsRes = await client.query(
            `SELECT id
               FROM agentes
              WHERE UPPER(COALESCE(nif, '')) = UPPER($1)
              LIMIT 1`,
            [payload.nif]
          );
          if (nifExistsRes.rows.length) {
            rowErrors.push(
              createBulkFieldError('nif', 'NIF_ALREADY_EXISTS', 'El NIF ya existe en el sistema', row.nif, 'NIF nuevo no existente')
            );
          }
        }

        if (rowErrors.length) {
          detail.push({
            line,
            tip,
            status: 'error',
            message: summarizeBulkErrors(rowErrors),
            errors: rowErrors,
            missing_fields: rowErrors
              .filter((err) => err.code === 'REQUIRED_MISSING')
              .map((err) => err.column),
          });
          errors += 1;
          await client.query(`RELEASE SAVEPOINT agente_bulk_${i}`);
          continue;
        }

        const createPayload = applyCreateDefaults(payload);

        const inserted = await insertAgenteWithClient(
          client,
          arsUnidadId,
          createPayload
        );

        const newId = Number(inserted.id);
        created += 1;
        detail.push({ line, tip, status: 'created', id: newId, errors: [] });

        await client.query(`RELEASE SAVEPOINT agente_bulk_${i}`);
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT agente_bulk_${i}`);
        errors += 1;
        const fallbackErrors = [
          createBulkFieldError(
            'row',
            'DB_CONSTRAINT',
            error.message || 'Error desconocido en fila masiva',
            null,
            ''
          ),
        ];
        detail.push({
          line,
          tip,
          status: 'error',
          message: summarizeBulkErrors(fallbackErrors),
          errors: fallbackErrors,
          missing_fields: [],
        });
      }
    }

    await client.query('COMMIT');
    return {
      total: rows.length,
      created,
      errors,
      detail,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

exports.bajasMasivas = async (payload, arsUnidadId) => {
  if (!arsUnidadId) {
    throw new Error('Agrupacion no resuelta para bajas masivas');
  }

  const rawTips = Array.isArray(payload.tips) ? payload.tips : [];
  const rawIds = Array.isArray(payload.ids) ? payload.ids : [];
  const tips = Array.from(
    new Set(
      rawTips
        .map(normalizeTip)
        .filter((tip) => !!tip)
    )
  );
  const ids = Array.from(
    new Set(
      rawIds
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  );

  if (!tips.length && !ids.length) {
    throw new Error('Debe informar TIP o IDs para baja masiva');
  }

  const filters = [];
  const values = [arsUnidadId];
  if (ids.length) {
    values.push(ids);
    filters.push(`id = ANY($${values.length}::int[])`);
  }
  if (tips.length) {
    values.push(tips);
    filters.push(`UPPER(COALESCE(tip, '')) = ANY($${values.length}::text[])`);
  }

  const listRes = await db.query(
    `SELECT id, tip, fecha_baja
       FROM agentes
      WHERE ars_unidad_id = $1
        AND (${filters.join(' OR ')})`,
    values
  );

  const byId = new Map();
  const byTip = new Map();
  listRes.rows.forEach((row) => {
    const id = Number(row.id);
    byId.set(id, row);
    const tip = normalizeTip(row.tip);
    if (tip) byTip.set(tip, row);
  });

  const detail = [];
  const toDeactivateIds = new Set();

  ids.forEach((id) => {
    const row = byId.get(id);
    if (!row) {
      detail.push({ id, status: 'error', message: 'Agente no encontrado' });
      return;
    }
    if (row.fecha_baja) {
      detail.push({ id, tip: normalizeTip(row.tip), status: 'skipped', message: 'Ya estaba de baja' });
      return;
    }
    toDeactivateIds.add(id);
    detail.push({ id, tip: normalizeTip(row.tip), status: 'applied' });
  });

  tips.forEach((tip) => {
    const row = byTip.get(tip);
    if (!row) {
      detail.push({ tip, status: 'error', message: 'TIP no encontrado' });
      return;
    }
    const id = Number(row.id);
    if (row.fecha_baja) {
      detail.push({ id, tip, status: 'skipped', message: 'Ya estaba de baja' });
      return;
    }
    toDeactivateIds.add(id);
    detail.push({ id, tip, status: 'applied' });
  });

  const idsToUpdate = Array.from(toDeactivateIds.values());
  if (idsToUpdate.length) {
    await db.query(
      `UPDATE agentes
          SET fecha_baja = NOW()
        WHERE ars_unidad_id = $1
          AND id = ANY($2::int[])
          AND fecha_baja IS NULL`,
      [arsUnidadId, idsToUpdate]
    );
  }

  return {
    total: detail.length,
    applied: detail.filter((item) => item.status === 'applied').length,
    skipped: detail.filter((item) => item.status === 'skipped').length,
    errors: detail.filter((item) => item.status === 'error').length,
    detail,
  };
};
