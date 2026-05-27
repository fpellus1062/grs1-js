const Joi = require('joi');

const dateSchema = Joi.string()
  .trim()
  .pattern(/^\d{4}-\d{2}-\d{2}$/);

const zeroOrPositiveOneDecimalDaySchema = Joi.number().min(0).custom((value, helpers) => {
  const rounded = Math.round(Number(value) * 10) / 10;
  if (!Number.isFinite(rounded) || rounded < 0) {
    return helpers.error('number.base');
  }
  return rounded;
}, 'one-decimal rounding allowing zero');

function isDisfrute(tipoMovimiento) {
  return String(tipoMovimiento || '').trim().toLowerCase() === 'disfrute';
}

function validateCondicionDiasByTipo(value, helpers, options = {}) {
  const { strictWhenTipoMissing = false } = options;
  const hasCondicionDias = Object.prototype.hasOwnProperty.call(value, 'condicion_dias');
  if (!hasCondicionDias) return value;

  const hasTipo = Object.prototype.hasOwnProperty.call(value, 'tipo_movimiento');
  const tipo = hasTipo ? value.tipo_movimiento : null;
  const dias = Number(value.condicion_dias);

  if (!Number.isFinite(dias)) {
    return helpers.error('any.custom', {
      message: 'condicion_dias debe ser un número válido',
    });
  }

  if (dias === 0) {
    if (hasTipo && isDisfrute(tipo)) {
      return value;
    }
    if (strictWhenTipoMissing || hasTipo) {
      return helpers.error('any.custom', {
        message: 'condicion_dias = 0 solo está permitido para tipo_movimiento "disfrute"',
      });
    }
  }

  return value;
}

const categoriaReglaSchema = Joi.string()
  .valid('Regla_Normal', 'Regla_Especial')
  .allow('', null);

exports.listReglasQuerySchema = Joi.object({
  actividad_id: Joi.number().integer().positive(),
  grupo_id: Joi.number().integer().positive(),
  empleo_id: Joi.string().trim().max(100).allow('', null),
  fecha: dateSchema.allow('', null),
  activo: Joi.boolean(),
  categoria_regla: categoriaReglaSchema,
});

exports.idParamSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
});

exports.createReglaSchema = Joi.object({
  actividad_id: Joi.number().integer().positive().allow(null),
  grupo_id: Joi.number().integer().positive().allow(null),
  empleo_id: Joi.string().trim().max(100).allow('', null),
  tipo_movimiento: Joi.string()
    .valid('devengo', 'disfrute', 'descanso')
    .required(),
  unidad: Joi.string().valid('dias').default('dias'),
  valor: Joi.number().precision(2).required(),
  aplica_cruce_festivo: Joi.boolean().default(false),
  tipo_dia: Joi.string()
    .valid('periodo', 'festivo', 'fin_semana', 'laborable')
    .default('periodo'),
  condicion_dias: zeroOrPositiveOneDecimalDaySchema,
  condicion_tipo: Joi.string()
    .valid('consecutivos', 'en_periodo')
    .default('en_periodo'),
  condicion_alcance: Joi.string()
    .valid('cualquier_actividad', 'actividad', 'grupo')
    .default('cualquier_actividad'),
  excluir_festivos: Joi.boolean().default(true),
  vigencia_desde: dateSchema.required(),
  vigencia_hasta: dateSchema.allow('', null),
  prioridad: Joi.number().integer().min(1).max(9999).default(100),
  activo: Joi.boolean().default(true),
  categoria_regla: categoriaReglaSchema,
  descripcion: Joi.string().trim().max(500).allow('', null),
}).custom((value, helpers) => {
  const condicionDiasValidation = validateCondicionDiasByTipo(value, helpers, {
    strictWhenTipoMissing: true,
  });
  if (condicionDiasValidation !== value) {
    return condicionDiasValidation;
  }

  const alcance = String(value.condicion_alcance || 'cualquier_actividad');
  const hasActividad = value.actividad_id != null;
  const hasGrupo = value.grupo_id != null;

  if (alcance === 'cualquier_actividad') {
    if (hasActividad || hasGrupo) {
      return helpers.error('any.custom', {
        message:
          'Para alcance "cualquier_actividad" no debe informar actividad ni grupo',
      });
    }
    return value;
  }

  if (alcance === 'actividad') {
    if (!hasActividad || hasGrupo) {
      return helpers.error('any.custom', {
        message:
          'Para alcance "actividad" debe informar actividad y no grupo',
      });
    }
    return value;
  }

  if (!hasGrupo || hasActividad) {
    return helpers.error('any.custom', {
      message: 'Para alcance "grupo" debe informar grupo y no actividad',
    });
  }
  return value;
}, 'scope validation');

