const Joi = require('joi');

// Regex: mín 12 chars, 1 mayúscula, 1 minúscula, 1 número, 1 especial
const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]).{12,72}$/;
const PASSWORD_MSG =
  'Mínimo 12 caracteres con mayúscula, minúscula, número y carácter especial';

exports.registerSchema = Joi.object({
  nombre: Joi.string().min(2).max(100).required().messages({
    'string.empty': 'El nombre no puede estar vacío',
    'string.min': 'El nombre debe tener al menos 2 caracteres',
    'any.required': 'El nombre es requerido',
  }),
  email: Joi.string().email().required().messages({
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
});

exports.loginSchema = Joi.object({
  email: Joi.string().email().messages({
    'string.email': 'Debe ser un email válido',
  }),
  usuario: Joi.string().min(2).max(100).messages({
    'string.min': 'El usuario debe tener al menos 2 caracteres',
    'string.max': 'El usuario no puede tener más de 100 caracteres',
  }),
  password: Joi.string().required().messages({
    'any.required': 'La contraseña es requerida',
  }),
})
  .or('email', 'usuario')
  .messages({
    'object.missing': 'Debes enviar email o usuario',
  });

exports.updateProfileSchema = Joi.object({
  nombre: Joi.string().trim().min(2).max(100).required().messages({
    'string.empty': 'El nombre no puede estar vacío',
    'string.min': 'El nombre debe tener al menos 2 caracteres',
    'any.required': 'El nombre es requerido',
  }),
});

exports.changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required().messages({
    'any.required': 'La contraseña actual es requerida',
  }),
  newPassword: Joi.string()
    .min(12)
    .max(72)
    .pattern(PASSWORD_REGEX)
    .required()
    .messages({
      'string.min': PASSWORD_MSG,
      'string.pattern.base': PASSWORD_MSG,
      'any.required': 'La nueva contraseña es requerida',
    }),
});
