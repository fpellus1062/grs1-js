const Joi = require('joi');

const nullableTrimmedString = (max) =>
  Joi.string().trim().max(max).empty('').allow(null).default(null);

const nullableUppercaseString = (max) =>
  Joi.string().trim().uppercase().max(max).empty('').allow(null).default(null);

exports.createAgenteSchema = Joi.object({
  nombre: Joi.string().trim().min(2).max(100).required().messages({
    'string.empty': 'El nombre no puede estar vacío',
    'string.min': 'El nombre debe tener al menos 2 caracteres',
    'any.required': 'El nombre es requerido',
  }),
  apellido_1: Joi.string().trim().min(2).max(100).required().messages({
    'string.empty': 'El apellido 1 no puede estar vacío',
    'string.min': 'El apellido 1 debe tener al menos 2 caracteres',
    'any.required': 'El apellido 1 es requerido',
  }),
  apellido_2: Joi.string().trim().min(2).max(100).required().messages({
    'string.empty': 'El apellido 2 es requerido',
    'string.min': 'El apellido 2 debe tener al menos 2 caracteres',
    'string.max': 'El apellido 2 no puede tener más de 100 caracteres',
    'any.required': 'El apellido 2 es requerido',
  }),
  email: Joi.string().trim().lowercase().email().max(255).required().messages({
    'string.email': 'Debe ser un email válido',
    'any.required': 'El email es requerido',
  }),
  peloton_id: Joi.string().trim().max(30).required().messages({
    'string.max': 'Pelotón ID no puede tener más de 30 caracteres',
    'string.empty': 'Pelotón ID es requerido',
    'any.required': 'Pelotón ID es requerido',
  }),
  empleo_id: Joi.string().trim().max(12).required().messages({
    'string.max': 'El Empleo ID no puede tener más de 12 caracteres',
    'string.empty': 'El Empleo ID es requerido',
    'any.required': 'El Empleo ID es requerido',
  }),
  orden_gc: Joi.number().integer().required().messages({
    'number.base': 'Orden debe ser un número entero',
    'any.required': 'Orden es requerido',
  }),
  tip: Joi.string()
    .trim()
    .uppercase()
    .pattern(/^[A-Z][0-9]{5}[A-Z]$/)
    .required()
    .messages({
      'string.empty': 'El TIP es requerido',
      'any.required': 'El TIP es requerido',
      'string.pattern.base': 'El TIP debe tener formato A99999A',
    }),
  nif: Joi.string().trim().uppercase().max(20).required().messages({
    'string.max': 'NIF no puede tener más de 20 caracteres',
    'string.empty': 'El NIF/NIE es requerido',
    'any.required': 'El NIF/NIE es requerido',
  }),
  telefono: Joi.string()
    .trim()
    .pattern(/^[0-9\s()+-]+$/)
    .max(60)
    .required()
    .messages({
      'string.pattern.base':
        'Teléfono debe contener solo números, espacios y guiones',
      'string.max': 'Teléfono no puede tener más de 60 caracteres',
      'string.empty': 'El teléfono es requerido',
      'any.required': 'El teléfono es requerido',
    }),
  aptitudes: Joi.string().trim().max(255).allow('', null),
  situacion_id: Joi.string().trim().max(6).required().messages({
    'string.max': 'Situación ID no puede tener más de 6 caracteres',
    'string.empty': 'Situación ID es requerido',
    'any.required': 'Situación ID es requerido',
  }),
  comentarios: Joi.string().trim().allow('', null),
  pei: Joi.boolean().allow(null).default(false),
  paef: Joi.boolean().allow(null).default(false),
  fecha_ant_empleo: Joi.date().iso().allow(null).default(null).messages({
    'date.base': 'La fecha de antigüedad de empleo debe ser una fecha válida',
  }),
  domicilio: Joi.string().trim().max(255).allow('', null).default(null).messages({
    'string.max': 'El domicilio no puede tener más de 255 caracteres',
  }),
  poblacion: Joi.string().trim().max(60).allow('', null).default(null).messages({
    'string.max': 'La población no puede tener más de 60 caracteres',
  }),
  codigo_postal: Joi.string().trim().max(5).allow('', null).default(null).messages({
    'string.max': 'El código postal no puede tener más de 5 caracteres',
  }),
  provincia: Joi.string().trim().uppercase().max(2).allow('', null).default(null).messages({
    'string.max': 'La provincia no puede tener más de 2 caracteres',
  }),
}).messages({
  'object.unknown': 'Campo no permitido en creación de agente',
});

