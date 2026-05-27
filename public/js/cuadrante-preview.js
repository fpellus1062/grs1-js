/**
 * Renderiza un mini-calendario de cuadrante en un contenedor.
 * Reutilizable para: modal de gestión, preview en toolbar, modal de bulk/delete.
 *
 * @param {string} containerId - ID del div contenedor
 * @param {object} cuadrante  - { dias[], num_semanas, mes_referencia, anio_referencia }
 * @param {object} opts       - { selectable, selectedDates, onSelect, festivos }
 */
function renderCuadrantePreview(containerId, cuadrante, opts) {
  opts = opts || {};
  let container = document.getElementById(containerId);
  if (!container || !cuadrante || !cuadrante.dias) return;

  let selectedSet = new Set(opts.selectedDates || []);
  let allowedSet = Array.isArray(opts.allowedDates)
    ? new Set(opts.allowedDates)
    : null;
  let dias = cuadrante.dias;
  let WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  // Agrupar por semana
  let semanas = {};
  dias.forEach(function (d) {
    if (!semanas[d.num_semana]) semanas[d.num_semana] = [];
    semanas[d.num_semana].push(d);
  });

  let html = '<div class="cuadrante-preview">';

  // Header con días de la semana
  html += '<div class="cuadrante-header d-flex gap-1 mb-1">';
  WEEKDAYS.forEach(function (wd, i) {
    let isWe = i >= 5;
    html +=
      '<div class="cuadrante-header-cell text-center fw-bold small" style="' +
      'width:42px;min-width:42px;font-size:.7rem;' +
      (isWe ? 'color:#b71c1c' : 'color:#424242') +
      '">' +
      wd +
      '</div>';
  });
  html += '</div>';

  // Semanas
  Object.keys(semanas)
    .sort(function (a, b) {
      return a - b;
    })
    .forEach(function (semNum) {
      html += '<div class="cuadrante-week d-flex gap-1 mb-1">';
      semanas[semNum].forEach(function (d) {
        let isAllowed = !allowedSet || allowedSet.has(d.fecha);
        let isWeekend = d.dia_semana >= 6;
        let isTraspaso = !d.es_del_mes_ref;
        let isFestivo = d.es_festivo;
        let isSelected = selectedSet.has(d.fecha);

        let bg = '#ffffff';
        let border = '1px solid #e0e0e0';
        let textColor = '#212529';
        let opacity = '1';

        if (isTraspaso) {
          bg = '#f5f5f5';
          textColor = '#9e9e9e';
          opacity = '0.7';
        }
        if (isWeekend) {
          bg = isTraspaso ? '#fff3e0' : '#fff8e1';
        }
        if (isFestivo) {
          // Usar el color del calendario si está disponible, sino usar color por defecto
          let festivoColor = d.color_festivo || '#ef9a9a';
          bg = festivoColor;
          border = '1px solid ' + festivoColor;
          // Si es un color muy claro, hacer el borde más oscuro
          let rgb = parseInt(festivoColor.substring(1), 16);
          let brightness =
            ((rgb >> 16) & 255) * 0.299 +
            ((rgb >> 8) & 255) * 0.587 +
            (rgb & 255) * 0.114;
          if (brightness > 186) {
            border = '1px solid rgba(0,0,0,0.2)';
            textColor = '#212529';
          } else {
            textColor = '#ffffff';
          }
        }
        if (isSelected) {
          let _selColor =
            (typeof window !== 'undefined' &&
              window.GRS1Dashboard &&
              window.GRS1Dashboard._gcColor) ||
            '#276836';
          bg = '#dff3e4';
          border = '2px solid ' + _selColor;
          textColor = '#1e4f28';
        }

        let diaNum = d.dia || parseInt(d.fecha.slice(8, 10), 10);
        let mesNum = d.mes || parseInt(d.fecha.slice(5, 7), 10);

        html +=
          '<label class="cuadrante-day text-center" data-fecha="' +
          d.fecha +
          '" data-allowed="' +
          (isAllowed ? '1' : '0') +
          '" data-selected="' +
          (isSelected ? '1' : '0') +
          '" data-bg="' +
          bg +
          '" data-border="' +
          border +
          '" data-color="' +
          textColor +
          '" style="' +
          'width:42px;min-width:42px;height:38px;' +
          'position:relative;' +
          'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
          'border-radius:4px;cursor:' +
          (opts.selectable && isAllowed ? 'pointer' : 'default') +
          ';' +
          'background:' +
          bg +
          ';border:' +
          border +
          ';color:' +
          textColor +
          ';opacity:' +
          opacity +
          ';"' +
          (isFestivo && d.nombre_festivo
            ? ' title="' + d.nombre_festivo + '"'
            : '') +
          '>';

        // Checkbox oculto: la selección se comunica visualmente por color de celda.
        html +=
          '<input type="checkbox" class="cuadrante-day-check" value="' +
          d.fecha +
          '" style="' +
          'position:absolute;opacity:0;pointer-events:none;width:0;height:0;margin:0;"' +
          (isSelected ? ' checked' : '') +
          (opts.selectable && isAllowed ? '' : ' disabled') +
          '>';

        // Mostrar mes abreviado si es traspaso
        if (isTraspaso) {
          html +=
            '<div style="font-size:.55rem;line-height:1;margin-bottom:-1px;">' +
            ['E', 'F', 'M', 'A', 'My', 'Jn', 'Jl', 'Ag', 'S', 'O', 'N', 'D'][
              mesNum - 1
            ] +
            '</div>';
        }

        html +=
          '<div style="font-size:.82rem;font-weight:' +
          (isFestivo ? '700' : '600') +
          ';line-height:1.1">' +
          diaNum +
          '</div>';

        if (isFestivo) {
          html +=
            '<div style="font-size:.45rem;line-height:1;color:inherit">●</div>';
        }

        html += '</label>';
      });
      html += '</div>';
    });

  // Leyenda
  html +=
    '<div class="d-flex gap-3 mt-2" style="font-size:.65rem;color:#757575;">' +
    '<span><span style="display:inline-block;width:10px;height:10px;background:#fff;border:1px solid #e0e0e0;border-radius:2px;"></span> Mes ref.</span>' +
    '<span><span style="display:inline-block;width:10px;height:10px;background:#f5f5f5;border:1px solid #e0e0e0;border-radius:2px;opacity:.7;"></span> Traspaso</span>' +
    '<span><span style="display:inline-block;width:10px;height:10px;background:#fff8e1;border:1px solid #e0e0e0;border-radius:2px;"></span> Fin de semana</span>' +
    '<span><span style="display:inline-block;width:10px;height:10px;background:#ef9a9a;border:1px solid #ef9a9a;border-radius:2px;"></span> Festivo (color calendario)</span>' +
    '</div>';

  html += '</div>';
  container.innerHTML = html;

  function applySelectionStyle(label, isSelected) {
    if (!label) return;
    label.dataset.selected = isSelected ? '1' : '0';
    if (isSelected) {
      let _selColor =
        (typeof window !== 'undefined' &&
          window.GRS1Dashboard &&
          window.GRS1Dashboard._gcColor) ||
        '#276836';
      label.style.background = '#dff3e4';
      label.style.border = '2px solid ' + _selColor;
      label.style.color = '#1e4f28';
      return;
    }
    label.style.background = label.dataset.bg || '#ffffff';
    label.style.border = label.dataset.border || '1px solid #e0e0e0';
    label.style.color = label.dataset.color || '#212529';
  }

  // Bind selection events.
  // We toggle manually on label click to avoid browser differences with hidden inputs.
  if (opts.selectable && typeof opts.onSelect === 'function') {
    container.querySelectorAll('.cuadrante-day').forEach(function (label) {
      label.addEventListener('click', function (ev) {
        let cb = label.querySelector('.cuadrante-day-check');
        if (!cb || cb.disabled) return;

        // Prevent default label behavior and force deterministic toggle.
        ev.preventDefault();
        cb.checked = !cb.checked;
        applySelectionStyle(label, cb.checked);

        let selected = Array.from(
          container.querySelectorAll('.cuadrante-day-check:checked')
        ).map(function (el) {
          return el.value;
        });
        opts.onSelect(selected);
      });
    });
  }
}
window.renderCuadrantePreview = renderCuadrantePreview;
