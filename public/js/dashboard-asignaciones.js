/* ========================================================================
 *  dashboard-asignaciones.js  (orquestador)
 *  Carga de datos (meta, cuadrante) y setupAsignacionesEventListeners.
 *
 *  Depende de:
 *    dashboard-asignaciones-utils.js      → app._asig (constantes, helpers)
 *    dashboard-asignaciones-historial.js  → historial / auditoría
 *    dashboard-asignaciones-modals.js     → modales, fill*, openCellModal
 *    dashboard-asignaciones-grid.js       → KPIs, Tabulator render
 * ======================================================================== */
(function () {
  let app = window.GRS1Dashboard;
  let _ = app._asig || {};
  let ASIG_TURNO_CONSTANTE_ID = 1;
  let DateTime = window.luxon && window.luxon.DateTime;
  let FALLBACK_MONTHS = [
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

  function getMonthsSafe() {
    return Array.isArray(_.MONTHS) && _.MONTHS.length
      ? _.MONTHS
      : FALLBACK_MONTHS;
  }

  function getPlanningWindowSafe(anio, mes) {
    if (typeof _.getPlanningWindow !== 'function') return [];
    let days = _.getPlanningWindow(anio, mes);
    return Array.isArray(days) ? days : [];
  }

  function truncateText(value, maxLen) {
    let s = String(value == null ? '' : value);
    if (s.length <= maxLen) return s;
    return s.slice(0, Math.max(0, maxLen - 1)) + '…';
  }

  function formatTimestampEs(value) {
    if (!value || !DateTime) return '-';
    let raw = String(value);
    let dt = DateTime.fromISO(raw, { setZone: true });
    if (!dt.isValid) dt = DateTime.fromSQL(raw, { setZone: true });
    if (!dt.isValid) return '-';
    return dt
      .setZone('Europe/Madrid', { keepLocalTime: false })
      .setLocale('es')
      .toFormat('dd/MM/yyyy HH:mm:ss');
  }

  function resolveActividadGrupoMap() {
    let actividades =
      (app.asignacionesState.meta && app.asignacionesState.meta.actividades) ||
      [];
    let map = new Map();
    actividades.forEach(function (a) {
      let id = Number(a.id_actividad);
      if (!id) return;
      let grupoNombre = String(a.grupo_nombre || '').trim();
      let grupoId = Number(a.grupo_id);
      let label =
        grupoNombre || (grupoId ? 'Grupo ' + String(grupoId) : 'Sin grupo');
      map.set(id, label);
    });
    return map;
  }

  function getAsigActividadesActivas() {
    let actividades =
      (app.asignacionesState.meta && app.asignacionesState.meta.actividades) ||
      [];
    return actividades.filter(function (a) {
      return a.activo !== false;
    });
  }

  function normalizeAsigActividadSelectedIds(raw) {
    let src = Array.isArray(raw) ? raw : [];
    let seen = new Set();
    let out = [];
    src.forEach(function (id) {
      let n = Number(id);
      // -1 = "Sin Actividad", -2 = "Con Actividad"; se permiten junto con IDs positivos
      if (!Number.isFinite(n) || (n <= 0 && n !== -1 && n !== -2) || seen.has(n)) return;
      seen.add(n);
      out.push(n);
    });
    return out;
  }

  function normalizeAsigActividadColor(value) {
    let raw = String(value || '').trim();
    if (!raw) return '';
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
    if (/^[0-9a-fA-F]{6}$/.test(raw)) return '#' + raw;
    return /^#[0-9a-fA-F]{3}$/.test(raw) ? raw : '';
  }

  function ensureAsigActividadSelectedIdsState() {
    app.asignacionesState.selectedActividadIds = normalizeAsigActividadSelectedIds(
      app.asignacionesState.selectedActividadIds
    );
    return app.asignacionesState.selectedActividadIds;
  }

  function normalizeIsoDateOrEmpty(value) {
    let raw = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
  }

  function ensureAsigActividadDateRangeState() {
    let inicio = normalizeIsoDateOrEmpty(app.asignacionesState.actividadFechaInicio);
    let fin = normalizeIsoDateOrEmpty(app.asignacionesState.actividadFechaFin);

    if (inicio && fin && inicio > fin) {
      let tmp = inicio;
      inicio = fin;
      fin = tmp;
    }

    app.asignacionesState.actividadFechaInicio = inicio;
    app.asignacionesState.actividadFechaFin = fin;
    return { inicio: inicio, fin: fin };
  }

  function getAsigCuadranteDateBounds() {
    let days = Array.isArray(app.asignacionesState.cuadranteDays)
      ? app.asignacionesState.cuadranteDays
      : [];
    if (!days.length) return { min: '', max: '' };
    let keys = days
      .map(function (d) {
        return String(d && d.key ? d.key : '').slice(0, 10);
      })
      .filter(function (k) {
        return /^\d{4}-\d{2}-\d{2}$/.test(k);
      })
      .sort();
    if (!keys.length) return { min: '', max: '' };
    return { min: keys[0], max: keys[keys.length - 1] };
  }

  function syncAsigActividadDateInputs(fechaInicioEl, fechaFinEl) {
    let range = ensureAsigActividadDateRangeState();
    let bounds = getAsigCuadranteDateBounds();

    if (fechaInicioEl) {
      fechaInicioEl.value = range.inicio || '';
      fechaInicioEl.min = bounds.min || '';
      fechaInicioEl.max = bounds.max || '';
    }
    if (fechaFinEl) {
      fechaFinEl.value = range.fin || '';
      fechaFinEl.min = bounds.min || '';
      fechaFinEl.max = bounds.max || '';
    }
  }

  function updateAsigActividadFilterCount() {
    let countEl = document.getElementById('asigActividadFilterCount');
    if (!countEl) return;
    let ids = ensureAsigActividadSelectedIdsState();
    let range = ensureAsigActividadDateRangeState();
    let hasDateRange = !!(range.inicio || range.fin);
    let bounds = getAsigCuadranteDateBounds();
    let fromBase = range.inicio || bounds.min || '';
    let toBase = range.fin || bounds.max || '';
    let fromDay = fromBase ? Number(String(fromBase).slice(8, 10)) : null;
    let toDay = toBase ? Number(String(toBase).slice(8, 10)) : null;
    let actividadCount = ids.filter(function (id) {
      return Number(id) > 0;
    }).length;
    let totalActiveFilters = ids.length;
    let rangoTexto =
      Number.isFinite(fromDay) && Number.isFinite(toDay)
        ? 'del ' + String(fromDay) + ' al ' + String(toDay)
        : 'del - al -';
    let actividadTexto =
      String(actividadCount) +
      ' ' +
      (actividadCount > 1 ? 'Actividades' : 'Actividad');

    countEl.textContent =
      totalActiveFilters > 0 || hasDateRange
        ? rangoTexto + ' ' + actividadTexto
        : '0';
    countEl.className =
      'badge text-wrap ' +
      (totalActiveFilters || hasDateRange ? 'text-bg-primary' : 'text-bg-secondary');
    countEl.title =
      'Seleccionadas: ' +
      String(ids.length) +
      ' · Rango fecha: ' +
      (hasDateRange
        ? (range.inicio || '...') + ' → ' + (range.fin || '...')
        : 'No');
  }

  function renderAsigActividadFilterList(filtro) {
    let listEl = document.getElementById('asigActividadFilterList');
    if (!listEl) return;

    let activas = getAsigActividadesActivas();
    let selected = ensureAsigActividadSelectedIdsState();
    let allowed = new Set(
      activas.map(function (a) {
        return Number(a.id_actividad);
      })
    );
    app.asignacionesState.selectedActividadIds = selected.filter(function (id) {
      let n = Number(id);
      if (n === -1 || n === -2) return true;
      return allowed.has(n);
    });
    selected = ensureAsigActividadSelectedIdsState();

    let q = String(filtro || '').trim().toLowerCase();
    let filtered = activas.filter(function (a) {
      if (!q) return true;
      let codigo = String(a.codigo || a.actividad || '').toLowerCase();
      let nombre = String(a.nombre || '').toLowerCase();
      let desc = String(a.descripcion || '').toLowerCase();
      return (
        codigo.indexOf(q) !== -1 ||
        nombre.indexOf(q) !== -1 ||
        desc.indexOf(q) !== -1
      );
    });

    // Entrada fija "Con Actividad" (sentinel -1): siempre visible en la cabecera del panel
    let conActChecked = selected.indexOf(-2) !== -1 ? ' checked' : '';
    let conActividadHtml =
      '<label class="asig-act-filter-item asig-act-filter-item--special">' +
      '<input type="checkbox" class="form-check-input asig-act-filter-chk" data-id="-2"' + conActChecked + '>' +
      '<span class="asig-act-filter-dot" style="background:#e8f5e9;border:1px solid #81c784"></span>' +
      '<span class="asig-act-filter-body">' +
      '<span class="asig-act-filter-head">' +
      '<span class="asig-act-filter-title fst-italic">Con Actividad</span>' +
      '</span>' +
      '</span>' +
      '</label>';

    // Entrada fija "Sin Actividad" (sentinel -1): siempre visible en la cabecera del panel
    let sinActChecked = selected.indexOf(-1) !== -1 ? ' checked' : '';
    let sinActividadHtml =
      '<label class="asig-act-filter-item asig-act-filter-item--special">' +
      '<input type="checkbox" class="form-check-input asig-act-filter-chk" data-id="-1"' + sinActChecked + '>' +
      '<span class="asig-act-filter-dot" style="background:#dee2e6;border:1px solid #adb5bd"></span>' +
      '<span class="asig-act-filter-body">' +
      '<span class="asig-act-filter-head">' +
      '<span class="asig-act-filter-title fst-italic">Sin Actividad (algún día)</span>' +
      '</span>' +
      '</span>' +
      '</label>';

    if (!filtered.length) {
      listEl.innerHTML = conActividadHtml + sinActividadHtml +
        '<div class="text-muted small p-2">Sin actividades para mostrar</div>';
      updateAsigActividadFilterCount();
      return;
    }

    listEl.innerHTML = conActividadHtml + sinActividadHtml + filtered
      .map(function (act) {
        let id = Number(act.id_actividad);
        let codigo = String(act.codigo || act.actividad || id);
        let nombre = String(act.nombre || '').trim();
        let label = nombre || codigo;
        let desc = String(act.descripcion || '');
        let color = normalizeAsigActividadColor(act.actividad_color || '');
        if (!color) color = '#dee2e6';
        let checked = selected.indexOf(id) !== -1 ? ' checked' : '';
        return (
          '<label class="asig-act-filter-item">' +
          '<input type="checkbox" class="form-check-input asig-act-filter-chk" data-id="' +
          app.escapeHtml(String(id)) +
          '"' +
          checked +
          '>' +
          '<span class="asig-act-filter-dot" style="background:' +
          app.escapeHtml(color) +
          '"></span>' +
          '<span class="asig-act-filter-body">' +
          '<span class="asig-act-filter-head">' +
          '<span class="asig-act-filter-title">' +
          app.escapeHtml(label) +
          '</span>' +
          '<span class="asig-act-filter-code">' +
          app.escapeHtml(codigo) +
          '</span>' +
          '</span>' +
          (desc
            ? '<span class="asig-act-filter-desc">' + app.escapeHtml(desc) + '</span>'
            : '') +
          '</span>' +
          '</label>'
        );
      })
      .join('');

    updateAsigActividadFilterCount();
  }

  function readDevengosWatchFromRows(rows, borradorId) {
    let list = Array.isArray(rows) ? rows : [];
    let selected = list.find(function (b) {
      return Number(b && b.id) === Number(borradorId);
    });
    if (!selected) return null;
    return {
      borradorId: Number(selected.id),
      pending: selected.devengos_pendientes === true,
      updatedAt: selected.devengos_updated_at
        ? String(selected.devengos_updated_at)
        : null,
    };
  }

  function syncDevengosWatchSnapshotFromRows(rows, borradorId) {
    let snap = readDevengosWatchFromRows(rows, borradorId);
    app.asignacionesState.devengosWatch = snap;
  }

    function markDevengosWatchPending(borradorId) {
      let targetId = Number(borradorId);
      if (!targetId) return;

      let rows = Array.isArray(app.asignacionesState.borradores)
        ? app.asignacionesState.borradores
        : [];
      let selected = rows.find(function (b) {
        return Number(b && b.id) === targetId;
      });
      if (selected) {
        selected.devengos_pendientes = true;
      }

      let prevSnap = app.asignacionesState.devengosWatch || null;
      app.asignacionesState.devengosWatch = {
        borradorId: targetId,
        pending: true,
        updatedAt:
          prevSnap && Number(prevSnap.borradorId) === targetId
            ? prevSnap.updatedAt || null
            : selected && selected.devengos_updated_at
              ? String(selected.devengos_updated_at)
              : null,
      };
    }

    function applyDevengosPendingState(payload, borradorId) {
      let pending = !!(
        payload &&
        payload.devengos &&
        payload.devengos.pending === true
      );
      if (!pending && payload && payload.asignacion) {
        pending = !!(
          payload.asignacion.devengos &&
          payload.asignacion.devengos.pending === true
        );
      }
      if (pending) {
        markDevengosWatchPending(borradorId || _.getSelectedBorradorId());
      }
    }

    app.markAsignacionesDevengosPending = markDevengosWatchPending;
    app.applyAsignacionesDevengosPendingState = applyDevengosPendingState;

  function getDevengosPollIntervalMs() {
    let configuredRaw =
      window['ASIG_DEVENGOS_POLL_INTERVAL_MS'] ??
      window['DEVENGOS_WORKER_INTERVAL_MS'];
    let configured = Number(configuredRaw);
    if (Number.isFinite(configured) && configured >= 5000) {
      return Math.round(configured);
    }
    return 30000;
  }

  async function pollDevengosConsolidados() {
    if (app.currentSection !== 'asignaciones') return;
    if (app.asignacionesState.devengosPollInFlight) return;

    let periodo = _.getPeriodo();
    if (!periodo || !periodo.anio || !periodo.mes) return;

    let borradorId = _.getSelectedBorradorId ? _.getSelectedBorradorId() : null;
    if (!borradorId) return;

    app.asignacionesState.devengosPollInFlight = true;
    try {
      let ts = Date.now();
      let res = await fetch(
        '/api/asignaciones/borradores/' +
          periodo.anio +
          '/' +
          periodo.mes +
          '?_ts=' +
          encodeURIComponent(String(ts)),
        { headers: _.headers(), cache: 'no-store' }
      );
      if (!res.ok) return;
      let json = await res.json();
      let rows = json && Array.isArray(json.borradores) ? json.borradores : [];
      let nextSnap = readDevengosWatchFromRows(rows, borradorId);
      if (!nextSnap) return;

      let prevSnap = app.asignacionesState.devengosWatch || null;
      let shouldNotify =
        prevSnap &&
        Number(prevSnap.borradorId) === Number(nextSnap.borradorId) &&
        prevSnap.pending === true &&
        nextSnap.pending === false &&
        !!nextSnap.updatedAt &&
        prevSnap.updatedAt !== nextSnap.updatedAt;

      app.asignacionesState.devengosWatch = nextSnap;

      if (shouldNotify) {
        _.showAlert(
          'Devengos Calculados. Recargando cuadrante...',
          'info'
        );
        await app.loadAsignacionesCuadrante();
      }
    } catch (_e) {
      // Polling silencioso: no interrumpir la edición por fallos transitorios.
    } finally {
      app.asignacionesState.devengosPollInFlight = false;
    }
  }

  function ensureAsignacionesDevengosPolling() {
    if (app.asignacionesState.devengosPollTimer) return;
    pollDevengosConsolidados();
    app.asignacionesState.devengosPollTimer = setInterval(function () {
      pollDevengosConsolidados();
    }, getDevengosPollIntervalMs());
  }

  async function exportAsignacionesPdfSimple() {
    if (!_.tabulator) {
      _.showAlert('No hay cuadrante cargado para exportar en PDF.', 'warning');
      return;
    }

    let borradorIdActual = _.getSelectedBorradorId
      ? _.getSelectedBorradorId()
      : null;
    if (typeof app.loadAsignacionesBorradores === 'function') {
      try {
        await app.loadAsignacionesBorradores(borradorIdActual);
      } catch (_refreshErr) {
        // No bloquea exportación: usar estado actual si falla el refresco.
      }
    }

    // @ts-ignore
    let jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) {
      _.showAlert('No se pudo inicializar jsPDF.', 'danger');
      return;
    }

    let rows = [];
    try {
      rows = _.tabulator.getData('active') || [];
    } catch (_e) {
      rows = _.tabulator.getData() || [];
    }

    let selectedAgenteIds = (app.asignacionesState.selectedAgenteIdsVista || [])
      .map(function (id) {
        return Number(id);
      })
      .filter(function (id) {
        return Number.isFinite(id) && id > 0;
      });
    if (!selectedAgenteIds.length) {
      _.showAlert('Marca al menos un agente para exportar el PDF.', 'warning');
      return;
    }
    let selectedSet = new Set(selectedAgenteIds);
    rows = rows.filter(function (r) {
      return selectedSet.has(Number(r && r.agente_id));
    });

    if (!rows.length) {
      _.showAlert(
        'No hay agentes marcados visibles para exportar en PDF.',
        'warning'
      );
      return;
    }

    let planningDays = Array.isArray(app.asignacionesState.cuadranteDays)
      ? app.asignacionesState.cuadranteDays
      : [];
    let dayFields = planningDays.map(function (d) {
      return 'dia_' + d.key;
    });
    if (!dayFields.length && rows.length) {
      dayFields = Object.keys(rows[0]).filter(function (k) {
        return k.indexOf('dia_') === 0;
      });
    }

    let actividadGrupoMap = resolveActividadGrupoMap();
    let gruposSet = new Set();
    let agentesGlobalesPorGrupo = new Map();
    let buckets = new Map();
    let agentesGlobales = new Set();

    rows.forEach(function (r) {
      let peloton =
        String(r.peloton_codigo || 'Sin peloton').trim() || 'Sin peloton';
      let empleo =
        String(r.empleo_nombre || 'Sin empleo').trim() || 'Sin empleo';
      let agenteId = Number(r.agente_id) || 0;
      let bucketKey = peloton.toLowerCase() + '||' + empleo.toLowerCase();

      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, {
          peloton: peloton,
          empleo: empleo,
          agenteIds: new Set(),
          agentesPorGrupo: new Map(),
        });
      }

      let bucket = buckets.get(bucketKey);
      if (agenteId) {
        bucket.agenteIds.add(agenteId);
        agentesGlobales.add(agenteId);
      }

      dayFields.forEach(function (field) {
        let cell = r[field];
        if (!cell || !Array.isArray(cell.servicios) || !cell.servicios.length)
          return;
        cell.servicios.forEach(function (s) {
          let actividadId = Number(s && s.id);
          let grupo = actividadGrupoMap.get(actividadId) || 'Sin grupo';
          gruposSet.add(grupo);

          if (!bucket.agentesPorGrupo.has(grupo))
            bucket.agentesPorGrupo.set(grupo, new Set());
          if (agenteId) bucket.agentesPorGrupo.get(grupo).add(agenteId);

          if (!agentesGlobalesPorGrupo.has(grupo))
            agentesGlobalesPorGrupo.set(grupo, new Set());
          if (agenteId) agentesGlobalesPorGrupo.get(grupo).add(agenteId);
        });
      });
    });

    let grupos = Array.from(gruposSet).sort(function (a, b) {
      return String(a).localeCompare(String(b), 'es');
    });

    if (!grupos.length) {
      _.showAlert(
        'No hay actividades asignadas para resumir en PDF.',
        'warning'
      );
      return;
    }

    let periodo = _.getPeriodo ? _.getPeriodo() : { anio: '', mes: '' };
    let mesLabel =
      Array.isArray(_.MONTHS) && _.MONTHS[Number(periodo.mes) - 1]
        ? _.MONTHS[Number(periodo.mes) - 1]
        : String(periodo.mes || '');
    let periodoLabel =
      String(mesLabel || '') + ' ' + String(periodo.anio || '');

    let borradorActual = (app.asignacionesState.borradores || []).find(
      function (b) {
        return Number(b.id) === Number(borradorIdActual);
      }
    );
    let borradorNombre =
      String(
        (app.asignacionesState.control &&
          app.asignacionesState.control.nombre) ||
          (borradorActual && borradorActual.nombre) ||
          'Sin borrador'
      ).trim() || 'Sin borrador';
    let cuadranteSel = app.asignacionesState.cuadranteSeleccionado || {};
    let cuadranteNombre =
      String(cuadranteSel.nombre || 'Sin cuadrante').trim() || 'Sin cuadrante';
    let ventanaInicio = String(cuadranteSel.fecha_inicio || '-').trim() || '-';
    let ventanaFin = String(cuadranteSel.fecha_fin || '-').trim() || '-';

    let updatedAtRaw =
      (app.asignacionesState.control &&
        app.asignacionesState.control.updated_at) ||
      null;
    let timestampActualizacion = formatTimestampEs(updatedAtRaw);

    let fechaHoraLabel = DateTime
      ? DateTime.now().setLocale('es').toFormat('dd/MM/yyyy HH:mm:ss')
      : '-';

    let sessionUserName =
      sessionStorage.getItem('userNombre') ||
      sessionStorage.getItem('userName') ||
      '';
    if (!sessionUserName) {
      let legacyUserName =
        localStorage.getItem('userNombre') || localStorage.getItem('userName');
      if (legacyUserName) {
        sessionUserName = legacyUserName;
        sessionStorage.setItem('userName', legacyUserName);
        localStorage.removeItem('userNombre');
        localStorage.removeItem('userName');
      }
    }

    let usuarioNombre =
      String(app.globalState.userName || sessionUserName || '-').trim() || '-';

    console.info('[asignaciones/pdf] timestamp fuente', {
      controlUpdatedAt: updatedAtRaw,
      timestampActualizacion: timestampActualizacion,
      control: app.asignacionesState.control || null,
    });

    let head = [['Pelotón', 'Empleo'].concat(grupos).concat(['Total Agentes'])];

    let bucketRows = Array.from(buckets.values()).sort(function (a, b) {
      let byPeloton = String(a.peloton).localeCompare(String(b.peloton), 'es');
      if (byPeloton !== 0) return byPeloton;
      return String(a.empleo).localeCompare(String(b.empleo), 'es');
    });

    let body = bucketRows.map(function (b) {
      let totalSet = new Set();
      let rowCounts = grupos.map(function (g) {
        let set = b.agentesPorGrupo.get(g);
        if (set)
          set.forEach(function (id) {
            totalSet.add(id);
          });
        return String(set ? set.size : 0);
      });

      return [truncateText(b.peloton, 16)]
        .concat([truncateText(b.empleo, 28)])
        .concat(rowCounts)
        .concat([String(totalSet.size)]);
    });

    let totalGlobalSet = new Set();
    let totalesGrupo = grupos.map(function (g) {
      let s = agentesGlobalesPorGrupo.get(g);
      if (s)
        s.forEach(function (id) {
          totalGlobalSet.add(id);
        });
      return String(s ? s.size : 0);
    });
    body.push(
      ['TOTAL', '-'].concat(totalesGrupo).concat([String(totalGlobalSet.size)])
    );

    let doc = new jsPDFCtor({
      orientation: 'landscape',
      unit: 'pt',
      format: 'a4',
    });
    doc.setFontSize(10);
    doc.text('Resúmen de Servicios para el Periodo; ' + periodoLabel, 40, 32);
    doc.setFontSize(8);
    doc.text(
      'Timestamp de actualización: ' + timestampActualizacion,
      doc.internal.pageSize.getWidth() - 40,
      32,
      { align: 'right' }
    );
    doc.setFontSize(8);
    doc.text(
      'Cuadrante: ' +
        cuadranteNombre +
        ' · Ventana: ' +
        ventanaInicio +
        ' -> ' +
        ventanaFin +
        ' · Borrador: ' +
        borradorNombre,
      40,
      46
    );

    doc.autoTable({
      startY: 56,
      head: head,
      body: body,
      theme: 'grid',
      styles: {
        fontSize: 6,
        cellPadding: 2,
        overflow: 'hidden',
        valign: 'middle',
      },
      headStyles: { fillColor: [52, 58, 64], textColor: 255 },
      columnStyles: (function () {
        let styles = {
          0: { cellWidth: 60 },
          1: { cellWidth: 130 },
        };
        for (let i = 0; i < grupos.length; i += 1)
          styles[i + 2] = { halign: 'center' };
        styles[grupos.length + 2] = { halign: 'center' };
        return styles;
      })(),
      didParseCell: function (data) {
        if (data.section === 'body' && data.row.index === body.length - 1) {
          data.cell.styles.fillColor = [244, 246, 248];
          data.cell.styles.fontStyle = 'bold';
        }
      },
      margin: { left: 40, right: 40 },
      didDrawPage: function () {
        doc.setFontSize(7);
        let footerY = doc.internal.pageSize.getHeight() - 16;
        doc.text('Usuario: ' + usuarioNombre, 40, footerY);
        doc.text(
          'Fecha y hora: ' + fechaHoraLabel,
          doc.internal.pageSize.getWidth() / 2,
          footerY,
          { align: 'center' }
        );

        let pages = doc.internal.getNumberOfPages();
        let pageText =
          'Pagina ' +
          String(doc.internal.getCurrentPageInfo().pageNumber) +
          ' / ' +
          String(pages);
        doc.text(pageText, doc.internal.pageSize.getWidth() - 80, footerY);
      },
    });

    doc.save('cuadrante_asignaciones.pdf');
  }

  function ensureAsigExportGroupBindings() {
    let exportToggle = document.querySelector('#asigExportDropdown > button');
    if (exportToggle) {
      // @ts-ignore
      exportToggle.disabled = false;
      exportToggle.classList.remove('disabled');
    }
    let groupToggle = document.querySelector('#asigGroupDropdown > button');
    if (groupToggle) {
      // @ts-ignore
      groupToggle.disabled = false;
      groupToggle.classList.remove('disabled');
    }

    // Fallback con botones directos (sin dropdown)
    let exportExcelBtn = document.getElementById('btnExportExcelAsig');
    if (exportExcelBtn) {
      // @ts-ignore
      exportExcelBtn.disabled = false;
      exportExcelBtn.classList.remove('disabled');
    }
    let exportPdfBtn = document.getElementById('btnExportPdfAsig');
    if (exportPdfBtn) {
      // @ts-ignore
      exportPdfBtn.disabled = false;
      exportPdfBtn.classList.remove('disabled');
    }
    let groupPelotonBtn = document.getElementById('btnGroupByPeloton');
    if (groupPelotonBtn) {
      // @ts-ignore
      groupPelotonBtn.disabled = false;
      groupPelotonBtn.classList.remove('disabled');
    }
    let groupEmpleoBtn = document.getElementById('btnGroupByEmpleo');
    if (groupEmpleoBtn) {
      // @ts-ignore
      groupEmpleoBtn.disabled = false;
      groupEmpleoBtn.classList.remove('disabled');
    }
    let groupClearBtn = document.getElementById('btnGroupClear');
    if (groupClearBtn) {
      // @ts-ignore
      groupClearBtn.disabled = false;
      groupClearBtn.classList.remove('disabled');
    }

    if (app._asigExportGroupDelegated) return;
    app._asigExportGroupDelegated = true;

    document.addEventListener('click', async function (e) {
      let target =
        // @ts-ignore
        e.target && e.target.closest
          ? // @ts-ignore
            e.target.closest(
              '#btnExportExcelAsig, #btnExportPdfAsig, #btnGroupByPeloton, #btnGroupByEmpleo, #btnGroupClear'
            )
          : null;
      if (!target) return;

      e.preventDefault();

      if (target.id === 'btnExportExcelAsig') {
        try {
          let periodo = _.getPeriodo();
          if (!periodo.anio || !periodo.mes) {
            _.showAlert(
              'Selecciona año y mes para exportar el cuadrante.',
              'warning'
            );
            return;
          }
          let borrId = _.getSelectedBorradorId();
          let params = new URLSearchParams({
            anio: String(periodo.anio),
            mes: String(periodo.mes),
          });
          if (borrId) {
            params.set('borrador_id', String(borrId));
            let borrador = (app.asignacionesState.borradores || []).find(
              function (b) {
                return Number(b.id) === Number(borrId);
              }
            );
            if (borrador && borrador.nombre)
              params.set('nombre_borrador', borrador.nombre);
          }
          let res = await fetch(
            '/api/asignaciones/exportar?' + params.toString(),
            { headers: _.headers() }
          );
          if (!res.ok) {
            let err = await res.json().catch(function () {
              return { error: 'Error al exportar cuadrante' };
            });
            throw new Error(err.error || 'Error al exportar cuadrante');
          }
          let blob = await res.blob();
          let url = URL.createObjectURL(blob);
          let disposition = res.headers.get('Content-Disposition') || '';
          let match = disposition.match(/filename="?([^";]+)"?/i);
          let filename = match && match[1] ? match[1] : 'cuadrante.xlsx';
          let link = document.createElement('a');
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
        } catch (error) {
          _.showAlert(error.message || 'Error al exportar cuadrante', 'danger');
        }
        return;
      }

      if (target.id === 'btnExportPdfAsig') {
        await exportAsignacionesPdfSimple();
        return;
      }

      if (target.id === 'btnGroupByPeloton') {
        if (!_.tabulator) {
          _.showAlert(
            'No hay cuadrante cargado para aplicar agrupación.',
            'warning'
          );
          return;
        }
        _.tabulator.setGroupBy('peloton_codigo');
        return;
      }

      if (target.id === 'btnGroupByEmpleo') {
        if (!_.tabulator) {
          _.showAlert(
            'No hay cuadrante cargado para aplicar agrupación.',
            'warning'
          );
          return;
        }
        _.tabulator.setGroupBy('empleo_nombre');
        return;
      }

      if (target.id === 'btnGroupClear') {
        if (!_.tabulator) {
          _.showAlert(
            'No hay cuadrante cargado para quitar la agrupación.',
            'warning'
          );
          return;
        }
        _.tabulator.setGroupBy(false);
      }
    });
  }

  const DESCANSOS_ESPECIALES_SELECTION_KEY =
    'grs1.asignaciones.descansosEspeciales.selection';

  function readDescansosEspecialesSelectionMap() {
    try {
      let raw = sessionStorage.getItem(DESCANSOS_ESPECIALES_SELECTION_KEY);
      if (!raw) return {};
      let parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_e) {
      return {};
    }
  }

  function getDescansosEspecialesSelectionForBorrador(borradorId) {
    let key = String(Number(borradorId) || '');
    if (!key) return [];
    let map = readDescansosEspecialesSelectionMap();
    let stored = Array.isArray(map[key]) ? map[key] : [];
    return Array.from(
      new Set(
        stored
          .map(function (value) {
            return Number(value);
          })
          .filter(function (value) {
            return Number.isInteger(value) && value > 0;
          })
      )
    );
  }

  function clearDescansosEspecialesSelectionForBorrador(borradorId) {
    let key = String(Number(borradorId) || '');
    if (!key) return;
    let map = readDescansosEspecialesSelectionMap();
    if (!Object.prototype.hasOwnProperty.call(map, key)) return;
    delete map[key];
    sessionStorage.setItem(
      DESCANSOS_ESPECIALES_SELECTION_KEY,
      JSON.stringify(map)
    );
  }

  function normalizeManualReglaOverride(regla) {
    if (!regla) return null;
    return {
      _regla_id: Number(regla.id) || null,
      actividad_id: Number(regla.actividad_id) || null,
      grupo_id: Number(regla.grupo_id) || null,
      empleo_id:
        regla.empleo_id == null || String(regla.empleo_id).trim() === ''
          ? null
          : String(regla.empleo_id).trim(),
      tipo_movimiento: regla.tipo_movimiento || 'devengo',
      valor: Number(regla.valor) || 0,
      aplica_cruce_festivo: !!regla.aplica_cruce_festivo,
      tipo_dia: regla.tipo_dia || 'periodo',
      condicion_dias: Number(regla.condicion_dias) || 6,
      condicion_tipo: regla.condicion_tipo || 'en_periodo',
      condicion_alcance: regla.condicion_alcance || 'cualquier_actividad',
      excluir_festivos:
        regla.excluir_festivos === undefined ? true : !!regla.excluir_festivos,
      prioridad: Number(regla.prioridad) || 100,
    };
  }

  function updateValidarProgress(percent, text) {
    let wrap = document.getElementById('asigValidarProgressWrap');
    let bar = document.getElementById('asigValidarProgressBar');
    let label = document.getElementById('asigValidarProgressText');
    if (!wrap || !bar || !label) return;

    let value = Math.max(0, Math.min(100, Number(percent) || 0));
    wrap.classList.remove('d-none');
    bar.style.width = value + '%';
    bar.setAttribute('aria-valuenow', String(Math.round(value)));
    bar.textContent = Math.round(value) + '%';
    label.textContent = text || 'Validando borrador...';
  }

  function resetValidarProgress() {
    let wrap = document.getElementById('asigValidarProgressWrap');
    let bar = document.getElementById('asigValidarProgressBar');
    let label = document.getElementById('asigValidarProgressText');
    if (wrap) wrap.classList.add('d-none');
    if (bar) {
      bar.style.width = '0%';
      bar.setAttribute('aria-valuenow', '0');
      bar.textContent = '0%';
    }
    if (label) label.textContent = '';
  }

  function waitValidarProgressClose() {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, 550);
    });
  }

  async function openAsignacionesValidarModal(options) {
    let opts = options || {};
    let mode = String(opts.mode || 'validar').toLowerCase();
    let isOnboarding = mode === 'onboarding';
    let cuadranteSel = app.asignacionesState
      ? app.asignacionesState.cuadranteSeleccionado || null
      : null;
    let selectorPeriodo = _.getPeriodo ? _.getPeriodo() : { anio: 0, mes: 0 };
    let p = {
      anio:
        Number(opts.anio) ||
        Number(cuadranteSel && cuadranteSel.anio_referencia) ||
        Number(selectorPeriodo.anio),
      mes:
        Number(opts.mes) ||
        Number(cuadranteSel && cuadranteSel.mes_referencia) ||
        Number(selectorPeriodo.mes),
    };

    if (
      !Number.isInteger(p.anio) ||
      p.anio < 2020 ||
      !Number.isInteger(p.mes) ||
      p.mes < 1 ||
      p.mes > 12
    ) {
      _.showAlert(
        'No se pudo determinar un período válido (año/mes) para cargar reglas especiales.',
        'warning'
      );
      return;
    }
    let modalEl = _.ensureAsignacionesValidarModal();
    if (!modalEl) {
      _.showAlert('No se pudo inicializar el modal de validación.', 'warning');
      return;
    }
    if (modalEl.dataset.progressBound !== '1') {
      modalEl.dataset.progressBound = '1';
      modalEl.addEventListener('hidden.bs.modal', function () {
        resetValidarProgress();
      });
    }

    let contextEl = document.getElementById('asigValidarModalContext');
    let acceptSwitch = /** @type {HTMLInputElement | null} */ (
      document.getElementById('asigValidarAceptarSwitch')
    );
    let acceptLabel = document.getElementById('asigValidarAceptarLabel');
    let confirmBtn = /** @type {HTMLButtonElement | null} */ (
      document.getElementById('btnConfirmAsigValidar')
    );
    let reglasWrap = document.getElementById('asigValidarReglasWrap');
    let reglasTitle = document.getElementById('asigValidarReglasTitle');
    let reglasHelp = document.getElementById('asigValidarReglasHelp');
    let reglasStatus = document.getElementById('asigValidarReglasStatus');
    let reglasList = document.getElementById('asigValidarReglasList');
    let borradorId = Number(opts.borradorId) || _.getSelectedBorradorId();
    let cuadrante = null;
    let reglas = [];
    if (borradorId) {
      let borradorSel = /** @type {HTMLSelectElement | null} */ (
        document.getElementById('asigBorrador')
      );
      if (borradorSel) borradorSel.value = String(borradorId);
      if (app.asignacionesState) app.asignacionesState.borradorId = borradorId;
    }

    if (!acceptSwitch || !acceptLabel || !confirmBtn) {
      _.showAlert(
        'No se pudo abrir el modal: faltan controles de confirmación.',
        'warning'
      );
      return;
    }
    if (!isOnboarding && !borradorId) {
      _.showAlert(
        'No se pudo abrir el modal: no hay borrador seleccionado para el período.',
        'warning'
      );
      return;
    }

    if (contextEl) {
      contextEl.textContent = isOnboarding
        ? 'Paso inicial: seleccione la regla especial y guarde el cálculo manual de devengos para el período ' +
          p.anio +
          '/' +
          String(p.mes).padStart(2, '0') +
          '. La acción se grabará para todos los agentes.'
        : 'Se validará el borrador de ' +
          p.anio +
          '/' +
          String(p.mes).padStart(2, '0') +
          ' y reemplazará el definitivo del período.';
    }

    let titleEl = document.getElementById('asigValidarModalLabel');
    if (titleEl) {
      titleEl.innerHTML = isOnboarding
        ? '<i class="bi bi-calendar2-check me-2"></i>Confirmar Cuadrante'
        : '<i class="bi bi-exclamation-triangle me-2"></i>Validar borrador';
    }
    let switchDescEl = acceptSwitch
      ? acceptSwitch.closest('.d-flex') && acceptSwitch.closest('.d-flex').querySelector('.text-muted')
      : null;
    if (switchDescEl) {
      switchDescEl.textContent = isOnboarding
        ? 'Confirma que quieres validar este cuadrante'
        : 'Confirma que quieres validar este borrador';
    }

    acceptSwitch.checked = false;
    acceptLabel.textContent = 'No';
    confirmBtn.disabled = true;
    if (reglasWrap) reglasWrap.classList.add('d-none');
    resetValidarProgress();
    if (reglasTitle) {
      reglasTitle.textContent = isOnboarding
        ? 'Reglas especiales candidatas'
        : 'Reglas especiales opcionales al validar';
    }
    if (reglasHelp) reglasHelp.textContent = '';
    if (reglasStatus) {
      reglasStatus.textContent = '';
      reglasStatus.className = 'small text-muted mb-2';
    }
    if (reglasList) reglasList.innerHTML = '';

    let selectedReglasEspecialesIds = getDescansosEspecialesSelectionForBorrador(
      borradorId
    );

    try {
      let previewRes = await fetch(
        '/api/asignaciones/validar/preview-reglas-especiales',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + app.globalState.token,
          },
          body: JSON.stringify({
            anio: p.anio,
            mes: p.mes,
          }),
        }
      );
      if (!previewRes.ok) {
        let err = await previewRes.json();
        throw new Error(
          err.message || 'No se pudieron cargar las reglas especiales candidatas'
        );
      }
      let previewJson = await previewRes.json();
      reglas = Array.isArray(previewJson.reglas_candidatas)
        ? previewJson.reglas_candidatas
        : [];
      if (isOnboarding) {
        if (!selectedReglasEspecialesIds.length && reglas.length === 1) {
          selectedReglasEspecialesIds = [Number(reglas[0].id)].filter(function (id) {
            return Number.isInteger(id) && id > 0;
          });
        }
      }
      cuadrante = previewJson.cuadrante || null;
      if (reglas.length && reglasWrap && reglasList) {
        reglasWrap.classList.remove('d-none');
        if (reglasHelp) {
          let cuadranteTxt = cuadrante
            ? 'Cuadrante #' +
              String(cuadrante.id || '-') +
              ' · ' +
              String(cuadrante.fecha_inicio || '-') +
              ' a ' +
              String(cuadrante.fecha_fin || '-')
            : 'Cuadrante del período activo';
          reglasHelp.textContent = isOnboarding
            ? cuadranteTxt
            : cuadranteTxt +
              ' · Estas reglas se aplicarán junto con la validación del borrador si las marcas.';
        }
        let preselectedSet = new Set(
          selectedReglasEspecialesIds.map(function (id) {
            return Number(id);
          })
        );
        reglasList.innerHTML = reglas
          .map(function (regla) {
            let descripcion = regla.descripcion
              ? String(regla.descripcion)
              : 'Regla #' + String(regla.id);
            let actividad = regla.actividad_codigo
              ? String(regla.actividad_codigo)
              : '[DSC]';
            let checked = preselectedSet.has(Number(regla.id))
              ? ' checked'
              : '';
            return (
              '<label class="d-flex align-items-start gap-2 small py-1 border-bottom">' +
              '<input class="form-check-input mt-1 asig-validar-regla-check" type="checkbox" value="' +
              String(regla.id) +
              '"' +
              checked +
              '>' +
              '<span>' +
              '<span class="fw-semibold d-block">' +
              app.escapeHtml(descripcion) +
              '</span>' +
              '<span class="text-muted d-block">' +
              'Actividad: ' +
              app.escapeHtml(actividad) +
              ' · Prioridad: ' +
              app.escapeHtml(String(regla.prioridad || '-')) +
              '</span>' +
              '</span>' +
              '</label>'
            );
          })
          .join('');
        if (reglasStatus) {
          reglasStatus.textContent = isOnboarding
            ? (selectedReglasEspecialesIds.length && reglas.length === 1
              ? 'Se ha preseleccionado una regla especial (opcional).'
              : 'La selección de reglas especiales es opcional.')
            : 'Si existe una regla activa especial para el cuadrante, aparecerá aquí como opción adicional. Si marcas varias, el backend resolverá conflictos por prioridad.';
        }
        reglasList
          .querySelectorAll('.asig-validar-regla-check')
          .forEach(function (checkbox) {
            checkbox.addEventListener('change', function () {
              selectedReglasEspecialesIds = Array.from(
                reglasList.querySelectorAll('.asig-validar-regla-check:checked')
              ).map(function (el) {
                return Number(el.getAttribute('value'));
              });
            });
          });
      }
    } catch (e) {
      if (reglasStatus) {
        reglasStatus.textContent =
          e.message || 'No se pudieron cargar reglas especiales';
        reglasStatus.className = 'small text-danger mb-2';
      }
    }

    let newConfirmBtn = /** @type {HTMLButtonElement} */ (
      confirmBtn.cloneNode(true)
    );
    if (newConfirmBtn) {
      newConfirmBtn.innerHTML = isOnboarding
        ? '<i class="bi bi-check2-circle me-1"></i>Confirmar Cuadrante'
        : newConfirmBtn.innerHTML;
    }
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    newConfirmBtn.disabled = true;

    acceptSwitch.onchange = function () {
      let accepted = !!acceptSwitch.checked;
      acceptLabel.textContent = accepted ? 'Sí' : 'No';
      newConfirmBtn.disabled = !accepted;
    };

    newConfirmBtn.addEventListener('click', async function () {
      if (!acceptSwitch.checked) return;
      try {
        newConfirmBtn.disabled = true;
        updateValidarProgress(
          30,
          isOnboarding
            ? '30% · Solicitud enviada. Preparando la confirmación del cuadrante...'
            : '30% · Solicitud enviada. Iniciando validación del borrador...'
        );

        if (isOnboarding) {
          let selectedIds = Array.from(
            new Set(
              selectedReglasEspecialesIds
                .map(function (value) {
                  return Number(value);
                })
                .filter(function (value) {
                  return Number.isInteger(value) && value > 0;
                })
            )
          );
          if (!selectedIds.length) {
            updateValidarProgress(
              100,
              '100% · Cuadrante confirmado sin reglas especiales. Cerrando ventana...'
            );
            await waitValidarProgressClose();
            bootstrap.Modal.getOrCreateInstance(modalEl).hide();
            if (typeof opts.onSaved === 'function') {
              await opts.onSaved({
                mode: 'onboarding',
                movimientos: [],
                count: 0,
              });
            }
            _.showAlert(
              'Cuadrante confirmado sin aplicar reglas especiales.',
              'success'
            );
            return;
          }

          if (!app.asignacionesState.meta || !Array.isArray(app.asignacionesState.meta.agentes) || !app.asignacionesState.meta.agentes.length) {
            if (reglasStatus) {
              reglasStatus.textContent = 'Cargando agentes...';
              reglasStatus.className = 'small text-muted mb-2';
            }
            try {
              let metaRes = await fetch('/api/asignaciones/meta', { headers: _.headers ? _.headers() : {} });
              if (metaRes.ok) {
                let metaJson = await metaRes.json();
                app.asignacionesState.meta = metaJson;
              }
            } catch (_metaErr) { /* ignorar, se comprobará a continuación */ }
          }
          let metaAgentes =
            (app.asignacionesState.meta && app.asignacionesState.meta.agentes) || [];
          let agentes = metaAgentes
            .map(function (agente) {
              return {
                id: Number(agente.id_agente || agente.id),
                empleo_id:
                  agente.empleo_id == null || String(agente.empleo_id).trim() === ''
                    ? null
                    : String(agente.empleo_id).trim(),
                empleo_nombre: agente.empleo_nombre || null,
              };
            })
            .filter(function (agente) {
              return Number.isInteger(agente.id) && agente.id > 0;
            });
          if (!agentes.length) {
            throw new Error('No hay agentes disponibles. Asegúrese de que el cuadrante tiene agentes asignados.');
          }

          let jsonHeaders = Object.assign(
            { 'Content-Type': 'application/json' },
            _.headers ? _.headers() : {}
          );
          let ruleMap = new Map(
            reglas
              .map(function (regla) {
                return [Number(regla.id), regla];
              })
              .filter(function (pair) {
                return Number.isInteger(pair[0]) && pair[0] > 0 && pair[1];
              })
          );
          let previewItems = [];
          let previewBase = null;

          for (let i = 0; i < selectedIds.length; i += 1) {
            let selectedRule = ruleMap.get(selectedIds[i]);
            if (!selectedRule) {
              throw new Error('La regla seleccionada ya no está disponible.');
            }
            let ruleOverride = normalizeManualReglaOverride(selectedRule);
            if (!ruleOverride) {
              throw new Error('La regla seleccionada no es válida.');
            }

            if (!ruleOverride.actividad_id) {
              throw new Error(
                'La regla "' + String(selectedRule.descripcion || selectedRule.id) +
                '" no tiene actividad_id en base de datos. Actualiza la regla antes de continuar.'
              );
            }

            previewBase = null;
            if (ruleOverride.actividad_id) {
              let representativeAgent = agentes[0];
              let previewRes = await fetch('/api/asignaciones-reglas/preview', {
                method: 'POST',
                headers: jsonHeaders,
                body: JSON.stringify({
                  agente_id: representativeAgent.id,
                  actividad_id: ruleOverride.actividad_id,
                  fecha: String((cuadrante && cuadrante.fecha_inicio) || p.anio + '-' + String(p.mes).padStart(2, '0') + '-01'),
                  fecha_hasta: String((cuadrante && cuadrante.fecha_fin) || p.anio + '-' + String(p.mes).padStart(2, '0') + '-28'),
                  regla_override: ruleOverride,
                }),
              });
              let previewJson = null;
              try {
                previewJson = await previewRes.json();
              } catch (_e) {
                previewJson = null;
              }
              if (!previewRes.ok || !(previewJson && previewJson.preview)) {
                throw new Error(
                  (previewJson && previewJson.message) ||
                    'No se pudo calcular el preview de la regla seleccionada'
                );
              }
              previewBase = previewJson.preview;
            }

            let fechaRegla = String(
              (cuadrante && cuadrante.fecha_inicio) ||
              p.anio + '-' + String(p.mes).padStart(2, '0') + '-01'
            );
            let fechaHastaRegla = String(
              (cuadrante && cuadrante.fecha_fin) ||
              p.anio + '-' + String(p.mes).padStart(2, '0') + '-28'
            );

            agentes.forEach(function (agente) {
              let previewSnapshot = previewBase
                ? Object.assign({}, previewBase, {
                    agente: Object.assign({}, previewBase.agente || {}, {
                      id: agente.id,
                      empleo_id: agente.empleo_id,
                      empleo_nombre: agente.empleo_nombre,
                    }),
                  })
                : null;
              previewItems.push({
                agente_id: agente.id,
                actividad_id: ruleOverride.actividad_id,
                borrador_id: null,
                fecha: (previewBase && previewBase.fecha) || fechaRegla,
                fecha_hasta: (previewBase && previewBase.fecha_hasta) || fechaHastaRegla,
                preview_snapshot: previewSnapshot,
                regla_override: ruleOverride,
              });
            });
          }

          let bulkPayload = {
            items: previewItems,
            observaciones:
              'Devengo manual desde onboarding de descansos especiales',
          };
          updateValidarProgress(
            75,
            '75% · Confirmación aplicada. Guardando los movimientos manuales del cuadrante...'
          );
          let bulkRes = await fetch('/api/asignaciones-reglas/movimientos-manuales/bulk', {
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify(bulkPayload),
          });
          let bulkJson = null;
          try {
            bulkJson = await bulkRes.json();
          } catch (_e) {
            bulkJson = null;
          }
          if (!bulkRes.ok || !(bulkJson && bulkJson.ok !== false)) {
            throw new Error(
              (bulkJson && bulkJson.message) ||
                'No se pudieron grabar los movimientos manuales'
            );
          }

            updateValidarProgress(
              100,
              '100% · Cuadrante confirmado correctamente. Cerrando ventana...'
            );
            await waitValidarProgressClose();
          bootstrap.Modal.getOrCreateInstance(modalEl).hide();
          if (typeof opts.onSaved === 'function') {
            await opts.onSaved({
              mode: 'onboarding',
              movimientos: bulkJson.movimientos || [],
              count: Number(bulkJson.count || 0),
            });
          }
          _.showAlert(
            'Se han grabado ' + String(bulkJson.count || 0) + ' movimientos manuales.',
            'success'
          );

          return;
        }

        let res = await fetch('/api/asignaciones/validar', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + app.globalState.token,
          },
          body: JSON.stringify({
            anio: p.anio,
            mes: p.mes,
            borrador_id: borradorId,
            reglas_especiales_ids: selectedReglasEspecialesIds.length
              ? selectedReglasEspecialesIds
              : null,
          }),
        });
        if (res.status === 409) {
          resetValidarProgress();
          newConfirmBtn.disabled = !acceptSwitch.checked;
          _.showAlert('Otro usuario está validando este periodo. Recargue.', 'warning');
          return;
        }
        if (!res.ok) {
          let err = await res.json();
          throw new Error(err.message || 'Error al validar borrador');
        }
        updateValidarProgress(
          75,
          '75% · Validación aplicada. Actualizando el estado del período...'
        );
        clearDescansosEspecialesSelectionForBorrador(borradorId);
        let payload = await res.json();
        let reglasTxt =
          payload &&
          Array.isArray(payload.reglas_especiales_aplicadas) &&
          payload.reglas_especiales_aplicadas.length
            ? ' · Reglas especiales seleccionadas: ' +
              String(payload.reglas_especiales_aplicadas.length)
            : '';
        updateValidarProgress(
          100,
          '100% · Borrador validado correctamente. Cerrando ventana...'
        );
        await waitValidarProgressClose();
        bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        _.showAlert('Borrador validado correctamente' + reglasTxt, 'success');
        await app.loadAsignacionesCuadrante();
        resetValidarProgress();
      } catch (e) {
        let msg = (e && e.message) || 'Error inesperado al guardar';
        if (reglasStatus) {
          reglasStatus.textContent = msg;
          reglasStatus.className = 'small text-danger mb-2';
          if (reglasWrap) reglasWrap.classList.remove('d-none');
        }
        resetValidarProgress();
        _.showAlert(msg, 'danger');
        newConfirmBtn.disabled = !acceptSwitch.checked;
      }
    });

    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  app.openAsignacionesValidarModal = openAsignacionesValidarModal;

  // ── Carga de metadatos ──────────────────────────────────────────

  app.loadAsignacionesMeta = async function loadAsignacionesMeta() {
    let anioEl = document.getElementById('asigAnio');
    let mesEl = document.getElementById('asigMes');

    // @ts-ignore
    if (anioEl && !anioEl.value) anioEl.value = '';
    // @ts-ignore
    if (mesEl && !mesEl.options.length) {
      mesEl.innerHTML =
        '<option value=""></option>' +
        getMonthsSafe()
          .map(function (m, idx) {
            let val = idx + 1;
            return '<option value="' + val + '">' + m + '</option>';
          })
          .join('');
      // @ts-ignore
      mesEl.value = '';
    }

    try {
      let res = await fetch('/api/asignaciones/meta', { headers: _.headers() });
      if (!res.ok)
        throw new Error('No se pudieron cargar metadatos de asignaciones');
      let json = await res.json();
      app.asignacionesState.meta = json;
      if (!Array.isArray(app.asignacionesState.selectedActividadIds)) {
        app.asignacionesState.selectedActividadIds = [];
      }
      renderAsigActividadFilterList(
        // @ts-ignore
        (document.getElementById('asigActividadFilterSearch') || {}).value || ''
      );
      if (typeof app.asignacionesState.searchTerm !== 'string')
        app.asignacionesState.searchTerm = '';
      _.refreshMetaResumenFromState();
      // La carga inicial de borradores y cuadrante la gestiona el sistema de
      // cuadrantes (dashboard-cuadrantes.js → loadCuadrantes → applyCuadranteSelection).
      // Llamarla aquí también causa una doble carga al inicializar la sección.
    } catch (e) {
      _.showAlert(e.message, 'danger');
    }
  };

  // ── Carga del cuadrante ─────────────────────────────────────────

  app.loadAsignacionesCuadrante = async function loadAsignacionesCuadrante(
    forceBorradorId
  ) {
    let periodo = _.getPeriodo();
    if (!periodo.anio || !periodo.mes) {
      let cuadranteSelEl = document.getElementById('asigCuadrante');
      let hasCuadranteActivo = !!(
        (app.asignacionesState &&
          app.asignacionesState.cuadranteSeleccionado &&
          app.asignacionesState.cuadranteSeleccionado.id) ||
        // @ts-ignore
        (cuadranteSelEl && cuadranteSelEl.value)
      );
      if (hasCuadranteActivo) return;
      _.showAlert('Seleccione un cuadrante para definir el período', 'warning');
      return;
    }

    app.asignacionesState.anio = periodo.anio;
    app.asignacionesState.mes = periodo.mes;

    let borradorId = forceBorradorId || _.getSelectedBorradorId();
    app.asignacionesState.borradorId = borradorId;

    let planningDays = getPlanningWindowSafe(periodo.anio, periodo.mes);
    if (!planningDays.length) {
      _.showAlert(
        'El período de asignaciones se define por el cuadrante seleccionado',
        'warning'
      );
      let emptyContainer = document.getElementById('asigGridContainer');
      if (emptyContainer) {
        emptyContainer.innerHTML =
          '<div class="text-center text-muted py-4">Seleccione un cuadrante para cargar el calendario de asignaciones.</div>';
      }
      app.asignacionesState.cuadrante = null;
      app.asignacionesState.cuadranteDays = [];
      _.refreshMetaResumenFromState();
      return;
    }

    let periodSet = new Set(
      planningDays.map(function (d) {
        return _.periodoKey(d.anio, d.mes);
      })
    );
    let periodList = Array.from(periodSet).map(function (k) {
      let parts = k.split('-');
      return { anio: Number(parts[0]), mes: Number(parts[1]), key: k };
    });

    let container = document.getElementById('asigGridContainer');
    if (container)
      container.innerHTML =
        '<div class="text-center text-muted py-4"><div class="spinner-border spinner-border-sm me-2" role="status"></div>Cargando cuadrante...</div>';

    try {
      if (!borradorId) {
        let currentBorradores = app.asignacionesState.borradores || [];
        let canonico = currentBorradores.find(function (b) {
          return b.estado === 'validado' || b.estado === 'modificado';
        });
        if (canonico) {
          borradorId = canonico.id;
          app.asignacionesState.borradorId = borradorId;
          let borradorEl = document.getElementById('asigBorrador');
          // @ts-ignore
          if (borradorEl) borradorEl.value = String(borradorId);
        }
      }

      let fechaCorteDevengo = null;
      let fechaFinDevengo = null;
      let cuadranteSeleccionado = app.asignacionesState.cuadranteSeleccionado;
      if (
        DateTime &&
        cuadranteSeleccionado &&
        cuadranteSeleccionado.fecha_inicio
      ) {
        let inicioVentana = DateTime.fromISO(
          String(cuadranteSeleccionado.fecha_inicio),
          { zone: 'utc' }
        );
        if (inicioVentana.isValid) {
          fechaCorteDevengo = inicioVentana.minus({ days: 1 }).toISODate();
        }
      }
      if (
        DateTime &&
        cuadranteSeleccionado &&
        cuadranteSeleccionado.fecha_fin
      ) {
        let finVentana = DateTime.fromISO(
          String(cuadranteSeleccionado.fecha_fin),
          {
            zone: 'utc',
          }
        );
        if (finVentana.isValid) {
          fechaFinDevengo = finVentana.toISODate();
        }
      }

      let requestTs = Date.now();
      let responses = await Promise.all(
        periodList.map(async function (p) {
          let params = [];
          if (fechaCorteDevengo) {
            params.push('fecha_corte=' + encodeURIComponent(fechaCorteDevengo));
          }
          if (fechaFinDevengo) {
            params.push('fecha_fin=' + encodeURIComponent(fechaFinDevengo));
          }
          // En ventanas con traspaso (p.ej. 29/04-12/05),
          // usar SIEMPRE el mismo borrador seleccionado en ambos meses.
          if (borradorId) {
            params.push(
              'borrador_id=' + encodeURIComponent(String(borradorId))
            );
          }
          params.push('_ts=' + encodeURIComponent(String(requestTs)));
          let qs = params.length ? '?' + params.join('&') : '';
          let res = await fetch(
            '/api/asignaciones/cuadrante/' + p.anio + '/' + p.mes + qs,
            { headers: _.headers(), cache: 'no-store' }
          );
          if (!res.ok)
            throw new Error('No se pudo cargar el cuadrante de ' + p.key);
          let json = await res.json();
          return { key: p.key, data: json };
        })
      );

      let selectedKey = _.periodoKey(periodo.anio, periodo.mes);
      let selected = responses.find(function (r) {
        return r.key === selectedKey;
      });
      let merged = {
        control: selected ? selected.data.control || null : null,
        selectedBorrador: selected
          ? selected.data.selectedBorrador || null
          : null,
        saldosDevengo:
          selected && selected.data && selected.data.saldosDevengo
            ? selected.data.saldosDevengo
            : {},
        requisitosByAgente:
          selected && selected.data && selected.data.requisitosByAgente
            ? selected.data.requisitosByAgente
            : {},
        borrador: [],
        borradorServicios: [],
        definitivo: [],
        definitivoServicios: [],
      };
      responses.forEach(function (r) {
        let d = r.data || {};
        merged.borrador = merged.borrador.concat(d.borrador || []);
        merged.borradorServicios = merged.borradorServicios.concat(
          d.borradorServicios || []
        );
        merged.definitivo = merged.definitivo.concat(d.definitivo || []);
        merged.definitivoServicios = merged.definitivoServicios.concat(
          d.definitivoServicios || []
        );
      });

      if (
        (!merged.requisitosByAgente ||
          !Object.keys(merged.requisitosByAgente).length) &&
        responses.length
      ) {
        let reqSource = responses.find(function (r) {
          let req = r && r.data && r.data.requisitosByAgente;
          return req && typeof req === 'object' && Object.keys(req).length;
        });
        if (reqSource && reqSource.data && reqSource.data.requisitosByAgente) {
          merged.requisitosByAgente = reqSource.data.requisitosByAgente;
        }
      }

      // Deduplicar servicios por clave funcional (asignacion_id + actividad_id)
      // cuando el cuadrante abarca varios períodos (trasspaso de mes) el mismo
      // servicio puede aparecer en ambas respuestas de la API.
      let seenBorrSvc = new Set();
      merged.borradorServicios = merged.borradorServicios.filter(function (s) {
        let k = String(s.asignacion_borrador_id) + '|' + String(s.actividad_id);
        if (seenBorrSvc.has(k)) return false;
        seenBorrSvc.add(k);
        return true;
      });
      let seenDefSvc = new Set();
      merged.definitivoServicios = merged.definitivoServicios.filter(
        function (s) {
          let k =
            String(s.asignacion_definitivo_id || s.asignacion_id) +
            '|' +
            String(s.actividad_id);
          if (seenDefSvc.has(k)) return false;
          seenDefSvc.add(k);
          return true;
        }
      );

      app.asignacionesState.control = merged.control;
      app.asignacionesState.cuadrante = merged;
      // Compatibilidad: algunas partes del grid aún leen de cuadranteData.
      app.asignacionesState.cuadranteData = merged;
      syncDevengosWatchSnapshotFromRows(
        app.asignacionesState.borradores,
        borradorId
      );
      _.refreshMetaResumenFromState();
      _.renderEstado(merged.control || null);
      _.renderGridTabulator(merged, periodo.anio, periodo.mes);
    } catch (e) {
      _.showAlert(e.message, 'danger');
      if (container)
        container.innerHTML =
          '<div class="text-center text-danger py-4">Error al cargar cuadrante</div>';
    }
  };

  // ── Event listeners ─────────────────────────────────────────────

  app.setupAsignacionesEventListeners =
    function setupAsignacionesEventListeners() {
      function isConsultaReadOnly() {
        return (
          typeof _.isConsultaReadOnlyRole === 'function' &&
          _.isConsultaReadOnlyRole()
        );
      }

      function guardReadOnlyAction() {
        if (!isConsultaReadOnly()) return false;
        _.showAlert('Perfil consulta: solo lectura', 'warning');
        return true;
      }

      function applyConsultaReadOnlyUi() {
        if (!isConsultaReadOnly()) return;
        if (typeof _.disableWriteActionButtons !== 'function') return;
        _.disableWriteActionButtons([
          'btnAsigNuevoBorrador',
          'btnConfirmarNuevoBorrador',
          'btnEditObservacionesBorrador',
          'btnGuardarObservacionesBorrador',
          'btnAsigDeleteBorrador',
          'btnConfirmDeleteBorrador',
          'btnAsigBulk',
          'btnSaveAsigBulk',
          'btnAsigDelete',
          'btnRunAsigDelete',
          'btnAsigCopy',
          'btnRunAsigCopy',
          'btnAsigValidate',
          'btnConfirmAsigValidar',
          'btnAsigConsolidarDevengos',
          'btnConfirmAsigConsolidarDevengos',
          'btnSaveAsigCell',
        ]);
      }

      let reloadBtn = document.getElementById('btnReloadAsignaciones');
      ensureAsignacionesDevengosPolling();
      applyConsultaReadOnlyUi();
      if (reloadBtn && reloadBtn.dataset.bound !== '1') {
        reloadBtn.dataset.bound = '1';
        reloadBtn.addEventListener('click', async function () {
          if (app.asignacionesState) {
            app.asignacionesState.cuadrante = null;
            app.asignacionesState.borradores = [];
            app.asignacionesState.borradorId = null;
            app.asignacionesState.control = null;
          }
          await app.loadAsignacionesBorradores();
          await app.loadAsignacionesCuadrante();
        });
      }

      let anioEl = document.getElementById('asigAnio');
      let mesEl = document.getElementById('asigMes');
      let borrSel = document.getElementById('asigBorrador');
      let nuevoBorrBtn = document.getElementById('btnAsigNuevoBorrador');
      let searchEl = document.getElementById('asigSearchAgente');
      let actFilterToggleEl = document.getElementById('asigActividadFilterToggle');
      let actFilterPanelEl = document.getElementById('asigActividadFilterPanel');
      let actFilterSearchEl = document.getElementById('asigActividadFilterSearch');
      let actFilterListEl = document.getElementById('asigActividadFilterList');
      let actFilterApplyEl = document.getElementById('asigActividadFilterApply');
      let actFilterClearEl = document.getElementById('asigActividadFilterClear');
      let actFilterFechaInicioElRaw = document.getElementById('asigActividadFilterFechaInicio');
      let actFilterFechaInicioEl =
        actFilterFechaInicioElRaw instanceof HTMLInputElement
          ? actFilterFechaInicioElRaw
          : null;
      let actFilterFechaFinElRaw = document.getElementById('asigActividadFilterFechaFin');
      let actFilterFechaFinEl =
        actFilterFechaFinElRaw instanceof HTMLInputElement
          ? actFilterFechaFinElRaw
          : null;

      if (
        actFilterToggleEl &&
        typeof bootstrap !== 'undefined' &&
        bootstrap.Tooltip
      ) {
        bootstrap.Tooltip.getOrCreateInstance(actFilterToggleEl);
      }

      // ── Búsqueda de agentes ──
      if (searchEl && searchEl.dataset.bound !== '1') {
        searchEl.dataset.bound = '1';
        // @ts-ignore
        searchEl.value = app.asignacionesState.searchTerm || '';
        searchEl.addEventListener('input', function () {
          // @ts-ignore
          app.asignacionesState.searchTerm = searchEl.value || '';
          if (typeof _.clearAsigSelection === 'function') _.clearAsigSelection();
          if (_.tabulator) {
            if (typeof _.applyAsigAdvancedFilters === 'function')
              _.applyAsigAdvancedFilters();
            else {
              // @ts-ignore
              let term = _.normalizeSearchText(searchEl.value || '');
              if (!term) {
                _.tabulator.clearFilter();
              } else {
                _.tabulator.setFilter(function (rowData) {
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
                      if (d)
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
                  return _.normalizeSearchText(searchable).indexOf(term) !== -1;
                });
              }
            }
          } else {
            _.updateSearchSummary(0, 0);
          }
        });
      }
//Limpiamos Filtros
      let clearAllBtn = document.getElementById('asigClearAllFilters');
      if (clearAllBtn && clearAllBtn.dataset.bound !== '1') {
        clearAllBtn.dataset.bound = '1';
        clearAllBtn.addEventListener('click', function () {
          app.asignacionesState.searchTerm = '';
          app.asignacionesState.selectedActividadIds = [];
          app.asignacionesState.columnFilters = {
            tip: '',
            nombre: '',
            peloton_codigo: '',
            requisitos_pct: '',
            orden_gc: '',
          };
          app.asignacionesState.actividadFechaInicio = '';
          app.asignacionesState.actividadFechaFin = '';
          app.asignacionesState.columnFilterFocus = null;
          // @ts-ignore
          if (searchEl) searchEl.value = '';
          // @ts-ignore
          if (actFilterSearchEl) actFilterSearchEl.value = '';
          if (actFilterFechaInicioEl) actFilterFechaInicioEl.value = '';
          if (actFilterFechaFinEl) actFilterFechaFinEl.value = '';
          renderAsigActividadFilterList('');
          if (typeof _.clearAsigSelection === 'function') _.clearAsigSelection();
          if (_.tabulator) {
            _.tabulator.clearHeaderFilter();
            if (typeof _.applyAsigAdvancedFilters === 'function')
              _.applyAsigAdvancedFilters();
            else _.tabulator.clearFilter();
          } else {
            _.updateSearchSummary(0, 0);
          }
        });
      }

      if (
        actFilterToggleEl &&
        actFilterPanelEl &&
        actFilterToggleEl.dataset.bound !== '1'
      ) {
        actFilterToggleEl.dataset.bound = '1';
        actFilterToggleEl.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          let open = actFilterPanelEl.classList.contains('d-none');
          actFilterPanelEl.classList.toggle('d-none', !open);
          actFilterToggleEl.setAttribute('aria-expanded', open ? 'true' : 'false');
          if (open) {
            syncAsigActividadDateInputs(actFilterFechaInicioEl, actFilterFechaFinEl);
          }
          if (open && actFilterSearchEl) {
            setTimeout(function () {
              // @ts-ignore
              actFilterSearchEl.focus();
            }, 20);
          }
        });
      }

      if (actFilterPanelEl && actFilterPanelEl.dataset.bound !== '1') {
        actFilterPanelEl.dataset.bound = '1';
        actFilterPanelEl.addEventListener('click', function (e) {
          e.stopPropagation();
        });
      }

      if (actFilterSearchEl && actFilterSearchEl.dataset.bound !== '1') {
        actFilterSearchEl.dataset.bound = '1';
        actFilterSearchEl.addEventListener('input', function () {
          // @ts-ignore
          renderAsigActividadFilterList(actFilterSearchEl.value || '');
        });
      }

      if (actFilterApplyEl && actFilterApplyEl.dataset.bound !== '1') {
        actFilterApplyEl.dataset.bound = '1';
        actFilterApplyEl.addEventListener('click', function () {
          let fechaInicio = normalizeIsoDateOrEmpty(
            actFilterFechaInicioEl ? actFilterFechaInicioEl.value : ''
          );
          let fechaFin = normalizeIsoDateOrEmpty(
            actFilterFechaFinEl ? actFilterFechaFinEl.value : ''
          );
          if (fechaInicio && fechaFin && fechaInicio > fechaFin) {
            _.showAlert('La fecha de inicio no puede ser mayor que la fecha de fin.', 'warning');
            return;
          }
          app.asignacionesState.actividadFechaInicio = fechaInicio;
          app.asignacionesState.actividadFechaFin = fechaFin;
          syncAsigActividadDateInputs(actFilterFechaInicioEl, actFilterFechaFinEl);
          updateAsigActividadFilterCount();
          if (typeof _.clearAsigSelection === 'function') _.clearAsigSelection();
          if (_.tabulator && typeof _.applyAsigAdvancedFilters === 'function') {
            _.applyAsigAdvancedFilters();
          }
        });
      }

      if (actFilterClearEl && actFilterClearEl.dataset.bound !== '1') {
        actFilterClearEl.dataset.bound = '1';
        actFilterClearEl.addEventListener('click', function () {
          app.asignacionesState.selectedActividadIds = [];
          app.asignacionesState.actividadFechaInicio = '';
          app.asignacionesState.actividadFechaFin = '';
          // @ts-ignore
          if (actFilterSearchEl) actFilterSearchEl.value = '';
          if (actFilterFechaInicioEl) actFilterFechaInicioEl.value = '';
          if (actFilterFechaFinEl) actFilterFechaFinEl.value = '';
          renderAsigActividadFilterList('');
          if (typeof _.clearAsigSelection === 'function') _.clearAsigSelection();
          if (_.tabulator && typeof _.applyAsigAdvancedFilters === 'function') {
            _.applyAsigAdvancedFilters();
          }
        });
      }

      if (actFilterListEl && actFilterListEl.dataset.bound !== '1') {
        actFilterListEl.dataset.bound = '1';
        actFilterListEl.addEventListener('change', function (e) {
          // @ts-ignore
          if (!e.target || !e.target.classList.contains('asig-act-filter-chk')) return;
          // @ts-ignore
          let actId = Number(e.target.dataset.id || 0);
          if (!actId) return;
          let selected = ensureAsigActividadSelectedIdsState();
          let idx = selected.indexOf(actId);
          // @ts-ignore
          if (e.target.checked && idx === -1) selected.push(actId);
          // @ts-ignore
          if (!e.target.checked && idx !== -1) selected.splice(idx, 1);
          app.asignacionesState.selectedActividadIds = selected;
          updateAsigActividadFilterCount();
        });
      }

      if (!app.asignacionesState._asigActividadOutsideClickBound) {
        app.asignacionesState._asigActividadOutsideClickBound = true;
        document.addEventListener('click', function () {
          if (!actFilterPanelEl || !actFilterToggleEl) return;
          actFilterPanelEl.classList.add('d-none');
          actFilterToggleEl.setAttribute('aria-expanded', 'false');
        });
      }

      // Render inicial del selector de actividades.
      syncAsigActividadDateInputs(actFilterFechaInicioEl, actFilterFechaFinEl);
      // @ts-ignore
      renderAsigActividadFilterList(actFilterSearchEl ? actFilterSearchEl.value : '');

      // ── Periodo ──
      if (anioEl && anioEl.dataset.bound !== '1') {
        anioEl.dataset.bound = '1';
        anioEl.addEventListener('change', async function () {
          await app.loadAsignacionesBorradores();
          app.loadAsignacionesCuadrante();
        });
      }
      if (mesEl && mesEl.dataset.bound !== '1') {
        mesEl.dataset.bound = '1';
        mesEl.addEventListener('change', async function () {
          await app.loadAsignacionesBorradores();
          app.loadAsignacionesCuadrante();
        });
      }
      if (borrSel && borrSel.dataset.bound !== '1') {
        borrSel.dataset.bound = '1';
        borrSel.addEventListener('change', function () {
          app.asignacionesState.borradorId = _.getSelectedBorradorId();
          _.updateObsBtnStyle();
          if (typeof _.updateConsolidarDevengosBtnState === 'function') {
            _.updateConsolidarDevengosBtnState();
          }
          app.loadAsignacionesCuadrante();
        });
      }

      // ── Nuevo borrador ──
      if (nuevoBorrBtn && nuevoBorrBtn.dataset.bound !== '1') {
        nuevoBorrBtn.dataset.bound = '1';
        nuevoBorrBtn.addEventListener('click', function () {
          if (guardReadOnlyAction()) return;
          let borradores = app.asignacionesState.borradores || [];
          let copiaSel = document.getElementById('nuevoCopiaDesdeBorrador');
          if (copiaSel) {
            copiaSel.innerHTML =
              '<option value="">— Empezar vacío —</option>' +
              borradores
                .map(function (b) {
                  let tag = b.estado === 'validado' ? ' (validado)' : '';
                  return (
                    '<option value="' +
                    b.id +
                    '">' +
                    app.escapeHtml(
                      (b.nombre || 'Borrador') + ' v' + (b.version || 1) + tag
                    ) +
                    '</option>'
                  );
                })
                .join('');
            // @ts-ignore
            copiaSel.selectedIndex = 0;
          }
          let modalEl = document.getElementById('modalNuevoBorrador');
          if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).show();
        });
      }

      let confirmarBorrBtn = document.getElementById(
        'btnConfirmarNuevoBorrador'
      );
      if (confirmarBorrBtn && confirmarBorrBtn.dataset.bound !== '1') {
        confirmarBorrBtn.dataset.bound = '1';
        confirmarBorrBtn.addEventListener('click', async function () {
          if (guardReadOnlyAction()) return;
          let p = _.getPeriodo();
          let copiaSel = document.getElementById('nuevoCopiaDesdeBorrador');
          let obsEl = document.getElementById('nuevoObservacionesBorrador');
          let nombre =
            'Borrador ' + p.anio + '-' + String(p.mes).padStart(2, '0');
          let copia_de_id =
            // @ts-ignore
            copiaSel && copiaSel.value ? Number(copiaSel.value) : null;
          try {
            let body = { anio: p.anio, mes: p.mes, nombre: nombre };
            if (copia_de_id) body.copia_de_id = copia_de_id;
            // @ts-ignore
            if (obsEl && obsEl.value.trim())
              // @ts-ignore
              body.observaciones = obsEl.value.trim();
            let res = await fetch('/api/asignaciones/borradores', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + app.globalState.token,
              },
              body: JSON.stringify(body),
            });
            let json = await res.json();
            if (!res.ok || !json.ok)
              throw new Error(
                (json && json.message) || 'No se pudo crear el borrador'
              );
            let modalEl = document.getElementById('modalNuevoBorrador');
            if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
            // @ts-ignore
            if (obsEl) obsEl.value = '';
            let newBorradorId = json.borrador && json.borrador.id;
            if (newBorradorId) {
              app.asignacionesState.borradorId = newBorradorId;
              let borrSel2 = document.getElementById('asigBorrador');
              // @ts-ignore
              if (borrSel2) borrSel2.value = String(newBorradorId);
            }
            await app.loadAsignacionesBorradores(newBorradorId);
            _.showAlert('Borrador creado: ' + nombre, 'success');
            await app.loadAsignacionesCuadrante(newBorradorId);
          } catch (e) {
            _.showAlert(e.message, 'danger');
          }
        });
      }

      // ── Observaciones borrador ──
      let editObsBtn = document.getElementById('btnEditObservacionesBorrador');
      if (editObsBtn && editObsBtn.dataset.bound !== '1') {
        editObsBtn.dataset.bound = '1';
        editObsBtn.addEventListener('click', function () {
          let borradorSel = document.getElementById('asigBorrador');
          let borradorId =
            // @ts-ignore
            (borradorSel && borradorSel.value
              ? // @ts-ignore
                Number(borradorSel.value)
              : null) ||
            (_.getSelectedBorradorId ? _.getSelectedBorradorId() : null);
          if (!borradorId) {
            _.showAlert('Seleccione un borrador primero', 'warning');
            return;
          }
          let borradores = app.asignacionesState.borradores || [];
          let borrador = borradores.find(function (b) {
            return Number(b.id) === Number(borradorId);
          });
          let titulo = borrador
            ? borrador.nombre + ' v' + (borrador.version || 1)
            : 'Borrador';
          let tituloEl = document.getElementById('obsModalTitulo');
          let textEl = document.getElementById('editObservacionesBorrador');
          if (tituloEl) tituloEl.textContent = titulo;
          if (textEl)
            // @ts-ignore
            textEl.value =
              borrador && borrador.observaciones ? borrador.observaciones : '';
          let modalEl = document.getElementById('modalObservacionesBorrador');
          if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).show();
        });
      }

      let guardarObsBtn = document.getElementById(
        'btnGuardarObservacionesBorrador'
      );
      if (guardarObsBtn && guardarObsBtn.dataset.bound !== '1') {
        guardarObsBtn.dataset.bound = '1';
        guardarObsBtn.addEventListener('click', async function () {
          if (guardReadOnlyAction()) return;
          let borradorId = _.getSelectedBorradorId();
          if (!borradorId) return;
          let textEl = document.getElementById('editObservacionesBorrador');
          // @ts-ignore
          let observaciones = textEl ? textEl.value.trim() : '';
          try {
            let res = await fetch(
              '/api/asignaciones/borradores/' + borradorId + '/observaciones',
              {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: 'Bearer ' + app.globalState.token,
                },
                body: JSON.stringify({ observaciones: observaciones }),
              }
            );
            let json = await res.json();
            if (!res.ok || !json.ok)
              throw new Error((json && json.message) || 'Error al guardar');
            let borradores = app.asignacionesState.borradores || [];
            let b = borradores.find(function (b) {
              return Number(b.id) === Number(borradorId);
            });
            if (b) b.observaciones = observaciones;
            _.updateObsBtnStyle();
            let modalEl = document.getElementById('modalObservacionesBorrador');
            if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
            _.showAlert('Observaciones guardadas', 'success');
          } catch (e) {
            _.showAlert(e.message, 'danger');
          }
        });
      }

      // ── Eliminar borrador ──
      let deleteBorradorBtn = document.getElementById('btnAsigDeleteBorrador');
      if (deleteBorradorBtn && deleteBorradorBtn.dataset.bound !== '1') {
        deleteBorradorBtn.dataset.bound = '1';
        deleteBorradorBtn.addEventListener('click', function () {
          if (guardReadOnlyAction()) return;
          let borradorId = _.getSelectedBorradorId();
          if (!borradorId) {
            _.showAlert(
              'Debe seleccionar un borrador para eliminar',
              'warning'
            );
            return;
          }
          let borradores = app.asignacionesState.borradores || [];
          let borrador = borradores.find(function (b) {
            return Number(b.id) === Number(borradorId);
          });
          let nombre = borrador ? borrador.nombre || 'Borrador' : 'Borrador';
          let modalEl = _.ensureConfirmBorradorModal();
          applyConsultaReadOnlyUi();
          let nombreEl = document.getElementById('asigConfirmBorradorNombre');
          if (nombreEl) nombreEl.textContent = nombre;
          let btnConfirm = document.getElementById('btnConfirmDeleteBorrador');
          if (btnConfirm) {
            let newBtn = btnConfirm.cloneNode(true);
            btnConfirm.parentNode.replaceChild(newBtn, btnConfirm);
            document
              .getElementById('btnConfirmDeleteBorrador')
              .addEventListener('click', async function () {
                if (guardReadOnlyAction()) return;
                try {
                  // Guardar lista y posición antes de borrar para seleccionar el anterior
                  let prevBorradores = (
                    app.asignacionesState.borradores || []
                  ).slice();
                  let idx = prevBorradores.findIndex(function (b) {
                    return Number(b.id) === Number(borradorId);
                  });
                  let prevId = null;
                  if (idx > 0) prevId = prevBorradores[idx - 1].id;
                  else if (prevBorradores.length > 1)
                    prevId = prevBorradores[1].id;

                  let res = await fetch(
                    '/api/asignaciones/borradores/' + borradorId,
                    {
                      method: 'DELETE',
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer ' + app.globalState.token,
                      },
                    }
                  );
                  let json = await res.json();
                  if (!res.ok || !json.ok)
                    throw new Error(
                      json.message || 'Error al eliminar borrador'
                    );
                  bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                  await app.loadAsignacionesBorradores(prevId);
                  await app.loadAsignacionesCuadrante(prevId || undefined);
                  _.showAlert('Borrador eliminado correctamente', 'success');
                } catch (e) {
                  _.showAlert(e.message, 'danger');
                }
              });
          }
          bootstrap.Modal.getOrCreateInstance(modalEl).show();
        });
      }

      // ── Asignación masiva (bulk) ──
      let bulkBtn = document.getElementById('btnAsigBulk');
      if (bulkBtn && bulkBtn.dataset.bound !== '1') {
        bulkBtn.dataset.bound = '1';
        bulkBtn.addEventListener('click', function () {
          if (guardReadOnlyAction()) return;
          let modalEl = _.ensureAsignacionesBulkModal();
          applyConsultaReadOnlyUi();
          let p = _.getPeriodo();
          _.fillAgenteOptions(document.getElementById('asigBulkAgentes'), {
            onlySelectedForBulk: true,
            preselectAll: true,
            hintEl: document.getElementById('asigBulkAgentesHint'),
          });
          _.fillTurnosOptions(document.getElementById('asigBulkTurno'));
          _.fillActividadesOptions(
            document.getElementById('asigBulkActividades')
          );
          // @ts-ignore
          document.getElementById('asigBulkObservaciones').value = '';

          let diasElRaw = document.getElementById('asigBulkDias');
          let diasEl =
            diasElRaw instanceof HTMLSelectElement ? diasElRaw : null;
          let diasMarcadosWrapEl = document.getElementById(
            'asigBulkDiasMarcadosWrap'
          );
          let diasMarcadosRawEl = document.getElementById('asigBulkDiasMarcados');
          let diasMarcadosEl =
            diasMarcadosRawEl instanceof HTMLSelectElement
              ? diasMarcadosRawEl
              : null;
          let planningDays = getPlanningWindowSafe(p.anio, p.mes);
          if (!diasEl) return;
          diasEl.innerHTML = planningDays
            .map(function (day) {
              return (
                '<option value="' +
                day.key +
                '" data-dia="' +
                day.dia +
                '">' +
                day.label +
                ' ' +
                day.labelDate +
                '</option>'
              );
            })
            .join('');
          if (diasMarcadosEl) diasMarcadosEl.innerHTML = '';
          if (diasMarcadosWrapEl) diasMarcadosWrapEl.classList.add('d-none');

          let filterAgBulk = document.getElementById('asigBulkFilterAgentes');
          if (filterAgBulk) {
            // @ts-ignore
            filterAgBulk.value = '';
            _.attachSelectFilter(
              filterAgBulk,
              document.getElementById('asigBulkAgentes')
            );
          }
          let filterActBulk = document.getElementById(
            'asigBulkFilterActividades'
          );
          if (filterActBulk) {
            // @ts-ignore
            filterActBulk.value = '';
            _.attachSelectFilter(
              filterActBulk,
              document.getElementById('asigBulkActividades')
            );
          }

          let checkAllAgentes = document.getElementById(
            'asigBulkCheckAllAgentes'
          );
          let agentesEl = document.getElementById('asigBulkAgentes');
          let bulkWarnWrap = document.getElementById(
            'asigBulkSelectionWarningWrap'
          );
          let saveBulkBtn = document.getElementById('btnSaveAsigBulk');
          let selectedCountEl = document.getElementById(
            'asigBulkSelectedCount'
          );

          function updateBulkApplyEnabledState() {
            let selectedAgentsCount = Array.from(
              // @ts-ignore
              agentesEl?.selectedOptions || []
            ).length;
            // @ts-ignore
            let totalAgentsCount = Number(agentesEl?.options?.length || 0);
            let hasSelectedAgents = selectedAgentsCount > 0;
            let hasBorradorSelected = !!_.getSelectedBorradorId();
            // @ts-ignore
            if (saveBulkBtn)
              // @ts-ignore
              saveBulkBtn.disabled = !hasSelectedAgents || !hasBorradorSelected;
            if (bulkWarnWrap)
              bulkWarnWrap.classList.toggle('d-none', hasSelectedAgents);
            if (selectedCountEl) {
              let borradorHint = hasBorradorSelected
                ? ''
                : ' · Seleccione un borrador antes de aplicar';
              selectedCountEl.textContent =
                'Agentes seleccionados: ' +
                selectedAgentsCount +
                ' de ' +
                totalAgentsCount +
                borradorHint;
            }
          }

          if (checkAllAgentes && agentesEl) {
            // @ts-ignore
            checkAllAgentes.checked = agentesEl.options.length > 0;
            checkAllAgentes.onclick = function () {
              // @ts-ignore
              for (let i = 0; i < agentesEl.options.length; i++)
                // @ts-ignore
                agentesEl.options[i].selected = checkAllAgentes.checked;
              updateBulkApplyEnabledState();
            };
            agentesEl.addEventListener('change', function () {
              let selectedCount = Array.from(
                // @ts-ignore
                agentesEl.selectedOptions || []
              ).length;
              // @ts-ignore
              if (!agentesEl.options.length) {
                // @ts-ignore
                checkAllAgentes.checked = false;
                // @ts-ignore
                checkAllAgentes.indeterminate = false;
                // @ts-ignore
              } else if (selectedCount === agentesEl.options.length) {
                // @ts-ignore
                checkAllAgentes.checked = true;
                // @ts-ignore
                checkAllAgentes.indeterminate = false;
              } else if (selectedCount > 0) {
                // @ts-ignore
                checkAllAgentes.checked = false;
                // @ts-ignore
                checkAllAgentes.indeterminate = true;
              } else {
                // @ts-ignore
                checkAllAgentes.checked = false;
                // @ts-ignore
                checkAllAgentes.indeterminate = false;
              }
              updateBulkApplyEnabledState();
            });
          }
          updateBulkApplyEnabledState();

          let checkAllDias = document.getElementById('asigBulkCheckAllDias');

          function moveBulkAssignedDaysToMarkedList(dayKeys) {
            if (!diasEl || !Array.isArray(dayKeys) || !dayKeys.length) return;

            let keys = new Set(
              dayKeys
                .map(function (k) {
                  return String(k || '').trim();
                })
                .filter(Boolean)
            );
            if (!keys.size) return;

            let moved = [];
            for (let i = diasEl.options.length - 1; i >= 0; i -= 1) {
              let opt = diasEl.options[i];
              if (!opt) continue;
              let key = String(opt.value || '').trim();
              if (!keys.has(key)) continue;
              moved.push({ key: key, label: String(opt.text || key).trim() });
              diasEl.remove(i);
            }

            if (diasMarcadosEl && moved.length) {
              let existing = new Set(
                Array.from(diasMarcadosEl.options || []).map(function (opt) {
                  return String(opt && opt.value ? opt.value : '').trim();
                })
              );

              moved.reverse().forEach(function (item) {
                if (!item || !item.key || existing.has(item.key)) return;
                let opt = document.createElement('option');
                opt.value = item.key;
                opt.text = item.label;
                diasMarcadosEl.appendChild(opt);
              });
            }

            if (diasMarcadosWrapEl) {
              let hasMarked = !!(diasMarcadosEl && diasMarcadosEl.options.length);
              diasMarcadosWrapEl.classList.toggle('d-none', !hasMarked);
            }

            if (checkAllDias) {
              // @ts-ignore
              checkAllDias.checked = false;
              // @ts-ignore
              checkAllDias.indeterminate = false;
              // @ts-ignore
              checkAllDias.disabled = diasEl.options.length === 0;
            }
          }

          if (checkAllDias && diasEl) {
            // @ts-ignore
            checkAllDias.checked = false;
            // @ts-ignore
            checkAllDias.indeterminate = false;
            // @ts-ignore
            checkAllDias.disabled = diasEl.options.length === 0;
            checkAllDias.onclick = function () {
              // @ts-ignore
              for (let i = 0; i < diasEl.options.length; i++)
                // @ts-ignore
                diasEl.options[i].selected = checkAllDias.checked;
            };
          }

          _.resetBulkProgress();

          document.getElementById('btnSaveAsigBulk').onclick =
            async function () {
              if (guardReadOnlyAction()) return;
              _.resetBulkProgress();
              let periodo = _.getPeriodo();
              let borrId = _.getSelectedBorradorId();
              let agenteIds = _.getSelectedNumbersFromSelect(
                document.getElementById('asigBulkAgentes')
              );
              // @ts-ignore
              let dias = Array.from(diasEl.selectedOptions)
                .map(function (opt) {
                  return opt.value;
                })
                .filter(Boolean);
              let turnoId = ASIG_TURNO_CONSTANTE_ID;
              let actividadIds = _.getSelectedNumbersFromSelect(
                document.getElementById('asigBulkActividades')
              );
              let observaciones =
                // @ts-ignore
                document.getElementById('asigBulkObservaciones').value.trim() ||
                null;
              let saveBtn2 = document.getElementById('btnSaveAsigBulk');
              let closeBtn = modalEl.querySelector('[data-bs-dismiss="modal"]');

              if (!agenteIds.length || !dias.length || !actividadIds.length) {
                _.showAlert(
                  'Complete agentes, días y actividades para asignación masiva',
                  'warning'
                );
                return;
              }
              if (!borrId) {
                _.showAlert(
                  'Seleccione un borrador para aplicar la asignación masiva',
                  'warning'
                );
                updateBulkApplyEnabledState();
                return;
              }

              try {
                if (saveBtn2) {
                  // @ts-ignore
                  saveBtn2.disabled = true;
                  saveBtn2.innerHTML =
                    '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Procesando...';
                }
                if (closeBtn) closeBtn.disabled = true;

                let chunks = _.chunkItems(
                  agenteIds,
                  _.BULK_REQUEST_AGENT_CHUNK_SIZE
                );
                let totalChunks = chunks.length;
                let processedAgents = 0;
                let totalApplied = 0;
                let MAX_PARALLEL = 5;

                _.updateBulkProgress(
                  5,
                  'Enviando ' + totalChunks + ' lotes...'
                );

                for (let ci = 0; ci < chunks.length; ci += MAX_PARALLEL) {
                  let batch = chunks.slice(ci, ci + MAX_PARALLEL);
                  let batchPromises = batch.map(function (chunk, batchIdx) {
                    let loteNum = ci + batchIdx + 1;
                    return fetch('/api/asignaciones/bulk', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer ' + app.globalState.token,
                        'X-Asig-Client-Version': _.ASIG_FE_VERSION,
                      },
                      body: JSON.stringify({
                        anio: periodo.anio,
                        mes: periodo.mes,
                        borrador_id: borrId,
                        agente_ids: chunk,
                        dias: dias,
                        turno_id: turnoId,
                        actividad_ids: actividadIds,
                        observaciones: observaciones,
                      }),
                    }).then(function (res) {
                      return res.json().then(function (json) {
                        return {
                          res: res,
                          json: json,
                          lote: loteNum,
                          chunk: chunk,
                        };
                      });
                    });
                  });

                  let batchResults = await Promise.all(batchPromises);
                  for (let bi = 0; bi < batchResults.length; bi++) {
                    let br = batchResults[bi];
                    if (br.res.status === 409) {
                      _.showAlert(
                        'La celda fue modificada por otro usuario. Recargando cuadrante...',
                        'warning'
                      );
                      await app.loadAsignacionesCuadrante();
                      return;
                    }
                    if (!br.res.ok || (br.json && br.json.ok === false))
                      throw new Error(
                        (br.json && br.json.message) ||
                          'Error en lote ' + br.lote
                      );
                    totalApplied += Number(
                      br.json && br.json.count
                        ? br.json.count
                        : br.chunk.length * dias.length
                    );
                    applyDevengosPendingState(br.json, borrId);
                  }
                  processedAgents += batch.reduce(function (sum, c) {
                    return sum + c.length;
                  }, 0);
                  _.updateBulkProgress(
                    5 + (processedAgents / agenteIds.length) * 75,
                    'Lotes: ' +
                      Math.min(ci + MAX_PARALLEL, chunks.length) +
                      '/' +
                      totalChunks +
                      ' · ' +
                      totalApplied +
                      ' celdas'
                  );
                }

                _.updateBulkProgress(85, 'Recargando cuadrante...');
                await app.loadAsignacionesCuadrante();
                _.updateBulkProgress(
                  100,
                  'Completado: ' + totalApplied + ' celdas'
                );
                _.showAlert(
                  'Asignación masiva aplicada en borrador: ' +
                    totalApplied +
                    ' celdas. El modal permanece abierto.',
                  'success'
                );
                moveBulkAssignedDaysToMarkedList(dias);
                setTimeout(_.resetBulkProgress, 1200);
              } catch (e) {
                _.showAlert(e.message, 'danger');
              } finally {
                if (saveBtn2) {
                  // @ts-ignore
                  saveBtn2.disabled = false;
                  saveBtn2.innerHTML =
                    '<i class="bi bi-check2 me-1"></i>Aplicar';
                }
                if (closeBtn) closeBtn.disabled = false;
              }
            };

          bootstrap.Modal.getOrCreateInstance(modalEl).show();
        });
      }

      // ── Eliminar asignaciones ──
      let deleteBtn = document.getElementById('btnAsigDelete');
      if (deleteBtn && deleteBtn.dataset.bound !== '1') {
        deleteBtn.dataset.bound = '1';
        deleteBtn.addEventListener('click', function () {
          if (guardReadOnlyAction()) return;
          let modalEl = _.ensureAsignacionesDeleteModal();
          applyConsultaReadOnlyUi();
          let p = _.getPeriodo();
          _.fillAgenteOptions(document.getElementById('asigDeleteAgentes'), {
            onlySelectedForBulk: true,
            preselectAll: true,
            hintEl: document.getElementById('asigDeleteAgentesHint'),
          });
          _.renderDeleteDateOptions(p.anio, p.mes);

          let filterAgDel = document.getElementById('asigDeleteFilterAgentes');
          if (filterAgDel) {
            // @ts-ignore
            filterAgDel.value = '';
            _.attachSelectFilter(
              filterAgDel,
              document.getElementById('asigDeleteAgentes')
            );
          }

          let checkAllAgDel = document.getElementById(
            'asigDeleteCheckAllAgentes'
          );
          let agentesDelEl = document.getElementById('asigDeleteAgentes');
          if (checkAllAgDel && agentesDelEl) {
            // @ts-ignore
            checkAllAgDel.checked = false;
            checkAllAgDel.onclick = function () {
              // @ts-ignore
              for (let i = 0; i < agentesDelEl.options.length; i++)
                // @ts-ignore
                agentesDelEl.options[i].selected = checkAllAgDel.checked;
            };
          }

          let checkAllFechasDel = document.getElementById(
            'asigDeleteCheckAllFechas'
          );
          if (checkAllFechasDel) {
            // @ts-ignore
            checkAllFechasDel.checked = false;
            checkAllFechasDel.onclick = function () {
              let checks = document.querySelectorAll(
                '#asigDeleteDates .asig-delete-date-check'
              );
              checks.forEach(function (cb) {
                // @ts-ignore
                cb.checked = checkAllFechasDel.checked;
              });
              if (checks.length) checks[0].dispatchEvent(new Event('change'));
            };
          }

          document.getElementById('btnRunAsigDelete').onclick =
            async function () {
              if (guardReadOnlyAction()) return;
              let agenteIds = _.getSelectedNumbersFromSelect(
                document.getElementById('asigDeleteAgentes')
              );
              let fechas = _.getSelectedDeleteDates();
              let dias = fechas.map(function (fecha) {
                return Number(String(fecha).slice(8, 10));
              });
              if (!agenteIds.length || !fechas.length) {
                _.showAlert(
                  'Seleccione agentes y fechas para eliminar',
                  'warning'
                );
                return;
              }
              try {
                let res = await fetch('/api/asignaciones/borrador', {
                  method: 'DELETE',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + app.globalState.token,
                  },
                  body: JSON.stringify({
                    anio: p.anio,
                    mes: p.mes,
                    borrador_id: _.getSelectedBorradorId(),
                    agente_ids: agenteIds,
                    dias: dias,
                    fechas: fechas,
                  }),
                });
                let responseJson = await res.json();
                if (!res.ok) {
                  let err = responseJson || {};
                  throw new Error(err.message || 'Error al eliminar borrador');
                }
                applyDevengosPendingState(
                  responseJson,
                  _.getSelectedBorradorId()
                );
                bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                _.showAlert(
                  'Borrador eliminado para selección indicada',
                  'success'
                );
                await app.loadAsignacionesCuadrante();
              } catch (e) {
                _.showAlert(e.message, 'danger');
              }
            };

          bootstrap.Modal.getOrCreateInstance(modalEl).show();
        });
      }

      // ── Copiar mes ──
      let copyBtn = document.getElementById('btnAsigCopy');
      if (copyBtn && copyBtn.dataset.bound !== '1') {
        copyBtn.dataset.bound = '1';
        copyBtn.addEventListener('click', async function () {
          if (guardReadOnlyAction()) return;
          let modalEl = _.ensureAsignacionesCopyModal();
          applyConsultaReadOnlyUi();
          let p = _.getPeriodo();
          _.fillAgenteOptions(document.getElementById('asigCopyAgentes'), {
            preselectSelected: true,
          });

          let copyOrigenMesEl = document.getElementById('asigCopyOrigenMes');
          let copyDestinoMesEl = document.getElementById('asigCopyDestinoMes');
          let monthOptions = getMonthsSafe()
            .map(function (m) {
              return (
                '<option value="' +
                app.escapeHtml(m) +
                '">' +
                app.escapeHtml(m) +
                '</option>'
              );
            })
            .join('');
          if (copyOrigenMesEl) copyOrigenMesEl.innerHTML = monthOptions;
          if (copyDestinoMesEl) copyDestinoMesEl.innerHTML = monthOptions;

          // @ts-ignore
          document.getElementById('asigCopyOrigenAnio').value = String(
            p.anio || new Date().getFullYear()
          );
          // @ts-ignore
          document.getElementById('asigCopyOrigenMes').value =
            _.mesNumberToString(p.mes || new Date().getMonth() + 1);
          // @ts-ignore
          document.getElementById('asigCopyDestinoAnio').value = String(
            p.anio || new Date().getFullYear()
          );
          // @ts-ignore
          document.getElementById('asigCopyDestinoMes').value =
            _.mesNumberToString(p.mes || new Date().getMonth() + 1);
          await _.renderCopyDateOptions(p.anio, p.mes);

          let checkAllFechasCopy = document.getElementById(
            'asigCopyCheckAllFechas'
          );
          if (checkAllFechasCopy) {
            // @ts-ignore
            checkAllFechasCopy.checked = false;
            checkAllFechasCopy.onclick = function () {
              let checks = document.querySelectorAll(
                '#asigCopyDates .asig-copy-date-check'
              );
              checks.forEach(function (cb) {
                // @ts-ignore
                cb.checked = checkAllFechasCopy.checked;
              });
              if (checks.length) checks[0].dispatchEvent(new Event('change'));
            };
          }

          let origenAnioEl2 = document.getElementById('asigCopyOrigenAnio');
          let origenMesEl2 = document.getElementById('asigCopyOrigenMes');
          async function rerenderCopyDatesFromOrigen() {
            // @ts-ignore
            let oa = Number(origenAnioEl2.value);
            // @ts-ignore
            let om = _.mesStringToNumber(origenMesEl2.value);
            if (!oa || !om) return;
            await _.renderCopyDateOptions(oa, om);
            // @ts-ignore
            if (checkAllFechasCopy) checkAllFechasCopy.checked = false;
          }
          if (origenAnioEl2)
            origenAnioEl2.onchange = rerenderCopyDatesFromOrigen;
          if (origenMesEl2) origenMesEl2.onchange = rerenderCopyDatesFromOrigen;

          document.getElementById('btnRunAsigCopy').onclick =
            async function () {
              if (guardReadOnlyAction()) return;
              let origenAnioNum = Number(
                // @ts-ignore
                document.getElementById('asigCopyOrigenAnio').value
              );
              let origenMesNum = _.mesStringToNumber(
                // @ts-ignore
                document.getElementById('asigCopyOrigenMes').value
              );
              let destinoAnioNum = Number(
                // @ts-ignore
                document.getElementById('asigCopyDestinoAnio').value
              );
              let destinoMesNum = _.mesStringToNumber(
                // @ts-ignore
                document.getElementById('asigCopyDestinoMes').value
              );
              let selectedFechas = _.getSelectedCopyDates();

              // Cargar las ventanas de días para origen y destino (aunque no
              // estén en el cuadrante activo del state, se obtendrán de la API).
              let origenDays = await _.fetchCuadranteDaysForPeriod(
                origenAnioNum,
                origenMesNum
              );
              let destinoDays = await _.fetchCuadranteDaysForPeriod(
                destinoAnioNum,
                destinoMesNum
              );

              if (!origenDays.length) {
                _.showAlert(
                  'No se encontró el cuadrante de origen para ' +
                    origenAnioNum +
                    '/' +
                    String(origenMesNum).padStart(2, '0'),
                  'warning'
                );
                return;
              }
              if (!destinoDays.length) {
                _.showAlert(
                  'No se encontró el cuadrante de destino para ' +
                    destinoAnioNum +
                    '/' +
                    String(destinoMesNum).padStart(2, '0'),
                  'warning'
                );
                return;
              }

              let origenWindow = origenDays.map(function (d) {
                return d.key;
              });
              let destinoWindow = destinoDays.map(function (d) {
                return d.key;
              });
              let seen = {};
              let pares = [];
              selectedFechas.forEach(function (fecha) {
                if (seen[fecha]) return;
                seen[fecha] = true;
                let idx = origenWindow.indexOf(fecha);
                if (idx >= 0 && idx < destinoWindow.length)
                  pares.push({ from: fecha, to: destinoWindow[idx] });
              });

              let payload = {
                origen_anio: origenAnioNum,
                origen_mes: origenMesNum,
                origen_borrador_id: _.getSelectedBorradorId(),
                destino_anio: destinoAnioNum,
                destino_mes: destinoMesNum,
                destino_borrador_id: null,
                agente_ids: _.getSelectedNumbersFromSelect(
                  document.getElementById('asigCopyAgentes')
                ),
                pares: pares,
              };

              if (
                !payload.origen_anio ||
                !payload.origen_mes ||
                !payload.destino_anio ||
                !payload.destino_mes
              ) {
                _.showAlert('Complete origen y destino válidos', 'warning');
                return;
              }
              if (!payload.agente_ids.length) {
                _.showAlert(
                  'Debe marcar al menos un agente en la tabla/lista para copiar',
                  'warning'
                );
                return;
              }
              if (!payload.pares.length) {
                _.showAlert(
                  'Debe marcar al menos un día en el modal para copiar',
                  'warning'
                );
                return;
              }

              try {
                let res = await fetch('/api/asignaciones/copiar-mes', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + app.globalState.token,
                  },
                  body: JSON.stringify(payload),
                });
                if (!res.ok) {
                  let err = await res.json();
                  throw new Error(err.message || 'Error al copiar mes');
                }
                let data = await res.json();
                bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                _.showAlert('Mes copiado al borrador destino', 'success');
                let anioEl2 = document.getElementById('asigAnio');
                let mesEl2 = document.getElementById('asigMes');
                let borradorEl2 = document.getElementById('asigBorrador');
                // @ts-ignore
                if (anioEl2) anioEl2.value = String(payload.destino_anio);
                // @ts-ignore
                if (mesEl2) mesEl2.value = String(payload.destino_mes);
                await app.loadAsignacionesBorradores(data.destino_borrador_id);
                if (borradorEl2 && data.destino_borrador_id)
                  // @ts-ignore
                  borradorEl2.value = String(data.destino_borrador_id);
                await app.loadAsignacionesCuadrante();
              } catch (e) {
                _.showAlert(e.message, 'danger');
              }
            };

          bootstrap.Modal.getOrCreateInstance(modalEl).show();
        });
      }

      // ── Validar borrador ──
      let validateBtn = document.getElementById('btnAsigValidate');
      if (validateBtn && validateBtn.dataset.bound !== '1') {
        validateBtn.dataset.bound = '1';
        validateBtn.addEventListener('click', async function () {
          if (guardReadOnlyAction()) return;
          await openAsignacionesValidarModal({ mode: 'validar' });
          applyConsultaReadOnlyUi();
        });
      }
      // ── Consolidar devengos (manual) ──
      let btnConsolidarDevengos = document.getElementById(
        'btnAsigConsolidarDevengos'
      );
      if (
        btnConsolidarDevengos &&
        btnConsolidarDevengos.dataset.bound !== '1'
      ) {
        btnConsolidarDevengos.dataset.bound = '1';
        btnConsolidarDevengos.addEventListener('click', async function () {
          if (guardReadOnlyAction()) return;
          let borradorSel = document.getElementById('asigBorrador');
          let borradorId =
            // @ts-ignore
            (borradorSel && borradorSel.value
              ? // @ts-ignore
                Number(borradorSel.value)
              : null) ||
            (_.getSelectedBorradorId ? _.getSelectedBorradorId() : null);
          if (!borradorId) {
            _.showAlert(
              'Seleccione un borrador para consolidar devengos',
              'warning'
            );
            return;
          }

          let modalEl = document.getElementById('modalConsolidarDevengos');
          if (!modalEl) {
            _.showAlert(
              'No se encontró el modal de consolidación de devengos',
              'danger'
            );
            return;
          }

          let contextEl = document.getElementById(
            'asigConsolidarDevengosModalContext'
          );
          let acceptSwitch = document.getElementById(
            'asigConsolidarDevengosAceptarSwitch'
          );
          let acceptLabel = document.getElementById(
            'asigConsolidarDevengosAceptarLabel'
          );
          let confirmBtn = document.getElementById(
            'btnConfirmAsigConsolidarDevengos'
          );
          if (!acceptSwitch || !acceptLabel || !confirmBtn) return;
          applyConsultaReadOnlyUi();

          if (contextEl) {
            contextEl.textContent =
              'Se recalcularán los devengos para el borrador seleccionado (ID ' +
              borradorId +
              ').';
          }

          // @ts-ignore
          acceptSwitch.checked = false;
          acceptLabel.textContent = 'No';
          // @ts-ignore
          confirmBtn.disabled = true;

          // patrón anti-double-binding como en validar()
          let newConfirmBtn = confirmBtn.cloneNode(true);
          confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
          // @ts-ignore
          newConfirmBtn.disabled = true;

          acceptSwitch.onchange = function () {
            // @ts-ignore
            let accepted = !!acceptSwitch.checked;
            acceptLabel.textContent = accepted ? 'Sí' : 'No';
            // @ts-ignore
            newConfirmBtn.disabled = !accepted;
          };

          newConfirmBtn.addEventListener('click', async function () {
            // @ts-ignore
            if (!acceptSwitch.checked) return;
            let pw = document.getElementById(
              'asigConsolidarDevengosProgressWrap'
            );
            let bar = pw ? pw.querySelector('.progress-bar') : null;
            let pct = 30;
            let ticker = null;
            function setBar(v) {
              if (!bar) return;
              // @ts-ignore
              bar.style.width = v + '%';
              bar.setAttribute('aria-valuenow', v);
              bar.textContent = v + '%';
            }
            try {
              // @ts-ignore
              newConfirmBtn.disabled = true;
              if (pw) pw.classList.remove('d-none');
              setBar(30);
              ticker = setInterval(function () {
                if (pct < 85) {
                  pct += 5;
                  setBar(pct);
                }
              }, 300);
              let res = await fetch('/api/asignaciones/devengos/consolidar', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: 'Bearer ' + app.globalState.token,
                },
                body: JSON.stringify({ borrador_id: Number(borradorId) }),
              });
              if (!res.ok) {
                let err = await res.json();
                throw new Error(err.message || 'Error al consolidar devengos');
              }
              let data = await res.json();
              clearInterval(ticker);
              setBar(100);
              bootstrap.Modal.getOrCreateInstance(modalEl).hide();
              _.showAlert(
                (data && data.message) || 'Devengos consolidados',
                'success'
              );
              await app.loadAsignacionesCuadrante();
            } catch (e) {
              clearInterval(ticker);
              _.showAlert(e.message, 'danger');
              // @ts-ignore
              newConfirmBtn.disabled = !acceptSwitch.checked;
            } finally {
              if (pw) pw.classList.add('d-none');
              setBar(30);
            }
          });

          bootstrap.Modal.getOrCreateInstance(modalEl).show();
        });
      }

      applyConsultaReadOnlyUi();
      // ── Historial ──
      let btnHistorialAsig = document.getElementById('btnAsigHistorial');
      if (btnHistorialAsig && btnHistorialAsig.dataset.bound !== '1') {
        btnHistorialAsig.dataset.bound = '1';
        btnHistorialAsig.addEventListener('click', function () {
          _.openAsignacionesHistorialModal();
        });
      }

      let btnHistorialAplicar = document.getElementById(
        'btnAsigHistorialAplicarFiltros'
      );
      if (btnHistorialAplicar && btnHistorialAplicar.dataset.bound !== '1') {
        btnHistorialAplicar.dataset.bound = '1';
        // @ts-ignore
        btnHistorialAplicar.disabled = true;
        btnHistorialAplicar.addEventListener('click', function () {
          _.loadAsignacionesHistorial();
        });
      }

      let btnHistorialLimpiar = document.getElementById(
        'btnAsigHistorialLimpiarFiltros'
      );
      if (btnHistorialLimpiar && btnHistorialLimpiar.dataset.bound !== '1') {
        btnHistorialLimpiar.dataset.bound = '1';
        btnHistorialLimpiar.addEventListener('click', function () {
          _.resetHistorialUiFilters();
          let sourceLogs =
            Array.isArray(app.asignacionesState.historialDateSourceLogs) &&
            app.asignacionesState.historialDateSourceLogs.length
              ? app.asignacionesState.historialDateSourceLogs
              : [];
          let contentEl = document.getElementById('asigHistorialContent');
          if (contentEl)
            contentEl.innerHTML =
              '<div class="text-center text-muted py-4">Selecciona los filtros y pulsa <strong>Consultar</strong> para cargar el historial.</div>';
          let pdfBtn = document.getElementById('btnAsigHistorialPdf');
          let excelBtn = document.getElementById('btnAsigHistorialExcel');
          if (pdfBtn) {
            // @ts-ignore
            pdfBtn.disabled = true;
            delete pdfBtn.dataset.query;
          }
          if (excelBtn) {
            // @ts-ignore
            excelBtn.disabled = true;
          }
          _.populateHistorialUsers(sourceLogs);
          _.populateHistorialDates(sourceLogs);
          if (typeof _.populateHistorialFechaCuadrante === 'function') {
            _.populateHistorialFechaCuadrante(sourceLogs);
          }
          _.renderHistorialResumen(0, _.getHistorialFilters());
        });
      }

      let historialActionEl = document.getElementById(
        'asigHistorialFiltroAccion'
      );
      if (historialActionEl && historialActionEl.dataset.bound !== '1') {
        historialActionEl.dataset.bound = '1';
        historialActionEl.addEventListener('change', function () {
          _.updateHistorialApplyButtonState();
        });
      }

      let historialUserEl = document.getElementById(
        'asigHistorialFiltroUsuario'
      );
      if (historialUserEl && historialUserEl.dataset.bound !== '1') {
        historialUserEl.dataset.bound = '1';
        historialUserEl.addEventListener('change', function () {
          _.updateHistorialApplyButtonState();
        });
      }

      let historialIncluirComunicadosEl = document.getElementById(
        'asigHistorialIncluirComunicados'
      );
      if (
        historialIncluirComunicadosEl &&
        historialIncluirComunicadosEl.dataset.bound !== '1'
      ) {
        historialIncluirComunicadosEl.dataset.bound = '1';
        historialIncluirComunicadosEl.addEventListener('change', function () {
          _.updateHistorialApplyButtonState();
        });
      }

      let historialDateEl = document.getElementById(
        'asigHistorialFiltroFechaCambio'
      );
      if (historialDateEl && historialDateEl.dataset.bound !== '1') {
        historialDateEl.dataset.bound = '1';
        historialDateEl.addEventListener('change', function () {
          _.updateHistorialApplyButtonState();
        });
      }

      let historialCuadranteDateEl = document.getElementById(
        'asigHistorialFiltroFechaCuadrante'
      );
      if (
        historialCuadranteDateEl &&
        historialCuadranteDateEl.dataset.bound !== '1'
      ) {
        historialCuadranteDateEl.dataset.bound = '1';
        historialCuadranteDateEl.addEventListener('change', function () {
          _.updateHistorialApplyButtonState();
        });
      }

      let btnHistorialExcel = document.getElementById('btnAsigHistorialExcel');
      if (btnHistorialExcel && btnHistorialExcel.dataset.bound !== '1') {
        btnHistorialExcel.dataset.bound = '1';
        btnHistorialExcel.addEventListener('click', function () {
          if (typeof _.exportHistorialExcel === 'function') {
            _.exportHistorialExcel();
          }
        });
      }

      let btnHistorialPdf = document.getElementById('btnAsigHistorialPdf');
      if (btnHistorialPdf && btnHistorialPdf.dataset.bound !== '1') {
        btnHistorialPdf.dataset.bound = '1';
        btnHistorialPdf.addEventListener('click', async function () {
          let query = btnHistorialPdf.dataset.query;
          if (!query) return;
          try {
            // @ts-ignore
            btnHistorialPdf.disabled = true;
            let sep = query && query.length > 0 ? '&' : '';
            let now = new Date();
            let pad2 = function (value) {
              return String(value).padStart(2, '0');
            };
            let exportTs =
              String(now.getFullYear()) +
              pad2(now.getMonth() + 1) +
              pad2(now.getDate()) +
              '_' +
              pad2(now.getHours()) +
              pad2(now.getMinutes()) +
              pad2(now.getSeconds());

            let pdfQuery =
              query +
              sep +
              'marcar_comunicados=0&export_ts=' +
              encodeURIComponent(exportTs);
            let res = await fetch('/api/asignaciones/historial/pdf?' + pdfQuery, {
              headers: _.headers(),
            });
            if (!res.ok) {
              let err = await res.json().catch(function () {
                return { message: 'Error al exportar el historial a PDF' };
              });
              throw new Error(
                err.message || 'Error al exportar el historial a PDF'
              );
            }
            let blob = await res.blob();
            let url = URL.createObjectURL(blob);
            let disposition = res.headers.get('Content-Disposition') || '';
            let match = disposition.match(/filename="?([^";]+)"?/i);
            let filename =
              match && match[1]
                ? match[1]
                : 'Cambios_Servicio_' + exportTs + '.pdf';
            let link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);

            // Descargar también el CSV de TIP/telefono directamente en navegador.
            let csvQuery =
              query +
              sep +
              'marcar_comunicados=0&export_ts=' +
              encodeURIComponent(exportTs);
            let csvRes = await fetch('/api/asignaciones/historial/csv?' + csvQuery, {
              headers: _.headers(),
            });
            if (!csvRes.ok) {
              let errCsv = await csvRes.json().catch(function () {
                return { message: 'Error al exportar el historial a CSV' };
              });
              throw new Error(
                errCsv.message || 'Error al exportar el historial a CSV'
              );
            }

            let csvBlob = await csvRes.blob();
            let csvUrl = URL.createObjectURL(csvBlob);
            let csvDisposition = csvRes.headers.get('Content-Disposition') || '';
            let csvMatch = csvDisposition.match(/filename="?([^";]+)"?/i);
            let csvFilename =
              csvMatch && csvMatch[1]
                ? csvMatch[1]
                : 'Cambios_Servicio_' + exportTs + '.csv';
            let csvLink = document.createElement('a');
            csvLink.href = csvUrl;
            csvLink.download = csvFilename;
            document.body.appendChild(csvLink);
            csvLink.click();
            csvLink.remove();
            URL.revokeObjectURL(csvUrl);

            // Marcar solo al final, cuando PDF y CSV se han descargado correctamente.
            let markQuery =
              query +
              sep +
              'marcar_comunicados=1&export_ts=' +
              encodeURIComponent(exportTs);
            let markRes = await fetch('/api/asignaciones/historial/marcar?' + markQuery, {
              method: 'POST',
              headers: _.headers(),
            });
            if (!markRes.ok) {
              let errMark = await markRes.json().catch(function () {
                return { message: 'Error al marcar comunicados tras la descarga' };
              });
              throw new Error(
                errMark.message ||
                  'Error al marcar comunicados tras la descarga'
              );
            }

            if (typeof _.loadAsignacionesHistorial === 'function') {
              await _.loadAsignacionesHistorial();
            }
          } catch (error) {
            _.showAlert(
              error.message || 'Error al exportar el historial a PDF',
              'danger'
            );
          } finally {
            // @ts-ignore
            btnHistorialPdf.disabled = !btnHistorialPdf.dataset.query;
          }
        });
      }

      // ── Export & Grouping (Tabulator) ──
      ensureAsigExportGroupBindings();
    };

  // Vincular aunque setup no llegue a ejecutarse por timing de inicialización
  ensureAsigExportGroupBindings();
})();