exports.updateAgenteSchema = Joi.object({
  nombre: Joi.string().min(2).max(100).messages({
    'string.min': 'El nombre debe tener al menos 2 caracteres',
  }),
  apellido_1: Joi.string().min(2).max(100).messages({
    'string.min': 'El apellido 1 debe tener al menos 2 caracteres',
  }),
  apellido_2: Joi.string().max(100).allow('', null).messages({
    'string.max': 'El apellido 2 no puede tener más de 100 caracteres',
  }),
  email: Joi.string().email().allow('', null).messages({
    'string.email': 'Debe ser un email válido',
  }),
  peloton_id: Joi.string().max(10).allow('', null).messages({
    'string.max': 'Pelotón ID no puede tener más de 10 caracteres',
  }),
  empleo_id: Joi.string().max(100).allow('', null).messages({
    'string.max': 'El Empleo ID no puede tener más de 100 caracteres',
  }),
  orden_gc: Joi.number().integer().allow(null, '').messages({
    'number.base': 'Orden debe ser un número',
  }),
  tip: Joi.string()
    .pattern(/^[A-Z][0-9]{5}[A-Z]$/)
    .allow('', null)
    .messages({
      'string.pattern.base': 'El TIP debe tener formato A99999A',
    }),
  nif: Joi.string().max(20).allow('', null).messages({
    'string.max': 'NIF no puede tener más de 20 caracteres',
  }),
  telefono: Joi.string()
    .pattern(/^[0-9\s()+-]+$/)
    .allow('', null)
    .messages({
      'string.pattern.base':
        'Teléfono debe contener solo números, espacios y guiones',
    }),
  aptitudes: Joi.string().max(255).allow('', null),
  situacion_id: Joi.string().max(10).allow('', null),
  comentarios: Joi.string().allow('', null),
  pei: Joi.boolean().allow(null),
  paef: Joi.boolean().allow(null),
  fecha_ant_empleo: Joi.date().iso().allow(null).messages({
    'date.base': 'La fecha de antigüedad de empleo debe ser una fecha válida',
  }),
  domicilio: Joi.string().max(255).messages({
    'string.max': 'El domicilio no puede tener más de 255 caracteres',
  }),
  poblacion: Joi.string().max(150).messages({
    'string.max': 'La población no puede tener más de 150 caracteres',
  }),
  codigo_postal: Joi.string().max(10).messages({
    'string.max': 'El código postal no puede tener más de 10 caracteres',
  }),
  provincia: Joi.string().max(100).messages({
    'string.max': 'La provincia no puede tener más de 100 caracteres',
  }),
  fecha_baja: Joi.date().iso().allow(null).messages({
    'date.base': 'La fecha de baja debe ser una fecha válida',
  }),
}).min(1);

exports.idParamSchema = Joi.object({
  id: Joi.number().integer().required().messages({
    'number.base': 'El ID debe ser un número',
    'any.required': 'El ID es requerido',
  }),
});