exports.updateReglaSchema = Joi.object({
  actividad_id: Joi.number().integer().positive().allow(null),
  grupo_id: Joi.number().integer().positive().allow(null),
  empleo_id: Joi.string().trim().max(100).allow('', null),
  tipo_movimiento: Joi.string().valid('devengo', 'disfrute', 'descanso'),
  unidad: Joi.string().valid('dias'),
  valor: Joi.number().precision(2),
  aplica_cruce_festivo: Joi.boolean(),
  tipo_dia: Joi.string().valid('periodo', 'festivo', 'fin_semana', 'laborable'),
  condicion_dias: zeroOrPositiveOneDecimalDaySchema,
  condicion_tipo: Joi.string().valid('consecutivos', 'en_periodo'),
  condicion_alcance: Joi.string().valid(
    'cualquier_actividad',
    'actividad',
    'grupo'
  ),
  excluir_festivos: Joi.boolean(),
  vigencia_desde: dateSchema,
  vigencia_hasta: dateSchema.allow('', null),
  prioridad: Joi.number().integer().min(1).max(9999),
  activo: Joi.boolean(),
  categoria_regla: categoriaReglaSchema,
  descripcion: Joi.string().trim().max(500).allow('', null),
})
  .min(1)
  .custom((value, helpers) => {
    const condicionDiasValidation = validateCondicionDiasByTipo(value, helpers);
    if (condicionDiasValidation !== value) {
      return condicionDiasValidation;
    }

    const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const alcance = hasOwn(value, 'condicion_alcance')
      ? value.condicion_alcance
      : null;
    const hasActividad = hasOwn(value, 'actividad_id');
    const hasGrupo = hasOwn(value, 'grupo_id');

    if (alcance === 'cualquier_actividad') {
      if (
        (hasActividad && value.actividad_id != null) ||
        (hasGrupo && value.grupo_id != null)
      ) {
        return helpers.error('any.custom', {
          message:
            'Para alcance "cualquier_actividad" no debe informar actividad ni grupo',
        });
      }
      return value;
    }

    if (alcance === 'actividad' && hasGrupo && value.grupo_id != null) {
      return helpers.error('any.custom', {
        message: 'Para alcance "actividad" no puede informar grupo',
      });
    }

    if (alcance === 'grupo' && hasActividad && value.actividad_id != null) {
      return helpers.error('any.custom', {
        message: 'Para alcance "grupo" no puede informar actividad',
      });
    }

    if (!hasActividad && !hasGrupo) return value;

    const actividad = hasActividad ? value.actividad_id : undefined;
    const grupo = hasGrupo ? value.grupo_id : undefined;

    if (
      (actividad == null && grupo == null) ||
      (actividad != null && grupo != null)
    ) {
      return helpers.error('any.custom', {
        message: 'Debe informar actividad o grupo (uno solo)',
      });
    }
    return value;
  }, 'scope patch validation');

