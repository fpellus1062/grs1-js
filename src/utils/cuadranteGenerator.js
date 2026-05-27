/**
 * Genera la estructura de un cuadrante de planificación.
 *
 * Reglas:
 * - Siempre empieza en lunes y termina en domingo
 * - De 4 a 6 semanas
 * - El nombre por defecto es el mes donde cae el primer día 1
 * - Los días fuera del mes de referencia se marcan como "traspaso"
 *
 * @param {number} year - Año (ej: 2026)
 * @param {number} month - Mes 1-12
 * @param {object} opts - { numSemanas: 3|4|5|6 }  (auto si no se indica)
 * @returns {object} { nombre, fecha_inicio, fecha_fin, num_semanas,
 *                      mes_referencia, anio_referencia, dias[] }
 */
const { DateTime } = require('luxon');

const MESES_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

function generarCuadrante(year, month, opts = {}) {
  const primerDiaMes = DateTime.fromObject(
    { year, month, day: 1 },
    { zone: 'UTC' }
  );
  if (!primerDiaMes.isValid) {
    throw new Error('Periodo de cuadrante inválido');
  }

  // Encontrar el lunes anterior o igual al día 1
  const inicio = primerDiaMes.minus({ days: primerDiaMes.weekday - 1 });

  // Último día del mes
  const ultimoDiaMes = primerDiaMes.endOf('month');

  // Calcular semanas necesarias (4-6) si no se fuerzan
  let numSemanas = opts.numSemanas || null;
  if (!numSemanas) {
    // Calcular automáticamente: necesitamos incluir el último día del mes
    const diasNecesarios =
      Math.ceil(ultimoDiaMes.diff(inicio, 'days').days) + 1;
    numSemanas = Math.ceil(diasNecesarios / 7);
    numSemanas = Math.max(3, Math.min(6, numSemanas));
  }

  // Generar fecha_fin (domingo de la última semana)
  const fin = inicio.plus({ days: numSemanas * 7 - 1 });
  const mesReferencia = month;
  const anioReferencia = year;

  // Generar días
  const dias = [];
  let current = inicio;
  for (let sem = 1; sem <= numSemanas; sem++) {
    for (let dow = 1; dow <= 7; dow++) {
      const fecha = formatDate(current);
      dias.push({
        fecha,
        num_semana: sem,
        dia_semana: dow, // 1=Lun, 7=Dom (ISO)
        dia: current.day,
        mes: current.month,
        anio: current.year,
        es_del_mes_ref:
          current.month === mesReferencia && current.year === anioReferencia,
      });
      current = current.plus({ days: 1 });
    }
  }

  // Nombre por defecto
  const nombre = `${MESES_ES[mesReferencia - 1]} ${anioReferencia}`;

  return {
    nombre,
    fecha_inicio: formatDate(inicio),
    fecha_fin: formatDate(fin),
    num_semanas: numSemanas,
    mes_referencia: mesReferencia,
    anio_referencia: anioReferencia,
    dias,
  };
}

function formatDate(d) {
  return d.toISODate();
}

module.exports = { generarCuadrante };
