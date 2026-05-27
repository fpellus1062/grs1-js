const Joi = require('joi');

const timePattern = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const hexColorPattern = /^#[0-9a-fA-F]{6}$/;

exports.createGrupoSchema = Joi.object({
  nombre: Joi.string().trim().min(1).max(255).required().messages({
    'string.empty': 'El nombre no puede estar vacío',
    'any.required': 'El nombre es requerido',
  }),
  parent_id_grupo: Joi.number().integer().allow(null).default(null).messages({
    'number.base': 'El ID de grupo padre debe ser un número entero',
  }),
  nivel: Joi.number().integer().min(1).max(5).required().messages({
    'number.base': 'El nivel debe ser un número',
    'number.min': 'El nivel debe estar entre 1 y 5',
    'number.max': 'El nivel debe estar entre 1 y 5',
    'any.required': 'El nivel es requerido',
  }),
  codigo: Joi.string().trim().max(255).allow('', null).messages({
    'string.max': 'El codigo no puede tener mas de 255 caracteres',
  }),
  color: Joi.string().trim().pattern(hexColorPattern).allow('', null).messages({
    'string.pattern.base': 'Color debe tener formato HEX #RRGGBB',
  }),
  orden: Joi.number().integer().min(0).default(0),
  activo: Joi.boolean().default(true),
});

exports.updateGrupoSchema = Joi.object({
  nombre: Joi.string().trim().min(1).max(255).messages({
    'string.empty': 'El nombre no puede estar vacío',
  }),
  parent_id_grupo: Joi.number().integer().allow(null).messages({
    'number.base': 'El ID de grupo padre debe ser un número entero',
  }),
  nivel: Joi.number().integer().min(1).max(5).messages({
    'number.base': 'El nivel debe ser un número',
    'number.min': 'El nivel debe estar entre 1 y 5',
    'number.max': 'El nivel debe estar entre 1 y 5',
  }),
  codigo: Joi.string().trim().max(255).allow('', null).messages({
    'string.max': 'El codigo no puede tener mas de 255 caracteres',
  }),
  color: Joi.string().trim().pattern(hexColorPattern).allow('', null).messages({
    'string.pattern.base': 'Color debe tener formato HEX #RRGGBB',
  }),
  orden: Joi.number().integer().min(0),
  activo: Joi.boolean(),
}).min(1);

exports.createActividadJerSchema = Joi.object({
  actividad: Joi.string().trim().min(1).max(255).required().messages({
    'string.empty': 'El código es requerido',
    'string.min': 'El código es requerido',
    'string.max': 'El código no puede tener más de 255 caracteres',
    'any.required': 'El código es requerido',
  }),
  nombre: Joi.string().trim().min(2).max(255).required().messages({
    'string.empty': 'El nombre no puede estar vacío',
    'string.min': 'El nombre debe tener al menos 2 caracteres',
    'any.required': 'El nombre es requerido',
  }),
  disponible: Joi.string()
    .trim()
    .valid('', '--a--', '--d--')
    .allow(null)
    .default('')
    .messages({
      'any.only': 'Disponible debe ser uno de los valores permitidos',
    }),
  grupo_id: Joi.number().integer().required().messages({
    'number.base': 'El ID de grupo debe ser un número entero',
    'any.required': 'El grupo es requerido',
  }),
  horario: Joi.string().trim().max(255).allow('', null),
  hora_inicio: Joi.string()
    .trim()
    .pattern(timePattern)
    .allow('', null)
    .messages({
      'string.pattern.base': 'Hora inicio debe tener formato HH:MM',
    }),
  hora_fin: Joi.string().trim().pattern(timePattern).allow('', null).messages({
    'string.pattern.base': 'Hora fin debe tener formato HH:MM',
  }),
  color: Joi.string().trim().pattern(hexColorPattern).allow('', null).messages({
    'string.pattern.base': 'Color debe tener formato HEX #RRGGBB',
  }),
});

exports.updateActividadJerSchema = Joi.object({
  actividad: Joi.any().forbidden().messages({
    'any.unknown': 'El código no se puede modificar',
  }),
  nombre: Joi.string().trim().min(2).max(255).messages({
    'string.min': 'El nombre debe tener al menos 2 caracteres',
  }),
  disponible: Joi.string()
    .trim()
    .valid('', '--a--', '--d--')
    .allow(null)
    .messages({
      'any.only': 'Disponible debe ser uno de los valores permitidos',
    }),
  grupo_id: Joi.number().integer(),
  horario: Joi.string().trim().max(255).allow('', null),
  hora_inicio: Joi.string()
    .trim()
    .pattern(timePattern)
    .allow('', null)
    .messages({
      'string.pattern.base': 'Hora inicio debe tener formato HH:MM',
    }),
  hora_fin: Joi.string().trim().pattern(timePattern).allow('', null).messages({
    'string.pattern.base': 'Hora fin debe tener formato HH:MM',
  }),
  color: Joi.string().trim().pattern(hexColorPattern).allow('', null).messages({
    'string.pattern.base': 'Color debe tener formato HEX #RRGGBB',
  }),
}).min(1);

exports.idParamSchema = Joi.object({
  id: Joi.number().integer().required().messages({
    'number.base': 'El ID debe ser un número',
    'any.required': 'El ID es requerido',
  }),
});