exports.previewSchema = Joi.object({
  agente_id: Joi.number().integer().positive().required(),
  actividad_id: Joi.number().integer().positive().required(),
  borrador_id: Joi.number().integer().positive().allow(null),
  fecha: dateSchema.allow('', null),
  fecha_hasta: dateSchema.allow('', null),
  regla_override: Joi.object({
    tipo_movimiento: Joi.string()
      .valid('devengo', 'disfrute', 'descanso')
      .required(),
    valor: Joi.number().precision(2).required(),
    aplica_cruce_festivo: Joi.boolean().default(false),
    tipo_dia: Joi.string()
      .valid('periodo', 'festivo', 'fin_semana', 'laborable')
      .default('periodo'),
    condicion_dias: zeroOrPositiveOneDecimalDaySchema,
    condicion_tipo: Joi.string().valid('consecutivos', 'en_periodo'),
    condicion_alcance: Joi.string().valid(
      'cualquier_actividad',
      'actividad',
      'grupo'
    ),
    excluir_festivos: Joi.boolean().default(true),
    actividad_id: Joi.number().integer().positive().allow(null),
    grupo_id: Joi.number().integer().positive().allow(null),
    empleo_id: Joi.string().trim().max(100).allow('', null),
    vigencia_desde: dateSchema.allow('', null),
    vigencia_hasta: dateSchema.allow('', null),
    prioridad: Joi.number().integer().min(1).max(9999).default(100),
    _regla_id: Joi.number().integer().allow(null),
  })
    .custom((ruleOverride, helpers) =>
      validateCondicionDiasByTipo(ruleOverride, helpers, {
        strictWhenTipoMissing: true,
      }), 'preview override condicion_dias')
    .allow(null),
}).custom((value, helpers) => {
  const fecha = value.fecha ? String(value.fecha).trim() : '';
  const fechaHasta = value.fecha_hasta ? String(value.fecha_hasta).trim() : '';

  if (fechaHasta && !fecha) {
    return helpers.error('any.custom', {
      message: 'Debe informar Fecha cuando use Fecha hasta',
    });
  }

  if (!fechaHasta && !value.borrador_id) {
    return helpers.error('any.custom', {
      message: 'Debe seleccionar un borrador cuando no informe Fecha hasta',
    });
  }

  return value;
}, 'preview range validation');

exports.persistirMovimientoManualSchema = Joi.object({
  agente_id: Joi.number().integer().positive().required(),
  actividad_id: Joi.number().integer().positive().required(),
  borrador_id: Joi.number().integer().positive().allow(null),
  fecha: dateSchema.allow('', null),
  fecha_hasta: dateSchema.allow('', null),
  observaciones: Joi.string().trim().min(5).max(5000).required(),
  preview_snapshot: Joi.object().unknown(true).allow(null),
  regla_override: Joi.object({
    tipo_movimiento: Joi.string()
      .valid('devengo', 'disfrute', 'descanso')
      .required(),
    valor: Joi.number().precision(2).required(),
    aplica_cruce_festivo: Joi.boolean().default(false),
    tipo_dia: Joi.string()
      .valid('periodo', 'festivo', 'fin_semana', 'laborable')
      .default('periodo'),
    condicion_dias: zeroOrPositiveOneDecimalDaySchema.default(6),
    condicion_tipo: Joi.string().valid('consecutivos', 'en_periodo'),
    condicion_alcance: Joi.string().valid(
      'cualquier_actividad',
      'actividad',
      'grupo'
    ),
    excluir_festivos: Joi.boolean().default(true),
    actividad_id: Joi.number().integer().positive().allow(null),
    grupo_id: Joi.number().integer().positive().allow(null),
    empleo_id: Joi.string().trim().max(100).allow('', null),
    vigencia_desde: dateSchema.allow('', null),
    vigencia_hasta: dateSchema.allow('', null),
    prioridad: Joi.number().integer().min(1).max(9999).default(100),
    _regla_id: Joi.number().integer().allow(null),
  })
    .custom((ruleOverride, helpers) =>
      validateCondicionDiasByTipo(ruleOverride, helpers, {
        strictWhenTipoMissing: true,
      }), 'manual override condicion_dias')
    .allow(null),
}).custom((value, helpers) => {
  const fecha = value.fecha ? String(value.fecha).trim() : '';
  const fechaHasta = value.fecha_hasta ? String(value.fecha_hasta).trim() : '';

  if (fechaHasta && !fecha) {
    return helpers.error('any.custom', {
      message: 'Debe informar Fecha cuando use Fecha hasta',
    });
  }

  if (!fechaHasta && !value.borrador_id) {
    return helpers.error('any.custom', {
      message: 'Debe seleccionar un borrador cuando no informe Fecha hasta',
    });
  }

  return value;
}, 'manual persist validation');

