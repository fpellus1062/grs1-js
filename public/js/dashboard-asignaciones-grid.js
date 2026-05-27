/* ========================================================================
 *  dashboard-asignaciones-grid.js
 *  KPIs, resumen del cuadrante y renderizado Tabulator.
 * ======================================================================== */
(function () {
  let app = window.GRS1Dashboard;
  let _ = app._asig || {};
  // @ts-ignore
  let qbe = window.GRS1TabulatorQbe || null;
  _.tabulatorReady = _.tabulatorReady === true;
  _.pendingAdvancedFilters = _.pendingAdvancedFilters === true;

  // Menu contextual para celdas de actividad/servicio
  document.addEventListener("click", () => {
    const menu =
        document.getElementById("custom-context-menu");
    if (menu) {
        menu.remove();
    }
});
  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function getPlanningDaysSafe(anio, mes) {
    if (typeof _.getPlanningWindow !== 'function') return [];
    return asArray(_.getPlanningWindow(anio, mes));
  }

  function buildServiciosMapSafe(rows, keyField) {
    if (typeof _.buildServiciosMap !== 'function') return new Map();
    let map = _.buildServiciosMap(rows, keyField);
    return map instanceof Map ? map : new Map();
  }

  function getAsigGridPlaceholderHtml() {
    return (
      '<div class="text-center text-muted py-4 px-3">' +
      '<i class="bi bi-grid-3x3-gap d-block fs-1 opacity-25 mb-2"></i>' +
      'No hay servicios para el período seleccionado.<br/>' +
      '<small>Selecciona un cuadrante / borrador para cargar el calendario de asignaciones.</small>' +
      '</div>'
    );
  }

  function buildActividadGrupoColorMaps() {
    let actividades =
      (app.asignacionesState.meta && app.asignacionesState.meta.actividades) ||
      [];
    let actividadToGrupo = new Map();
    let actividadToNivel = new Map();
    let actividadToTooltip = new Map();
    let actividadToCodigo = new Map();
    let actividadToNombre = new Map();
    let actividadToSortNivel = new Map();
    let actividadToColor = new Map();
    let nivelToColor = new Map();
    let grupoToColor = new Map();
    let palette = [
      '#1f6feb',
      '#0f766e',
      '#b45309',
      '#7c3aed',
      '#be123c',
      '#0369a1',
      '#166534',
      '#a16207',
      '#9f1239',
      '#5b21b6',
      '#334155',
      '#374151',
    ];

    function normalizeCssColor(value) {
      let raw = String(value || '').trim();
      if (!raw) return '';
      if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
      if (/^[0-9a-fA-F]{6}$/.test(raw)) return '#' + raw;
      return /^#[0-9a-fA-F]{3}$/.test(raw) ? raw : '';
    }

    actividades.forEach(function (a) {
      let actId = Number(a.id_actividad);
      if (!actId) return;
      let grupoId = Number(a.grupo_id);
      let nivelNombre = String(a.nivel_grupo_nombre || '').trim();
      let nivelOrdenRaw = Number(a.nivel_grupo_orden);
      let nivelOrden = Number.isFinite(nivelOrdenRaw) ? nivelOrdenRaw : 9999;
      let grupoNombre = String(a.grupo_nombre || '').trim();
      let grupoColor = normalizeCssColor(a.grupo_color);
      let grupoKey =
        grupoNombre || (grupoId ? 'Grupo ' + String(grupoId) : 'Sin grupo');
      let nivelColor = normalizeCssColor(a.nivel_grupo_color);
      let codigo = String(a.codigo || '').trim();
      let nombre = String(a.nombre || '').trim();
      let actividadLabel =
        codigo && nombre
          ? codigo + ' - ' + nombre
          : codigo || nombre || 'Actividad #' + String(actId);
      let jerarquiaLabel = [
        nivelNombre || 'Sin nivel',
        grupoNombre || 'Sin grupo',
        actividadLabel,
      ].join(' > ');

      actividadToGrupo.set(actId, grupoKey);
      actividadToNivel.set(actId, nivelNombre || 'Sin nivel');
      actividadToSortNivel.set(actId, nivelOrden);
      actividadToTooltip.set(actId, jerarquiaLabel);
      actividadToCodigo.set(actId, codigo);
      actividadToNombre.set(actId, nombre);

      let actOwnColor = normalizeCssColor(a.actividad_color || '');
      if (!actividadToColor.has(actId)) {
        if (actOwnColor) {
          actividadToColor.set(actId, actOwnColor);
        } else {
          let actIdx = Number.isFinite(actId)
            ? Math.abs(actId + 3) % palette.length
            : Math.abs(actividadLabel.length) % palette.length;
          actividadToColor.set(actId, palette[actIdx] || '#6c757d');
        }
      }

      let nivelKey = nivelNombre || 'Sin nivel';
      if (!nivelToColor.has(nivelKey)) {
        if (nivelColor) {
          nivelToColor.set(nivelKey, nivelColor);
        } else {
          let nivelIdx = Number.isFinite(nivelOrden)
            ? Math.abs(nivelOrden + 7) % palette.length
            : Math.abs(nivelKey.length) % palette.length;
          nivelToColor.set(nivelKey, palette[nivelIdx] || '#6c757d');
        }
      }

      if (!grupoToColor.has(grupoKey)) {
        if (grupoColor) {
          grupoToColor.set(grupoKey, grupoColor);
        } else {
          let idx =
            grupoId && Number.isFinite(grupoId)
              ? Math.abs(grupoId) % palette.length
              : Math.abs(grupoKey.length) % palette.length;
          grupoToColor.set(grupoKey, palette[idx] || '#6c757d');
        }
      }
    });

    return {
      actividadToGrupo: actividadToGrupo,
      actividadToNivel: actividadToNivel,
      actividadToTooltip: actividadToTooltip,
      actividadToCodigo: actividadToCodigo,
      actividadToNombre: actividadToNombre,
      actividadToSortNivel: actividadToSortNivel,
      actividadToColor: actividadToColor,
      nivelToColor: nivelToColor,
      grupoToColor: grupoToColor,
    };
  }

  function getTextColorForBackground(hexColor) {
    let hex = String(hexColor || '').replace('#', '');
    if (hex.length !== 6) return '#fff';
    let r = parseInt(hex.slice(0, 2), 16);
    let g = parseInt(hex.slice(2, 4), 16);
    let b = parseInt(hex.slice(4, 6), 16);
    if (
      [r, g, b].some(function (n) {
        return Number.isNaN(n);
      })
    )
      return '#fff';
    let luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    return luminance > 160 ? '#111' : '#fff';
  }

  function getAsigColumnFilterDefaults() {
    return {
      tip: '',
      nombre: '',
      peloton_codigo: '',
      requisitos_pct: '',
      orden_gc: '',
      devengo: '',
    };
  }

  function normalizeAsigColumnFilterState(raw) {
    let defaults = getAsigColumnFilterDefaults();
    let src = raw && typeof raw === 'object' ? raw : {};

    // Compatibilidad con clave antigua "agente".
    if (
      !Object.prototype.hasOwnProperty.call(src, 'nombre') &&
      Object.prototype.hasOwnProperty.call(src, 'agente')
    ) {
      src.nombre = src.agente;
    }

    Object.keys(defaults).forEach(function (k) {
      defaults[k] = String(src[k] || '').trim();
    });

    return defaults;
  }

  function ensureAsigColumnFiltersState() {
    app.asignacionesState.columnFilters = normalizeAsigColumnFilterState(
      app.asignacionesState.columnFilters
    );
    return app.asignacionesState.columnFilters;
  }

  function asigHasColumn(field) {
    if (!_.tabulator || typeof _.tabulator.getColumns !== 'function') {
      return false;
    }
    let cols = _.tabulator.getColumns() || [];
    return cols.some(function (col) {
      return (
        col &&
        typeof col.getField === 'function' &&
        String(col.getField() || '') === String(field || '')
      );
    });
  }

  function parseQbeExpression(rawValue) {
    if (qbe && typeof qbe.parseExpression === 'function') {
      return qbe.parseExpression(rawValue);
    }
    let input = String(rawValue || '').trim();
    if (!input) return null;

    // Soporte ergonomico: "texto$" equivale a "$texto" (termina en)
    if (input.length > 1 && input.slice(-1) === '$' && input.slice(0, 1) !== '$') {
      return { op: '$', value: input.slice(0, -1).trim() };
    }

    let twoCharOp = input.slice(0, 2);
    let oneCharOp = input.slice(0, 1);

    if (twoCharOp === '>=' || twoCharOp === '<=' || twoCharOp === '!=') {
      return { op: twoCharOp, value: input.slice(2).trim() };
    }

    if (
      oneCharOp === '=' ||
      oneCharOp === '>' ||
      oneCharOp === '<' ||
      oneCharOp === '^' ||
      oneCharOp === '$' ||
      oneCharOp === '*' ||
      oneCharOp === '~' ||
      oneCharOp === '!'
    ) {
      return { op: oneCharOp, value: input.slice(1).trim() };
    }

    return { op: 'contains', value: input };
  }

  function matchesTextQbe(rowValue, expression) {
    if (qbe && typeof qbe.matchesText === 'function') {
      return qbe.matchesText(rowValue, expression, _.normalizeSearchText);
    }
    if (!expression || !expression.value) return true;
    let left = _.normalizeSearchText(String(rowValue == null ? '' : rowValue));
    let right = _.normalizeSearchText(expression.value);
    if (!right) return true;

    if (expression.op === '=') return left === right;
    if (expression.op === '!=') return left !== right;
    if (expression.op === '^') return left.indexOf(right) === 0;
    if (expression.op === '$')
      return left.lastIndexOf(right) === left.length - right.length;
    if (expression.op === '!') return left.indexOf(right) === -1;
    if (expression.op === '*') return left.indexOf(right) !== -1;
    return left.indexOf(right) !== -1;
  }

  function matchesNumberQbe(rowValue, expression) {
    if (qbe && typeof qbe.matchesNumber === 'function') {
      return qbe.matchesNumber(rowValue, expression);
    }
    if (!expression || !expression.value) return true;
    let left = Number(
      String(rowValue == null ? '' : rowValue)
        .trim()
        .replace(',', '.')
    );
    let right = Number(String(expression.value).trim().replace(',', '.'));
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;

    if (expression.op === '=') return left === right;
    if (expression.op === '!=') return left !== right;
    if (expression.op === '>') return left > right;
    if (expression.op === '>=') return left >= right;
    if (expression.op === '<') return left < right;
    if (expression.op === '<=') return left <= right;
    return String(left).indexOf(String(right)) !== -1;
  }

  function doesRowMatchAsigQbe(rowData, qbeFilters) {
    let filters = normalizeAsigColumnFilterState(qbeFilters);
    let textFields = ['tip', 'nombre', 'peloton_codigo'];

    for (let i = 0; i < textFields.length; i += 1) {
      let key = textFields[i];
      let expr = parseQbeExpression(filters[key]);
      if (!matchesTextQbe(rowData && rowData[key], expr)) return false;
    }

    let ordenExpr = parseQbeExpression(filters.orden_gc);
    if (!matchesNumberQbe(rowData && rowData.orden_gc, ordenExpr)) {
      // Fallback textual para no romper comportamiento antiguo cuando no sea numérico.
      if (!matchesTextQbe(rowData && rowData.orden_gc, ordenExpr)) return false;
    }

    let devengoExpr = parseQbeExpression(filters.devengo);
    if (!matchesNumberQbe(rowData && rowData.devengo, devengoExpr)) {
      return false;
    }

    let reqExpr = parseQbeExpression(filters.requisitos_pct);
    if (!matchesNumberQbe(rowData && rowData.requisitos_pct, reqExpr)) {
      return false;
    }

    return true;
  }

  function buildAsigRowSearchableText(rowData) {
    if (!rowData) return '';
    let searchable = [
      rowData.tip,
      rowData.nombre,
      rowData.empleo_nombre,
      rowData.peloton_codigo,
      String(rowData.orden_gc || ''),
      rowData.situacion,
      Array.isArray(rowData.aptitudes)
        ? rowData.aptitudes.join(' ')
        : rowData.aptitudes || '',
      rowData.comentarios,
    ].join(' ');

    Object.keys(rowData)
      .filter(function (k) {
        return k.indexOf('dia_') === 0;
      })
      .forEach(function (k) {
        let d = rowData[k];
        if (!d) return;
        searchable +=
          ' ' +
          (d.turnoLabel || '') +
          ' ' +
          (d.servicios || [])
            .map(function (s) {
              return s.label || '';
            })
            .join(' ') +
          ' ' +
          (d.observaciones || '');
      });

    return searchable;
  }

  function getRequisitoPctBadgeColors(pct) {
    return window.GRS1Utils.getRequisitoPctBadgeColors(pct);
  }

  function getRequisitosDetalleVisible(rowData) {
    return window.GRS1Utils.getRequisitosDetalleVisible(rowData);
  }

  function getAsigSelectedActividadIdsSet() {
    let src = app.asignacionesState.selectedActividadIds;
    if (!Array.isArray(src) || !src.length) return new Set();
    let out = new Set();
    src.forEach(function (id) {
      let n = Number(id);
      if (Number.isFinite(n) && n > 0) out.add(n);
    });
    return out;
  }

  function getAsigFilterEmptyActividad() {
    let src = app.asignacionesState.selectedActividadIds;
    return Array.isArray(src) && src.indexOf(-1) !== -1;
  }

  function getAsigFilterHasActividad() {
    let src = app.asignacionesState.selectedActividadIds;
    return Array.isArray(src) && src.indexOf(-2) !== -1;
  }

  function getAsigActividadDateRange() {
    let inicio = String(app.asignacionesState.actividadFechaInicio || '').trim();
    let fin = String(app.asignacionesState.actividadFechaFin || '').trim();
    let valid = function (value) {
      return /^\d{4}-\d{2}-\d{2}$/.test(value);
    };
    if (!valid(inicio)) inicio = '';
    if (!valid(fin)) fin = '';
    if (inicio && fin && inicio > fin) {
      let tmp = inicio;
      inicio = fin;
      fin = tmp;
    }
    return { inicio: inicio, fin: fin };
  }

  function rowMatchesSelectedActividades(
    rowData,
    selectedActividadIds,
    filterEmpty,
    filterHasActividad,
    dateRange
  ) {
    let positiveFilterActive = selectedActividadIds && selectedActividadIds.size > 0;
    let range = dateRange && typeof dateRange === 'object' ? dateRange : {};
    let from = String(range.inicio || '');
    let to = String(range.fin || '');
    let hasDateRange = !!(from || to);

    if (!positiveFilterActive && !filterEmpty && !filterHasActividad && !hasDateRange)
      return true;
    if (!rowData || typeof rowData !== 'object') return false;

    let dayFields = Object.keys(rowData).filter(function (k) {
      return k.indexOf('dia_') === 0;
    });

    if (from || to) {
      dayFields = dayFields.filter(function (k) {
        let dateKey = String(k).slice(4, 14);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
        if (from && dateKey < from) return false;
        if (to && dateKey > to) return false;
        return true;
      });
    }

    if (!dayFields.length) return false;

    let hasSomeDayWithActividad = dayFields.some(function (k) {
      let cell = rowData[k];
      if (!cell) return false;
      let acts = Array.isArray(cell.actividad_ids) ? cell.actividad_ids : [];
      let servs = Array.isArray(cell.servicios) ? cell.servicios : [];
      return acts.length > 0 || servs.length > 0;
    });

    if (filterHasActividad && hasSomeDayWithActividad) return true;

    if (filterEmpty) {
      // Fila con al menos un día sin actividad en el periodo
      let hasSomeDayWithoutActividad = dayFields.some(function (k) {
        let cell = rowData[k];
        if (!cell) return true;
        let acts = Array.isArray(cell.actividad_ids) ? cell.actividad_ids : [];
        let servs = Array.isArray(cell.servicios) ? cell.servicios : [];
        return acts.length === 0 && servs.length === 0;
      });
      if (hasSomeDayWithoutActividad || dayFields.length === 0) return true;
    }

    if (!positiveFilterActive && !filterEmpty && !filterHasActividad && hasDateRange) {
      return hasSomeDayWithActividad;
    }

    if (!positiveFilterActive) return false;

    for (let i = 0; i < dayFields.length; i += 1) {
      let cell = rowData[dayFields[i]];
      if (!cell) continue;

      let actividadIds = Array.isArray(cell.actividad_ids) ? cell.actividad_ids : [];
      for (let j = 0; j < actividadIds.length; j += 1) {
        let actId = Number(actividadIds[j]);
        if (selectedActividadIds.has(actId)) return true;
      }

      let servicios = Array.isArray(cell.servicios) ? cell.servicios : [];
      for (let k = 0; k < servicios.length; k += 1) {
        let actId = Number(servicios[k] && servicios[k].id);
        if (selectedActividadIds.has(actId)) return true;
      }
    }

    return false;
  }

  function applyAsigAdvancedFilters() {
    if (!_.tabulator) return;
    if (!_.tabulatorReady) {
      _.pendingAdvancedFilters = true;
      return;
    }

    let qbeFilters = ensureAsigColumnFiltersState();
    let searchTerm = _.normalizeSearchText(
      app.asignacionesState.searchTerm || ''
    );
    let selectedActividadIds = getAsigSelectedActividadIdsSet();
    let filterEmptyActividad = getAsigFilterEmptyActividad();
    let filterHasActividad = getAsigFilterHasActividad();
    let actividadDateRange = getAsigActividadDateRange();
    let hasDateRange = !!(actividadDateRange.inicio || actividadDateRange.fin);
    let hasActividadFilters =
      selectedActividadIds.size > 0 || filterEmptyActividad || filterHasActividad || hasDateRange;
    let hasQbeFilters = Object.keys(qbeFilters).some(function (k) {
      return qbeFilters[k] !== '';
    });

    if (!hasQbeFilters && !searchTerm && !hasActividadFilters) {
      _.tabulator.clearFilter();
      return;
    }

    _.tabulator.setFilter(function (rowData) {
      if (
        hasActividadFilters &&
        !rowMatchesSelectedActividades(
          rowData,
          selectedActividadIds,
          filterEmptyActividad,
          filterHasActividad,
          actividadDateRange
        )
      ) {
        return false;
      }
      if (hasQbeFilters && !doesRowMatchAsigQbe(rowData, qbeFilters))
        return false;
      if (!searchTerm) return true;
      return (
        _.normalizeSearchText(buildAsigRowSearchableText(rowData)).indexOf(
          searchTerm
        ) !== -1
      );
    });
  }

  function syncAsigColumnFiltersFromHeader() {
    if (!_.tabulator || typeof _.tabulator.getHeaderFilters !== 'function')
      return;
    let next = getAsigColumnFilterDefaults();
    let headerFilters = _.tabulator.getHeaderFilters() || [];

    headerFilters.forEach(function (f) {
      if (!f || !Object.prototype.hasOwnProperty.call(next, f.field)) return;
      if (!asigHasColumn(f.field)) return;

      next[f.field] = String(f.value || '').trim();
    });

    app.asignacionesState.columnFilters = next;
  }

  function restoreAsigHeaderFiltersFromState() {
    if (!_.tabulator || typeof _.tabulator.setHeaderFilterValue !== 'function')
      return;
    let filters = ensureAsigColumnFiltersState();

    Object.keys(filters).forEach(function (field) {
      let value = filters[field];
      if (!asigHasColumn(field)) return;
      _.tabulator.setHeaderFilterValue(field, value === '' ? '' : value);
    });
  }

  // ── KPIs ────────────────────────────────────────────────────────

  function countAgentesFiltrados() {
    if (typeof app.asignacionesState._agentesFiltradosCount === 'number') {
      return app.asignacionesState._agentesFiltradosCount;
    }
    if (!_.tabulator || typeof _.tabulator.getRows !== 'function') return 0;
    return _.tabulator.getRows('active').length;
  }

  function countAgentesConCuadranteCompleto(data, anio, mes) {
    if (!data || !anio || !mes) return 0;
    let planningDays = getPlanningDaysSafe(anio, mes);
    let totalDays = planningDays.length;
    if (!totalDays) return 0;

    let dayKeys = new Set(
      planningDays.map(function (d) {
        return d.key;
      })
    );
    let isBorrador = !!(
      data.control &&
      data.control.borrador_id &&
      data.control.estado !== 'sin_borrador'
    );
    let sourceRows = isBorrador ? data.borrador || [] : data.definitivo || [];

    let assignedByAgente = new Map();
    sourceRows.forEach(function (r) {
      let agenteId = _.normalizeAgenteId(r.agente_id);
      let fecha = r.fecha
        ? String(r.fecha).slice(0, 10)
        : String(r.anio) +
          '-' +
          String(r.mes).padStart(2, '0') +
          '-' +
          String(r.dia).padStart(2, '0');
      if (!dayKeys.has(fecha)) return;
      if (!assignedByAgente.has(agenteId))
        assignedByAgente.set(agenteId, new Set());
      assignedByAgente.get(agenteId).add(fecha);
    });

    let agentesMeta =
      (app.asignacionesState.meta && app.asignacionesState.meta.agentes) || [];
    let agenteIds = agentesMeta.length
      ? agentesMeta.map(function (a) {
          return _.normalizeAgenteId(a.id_agente);
        })
      : Array.from(assignedByAgente.keys());

    let completos = 0;
    agenteIds.forEach(function (agenteId) {
      let fechas = assignedByAgente.get(agenteId);
      if (fechas && fechas.size === totalDays) completos += 1;
    });
    return completos;
  }

  function countAppliedTurnosYServicios(data, anio, mes) {
    if (!data || !anio || !mes)
      return { turnosAplicados: 0, serviciosAplicados: 0 };
    let planningDays = getPlanningDaysSafe(anio, mes);
    if (!planningDays.length)
      return { turnosAplicados: 0, serviciosAplicados: 0 };

    let dayKeys = new Set(
      planningDays.map(function (d) {
        return d.key;
      })
    );
    let isBorrador = !!(
      data.control &&
      data.control.borrador_id &&
      data.control.estado !== 'sin_borrador'
    );
    let sourceRows = isBorrador ? data.borrador || [] : data.definitivo || [];
    let serviciosByAsig = isBorrador
      ? buildServiciosMapSafe(data.borradorServicios, 'asignacion_borrador_id')
      : buildServiciosMapSafe(data.definitivoServicios, 'asignacion_id');

    let usedTurnos = new Set();
    let usedServicios = new Set();
    sourceRows.forEach(function (r) {
      let fecha = r.fecha
        ? String(r.fecha).slice(0, 10)
        : String(r.anio) +
          '-' +
          String(r.mes).padStart(2, '0') +
          '-' +
          String(r.dia).padStart(2, '0');
      if (!dayKeys.has(fecha)) return;
      let turnoId = Number(r.turno_id);
      if (turnoId) usedTurnos.add(turnoId);

      let servicios = serviciosByAsig.get(Number(r.id)) || [];
      if (servicios.length) {
        servicios.forEach(function (s) {
          let id = Number(s.id);
          if (id) usedServicios.add(id);
        });
        return;
      }
      (Array.isArray(r.actividad_ids) ? r.actividad_ids : []).forEach(
        function (id) {
          let n = Number(id);
          if (n) usedServicios.add(n);
        }
      );
      (Array.isArray(r.servicios) ? r.servicios : []).forEach(function (s) {
        let n = Number(s && (s.actividad_id || s.id));
        if (n) usedServicios.add(n);
      });
    });
    return {
      turnosAplicados: usedTurnos.size,
      serviciosAplicados: usedServicios.size,
    };
  }

  // ── Resumen meta ────────────────────────────────────────────────

  function buildServiciosPorNivel(data, anio, mes) {
    if (!data || !anio || !mes) return [];
    let planningDays = getPlanningDaysSafe(anio, mes);
    if (!planningDays.length) return [];

    let dayKeys = new Set(
      planningDays.map(function (d) {
        return d.key;
      })
    );
    let isBorrador = !!(
      data.control &&
      data.control.borrador_id &&
      data.control.estado !== 'sin_borrador'
    );
    let sourceRows = isBorrador ? data.borrador || [] : data.definitivo || [];
    let serviciosByAsig = isBorrador
      ? buildServiciosMapSafe(data.borradorServicios, 'asignacion_borrador_id')
      : buildServiciosMapSafe(data.definitivoServicios, 'asignacion_id');

    let maps = buildActividadGrupoColorMaps();
    // nivelAgentes: nivel -> Set de "agente_id|actividad_id" únicos
    let nivelAgentes = new Map();

    sourceRows.forEach(function (r) {
      let fecha = r.fecha
        ? String(r.fecha).slice(0, 10)
        : String(r.anio) +
          '-' +
          String(r.mes).padStart(2, '0') +
          '-' +
          String(r.dia).padStart(2, '0');
      if (!dayKeys.has(fecha)) return;

      let agenteId = String(r.agente_id || r.id_agente || '');
      let actividadIds = [];
      let servicios = serviciosByAsig.get(Number(r.id)) || [];
      if (servicios.length) {
        servicios.forEach(function (s) {
          let id = Number(s.id);
          if (id) actividadIds.push(id);
        });
      } else {
        (Array.isArray(r.actividad_ids) ? r.actividad_ids : []).forEach(
          function (id) {
            let n = Number(id);
            if (n) actividadIds.push(n);
          }
        );
        (Array.isArray(r.servicios) ? r.servicios : []).forEach(function (s) {
          let n = Number(s && (s.actividad_id || s.id));
          if (n) actividadIds.push(n);
        });
      }

      actividadIds.forEach(function (actId) {
        let nivel = maps.actividadToNivel.get(actId) || 'Sin nivel';
        let color = maps.nivelToColor.get(nivel) || '#6c757d';
        let orden = maps.actividadToSortNivel.get(actId);
        if (!nivelAgentes.has(nivel)) {
          nivelAgentes.set(nivel, {
            color: color,
            orden: Number.isFinite(orden) ? orden : 9999,
            pares: new Set(),
          });
        }
        nivelAgentes.get(nivel).pares.add(agenteId + '|' + String(actId));
      });
    });

    let nivelMap = new Map();
    let total = 0;
    nivelAgentes.forEach(function (v, nivel) {
      let count = v.pares.size;
      nivelMap.set(nivel, { color: v.color, orden: v.orden, count: count });
      total += count;
    });

    let result = [];
    nivelMap.forEach(function (v, k) {
      result.push({
        nivelNombre: k,
        color: v.color,
        orden: v.orden,
        count: v.count,
        pct: total > 0 ? Math.round((v.count * 100) / total) : 0,
      });
    });
    result.sort(function (a, b) {
      return a.orden - b.orden;
    });
    return result;
  }

  function renderMetaResumen(meta, extras) {
    let el = document.getElementById('asigMetaResumen');
    if (!el) return;
    let safe = function (n) {
      return Number(n || 0);
    };
    let extra = extras || {};
    let totalAgentes = safe(meta && meta.agentes && meta.agentes.length);
    let agentesMarcados = safe(extra.agentesMarcados);
    let agentesFiltrados = safe(extra.agentesFiltrados);

    function renderSimpleCard(label, value) {
      return (
        '<div class="col"><div class="border rounded p-1 bg-light h-100">' +
        '<div class="text-muted" style="font-size:.68rem;line-height:1.1">' +
        app.escapeHtml(label) +
        '</div>' +
        '<div class="fw-semibold" style="font-size:.92rem;line-height:1.2">' +
        app.escapeHtml(String(value)) +
        '</div>' +
        '</div></div>'
      );
    }

    let nivelesData = extra.serviciosPorNivel || [];
    let nivelesHtml = '';
    if (nivelesData.length) {
      nivelesHtml = nivelesData
        .map(function (n) {
          let bg = n.color || '#6c757d';
          let fg = getTextColorForBackground(bg);
          return (
            '<span class="badge d-inline-flex align-items-center gap-1 me-1 mb-1" ' +
            'style="background:' +
            bg +
            ';color:' +
            fg +
            ';font-size:.63rem;font-weight:500;padding:.25em .45em;">' +
            app.escapeHtml(n.nivelNombre) +
            '<span class="badge rounded-pill" ' +
            'style="background:rgba(0,0,0,.22);font-size:.6rem;padding:.15em .4em;">' +
            n.pct +
            '%</span>' +
            '</span>'
          );
        })
        .join('');
    } else {
      nivelesHtml =
        '<span class="text-muted fw-semibold" style="font-size:.9rem;">' +
        safe(extra.serviciosAplicados) +
        '</span>';
    }

    let serviciosCard =
      '<div class="col-auto"><div class="border rounded p-1 bg-light h-100" style="min-width:110px;">' +
      '<div class="text-muted" style="font-size:.68rem;line-height:1.1">Servicios por nivel</div>' +
      '<div class="d-flex flex-wrap align-items-center" style="line-height:1.4;min-height:1.3rem;">' +
      nivelesHtml +
      '</div>' +
      '</div></div>';

    el.innerHTML =
      renderSimpleCard('Agentes / Marcados', totalAgentes + ' / ' + agentesMarcados) +
      renderSimpleCard('Filtrados', agentesFiltrados) +
      renderSimpleCard('C. Completo', safe(extra.agentesConCuadranteCompleto)) +
      serviciosCard +
      renderSimpleCard('Empleos', safe(meta && meta.empleos && meta.empleos.length)) +
      renderSimpleCard('Pelotones', safe(meta && meta.pelotones && meta.pelotones.length)) +
      renderSimpleCard('Situaciones', safe(meta && meta.situaciones && meta.situaciones.length));
  }

  function refreshMetaResumenFromState() {
    let meta = app.asignacionesState.meta || {};
    let extras = {
      agentesConCuadranteCompleto: 0,
      turnosAplicados: 0,
      serviciosAplicados: 0,
      agentesMarcados: (app.asignacionesState.selectedAgenteIdsVista || [])
        .length,
      agentesFiltrados: countAgentesFiltrados(),
    };
    if (
      app.asignacionesState.cuadrante &&
      app.asignacionesState.anio &&
      app.asignacionesState.mes
    ) {
      extras.agentesConCuadranteCompleto = countAgentesConCuadranteCompleto(
        app.asignacionesState.cuadrante,
        app.asignacionesState.anio,
        app.asignacionesState.mes
      );
      let applied = countAppliedTurnosYServicios(
        app.asignacionesState.cuadrante,
        app.asignacionesState.anio,
        app.asignacionesState.mes
      );
      extras.turnosAplicados = applied.turnosAplicados;
      extras.serviciosAplicados = applied.serviciosAplicados;
      extras.serviciosPorNivel = buildServiciosPorNivel(
        app.asignacionesState.cuadrante,
        app.asignacionesState.anio,
        app.asignacionesState.mes
      );
    }
    renderMetaResumen(meta, extras);
  }

  function renderEstado(control) {
    let el = document.getElementById('asignacionesEstadoPeriodo');
    if (!el) return;
    let estado =
      control && control.estado ? String(control.estado) : 'sin_borrador';
    el.className = 'badge border';
    if (estado === 'validado') {
      el.classList.add('bg-success-subtle', 'text-success-emphasis');
    } else if (estado === 'borrador' || estado === 'pendiente_validacion') {
      el.classList.add('bg-warning-subtle', 'text-warning-emphasis');
    } else {
      el.classList.add('bg-light', 'text-dark');
    }
    el.textContent = 'Estado: ' + estado;
  }

  // ── Renderizado Tabulator ───────────────────────────────────────

  function renderGridTabulator(data, anio, mes) {
    let container = document.getElementById('asigGridContainer');
    if (!container) return;

    if (_.tabulator) {
      _.tabulatorReady = false;
      _.tabulator.destroy();
      _.tabulator = null;
    }
    container.removeAttribute('style');

    // Verificar si hay agentes para esta ARS
    let metaAgentes =
      (app.asignacionesState.meta && app.asignacionesState.meta.agentes) || [];
    let hasData =
      metaAgentes.length > 0 ||
      (data.borrador && data.borrador.length) ||
      (data.definitivo && data.definitivo.length);
    if (!hasData) {
      let arsId = app.globalState.activeArsId || 'actual';
      let arsEntry = (app.globalState.arsCatalog || []).find(function (a) {
        return a.id_unidad === arsId;
      });
      let arsLabel = arsEntry
        ? arsEntry.id_unidad +
          (arsEntry.poblacion ? ' — ' + arsEntry.poblacion : '')
        : arsId;
      container.innerHTML =
        '<div class="text-center text-muted py-5">' +
        '<i class="bi bi-inbox" style="font-size:2.5rem;"></i>' +
        '<p class="mt-2 mb-0">No hay agentes asignados a la agrupación <strong>' +
        app.escapeHtml(arsLabel) +
        '</strong>.</p>' +
        '<p class="small">Asigna agentes a esta ARS desde la sección de Agentes o Configuración.</p>' +
        '</div>';
      _.refreshMetaResumenFromState();
      return;
    }

    let planningDays = getPlanningDaysSafe(anio, mes);
    app.asignacionesState.cuadranteDays = planningDays;

    let isBorrador = !!(
      data.control &&
      data.control.borrador_id &&
      data.control.estado !== 'sin_borrador'
    );
    let sourceRows = isBorrador ? data.borrador || [] : data.definitivo || [];
    let serviciosByAsig = isBorrador
      ? buildServiciosMapSafe(data.borradorServicios, 'asignacion_borrador_id')
      : buildServiciosMapSafe(data.definitivoServicios, 'asignacion_id');

    let actividadGrupoMaps = buildActividadGrupoColorMaps();

    let agentesMap = new Map();
    let requisitosByAgente =
      data && data.requisitosByAgente && typeof data.requisitosByAgente === 'object'
        ? data.requisitosByAgente
        : {};

    function getRequisitosResumenForAgente(agenteId) {
      let raw = requisitosByAgente[String(agenteId)] || requisitosByAgente[agenteId] || null;
      if (!raw || typeof raw !== 'object') {
        return {
          pct: null,
          completado_total: 0,
          objetivo_total: 0,
          detalle: [],
        };
      }
      return {
        pct:
          raw.pct == null || !Number.isFinite(Number(raw.pct))
            ? null
            : Number(raw.pct),
        completado_total: Number(raw.completado_total || 0),
        objetivo_total: Number(raw.objetivo_total || 0),
        detalle: Array.isArray(raw.detalle) ? raw.detalle : [],
      };
    }
    (
      (app.asignacionesState.meta && app.asignacionesState.meta.agentes) ||
      []
    ).forEach(function (ag) {
      let agenteId = _.normalizeAgenteId(ag.id_agente);
      let req = getRequisitosResumenForAgente(agenteId);
      agentesMap.set(agenteId, {
        agente_id: agenteId,
        tip: ag.agente_tip || '',
        nombre: _.agenteNombre(ag),
        empleo_id: ag.empleo_id || '',
        empleo_nombre: ag.empleo_nombre || '',
        color_empleo: ag.color_empleo || ag.empleo_color || '#bdbdbd',
        peloton_id: ag.peloton_id,
        peloton_codigo: ag.peloton_codigo || '',
        peloton_color: ag.peloton_color || '#888',
        situacion_id: ag.situacion_id,
        requisitos_pct: req.pct,
        requisitos_completado_total: req.completado_total,
        requisitos_objetivo_total: req.objetivo_total,
        requisitos_detalle_pct: req.detalle,
        orden_gc: ag.orden_gc,
        escalafon: ag.escalafon || '',
        aptitudes: Array.isArray(ag.aptitudes)
          ? ag.aptitudes
          : typeof ag.aptitudes === 'string'
            ? ag.aptitudes
                .split(',')
                .map(function (s) {
                  return s.trim();
                })
                .filter(Boolean)
            : [],
        situacion: ag.situacion_nombre || ag.situacion || '',
        comentarios: ag.comentarios || '',
      });
    });

    sourceRows.forEach(function (r) {
      let agenteId = _.normalizeAgenteId(r.agente_id);
      if (!agentesMap.has(agenteId)) {
        let req = getRequisitosResumenForAgente(agenteId);
        agentesMap.set(agenteId, {
          agente_id: agenteId,
          tip: r.agente_tip || '',
          nombre: [r.agente_apellido1, r.agente_apellido2, r.agente_nombre]
            .filter(Boolean)
            .join(' '),
          empleo_id: r.empleo_id || '',
          empleo_nombre: r.empleo_nombre || '',
          color_empleo: r.color_empleo || r.empleo_color || '#bdbdbd',
          peloton_id: r.peloton_id,
          peloton_codigo: r.peloton_codigo || '',
          peloton_color: r.peloton_color || '#888',
          situacion_id: r.situacion_id,
          requisitos_pct: req.pct,
          requisitos_completado_total: req.completado_total,
          requisitos_objetivo_total: req.objetivo_total,
          requisitos_detalle_pct: req.detalle,
          orden_gc: r.orden_gc,
          escalafon: r.escalafon || '',
          aptitudes: Array.isArray(r.aptitudes)
            ? r.aptitudes
            : typeof r.aptitudes === 'string'
              ? r.aptitudes
                  .split(',')
                  .map(function (s) {
                    return s.trim();
                  })
                  .filter(Boolean)
              : [],
          situacion: r.situacion_nombre || '',
          comentarios: r.comentarios || '',
        });
      }
    });

    let diasData = {};
    sourceRows.forEach(function (r) {
      let agenteId = _.normalizeAgenteId(r.agente_id);
      let servs = serviciosByAsig.get(Number(r.id)) || [];
      let key = r.fecha
        ? String(r.fecha).slice(0, 10)
        : String(r.anio) +
          '-' +
          String(r.mes).padStart(2, '0') +
          '-' +
          String(r.dia).padStart(2, '0');
      if (!diasData[agenteId]) diasData[agenteId] = {};
      diasData[agenteId]['dia_' + key] = {
        asignacionId: Number(r.id),
        turnoLabel: _.getTurnoLabel(r),
        turno_id: Number(r.turno_id),
        turnoColor: r.turno_color || '#6c757d',
        servicios: servs,
        actividad_ids: servs.map(function (s) {
          return Number(s.id);
        }),
        observaciones: r.observaciones || null,
        revision: r.revision != null ? Number(r.revision) : null,
      };
    });

    let tabulatorData = [];
    agentesMap.forEach(function (ag) {
      let devengoVal =
        data && data.saldosDevengo && data.saldosDevengo[ag.agente_id] != null
          ? Number(data.saldosDevengo[ag.agente_id])
          : 0;
      let row = {
        agente_id: ag.agente_id,
        tip: ag.tip || '',
        nombre: ag.nombre || 'Agente #' + ag.agente_id,
        escalafon: ag.escalafon || '',
        empleo_id: ag.empleo_id,
        empleo_nombre: ag.empleo_nombre,
        color_empleo: ag.color_empleo,
        peloton_codigo: ag.peloton_codigo,
        peloton_color: ag.peloton_color,
        situacion: ag.situacion,
        orden_gc: ag.orden_gc,
        requisitos_pct: ag.requisitos_pct,
        requisitos_completado_total: ag.requisitos_completado_total,
        requisitos_objetivo_total: ag.requisitos_objetivo_total,
        requisitos_detalle_pct: ag.requisitos_detalle_pct,
        devengo: Number.isFinite(devengoVal) ? devengoVal : 0,
        aptitudes: ag.aptitudes,
        comentarios: ag.comentarios,
      };
      let agtDias = diasData[ag.agente_id] || {};
      planningDays.forEach(function (pd) {
        row['dia_' + pd.key] = agtDias['dia_' + pd.key] || null;
      });
      tabulatorData.push(row);
    });

    let totalAgentes = tabulatorData.length;

    function getActiveTabulatorRows() {
      if (!_.tabulator) return [];
      try {
        return _.tabulator.getRows('active') || [];
      } catch (_err) {
        return [];
      }
    }

    function syncHeaderSelectAllActiveCheckbox() {
      let headerCheckbox = container.querySelector('.asig-select-all-active');
      if (!headerCheckbox) return;

      let activeRows = getActiveTabulatorRows();
      let activeCount = activeRows.length;
      let selectedActiveCount = activeRows.filter(function (row) {
        return row && typeof row.isSelected === 'function' && row.isSelected();
      }).length;

      headerCheckbox.disabled = activeCount === 0;
      headerCheckbox.checked =
        activeCount > 0 && selectedActiveCount === activeCount;
      headerCheckbox.indeterminate =
        selectedActiveCount > 0 && selectedActiveCount < activeCount;
    }

    function buildRequisitosTooltip(rowData) {
      return window.GRS1Utils.buildRequisitosTooltip(rowData);
    }

    // ── Fixed columns ──
    let fixedCols = [
      {
        formatter: 'rowSelection',
        titleFormatter: 'html',
        titleFormatterParams: {},
        title:
          '<input type="checkbox" class="form-check-input asig-select-all-active" ' +
          'aria-label="Seleccionar solo agentes filtrados" title="Seleccionar solo agentes filtrados">',
        headerClick: function (_e) {
          let activeRows = getActiveTabulatorRows();
          if (!activeRows.length) {
            syncHeaderSelectAllActiveCheckbox();
            return;
          }

          let shouldSelect = activeRows.some(function (row) {
            return (
              row && typeof row.isSelected === 'function' && !row.isSelected()
            );
          });

          activeRows.forEach(function (row) {
            if (!row) return;
            if (shouldSelect) {
              row.select();
            } else {
              row.deselect();
            }
          });

          syncHeaderSelectAllActiveCheckbox();
        },
        frozen: true,
        headerSort: false,
        hozAlign: 'center',
        minWidth: 42,
        widthGrow: 0,
      },
      {
        title: 'TIP',
        field: 'tip',
        frozen: true,
        headerFilter: 'input',
        headerFilterPlaceholder: 'Filtrar (*,=,!=,^,$,!,&&,||)...',
        headerFilterLiveFilter: false,
        headerFilterFunc: function () {
          return true;
        },
        minWidth: 60,
        sorter: 'string',
      },
      {
        title: 'Escalafón',
        field: 'escalafon',
        visible: false,
        frozen: true,
        headerSort: true,
        sorter: 'string',
      },
      {
        title: 'Agente',
        field: 'nombre',
        frozen: true,
        headerFilter: 'input',
        headerFilterPlaceholder: 'Filtrar (*,=,!=,^,$,!,&&,||)...',
        headerFilterLiveFilter: false,
        headerFilterFunc: function () {
          return true;
        },
        minWidth: 140,
        sorter: 'string',
        formatter: function (cell) {
          let d = cell.getRow().getData();
          let html =
            '<div style="line-height:1.15;"><div class="fw-semibold">' +
            app.escapeHtml(d.nombre || '') +
            '</div>';
          let es = '';
          if (d.empleo_nombre)
            es += window.GRS1Utils.renderColorBadgeHtml(
              d.empleo_nombre,
              d.color_empleo || '#bdbdbd',
              {
                escapeHtmlFn: app.escapeHtml,
                className: 'badge me-1',
                fontSize: '.68em',
                whiteSpace: 'normal',
                lineHeight: '1.1',
                contrastThreshold: 0.6,
              }
            );
          if (d.situacion)
            es += window.GRS1Utils.renderSemanticBadgeHtml(
              d.situacion,
              'secondary',
              {
                escapeHtmlFn: app.escapeHtml,
                variant: 'solid',
                className: 'me-1',
                fontSize: '.70em',
                lineHeight: '1.1',
              }
            );
          if (es) html += '<div>' + es + '</div>';
          let extras = '';
          if (Array.isArray(d.aptitudes) && d.aptitudes.length)
            extras += d.aptitudes
              .map(function (ap) {
                return window.GRS1Utils.renderSemanticBadgeHtml(ap, 'info', {
                  escapeHtmlFn: app.escapeHtml,
                  variant: 'solid',
                  className: 'me-1',
                  fontSize: '.70em',
                });
              })
              .join('');
          if (d.comentarios && String(d.comentarios).trim().length > 0)
            extras +=
              '<span class="ms-1 text-primary asig-comentario-icon" data-agente-id="' +
              d.agente_id +
              '" style="cursor:pointer;" title="Ver comentarios"><i class="bi bi-chat-dots-fill"></i></span>';
          if (extras) html += '<div>' + extras + '</div>';
          html += '</div>';
          return html;
        },
      },
      {
        title: 'Pelotón',
        field: 'peloton_codigo',
        frozen: true,
        headerFilter: 'input',
        headerFilterPlaceholder: 'Filtrar (*,=,!=,^,$,!,&&,||)...',
        headerFilterLiveFilter: false,
        headerFilterFunc: function () {
          return true;
        },
        minWidth: 65,
        sorter: 'string',
        formatter: function (cell) {
          let d = cell.getRow().getData();
          if (!d.peloton_codigo) return '-';
          return window.GRS1Utils.renderColorBadgeHtml(
            d.peloton_codigo,
            d.peloton_color || '#888',
            {
              escapeHtmlFn: app.escapeHtml,
              className: 'badge',
              fontSize: '.95em',
              contrastThreshold: 0.6,
            }
          );
        },
      },
      {
        title: '% Requisitos',
        field: 'requisitos_pct',
        frozen: true,
        headerFilter: 'input',
        headerFilterPlaceholder: 'Filtrar (>,>=,<,<=,=,!=)...',
        headerFilterLiveFilter: false,
        headerFilterFunc: function (headerValue, _rowValue, rowData) {
          let expr = parseQbeExpression(headerValue);
          if (!expr || !expr.value) return true;
          return matchesNumberQbe(rowData && rowData.requisitos_pct, expr);
        },
        minWidth: 90,
        sorter: 'number',
        variableHeight: true,
        hozAlign: 'center',
        tooltip: function (_e, cell) {
          let rowData = cell.getRow().getData() || {};
          let detalle = getRequisitosDetalleVisible(rowData);
          if (!detalle.length) return false;
          return buildRequisitosTooltip(rowData);
        },
        formatter: function (cell) {
          let rowData = cell.getRow().getData() || {};
          let chips =
            window.GRS1Utils &&
            typeof window.GRS1Utils.renderRequisitosBadgesHtml === 'function'
              ? window.GRS1Utils.renderRequisitosBadgesHtml(
                  rowData,
                  app.escapeHtml
                )
              : '';
          if (!chips) return '';

          return (
            '<div class="d-flex flex-wrap justify-content-center">' +
            chips +
            '</div>'
          );
        },
      },
      {
        title: 'Devengo',
        field: 'devengo',
        frozen: true,
        headerFilter: 'input',
        headerFilterPlaceholder: 'Filtrar (>,>=,<,<=,=,!=)...',
        headerFilterLiveFilter: false,
        headerFilterFunc: function (headerValue, _rowValue, rowData) {
          let expr = parseQbeExpression(headerValue);
          if (!expr || !expr.value) return true;

          let saldos =
            (app.asignacionesState.cuadranteData &&
              app.asignacionesState.cuadranteData.saldosDevengo) ||
            (app.asignacionesState.cuadrante &&
              app.asignacionesState.cuadrante.saldosDevengo) ||
            {};
          let agenteId = Number(rowData && rowData.agente_id);
          let val = saldos[agenteId] != null ? Number(saldos[agenteId]) : 0;
          return matchesNumberQbe(val, expr);
        },
        minWidth: 70,
        sorter: 'number',
        formatter: function (cell) {
          let d = cell.getRow().getData();
          let saldos =
            (app.asignacionesState.cuadranteData &&
              app.asignacionesState.cuadranteData.saldosDevengo) ||
            (app.asignacionesState.cuadrante &&
              app.asignacionesState.cuadrante.saldosDevengo) ||
            {};
          let rawVal =
            saldos[d.agente_id] != null ? Number(saldos[d.agente_id]) : 0;
          let val = Number.isFinite(rawVal) ? rawVal : 0;
          let entero = Math.round(val);
          let colorStyle = entero < 0 ? 'color:#dc3545;' : '';
          return (
            '<span class="fw-semibold" style="' +
            colorStyle +
            '">' +
            entero.toLocaleString('es-ES', { maximumFractionDigits: 0 }) +
            '</span>'
          );
        },
      },
    ];

    // ── Day columns ──
    let dayCols = planningDays.map(function (pd) {
      // Nuevo: marcar festivos y fines de semana con colores distintos Cuadrante.js ya no marca los días festivos, pero se puede usar la info que viene en el API para colorear las columnas
      let isWeekend = pd.weekdayIndex >= 5;
      let isTraspaso = pd.esTraspaso || false;
      let isFestivo = pd.esFestivo || false;

      // Color de la cabecera según tipo
      let headerBg = '';
      if (isFestivo) headerBg = 'background:#ffebee;';
      else if (isTraspaso) headerBg = 'background:#f5f5f5;opacity:.8;';
      else if (isWeekend) headerBg = 'background:#fff8e1;';
      let pdKey = pd.key;
      return {
        title:
          '<div style="' +
          headerBg +
          'padding:1px 2px;border-radius:3px;line-height:1.05;">' +
          '<span style="font-size:.78em;">' +
          pd.label +
          ' ' +
          pd.labelDate +
          '</span>' +
          (isTraspaso
            ? '<span style="font-size:.58em;color:#9e9e9e;display:block;">trasp.</span>'
            : '') +
          (isFestivo
            ? '<span style="font-size:.58em;color:#c62828;display:block;">●</span>'
            : '') +
          '</div>',
        field: 'dia_' + pd.key,
        minWidth: 70,
        hozAlign: 'center',
        headerSort: false,
        cssClass: isWeekend ? 'asig-weekend-col' : '',
        titleFormatter: 'html',
        formatter: function (cell) {
          let val = cell.getValue();
          if (!val) return '<span class="text-muted">—</span>';
          let serviciosHtml = '-';
          if (val.servicios && val.servicios.length) {
            let serviciosOrdenados = val.servicios
              .slice()
              .sort(function (a, b) {
                let aId = Number(a && a.id);
                let bId = Number(b && b.id);

                let aNivel = Number(
                  actividadGrupoMaps.actividadToSortNivel.get(aId)
                );
                let bNivel = Number(
                  actividadGrupoMaps.actividadToSortNivel.get(bId)
                );
                let aNivelSort = Number.isFinite(aNivel) ? aNivel : 9999;
                let bNivelSort = Number.isFinite(bNivel) ? bNivel : 9999;
                if (aNivelSort !== bNivelSort) return aNivelSort - bNivelSort;

                let aGrupo = String(
                  actividadGrupoMaps.actividadToGrupo.get(aId) || 'Sin grupo'
                );
                let bGrupo = String(
                  actividadGrupoMaps.actividadToGrupo.get(bId) || 'Sin grupo'
                );
                let cmpGrupo = aGrupo.localeCompare(bGrupo, 'es', {
                  sensitivity: 'base',
                });
                if (cmpGrupo !== 0) return cmpGrupo;

                let aCodigo = String(
                  actividadGrupoMaps.actividadToCodigo.get(aId) || ''
                ).trim();
                let bCodigo = String(
                  actividadGrupoMaps.actividadToCodigo.get(bId) || ''
                ).trim();
                let aNombre = String(
                  actividadGrupoMaps.actividadToNombre.get(aId) || ''
                ).trim();
                let bNombre = String(
                  actividadGrupoMaps.actividadToNombre.get(bId) || ''
                ).trim();
                let aLabel =
                  aCodigo && aNombre
                    ? aCodigo + ' - ' + aNombre
                    : aCodigo || aNombre;
                let bLabel =
                  bCodigo && bNombre
                    ? bCodigo + ' - ' + bNombre
                    : bCodigo || bNombre;
                return aLabel.localeCompare(bLabel, 'es', {
                  sensitivity: 'base',
                });
              });

            serviciosHtml = serviciosOrdenados
              .map(function (s) {
                let actId = Number(s && s.id);
                let tooltip =
                  actividadGrupoMaps.actividadToTooltip.get(actId) ||
                  String(s.label || 'Actividad');
                // Mantener formato clásico: codigo + descripcion
                // y color de la actividad (BBDD).
                let actividadLabel =
                  String(s && s.label ? s.label : '').trim() || tooltip;
                let actividadBg =
                  actividadGrupoMaps.actividadToColor.get(actId) || '#6c757d';

                // Mantener este bloque comentado por si se vuelve a necesitar
                // mostrar nivel+grupo en una linea superior.
                // var grupoBg = actividadGrupoMaps.grupoToColor.get(grupoKey) || "#6c757d";
                // var grupoFg = getTextColorForBackground(grupoBg);
                // var nivelGrupoHtml = '' +
                //   '<span class="d-inline-flex align-items-center" style="gap:2px;flex-wrap:wrap;">' +
                //     '<span class="badge" style="background:' + app.escapeHtml(nivelBg) + ';color:' + app.escapeHtml(nivelFg) + ';font-size:.58em;line-height:1.05;padding:.18rem .32rem;">' + app.escapeHtml(nivelNombre) + '</span>' +
                //     '<span class="badge" style="background:' + app.escapeHtml(grupoBg) + ';color:' + app.escapeHtml(grupoFg) + ';font-size:.58em;line-height:1.05;padding:.18rem .32rem;">' + app.escapeHtml(grupoNombre) + '</span>' +
                //   '</span>';

                return (
                  '' +
                  '<span class="d-inline-flex me-1 mb-1" title="' +
                  app.escapeHtml(tooltip) +
                  '" style="max-width:100%;">' +
                  window.GRS1Utils.renderColorBadgeHtml(
                    actividadLabel,
                    actividadBg,
                    {
                      escapeHtmlFn: app.escapeHtml,
                      className: 'badge',
                      fontSize: '.70em',
                      lineHeight: '1.1',
                      padding: '.24rem .42rem',
                      contrastThreshold: 0.6,
                    }
                  ) +
                  '</span>'
                );
              })
              .join('');
          }
          let html = '<div class="d-flex flex-column gap-1">';
          let obsIconHtml = '';
          if (
            val.observaciones &&
            String(val.observaciones).trim().length > 0
          ) {
            obsIconHtml =
              '<span class="ms-1 text-primary asig-cell-comentario-icon" data-obs="' +
              app.escapeHtml(val.observaciones) +
              '" style="cursor:pointer;" title="Ver observación"><i class="bi bi-chat-dots-fill"></i></span>';
          }
          html +=
            '<small class="text-muted" style="line-height:1.2">' +
            serviciosHtml +
            obsIconHtml +
            '</small></div>';
          return html;
        },
        cellContext: function (e, cell) {
          mostrarMenuCelda(e, cell);
        },
        cellClick: function (e, cell) {
          if (
            e.target &&
            e.target.closest &&
            e.target.closest('.asig-cell-comentario-icon')
          )
            return;
          let rowData = cell.getRow().getData();
          let val = cell.getValue();
          app.openAsignacionCellModal({
            anio: pd.anio,
            mes: pd.mes,
            agente_id: rowData.agente_id,
            agenteNombre: rowData.nombre,
            dia: pd.dia,
            fecha: pdKey,
            turno_id: val ? val.turno_id : null,
            actividad_ids: val ? val.actividad_ids || [] : [],
            observaciones: val ? val.observaciones : null,
            revision: val && val.revision != null ? Number(val.revision) : null,
          });
        },
      };
    });

    // ── Init Tabulator ──
    // @ts-ignore
    _.tabulator = new Tabulator('#asigGridContainer', {
      locale: 'es-es',
      langs: _.TABULATOR_LANGS,
      layout: 'fitDataFill',
      height: 'calc(100vh - 320px)',
      initialSort:[
        { column: "escalafon", dir: "asc" }],
      virtualDom: true,
      selectable: true,
      data: tabulatorData,
      columnDefaults: { resizable: true, headerHozAlign: 'center' },
      // @ts-ignore
      columns: fixedCols.concat(dayCols),
      placeholder: getAsigGridPlaceholderHtml(),
      rowFormatter: function (row) {
        let d = row.getData();
        let rowEl = row.getElement();
        let cells = row.getCells();
        if (d.empleo_id === 'GAP' || d.situacion_id === 'BAJA') {
          let hex = (d.color_empleo || '#276836').replace('#', '');
          if (hex.length === 3)
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
          let r2 = Math.round(
            parseInt(hex.substring(0, 2), 16) * 0.12 + 255 * 0.88
          );
          let g2 = Math.round(
            parseInt(hex.substring(2, 4), 16) * 0.12 + 255 * 0.88
          );
          let b2 = Math.round(
            parseInt(hex.substring(4, 6), 16) * 0.12 + 255 * 0.88
          );
          let light =
            '#' +
            r2.toString(16).padStart(2, '0') +
            g2.toString(16).padStart(2, '0') +
            b2.toString(16).padStart(2, '0');
          rowEl.style.backgroundColor = light;
          cells.forEach(function (cell) {
            cell.getElement().style.backgroundColor = light;
          });
        } else {
          rowEl.style.backgroundColor = '';
          cells.forEach(function (cell) {
            cell.getElement().style.backgroundColor = '';
          });
        }
      },
    });
    let tableInstance = _.tabulator;
    _.tabulatorReady = false;

    // Limpiado de una celda del cuadrante: se muestra al hacer click derecho sobre una celda de día, y permite eliminar la asignación de esa celda del borrador actual (si existe) y dejarla vacía.
    function mostrarMenuCelda(e, cell) {
      // Evitar menú navegador
      e.preventDefault();
  
      // Eliminar menú previo
      const oldMenu = document.getElementById("custom-context-menu");
  
      if (oldMenu) {
          oldMenu.remove();
      }
  
      // Crear contenedor menú
      const menu = document.createElement("div");
  
      menu.id = "custom-context-menu";
  
      Object.assign(menu.style, {
          position: "fixed",
          top: `${e.clientY}px`,
          left: `${e.clientX}px`,
          background: "#fff",
          border: "1px solid #ccc",
          borderRadius: "6px",
          boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
          padding: "5px 0",
          zIndex: "99999",
          minWidth: "100px",
          fontFamily: "Arial",
          fontSize: "14px"
      });
  
      // ==========================================
      // OPCIÓN LIMPIAR
      // ==========================================
  
      const limpiar = document.createElement("div");
  
      limpiar.innerText = "🧹 Limpiar";
  
      Object.assign(limpiar.style, {
          padding: "8px 12px",
          cursor: "pointer"
      });
  
      limpiar.addEventListener("mouseenter", () => {
          limpiar.style.background = "#f0f0f0";
      });
  
      limpiar.addEventListener("mouseleave", () => {
          limpiar.style.background = "#fff";
      });
  
    limpiar.addEventListener("click", async (ev) => {
                ev.stopPropagation();

                let rowData = cell.getRow().getData() || {};
                let anioPayload = Number(
                  app.asignacionesState.anio != null
                    ? app.asignacionesState.anio
                    : rowData.anio
                );
                let mesPayload = Number(
                  app.asignacionesState.mes != null
                    ? app.asignacionesState.mes
                    : rowData.mes
                );

                let agenteIds = rowData.agente_id
                  ? [rowData.agente_id]
                  : [];
                let fechas = cell.getColumn().getField().indexOf('dia_') === 0
                  ? [String(cell.getColumn().getField()).slice(4)]
                  : [];
                let dias = fechas.map(function (fecha) {
                  return Number(String(fecha).slice(8, 10));
                });
                if (!agenteIds.length || !fechas.length) {
                  _.showAlert(
                    'No hay nada que limpiar en esta celda',
                    'warning'
                  );
                  return;
                }
                try {
                  if (!Number.isInteger(anioPayload) || !Number.isInteger(mesPayload)) {
                    throw new Error('No se pudo resolver año/mes del cuadrante');
                  }
                  let res = await fetch('/api/asignaciones/borrador', {
                    method: 'DELETE',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: 'Bearer ' + app.globalState.token,
                    },
                    body: JSON.stringify({
                      anio: anioPayload,
                      mes: mesPayload,
                      borrador_id: _.getSelectedBorradorId(),
                      agente_ids: agenteIds,
                      dias: dias,
                      fechas: fechas,
                    }),
                  });
                  let responseJson = await res.json();
                  if (!res.ok) {
                    let err = responseJson || {};
                    throw new Error(err.message || 'Error al eliminar celda del borrador');
                  }
                  cell.setValue(null);
                  //await app.loadAsignacionesCuadrante();
                } catch (e) {
                  _.showAlert(e.message, 'danger');
                }
          // Cerrar menú
          menu.remove();
    });
    menu.appendChild(limpiar);
      // Añadir al DOM
      document.body.appendChild(menu);
  
      // ==========================================
      // CERRAR AL HACER CLICK FUERA
      // ==========================================
  
      setTimeout(() => {
  
          document.addEventListener("click", function closeMenu() {
  
              const currentMenu =
                  document.getElementById("custom-context-menu");
  
              if (currentMenu) {
                  currentMenu.remove();
              }
  
              document.removeEventListener("click", closeMenu);
  
          });
  
      }, 0);
  }
    _.tabulator.on('rowSelectionChanged', function (data, rows) {
      if (tableInstance !== _.tabulator) return;
      app.asignacionesState.selectedAgenteIdsVista = rows.map(function (r) {
        return Number(r.getData().agente_id);
      });
      syncHeaderSelectAllActiveCheckbox();
      refreshMetaResumenFromState();
    });

    // @ts-ignore
    _.tabulator.on('dataFiltered', function (filters, rows) {
      if (tableInstance !== _.tabulator) return;
      app.asignacionesState._agentesFiltradosCount = rows.length;
      _.updateSearchSummary(rows.length, totalAgentes);
      syncHeaderSelectAllActiveCheckbox();
      refreshMetaResumenFromState();
    });

    // Restaurar filtros sólo cuando la tabla esté completamente construida,
    // para evitar el warning "Table Not Initialized" y el estado inconsistente
    // de filtros que causaba que las celdas aparecieran vacías tras recargar.
    _.tabulator.on('tableBuilt', function () {
      if (tableInstance !== _.tabulator) return;
      _.tabulatorReady = true;
      restoreAsigHeaderFiltersFromState();
      _.pendingAdvancedFilters = false;
      syncHeaderSelectAllActiveCheckbox();
      if (typeof _.applyAsigAdvancedFilters === 'function') {
        _.applyAsigAdvancedFilters();
      }
    });

    _.triggerAsigHeaderQbeSync = function () {
      if (app.asignacionesState._asigHeaderQbeSyncTimer) {
        clearTimeout(app.asignacionesState._asigHeaderQbeSyncTimer);
      }
      app.asignacionesState._asigHeaderQbeSyncTimer = setTimeout(function () {
        if (!_.tabulator) return;
        syncAsigColumnFiltersFromHeader();
        clearAsigSelection();
        if (typeof _.applyAsigAdvancedFilters === 'function') {
          _.applyAsigAdvancedFilters();
        }
      }, 0);
    };

    // ── Event delegation (once per container) ──
    if (!container.dataset.asigTabDelegates) {
      container.dataset.asigTabDelegates = '1';
      container.addEventListener('click', function (e) {
        let obsIcon =
          // @ts-ignore
          e.target && e.target.closest
            ? // @ts-ignore
              e.target.closest('.asig-cell-comentario-icon')
            : null;
        if (obsIcon) {
          e.stopPropagation();
          let obs = obsIcon.getAttribute('data-obs');
          if (!obs) return;
          let modal = document.getElementById('asigCellComentarioModal');
          if (!modal) {
            modal = document.createElement('div');
            modal.id = 'asigCellComentarioModal';
            modal.innerHTML =
              '<div class="modal fade" tabindex="-1"><div class="modal-dialog"><div class="modal-content">' +
              '<div class="modal-header"><h5 class="modal-title">Observación de la asignación</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>' +
              '<div class="modal-body"><div id="asigCellComentarioModalBody"></div></div>' +
              '<div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button></div></div></div></div>';
            document.body.appendChild(modal);
          }
          document.getElementById('asigCellComentarioModalBody').textContent =
            obs;
          bootstrap.Modal.getOrCreateInstance(
            modal.querySelector('.modal')
          ).show();
          return;
        }
        let comentarioIcon =
          // @ts-ignore
          e.target && e.target.closest
            ? // @ts-ignore
              e.target.closest('.asig-comentario-icon')
            : null;
        if (comentarioIcon) {
          e.stopPropagation();
          let agId = Number(comentarioIcon.getAttribute('data-agente-id'));
          let agRow = null;
          if (_.tabulator) {
            let allRows = _.tabulator.getRows();
            for (let ri = 0; ri < allRows.length; ri++) {
              if (Number(allRows[ri].getData().agente_id) === agId) {
                agRow = allRows[ri].getData();
                break;
              }
            }
          }
          if (!agRow || !agRow.comentarios) return;
          let cModal = document.getElementById('asigComentarioModal');
          if (!cModal) {
            cModal = document.createElement('div');
            cModal.id = 'asigComentarioModal';
            cModal.innerHTML =
              '<div class="modal fade" tabindex="-1"><div class="modal-dialog"><div class="modal-content">' +
              '<div class="modal-header"><h5 class="modal-title">Comentarios del agente</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>' +
              '<div class="modal-body"><div id="asigComentarioModalBody"></div></div>' +
              '<div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button></div></div></div></div>';
            document.body.appendChild(cModal);
          }
          document.getElementById('asigComentarioModalBody').textContent =
            agRow.comentarios;
          bootstrap.Modal.getOrCreateInstance(
            cModal.querySelector('.modal')
          ).show();
        }
      });

      container.addEventListener('input', function (e) {
        let target = e.target;
        if (
          !target ||
          // @ts-ignore
          !target.closest ||
          // @ts-ignore
          !target.closest('.tabulator-header-filter')
        )
          return;
        if (typeof _.triggerAsigHeaderQbeSync === 'function') {
          _.triggerAsigHeaderQbeSync();
        }
      });

      container.addEventListener('change', function (e) {
        let target = e.target;
        if (
          !target ||
          // @ts-ignore
          !target.closest ||
          // @ts-ignore
          !target.closest('.tabulator-header-filter')
        )
          return;
        if (typeof _.triggerAsigHeaderQbeSync === 'function') {
          _.triggerAsigHeaderQbeSync();
        }
      });
    }
  }

  function clearAsigSelection() {
    if (_.tabulator) _.tabulator.deselectRow();
  }

  // ── Exportar ────────────────────────────────────────────────────
  _.refreshMetaResumenFromState = refreshMetaResumenFromState;
  _.renderEstado = renderEstado;
  _.renderGridTabulator = renderGridTabulator;
  _.applyAsigAdvancedFilters = applyAsigAdvancedFilters;
  _.clearAsigSelection = clearAsigSelection;
})();
