const Joi = require('joi');

// ── Esquema reutilizable para una asignación individual ──
exports.asignacionItem = Joi.object({
  agente_id: Joi.number().integer().positive().required(),
  dia: Joi.number().integer().min(1).max(31).required(),
  turno_id: Joi.number().integer().positive().required(),
  actividad_ids: Joi.array()
    .items(Joi.number().integer().positive())
    .min(1)
    .required()
    .messages({ 'array.min': 'Debe asignar al menos un servicio/actividad' }),
  observaciones: Joi.string().trim().max(500).allow('', null),
});

// ── Parámetros de período (año/mes) ──
exports.periodoParamsSchema = Joi.object({
  anio: Joi.number()
    .integer()
    .min(2020)
    .max(2100)
    .required()
    .messages({ 'any.required': 'El año es requerido' }),
  mes: Joi.number()
    .integer()
    .min(1)
    .max(12)
    .required()
    .messages({ 'any.required': 'El mes es requerido' }),
});

// ── Asignación individual (upsert) ──
exports.upsertSchema = Joi.object({
  anio: Joi.number().integer().min(2020).max(2100).required(),
  mes: Joi.number().integer().min(1).max(12).required(),
  borrador_id: Joi.number().integer().positive().allow(null),
  agente_id: Joi.number().integer().positive().required(),
  dia: Joi.number().integer().min(1).max(31).required(),
  fecha: Joi.string()
    .trim()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .allow(null, ''),
  turno_id: Joi.number().integer().positive().required(),
  actividad_ids: Joi.array()
    .items(Joi.number().integer().positive())
    .min(1)
    .required(),
  observaciones: Joi.string().trim().max(500).allow('', null),
  revision: Joi.number().integer().min(0).allow(null),
});

// ── Asignación bulk (varios agentes / días) ──
exports.bulkSchema = Joi.object({
  anio: Joi.number().integer().min(2020).max(2100).required(),
  mes: Joi.number().integer().min(1).max(12).required(),
  borrador_id: Joi.number().integer().positive().required().messages({
    'any.required': 'Debe seleccionar un borrador para la asignación masiva',
  }),
  agente_ids: Joi.array()
    .items(Joi.number().integer().positive())
    .min(1)
    .required()
    .messages({ 'array.min': 'Debe seleccionar al menos un agente' }),
  dias: Joi.array()
    .items(
      Joi.alternatives().try(
        Joi.number().integer().min(1).max(31),
        Joi.string()
          .trim()
          .pattern(/^\d{4}-\d{2}-\d{2}$/)
      )
    )
    .min(1)
    .required()
    .messages({ 'array.min': 'Debe seleccionar al menos un día' }),
  turno_id: Joi.number().integer().positive().required(),
  actividad_ids: Joi.array()
    .items(Joi.number().integer().positive())
    .min(1)
    .required(),
  observaciones: Joi.string().trim().max(500).allow('', null),
});

// ── Eliminar asignaciones del borrador ──
exports.deleteSchema = Joi.object({
  anio: Joi.number().integer().min(2020).max(2100).required(),
  mes: Joi.number().integer().min(1).max(12).required(),
  borrador_id: Joi.number().integer().positive().allow(null),
  agente_ids: Joi.array()
    .items(Joi.number().integer().positive())
    .min(1)
    .required(),
  dias: Joi.array().items(Joi.number().integer().min(1).max(31)).min(1),
  fechas: Joi.array()
    .items(
      Joi.string()
        .trim()
        .pattern(/^\d{4}-\d{2}-\d{2}$/)
    )
    .min(1),
})
  .or('dias', 'fechas')
  .messages({
    'object.missing': 'Debe indicar al menos un día o una fecha para eliminar',
  });

// ── Copiar mes ──
exports.copiarMesSchema = Joi.object({
  origen_anio: Joi.number().integer().min(2020).max(2100).required(),
  origen_mes: Joi.number().integer().min(1).max(12).required(),
  origen_borrador_id: Joi.number().integer().positive().allow(null),
  destino_anio: Joi.number().integer().min(2020).max(2100).required(),
  destino_mes: Joi.number().integer().min(1).max(12).required(),
  destino_borrador_id: Joi.number().integer().positive().allow(null),
  agente_ids: Joi.array()
    .items(Joi.number().integer().positive())
    .allow(null)
    .messages({ 'array.base': 'agente_ids debe ser un array' }),
  dias: Joi.array().items(Joi.number().integer().min(1).max(31)).allow(null),
  pares: Joi.array()
    .items(
      Joi.object({
        from: Joi.string()
          .pattern(/^\d{4}-\d{2}-\d{2}$/)
          .required(),
        to: Joi.string()
          .pattern(/^\d{4}-\d{2}-\d{2}$/)
          .required(),
      })
    )
    .allow(null),
});