exports.persistirMovimientoManualBulkSchema = Joi.object({
  items: Joi.array()
    .items(
      Joi.object({
        agente_id: Joi.number().integer().positive().required(),
        actividad_id: Joi.number().integer().positive().required(),
        borrador_id: Joi.number().integer().positive().allow(null),
        fecha: dateSchema.allow('', null),
        fecha_hasta: dateSchema.allow('', null),
        preview_snapshot: Joi.object().unknown(true).allow(null),
        regla_override: Joi.object({
          tipo_movimiento: Joi.string()
            .valid('devengo', 'disfrute', 'descanso')
            .required(),
          valor: Joi.number().precision(2).required(),
          aplica_cruce_festivo: Joi.boolean().default(false),
          tipo_dia: Joi.string()
            .valid('periodo', 'festivo', 'fin_semana', 'laborable')
            .default('periodo'),
          condicion_dias: zeroOrPositiveOneDecimalDaySchema.default(6),
          condicion_tipo: Joi.string().valid('consecutivos', 'en_periodo'),
          condicion_alcance: Joi.string().valid(
            'cualquier_actividad',
            'actividad',
            'grupo'
          ),
          excluir_festivos: Joi.boolean().default(true),
          actividad_id: Joi.number().integer().positive().allow(null),
          grupo_id: Joi.number().integer().positive().allow(null),
          empleo_id: Joi.string().trim().max(100).allow('', null),
          vigencia_desde: dateSchema.allow('', null),
          vigencia_hasta: dateSchema.allow('', null),
          prioridad: Joi.number().integer().min(1).max(9999).default(100),
          _regla_id: Joi.number().integer().allow(null),
        })
          .custom((ruleOverride, helpers) =>
            validateCondicionDiasByTipo(ruleOverride, helpers, {
              strictWhenTipoMissing: true,
            }), 'bulk manual override condicion_dias')
          .allow(null),
      })
    )
    .min(1)
    .max(5000)
    .required(),
  observaciones: Joi.string().trim().min(5).max(5000).required(),
}).custom((value, helpers) => {
  for (const item of value.items) {
    const fecha = item.fecha ? String(item.fecha).trim() : '';
    const fechaHasta = item.fecha_hasta ? String(item.fecha_hasta).trim() : '';

    if (fechaHasta && !fecha) {
      return helpers.error('any.custom', {
        message: 'Debe informar Fecha cuando use Fecha hasta',
      });
    }

    if (!fechaHasta && !item.borrador_id) {
      return helpers.error('any.custom', {
        message: 'Debe seleccionar un borrador cuando no informe Fecha hasta',
      });
    }
  }

  return value;
}, 'manual persist bulk validation');

exports.saldosQuerySchema = Joi.object({
  anio: Joi.number().integer().min(2020).max(2100).required(),
  mes: Joi.number().integer().min(1).max(12).required(),
  agente_id: Joi.number().integer().positive(),
  empleo_id: Joi.string().trim().max(100),
});

exports.ledgerSaldosMensualesQuerySchema = Joi.object({
  // anio/mes opcionales en el diseño 3-panel (filtro por agente_id)
  anio: Joi.number().integer().min(2020).max(2100),
  mes: Joi.number().integer().min(1).max(12),
  agente_id: Joi.number().integer().positive(),
  empleo_id: Joi.string().trim().max(100),
}).or('anio', 'agente_id');

exports.ledgerAgentesQuerySchema = Joi.object({
  anio: Joi.number().integer().min(2020).max(2100),
});

exports.ledgerMovimientosQuerySchema = Joi.object({
  anio: Joi.number().integer().min(2020).max(2100).required(),
  mes: Joi.number().integer().min(1).max(12),
  agente_id: Joi.number().integer().positive().required(),
  empleo_id: Joi.string().trim().max(100),
  empleo_null: Joi.boolean().default(false),
});
