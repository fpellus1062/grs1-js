(function () {
  /**
   * dashboard-utils.js
   * Utilidades compartidas entre todos los módulos del dashboard.
   * Debe cargarse antes que cualquier otro script de módulo.
   */

  /** Traducciones en español para Tabulator */
  const TABULATOR_LANGS = {
    'es-es': {
      data: { loading: 'Cargando...', error: 'Error al cargar datos' },
      pagination: {
        page_size: 'Registros por página',
        first: '«',
        first_title: 'Primera',
        last: '»',
        last_title: 'Última',
        prev: '‹',
        prev_title: 'Anterior',
        next: '›',
        next_title: 'Siguiente',
        all: 'Todos',
        counter: {
          showing: 'Mostrando',
          of: 'de',
          rows: 'filas',
          pages: 'páginas',
        },
      },
      headerFilters: { default: 'Filtrar...' },
    },
  };

  /**
   * Compara dos valores coercionando a string (null/undefined tratados como '').
   * @param {*} left
   * @param {*} right
   * @returns {boolean}
   */
  function sameValue(left, right) {
    return (
      String(left == null ? '' : left) === String(right == null ? '' : right)
    );
  }

  /**
   * Devuelve una copia profunda de un array de filas mediante JSON round-trip.
   * @param {Array} rows
   * @returns {Array}
   */
  function cloneRows(rows) {
    return JSON.parse(JSON.stringify(rows || []));
  }

  /**
   * Escapa HTML usando app.escapeHtml; trata null/undefined como cadena vacía.
   * @param {*} value
   * @returns {string}
   */
  function esc(value) {
    return window.GRS1Dashboard.escapeHtml(value == null ? '' : value);
  }

  function resolveUserRole(appRef) {
    let app = appRef || window.GRS1Dashboard || {};
    let fromState =
      app && app.globalState && typeof app.globalState.userRole === 'string'
        ? app.globalState.userRole
        : '';
    if (fromState) return String(fromState).trim().toLowerCase();

    let fromSession =
      (window.sessionStorage &&
        (sessionStorage.getItem('userRole') || sessionStorage.getItem('role'))) ||
      '';
    if (fromSession) return String(fromSession).trim().toLowerCase();

    let fromLocal =
      (window.localStorage &&
        (localStorage.getItem('userRole') || localStorage.getItem('role'))) ||
      '';
    return String(fromLocal || '').trim().toLowerCase();
  }

  function isConsultaReadOnlyRole(appRef) {
    return resolveUserRole(appRef) === 'consulta';
  }

  function disableElementsById(ids, titleText) {
    let list = Array.isArray(ids) ? ids : [];
    let title = String(titleText || 'Perfil consulta: solo lectura');
    list.forEach(function (id) {
      let el = document.getElementById(String(id || ''));
      if (!el) return;
      // @ts-ignore
      el.disabled = true;
      el.classList.add('disabled');
      el.setAttribute('aria-disabled', 'true');
      el.setAttribute('title', title);
    });
  }

  function normalizeHexColor(value) {
    let raw = String(value || '').trim();
    if (!raw) return '';
    let hex = raw.replace('#', '');
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
      hex =
        hex.charAt(0) +
        hex.charAt(0) +
        hex.charAt(1) +
        hex.charAt(1) +
        hex.charAt(2) +
        hex.charAt(2);
    }
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return '';
    return '#' + hex.toLowerCase();
  }

  function getTextColorForHexBackground(color, threshold) {
    let normalized = normalizeHexColor(color);
    if (!normalized) return '#ffffff';
    let hex = normalized.replace('#', '');
    let r = parseInt(hex.slice(0, 2), 16);
    let g = parseInt(hex.slice(2, 4), 16);
    let b = parseInt(hex.slice(4, 6), 16);
    let t = Number.isFinite(Number(threshold)) ? Number(threshold) : 0.6;
    let lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > t ? '#212529' : '#ffffff';
  }

  function renderColorBadgeHtml(label, color, options) {
    let opts = options || {};
    let safe =
      typeof opts.escapeHtmlFn === 'function'
        ? opts.escapeHtmlFn
        : function (value) {
            return esc(value);
          };
    let text = safe(label == null ? '' : String(label));

    let className = String(opts.className || 'badge').trim();
    let styleParts = [];
    if (opts.fontSize) styleParts.push('font-size:' + String(opts.fontSize));
    if (opts.padding) styleParts.push('padding:' + String(opts.padding));
    if (opts.maxWidth) styleParts.push('max-width:' + String(opts.maxWidth));
    if (opts.whiteSpace) styleParts.push('white-space:' + String(opts.whiteSpace));
    if (opts.overflowWrap) {
      styleParts.push('overflow-wrap:' + String(opts.overflowWrap));
    }
    if (opts.lineHeight) styleParts.push('line-height:' + String(opts.lineHeight));

    let normalized = normalizeHexColor(color);
    if (!normalized) {
      if (opts.noColorClassName) {
        className = String(opts.noColorClassName);
      }
      if (opts.noColorStyle) styleParts.push(String(opts.noColorStyle));
      return (
        '<span class="' + className + '" style="' + styleParts.join(';') + '">' +
        text +
        '</span>'
      );
    }

    styleParts.push('background:' + safe(normalized));
    styleParts.push(
      'color:' +
        safe(getTextColorForHexBackground(normalized, opts.contrastThreshold))
    );

    return (
      '<span class="' + className + '" style="' + styleParts.join(';') + '">' +
      text +
      '</span>'
    );
  }

  function getSemanticBadgeClass(tone, variant) {
    let t = String(tone || 'secondary').trim().toLowerCase();
    let v = String(variant || 'subtle').trim().toLowerCase();

    if (v === 'solid') {
      let solid = {
        primary: 'bg-primary text-white',
        secondary: 'bg-secondary text-light',
        success: 'bg-success text-white',
        warning: 'bg-warning text-dark',
        danger: 'bg-danger text-white',
        info: 'bg-info text-dark',
        light: 'bg-light text-dark',
        dark: 'bg-dark text-white',
      };
      return solid[t] || solid.secondary;
    }

    let subtle = {
      primary: 'bg-primary-subtle text-primary border border-primary-subtle',
      secondary: 'bg-secondary-subtle text-secondary border border-secondary-subtle',
      success: 'bg-success-subtle text-success border border-success-subtle',
      warning: 'bg-warning-subtle text-warning border border-warning-subtle',
      danger: 'bg-danger-subtle text-danger border border-danger-subtle',
      info: 'bg-info-subtle text-info border border-info-subtle',
      light: 'bg-light text-dark border',
      dark: 'bg-dark-subtle text-dark border border-dark-subtle',
    };
    return subtle[t] || subtle.secondary;
  }

  function renderSemanticBadgeHtml(label, tone, options) {
    let opts = options || {};
    let safe =
      typeof opts.escapeHtmlFn === 'function'
        ? opts.escapeHtmlFn
        : function (value) {
            return esc(value);
          };
    let text = safe(label == null ? '' : String(label));

    let className =
      'badge ' + getSemanticBadgeClass(tone, opts.variant || 'subtle');
    if (opts.className) {
      className += ' ' + String(opts.className);
    }

    let styleParts = [];
    if (opts.fontSize) styleParts.push('font-size:' + String(opts.fontSize));
    if (opts.padding) styleParts.push('padding:' + String(opts.padding));
    if (opts.maxWidth) styleParts.push('max-width:' + String(opts.maxWidth));
    if (opts.whiteSpace) styleParts.push('white-space:' + String(opts.whiteSpace));
    if (opts.overflowWrap) {
      styleParts.push('overflow-wrap:' + String(opts.overflowWrap));
    }
    if (opts.lineHeight) styleParts.push('line-height:' + String(opts.lineHeight));
    if (opts.cursor) styleParts.push('cursor:' + String(opts.cursor));

    let titleAttr = '';
    if (opts.title) {
      titleAttr = ' title="' + safe(String(opts.title)) + '"';
    }

    return (
      '<span class="' + className.trim() + '" style="' + styleParts.join(';') + '"' + titleAttr + '>' +
      text +
      '</span>'
    );
  }

  function pdfHexToRgb(hex, fallback) {
    let raw = String(hex || '').trim().replace('#', '');
    if (/^[0-9a-fA-F]{3}$/.test(raw)) {
      raw =
        raw.charAt(0) +
        raw.charAt(0) +
        raw.charAt(1) +
        raw.charAt(1) +
        raw.charAt(2) +
        raw.charAt(2);
    }
    if (!/^[0-9a-fA-F]{6}$/.test(raw)) return fallback;
    return [
      parseInt(raw.slice(0, 2), 16),
      parseInt(raw.slice(2, 4), 16),
      parseInt(raw.slice(4, 6), 16),
    ];
  }

  function drawPdfBadgeFlow(doc, badges, options) {
    if (!doc || typeof doc.getTextWidth !== 'function') {
      return { endY: Number(options && options.y) || 0 };
    }

    let opts = options || {};
    let xStart = Number(opts.x);
    if (!Number.isFinite(xStart)) xStart = 14;
    let y = Number(opts.y);
    if (!Number.isFinite(y)) y = 20;
    let x = xStart;
    let maxX = Number(opts.maxX);
    if (!Number.isFinite(maxX)) maxX = 196;
    let badgeH = Number(opts.badgeHeight);
    if (!Number.isFinite(badgeH)) badgeH = 6;
    let gapX = Number(opts.gapX);
    if (!Number.isFinite(gapX)) gapX = 1.5;
    let lineGap = Number(opts.lineGap);
    if (!Number.isFinite(lineGap)) lineGap = 2;
    let padX = Number(opts.padX);
    if (!Number.isFinite(padX)) padX = 1.8;
    let radius = Number(opts.radius);
    if (!Number.isFinite(radius)) radius = 1.2;
    let fontSize = Number(opts.fontSize);
    if (!Number.isFinite(fontSize)) fontSize = 8;

    let rows = Array.isArray(badges) && badges.length
      ? badges
      : [
          {
            label: String(opts.emptyLabel || '-'),
            bg: '#e9ecef',
            fg: '#212529',
          },
        ];

    rows.forEach(function (badge) {
      let label = String((badge && badge.label) || '-');
      doc.setFontSize(fontSize);
      let textW = doc.getTextWidth(label);
      let badgeW = textW + padX * 2;

      if (x + badgeW > maxX) {
        x = xStart;
        y += badgeH + lineGap;
      }

      let bgRgb = pdfHexToRgb(badge && badge.bg, [233, 236, 239]);
      let fgRgb = pdfHexToRgb(badge && badge.fg, [33, 37, 41]);
      doc.setFillColor(bgRgb[0], bgRgb[1], bgRgb[2]);
      doc.roundedRect(x, y - 4.6, badgeW, badgeH, radius, radius, 'F');
      doc.setTextColor(fgRgb[0], fgRgb[1], fgRgb[2]);
      doc.text(label, x + padX, y);
      x += badgeW + gapX;
    });

    return { endY: y + badgeH };
  }

  function getRequisitoPctBadgeColors(pct) {
    if (pct == null || !Number.isFinite(Number(pct))) {
      return { bg: '#6c757d', fg: '#fff' };
    }
    let value = Math.max(0, Math.min(100, Math.round(Number(pct))));
    if (value === 100) return { bg: '#198754', fg: '#fff' };
    if (value > 49) return { bg: '#f59e0b', fg: '#111' };
    return { bg: '#dc3545', fg: '#fff' };
  }

  function getRequisitosDetalleVisible(rowData) {
    let detalle = Array.isArray(rowData && rowData.requisitos_detalle_pct)
      ? rowData.requisitos_detalle_pct
      : [];
    return detalle.filter(function (item) {
      let objetivo = Number(item && item.objetivo_total ? item.objetivo_total : 0);
      let completado = Number(item && item.completado_total ? item.completado_total : 0);
      return objetivo > 0 || completado > 0;
    });
  }

  function buildRequisitosResumenTexto(rowData) {
    let detalle = getRequisitosDetalleVisible(rowData || {});
    if (!detalle.length) return 'Sin requisitos';
    return detalle
      .map(function (item) {
        let tipo = String(
          item && (item.tipo || item.plantilla_nombre)
            ? item.tipo || item.plantilla_nombre
            : 'Requisito'
        ).trim();
        let pctVal =
          item && item.pct != null && Number.isFinite(Number(item.pct))
            ? Math.max(0, Math.min(100, Math.round(Number(item.pct))))
            : null;
        return tipo + ': ' + (pctVal == null ? '-' : String(pctVal) + '%');
      })
      .join(' | ');
  }

  function formatRequisitosEstado(estado) {
    let s = String(estado || '').trim().toLowerCase();
    if (s === 'cumple' || s === 'cumplido') return 'Cumplido';
    if (s === 'en_progreso') return 'En progreso';
    if (s === 'vencido') return 'Vencido';
    if (s === 'sin_objetivo') return 'Sin objetivo';
    if (s === 'sancionado') return 'Sancionado';
    return 'Sin estado';
  }

  function buildRequisitosTooltip(rowData) {
    if (!rowData) return 'Sin requisitos';
    let objetivo = Number(rowData.requisitos_objetivo_total || 0);
    let completado = Number(rowData.requisitos_completado_total || 0);
    let pct =
      rowData.requisitos_pct == null || !Number.isFinite(Number(rowData.requisitos_pct))
        ? null
        : Number(rowData.requisitos_pct);
    let lines = [];
    lines.push(
      'Cumplimiento global: ' +
        (pct == null ? '-' : String(Math.round(pct)) + '%') +
        ' (' +
        String(completado) +
        '/' +
        String(objetivo) +
        ')'
    );

    let detalle = getRequisitosDetalleVisible(rowData);
    if (!detalle.length) {
      lines.push('Sin requisitos');
      return lines.join('\n');
    }

    detalle.forEach(function (item) {
      let tipo = String(
        item && (item.tipo || item.plantilla_nombre)
          ? item.tipo || item.plantilla_nombre
          : 'Requisito'
      ).trim();
      let detComp = Number(item && item.completado_total ? item.completado_total : 0);
      let detObj = Number(item && item.objetivo_total ? item.objetivo_total : 0);
      let detPct =
        item && item.pct != null && Number.isFinite(Number(item.pct))
          ? String(Math.round(Number(item.pct))) + '%'
          : '-';
      let estado = formatRequisitosEstado(item && item.estado);
      lines.push(
        '- ' +
          tipo +
          ': ' +
          String(detComp) +
          '/' +
          String(detObj) +
          ' (' +
          detPct +
          ') - ' +
          estado
      );
    });

    return lines.join('\n');
  }

  function renderRequisitosBadgesHtml(rowData, escapeHtmlFn) {
    let detalle = getRequisitosDetalleVisible(rowData || {});
    if (!detalle.length) return '';
    let safe =
      typeof escapeHtmlFn === 'function'
        ? escapeHtmlFn
        : function (value) {
            return esc(value);
          };
    return detalle
      .map(function (item) {
        let tipo = String(
          item && (item.tipo || item.plantilla_nombre)
            ? item.tipo || item.plantilla_nombre
            : 'Requisito'
        ).trim();
        let pctVal =
          item && item.pct != null && Number.isFinite(Number(item.pct))
            ? Math.max(0, Math.min(100, Math.round(Number(item.pct))))
            : null;
        let c = getRequisitoPctBadgeColors(pctVal);
        let label = safe(tipo) + ': ' + (pctVal == null ? '-' : String(pctVal) + '%');
        return (
          '<span class="badge rounded-pill me-1 mb-1" style="background:' +
          c.bg +
          ';color:' +
          c.fg +
          ';font-weight:600;">' +
          label +
          '</span>'
        );
      })
      .join('');
  }

  // @ts-ignore
  window.GRS1TabulatorLangs = TABULATOR_LANGS;
  // @ts-ignore
  window.GRS1Utils = {
    sameValue: sameValue,
    cloneRows: cloneRows,
    esc: esc,
    isConsultaReadOnlyRole: isConsultaReadOnlyRole,
    disableElementsById: disableElementsById,
    normalizeHexColor: normalizeHexColor,
    getTextColorForHexBackground: getTextColorForHexBackground,
    renderColorBadgeHtml: renderColorBadgeHtml,
    getSemanticBadgeClass: getSemanticBadgeClass,
    renderSemanticBadgeHtml: renderSemanticBadgeHtml,
    pdfHexToRgb: pdfHexToRgb,
    drawPdfBadgeFlow: drawPdfBadgeFlow,
    getRequisitoPctBadgeColors: getRequisitoPctBadgeColors,
    getRequisitosDetalleVisible: getRequisitosDetalleVisible,
    buildRequisitosResumenTexto: buildRequisitosResumenTexto,
    formatRequisitosEstado: formatRequisitosEstado,
    buildRequisitosTooltip: buildRequisitosTooltip,
    renderRequisitosBadgesHtml: renderRequisitosBadgesHtml,
  };
})();