// ── Validar borrador (pasar a definitivo) ──
exports.validarSchema = Joi.object({
  borrador_id: Joi.number().integer().positive().required(),
  anio: Joi.number().integer().min(2020).max(2100).allow(null),
  mes: Joi.number().integer().min(1).max(12).allow(null),
  reglas_especiales_ids: Joi.array()
    .items(Joi.number().integer().positive())
    .min(1)
    .allow(null),
});

exports.previewReglasEspecialesSchema = Joi.object({
  anio: Joi.number().integer().min(2020).max(2100).required(),
  mes: Joi.number().integer().min(1).max(12).required(),
});

exports.consolidarDevengosSchema = Joi.object({
  borrador_id: Joi.number().integer().positive().required(),
});

exports.borradoresParamsSchema = Joi.object({
  anio: Joi.number().integer().min(2020).max(2100).required(),
  mes: Joi.number().integer().min(1).max(12).required(),
});

exports.crearBorradorSchema = Joi.object({
  anio: Joi.number().integer().min(2020).max(2100).required(),
  mes: Joi.number().integer().min(1).max(12).required(),
  nombre: Joi.string().trim().min(1).max(120).required(),
  copia_de_id: Joi.number().integer().positive().allow(null),
  observaciones: Joi.string().trim().max(500).allow('', null),
});

exports.updateBorradorObservacionesSchema = Joi.object({
  observaciones: Joi.string().trim().max(500).allow('', null),
});

// ── Exportar cuadrante a Excel ──
exports.exportarCuadranteSchema = Joi.object({
  anio: Joi.number().integer().min(2020).max(2100).required(),
  mes: Joi.number().integer().min(1).max(12).required(),
  borrador_id: Joi.number().integer().positive().allow(null, ''),
  nombre_borrador: Joi.string().trim().max(200).allow('', null),
  formato: Joi.string().valid('xlsx', 'pdf').default('xlsx'),
  modo: Joi.string().valid('normal', 'por_dia').default('normal'),
  fechas: Joi.string()
    .trim()
    .pattern(/^\d{4}-\d{2}-\d{2}(,\d{4}-\d{2}-\d{2})*$/)
    .allow('', null),
});

// ── Eliminar borrador completamente ──
exports.deleteBorradorSchema = Joi.object({
  id: Joi.number()
    .integer()
    .positive()
    .required()
    .messages({ 'any.required': 'El ID del borrador es requerido' }),
});

// ── Query historial ──
exports.historialQuerySchema = Joi.object({
  anio: Joi.number().integer().min(2020).max(2100).required(),
  mes: Joi.number().integer().min(1).max(12).required(),
  borrador_id: Joi.number().integer().positive().allow(null, ''),
  agente_id: Joi.number().integer().positive().allow(null, ''),
  agente_ids: Joi.string()
    .trim()
    .pattern(/^\d+(,\d+)*$/)
    .allow(null, ''),
  accion: Joi.string().trim().max(50).allow(null, ''),
  acciones: Joi.string().trim().allow(null, ''),
  usuario_id: Joi.number().integer().positive().allow(null, ''),
  fecha_cambio: Joi.string()
    .trim()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .allow('', null),
  fechas_cambio: Joi.string()
    .trim()
    .pattern(/^\d{4}-\d{2}-\d{2}(,\d{4}-\d{2}-\d{2})*$/)
    .allow('', null),
  fechas_cuadrante: Joi.string()
    .trim()
    .pattern(
      /^(\d{4}-\d{2}-\d{2}|__SIN_FECHA_MASIVO__)(,(\d{4}-\d{2}-\d{2}|__SIN_FECHA_MASIVO__))*$/
    )
    .allow('', null),
  repetir_comunicados: Joi.boolean().truthy('1').truthy('true').falsy('0').falsy('false').default(false),
  marcar_comunicados: Joi.boolean().truthy('1').truthy('true').falsy('0').falsy('false').default(true),
  export_ts: Joi.string().trim().pattern(/^\d{8}_\d{6}$/).allow('', null),
  nombre_borrador: Joi.string().trim().max(200).allow('', null),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(5000).default(1000),
  fechas: Joi.string().trim().allow('', null),
});

exports.historialCeldaQuerySchema = Joi.object({
  anio: Joi.number().integer().min(2020).max(2100).required(),
  mes: Joi.number().integer().min(1).max(12).required(),
  borrador_id: Joi.number().integer().positive().required(),
  agente_id: Joi.number().integer().positive().required(),
  fecha: Joi.string()
    .trim()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required(),
  limit: Joi.number().integer().min(1).max(300).default(100),
});
