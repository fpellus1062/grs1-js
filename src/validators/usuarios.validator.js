const Joi = require('joi');

// Regex: mín 12 chars, 1 mayúscula, 1 minúscula, 1 número, 1 especial
const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[[\]!@#$%^&*()_+\-=\]{};':"\\|,.<>/?]).{12,72}$/;
const PASSWORD_MSG =
  'Mínimo 12 caracteres con mayúscula, minúscula, número y carácter especial';

exports.createUserSchema = Joi.object({
  nombre: Joi.string().trim().min(2).max(100).required().messages({
    'string.empty': 'El nombre no puede estar vacío',
    'string.min': 'El nombre debe tener al menos 2 caracteres',
    'any.required': 'El nombre es requerido',
  }),
  email: Joi.string().trim().email().required().messages({
    'string.email': 'Debe ser un email válido',
    'any.required': 'El email es requerido',
  }),
  password: Joi.string()
    .min(12)
    .max(72)
    .pattern(PASSWORD_REGEX)
    .required()
    .messages({
      'string.min': PASSWORD_MSG,
      'string.pattern.base': PASSWORD_MSG,
      'any.required': 'La contraseña es requerida',
    }),
  tip: Joi.string()
    .trim()
    .pattern(/^[A-Z][0-9]{5}[A-Z]$/)
    .allow('', null)
    .messages({
      'string.pattern.base':
        'El TIP debe tener formato letra-5dígitos-letra (ej. J12345A)',
    }),
});

exports.updateUserSchema = Joi.object({
  nombre: Joi.string().trim().min(2).max(100).messages({
    'string.min': 'El nombre debe tener al menos 2 caracteres',
  }),
  email: Joi.string().trim().email().messages({
    'string.email': 'Debe ser un email válido',
  }),
  password: Joi.string().min(12).max(72).pattern(PASSWORD_REGEX).messages({
    'string.min': PASSWORD_MSG,
    'string.pattern.base': PASSWORD_MSG,
  }),
  role: Joi.string().trim().messages({
    'string.base': 'El rol debe ser un texto válido',
  }),
  activo: Joi.boolean().messages({
    'boolean.base': 'El estado debe ser verdadero o falso',
  }),
  bloqueado_hasta: Joi.date().iso().allow(null).messages({
    'date.base': 'La fecha de bloqueo debe ser válida',
    'date.format': 'La fecha de bloqueo debe tener formato ISO',
  }),
  login_intentos: Joi.number().integer().min(0).messages({
    'number.base': 'Los intentos deben ser numéricos',
    'number.integer': 'Los intentos deben ser enteros',
    'number.min': 'Los intentos no pueden ser negativos',
  }),
  tip: Joi.string()
    .trim()
    .pattern(/^[A-Z][0-9]{5}[A-Z]$/)
    .allow('', null)
    .messages({
      'string.pattern.base':
        'El TIP debe tener formato letra-5dígitos-letra (ej. J12345A)',
    }),
}).min(1);

exports.idParamSchema = Joi.object({
  id: Joi.number().integer().required().messages({
    'number.base': 'El ID debe ser un número',
    'any.required': 'El ID es requerido',
  }),
});

exports.setUsuarioArsSchema = Joi.object({
  ars_unidad_ids: Joi.array()
    .items(Joi.string().trim().min(1))
    .min(1)
    .required()
    .messages({
      'array.base': 'Las agrupaciones deben enviarse como una lista',
      'array.min': 'Debes seleccionar al menos una agrupacion',
      'any.required': 'La lista de agrupaciones es obligatoria',
    }),
});
