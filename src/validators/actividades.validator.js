const Joi = require('joi');

const timePattern = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const disponibilidadValues = ['', '--a--', '--d--'];
const colorPattern = /^#[0-9a-fA-F]{6}$/;

exports.createActividadSchema = Joi.object({
  actividad: Joi.string().trim().max(255).allow('', null).messages({
    'string.max': 'La actividad no puede tener más de 255 caracteres',
  }),
  nombre: Joi.string().trim().min(2).max(255).required().messages({
    'string.empty': 'El nombre no puede estar vacío',
    'string.min': 'El nombre debe tener al menos 2 caracteres',
    'any.required': 'El nombre es requerido',
  }),
  disponible: Joi.string()
    .trim()
    .valid(...disponibilidadValues)
    .allow(null)
    .default('')
    .messages({
      'any.only': 'Disponible debe ser uno de los valores permitidos',
    }),
  grupo_id: Joi.number().integer().allow(null, '').messages({
    'number.base': 'Grupo ID debe ser un número entero',
  }),
  horario: Joi.string().trim().max(255).allow('', null).messages({
    'string.max': 'El horario no puede tener más de 255 caracteres',
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
});

exports.updateActividadSchema = Joi.object({
  actividad: Joi.string().trim().max(255).allow('', null).messages({
    'string.max': 'La actividad no puede tener más de 255 caracteres',
  }),
  nombre: Joi.string().trim().min(2).max(255).messages({
    'string.min': 'El nombre debe tener al menos 2 caracteres',
  }),
  disponible: Joi.string()
    .trim()
    .valid(...disponibilidadValues)
    .allow(null)
    .messages({
      'any.only': 'Disponible debe ser uno de los valores permitidos',
    }),
  grupo_id: Joi.number().integer().allow(null, '').messages({
    'number.base': 'Grupo ID debe ser un número entero',
  }),
  horario: Joi.string().trim().max(255).allow('', null).messages({
    'string.max': 'El horario no puede tener más de 255 caracteres',
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
}).min(1);

exports.idParamSchema = Joi.object({
  id: Joi.number().integer().required().messages({
    'number.base': 'El ID debe ser un número',
    'any.required': 'El ID es requerido',
  }),
});