const bulkAgenteRowSchema = Joi.object({
  id: Joi.number().integer().allow(null),
  tip: Joi.string()
    .trim()
    .uppercase()
    .pattern(/^[A-Z][0-9]{5}[A-Z]$/)
    .max(20)
    .required()
    .messages({
      'any.required': 'TIP es obligatorio',
      'string.empty': 'TIP es obligatorio',
      'string.pattern.base': 'TIP debe tener formato A99999A',
    }),
  nombre: nullableTrimmedString(100),
  apellido_1: nullableTrimmedString(100),
  apellido_2: nullableTrimmedString(100),
  email: Joi.string().trim().lowercase().email().max(255).empty('').allow(null).default(null).messages({
    'string.email': 'Email no tiene un formato válido',
  }),
  peloton_id: nullableTrimmedString(120),
  empleo_id: nullableTrimmedString(120),
  orden_gc: Joi.alternatives()
    .try(Joi.number().integer(), Joi.string().trim().pattern(/^\d+$/), Joi.valid(null, ''))
    .custom((value) => {
      if (value == null || value === '') return null;
      return Number(value);
    })
    .messages({
      'alternatives.match': 'Orden GC debe ser un entero',
      'string.pattern.base': 'Orden GC debe ser un entero',
    }),
  nif: nullableUppercaseString(20),
  telefono: Joi.string()
    .trim()
    .pattern(/^[0-9\s()+-]+$/)
    .max(60)
    .empty('')
    .allow(null)
    .default(null)
    .messages({
      'string.pattern.base': 'Teléfono solo puede contener números, espacios, paréntesis, + y -',
    }),
  aptitudes: nullableTrimmedString(255),
  situacion_id: nullableTrimmedString(120),
  comentarios: Joi.string().trim().empty('').allow(null).default(null),
  pei: Joi.boolean().allow(null).default(null),
  paef: Joi.boolean().allow(null).default(null),
  fecha_ant_empleo: Joi.string().trim().isoDate().empty('').allow(null).default(null).messages({
    'string.isoDate': 'Fecha Nombramiento debe tener formato ISO válido (YYYY-MM-DD)',
  }),
  domicilio: nullableTrimmedString(255),
  codigo_postal: nullableTrimmedString(5),
  poblacion: nullableTrimmedString(60),
  provincia: nullableUppercaseString(2),
  // Columnas de sistema del DDL: se aceptan para importación full y se ignoran en alta nueva.
  // Se tolera texto libre para evitar rechazos por formatos de export no ISO.
  created_at: Joi.string().trim().max(80).empty('').allow(null).default(null),
  created_user: Joi.alternatives()
    .try(Joi.number().integer(), Joi.string().trim().pattern(/^\d+$/), Joi.valid(null, ''))
    .custom((value) => {
      if (value == null || value === '') return null;
      return Number(value);
    }),
  ars_unidad_id: Joi.string().trim().max(30).empty('').allow(null).default(null),
  fecha_baja: Joi.string().trim().max(80).empty('').allow(null).default(null),
  escalafon: Joi.string().trim().max(24).empty('').allow(null).default(null),
  _line: Joi.number().integer().allow(null),
  // Se toleran columnas extra del frontend (campos de presentacion) y
  // validate.middleware las elimina via stripUnknown.
}).unknown(true).messages({
  'object.unknown': 'La fila contiene una columna no permitida',
});

exports.altasMasivasSchema = Joi.object({
  rows: Joi.array().items(bulkAgenteRowSchema).min(1).max(1000).required().messages({
    'array.min': 'Debe informar al menos una fila para altas masivas',
    'array.max': 'No se permiten más de 1000 filas por carga',
    'any.required': 'Debe informar filas para altas masivas',
  }),
}).messages({
  'object.unknown': 'El payload de altas masivas contiene propiedades no permitidas',
});

exports.bajasMasivasSchema = Joi.object({
  tips: Joi.array().items(Joi.string().trim().max(20)).max(1000).default([]),
  ids: Joi.array().items(Joi.number().integer().positive()).max(1000).default([]),
})
  .custom((value, helpers) => {
    if ((!value.tips || !value.tips.length) && (!value.ids || !value.ids.length)) {
      return helpers.error('any.custom');
    }
    return value;
  }, 'al menos un criterio de baja')
  .messages({
    'any.custom': 'Debe informar al menos un TIP o ID para la baja masiva',
  });
