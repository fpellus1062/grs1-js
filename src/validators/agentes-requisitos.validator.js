const Joi = require('joi');

const periodicidadValues = ['anual', 'semestral', 'mensual'];

const objetivoItemSchema = Joi.object({
  subtipo: Joi.string().trim().min(1).max(80).required(),
  objetivo: Joi.number().integer().positive().required(),
  orden: Joi.number().integer().min(0).default(0),
});

exports.createPlantillaSchema = Joi.object({
  nombre: Joi.string().trim().min(3).max(160).required(),
  descripcion: Joi.string().trim().allow('', null).default(null),
  periodicidad: Joi.string()
    .trim()
    .lowercase()
    .valid(...periodicidadValues)
    .required(),
  tipo_requisito: Joi.string().trim().min(2).max(60).required(),
  objetivo_total: Joi.number().integer().positive().required(),
  requiere_aprobacion: Joi.boolean().default(false),
  plazo_dias: Joi.number().integer().positive().allow(null).default(null),
  fecha_inicio_manual: Joi.string().isoDate().allow(null).default(null),
  fecha_fin_manual: Joi.string().isoDate().allow(null).default(null),
  objetivos: Joi.array().items(objetivoItemSchema).min(1).max(20).required(),
});

exports.updatePlantillaSchema = Joi.object({
  nombre: Joi.string().trim().min(3).max(160).required(),
  descripcion: Joi.string().trim().allow('', null).default(null),
  periodicidad: Joi.string()
    .trim()
    .lowercase()
    .valid(...periodicidadValues)
    .required(),
  tipo_requisito: Joi.string().trim().min(2).max(60).required(),
  objetivo_total: Joi.number().integer().positive().required(),
  requiere_aprobacion: Joi.boolean().default(false),
  plazo_dias: Joi.number().integer().positive().allow(null).default(null),
  fecha_inicio_manual: Joi.string().isoDate().allow(null).default(null),
  fecha_fin_manual: Joi.string().isoDate().allow(null).default(null),
  activo: Joi.boolean().default(true),
  objetivos: Joi.array().items(objetivoItemSchema).min(1).max(20).required(),
});

exports.plantillaIdParamSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
});

exports.assignPlantillaSchema = Joi.object({
  plantilla_id: Joi.number().integer().positive().required(),
  agente_ids: Joi.array().items(Joi.number().integer().positive()).min(1).max(2000).required(),
  fecha_referencia: Joi.string().isoDate().required(),
});

exports.registerEjecucionSchema = Joi.object({
  periodo_id: Joi.number().integer().positive().required(),
  subtipo: Joi.string().trim().min(1).max(80).required(),
  cantidad: Joi.number().integer().positive().default(1),
  fecha_prueba: Joi.string().isoDate().allow(null).default(null),
  resultado: Joi.string().trim().lowercase().valid('aprobado', 'rechazado', 'pendiente').default('aprobado'),
  evidencia_url: Joi.string().trim().uri().allow('', null).default(null),
  observaciones: Joi.string().trim().allow('', null).default(null),
});

exports.registerEjecucionBulkSchema = Joi.object({
  periodo_ids: Joi.array().items(Joi.number().integer().positive()).min(1).max(500).required(),
  subtipo: Joi.string().trim().min(1).max(80).required(),
  cantidad: Joi.number().integer().positive().default(1),
  fecha_prueba: Joi.string().isoDate().allow(null).default(null),
  resultado: Joi.string().trim().lowercase().valid('aprobado', 'rechazado', 'pendiente').default('aprobado'),
  evidencia_url: Joi.string().trim().uri().allow('', null).default(null),
  observaciones: Joi.string().trim().allow('', null).default(null),
});

const ejecucionMultiItemSchema = Joi.object({
  subtipo: Joi.string().trim().min(1).max(80).required(),
  cantidad: Joi.number().integer().positive().required(),
});

exports.registerEjecucionMultiSchema = Joi.object({
  periodo_ids: Joi.array().items(Joi.number().integer().positive()).min(1).max(500).required(),
  items: Joi.array().items(ejecucionMultiItemSchema).min(1).max(100).required(),
  fecha_prueba: Joi.string().isoDate().allow(null).default(null),
  resultado: Joi.string().trim().lowercase().valid('aprobado', 'rechazado', 'pendiente').default('aprobado'),
  evidencia_url: Joi.string().trim().uri().allow('', null).default(null),
  observaciones: Joi.string().trim().allow('', null).default(null),
});

exports.sancionarPeriodoSchema = Joi.object({
  periodo_id: Joi.number().integer().positive().required(),
  sancion_notas: Joi.string().trim().min(3).max(3000).required(),
});
