/**
 * Devuelve la abreviatura del día de la semana en español.
 * L, M, X, J, V, S, D (Lunes a Domingo)
 * @param {Date} fecha
 * @returns {string}
 */
function obtenerDiaSemana(fecha) {
  const dias = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  return dias[fecha.getDay()];
}

/**
 * Formatea una fecha en formato YYYY-MM-DD.
 * @param {Date} fecha
 * @returns {string}
 */
function formatearFecha(fecha) {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}
function esFestivo(fecha, calendario) {
  const year = fecha.split('-')[0];
  const datos = calendario[year];

  if (!datos) return false;

  const festivos = [...(datos.fijos || []), ...(datos.personalizados || [])];

  return festivos.includes(fecha);
}
/**
 * Genera un cuadrante mensual de 4 o 5 semanas.
 * @param {number} year - Año en formato YYYY.
 * @param {number} month - Mes (1-12).
 * @returns {Object}
 */
function generarCuadranteMensual(year, month) {
  const primerDiaMes = new Date(year, month - 1, 1);
  let diaSemana = primerDiaMes.getDay();
  diaSemana = diaSemana === 0 ? 7 : diaSemana; // Ajuste para lunes

  // Calcular el lunes anterior o igual al día 1
  const inicio = new Date(primerDiaMes);
  inicio.setDate(primerDiaMes.getDate() - (diaSemana - 1));

  const ultimoDiaMes = new Date(year, month, 0);
  const semanas = [];
  let fechaActual = new Date(inicio);
  let contieneUltimoDia = false;

  for (let i = 0; i < 5; i++) {
    const semana = [];

    for (let j = 0; j < 7; j++) {
      const fecha = new Date(fechaActual);

      if (
        fecha.getFullYear() === ultimoDiaMes.getFullYear() &&
        fecha.getMonth() === ultimoDiaMes.getMonth() &&
        fecha.getDate() === ultimoDiaMes.getDate()
      ) {
        contieneUltimoDia = true;
      }

      semana.push({
        fecha: formatearFecha(fecha),
        dia: fecha.getDate(),
        diaSemana: obtenerDiaSemana(fecha),
        mes: fecha.getMonth() + 1,
        anio: fecha.getFullYear(),
        esDelMes: fecha.getMonth() === month - 1,
      });

      fechaActual.setDate(fechaActual.getDate() + 1);
    }

    semanas.push(semana);

    // Garantiza entre 4 y 5 semanas
    if (contieneUltimoDia && i >= 3) {
      break;
    }
  }

  return {
    denominacion: `${year}.${String(month).padStart(2, '0')}`,
    semanas,
  };
}

/**
 * Genera todos los cuadrantes de un año.
 * @param {number} year - Año en formato YYYY.
 * @returns {Array}
 */
function generarCuadrantesAnuales(year, calendarioFestivos = {}) {
  const cuadrantes = [];

  for (let month = 1; month <= 12; month++) {
    const cuadrante = generarCuadranteMensual(year, month);

    cuadrante.semanas.forEach((semana) => {
      semana.forEach((dia) => {
        dia.esFestivo = esFestivo(dia.fecha, calendarioFestivos);
      });
    });

    cuadrantes.push(cuadrante);
  }

  return cuadrantes;
}

module.exports = {
  obtenerDiaSemana,
  formatearFecha,
  esFestivo,
  generarCuadranteMensual,
  generarCuadrantesAnuales,
};
