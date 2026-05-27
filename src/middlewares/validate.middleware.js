const ApiError = require('../utils/ApiError');

function mapJoiTypeToCode(type) {
  const t = String(type || '');
  if (t === 'any.required') return 'REQUIRED_MISSING';
  if (t === 'string.empty') return 'REQUIRED_MISSING';
  if (t === 'object.unknown') return 'UNKNOWN_FIELD';
  if (t.indexOf('pattern') !== -1) return 'INVALID_FORMAT';
  if (t.indexOf('email') !== -1) return 'INVALID_FORMAT';
  if (t.indexOf('isoDate') !== -1) return 'INVALID_FORMAT';
  if (t.indexOf('date.') === 0) return 'INVALID_FORMAT';
  if (t.indexOf('number.') === 0) return 'INVALID_FORMAT';
  if (t.indexOf('string.max') !== -1) return 'MAX_LENGTH_EXCEEDED';
  if (t.indexOf('string.min') !== -1) return 'MIN_LENGTH_NOT_MET';
  if (t.indexOf('array.max') !== -1) return 'MAX_ITEMS_EXCEEDED';
  if (t.indexOf('array.min') !== -1) return 'MIN_ITEMS_NOT_MET';
  return 'INVALID_PAYLOAD';
}

function mapJoiDetail(detail) {
  const path = Array.isArray(detail && detail.path) ? detail.path : [];
  const row =
    path.length >= 2 && path[0] === 'rows' && Number.isInteger(path[1])
      ? Number(path[1]) + 2
      : null;
  const column =
    path.length >= 3
      ? String(path[2])
      : path.length >= 1
      ? String(path[path.length - 1])
      : 'row';

  return {
    message: detail && detail.message ? String(detail.message) : 'Error de validación',
    path,
    row,
    column,
    code: mapJoiTypeToCode(detail && detail.type),
    value:
      detail && detail.context && Object.prototype.hasOwnProperty.call(detail.context, 'value')
        ? detail.context.value
        : null,
    expected:
      detail && detail.context && detail.context.limit != null
        ? String(detail.context.limit)
        : '',
    type: detail && detail.type ? String(detail.type) : '',
  };
}

module.exports = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const details = Array.isArray(error.details)
        ? error.details.map(mapJoiDetail)
        : [];
      return next(new ApiError(400, 'Error de validación', details));
    }

    req[property] = value;
    next();
  };
};
