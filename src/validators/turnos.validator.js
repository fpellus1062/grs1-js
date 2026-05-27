const Joi = require('joi');

const timePattern = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const colorPattern = /^#[0-9a-fA-F]{6}$/;

exports.createTurnoSchema = Joi.object({
  codigo: Joi.string().trim().uppercase().min(1).max(10).required().messages({
    'string.empty': 'El código no puede estar vacío',
    'string.min': 'El código debe tener al menos 1 carácter',
    'string.max': 'El código no puede tener más de 10 caracteres',
    'any.required': 'El código es requerido',
  }),
  nombre: Joi.string().trim().min(2).max(100).required().messages({
    'string.empty': 'El nombre no puede estar vacío',
    'string.min': 'El nombre debe tener al menos 2 caracteres',
    'string.max': 'El nombre no puede tener más de 100 caracteres',
    'any.required': 'El nombre es requerido',
  }),
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
  color: Joi.string().trim().pattern(colorPattern).allow('', null).messages({
    'string.pattern.base': 'El color debe tener formato hexadecimal (#RRGGBB)',
  }),
  observaciones: Joi.string().trim().max(1000).allow('', null).messages({
    'string.max': 'Las observaciones no pueden tener más de 1000 caracteres',
  }),
});

exports.updateTurnoSchema = Joi.object({
  codigo: Joi.string().trim().uppercase().max(10).messages({
    'string.max': 'El código no puede tener más de 10 caracteres',
  }),
  nombre: Joi.string().trim().min(2).max(100).messages({
    'string.min': 'El nombre debe tener al menos 2 caracteres',
    'string.max': 'El nombre no puede tener más de 100 caracteres',
  }),
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
  color: Joi.string().trim().pattern(colorPattern).allow('', null).messages({
    'string.pattern.base': 'El color debe tener formato hexadecimal (#RRGGBB)',
  }),
  observaciones: Joi.string().trim().max(1000).allow('', null).messages({
    'string.max': 'Las observaciones no pueden tener más de 1000 caracteres',
  }),
  baja_at: Joi.alternatives()
    .try(Joi.date().iso(), Joi.string().valid('', null), Joi.allow(null))
    .messages({
      'date.format': 'La fecha de baja debe tener formato ISO válido',
    }),
}).min(1);

exports.idParamSchema = Joi.object({
  id: Joi.number().integer().required().messages({
    'number.base': 'El ID debe ser un número',
    'any.required': 'El ID es requerido',
  }),
});
