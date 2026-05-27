/* ========================================================================
 *  dashboard-asignaciones-historial.js
 *  Auditoría / historial de cambios del cuadrante de asignaciones.
 * ======================================================================== */
(function () {
  let app = window.GRS1Dashboard;
  let _ = app._asig || {}; // alias corto al namespace compartido
  // @ts-ignore
  let GRS1Utils = window.GRS1Utils || {};

  // ── Opciones de acciones ────────────────────────────────────────
  function getHistorialActionOptions() {
    return [
      { value: 'BORRADOR_CREAR', label: 'Alta en borrador' },
      { value: 'BORRADOR_EDITAR', label: 'Edición en borrador' },
      { value: 'BORRADOR_CREAR_MASIVO', label: 'Alta masiva' },
      { value: 'BORRADOR_EDITAR_MASIVO', label: 'Edición masiva' },
      { value: 'BORRADOR_BULK', label: 'Asignación masiva' },
      { value: 'BORRADOR_ELIMINAR', label: 'Eliminación en borrador' },
      { value: 'BORRADOR_COPIAR_MES', label: 'Copia de mes' },
      { value: 'BORRADOR_ELIMINADO', label: 'Borrador eliminado' },
      { value: 'VALIDAR', label: 'Validación' },
      { value: 'REVALIDAR', label: 'Revalidación' },
    ];
  }
  // ── Controles de filtro del modal ───────────────────────────────
  function ensureHistorialFilterControls() {
    let actionEl = document.getElementById('asigHistorialFiltroAccion');
    if (actionEl && !actionEl.dataset.ready) {
      actionEl.innerHTML = getHistorialActionOptions()
        .map(function (item) {
          let id = 'asigAccCb_' + item.value;
          return (
            '<label style="display:flex;align-items:center;gap:5px;padding:2px 0;cursor:pointer;white-space:nowrap;">' +
            '<input type="checkbox" id="' +
            id +
            '" value="' +
            app.escapeHtml(item.value) +
            '" style="cursor:pointer;">' +
            '<span>' +
            app.escapeHtml(item.label) +
            '</span>' +
            '</label>'
          );
        })
        .join('');
      actionEl.dataset.ready = '1';
    }
  }

  function setHistorialDefaultActionFilters() {
    ['BORRADOR_EDITAR', 'BORRADOR_EDITAR_MASIVO'].forEach(function (action) {
      let cb = document.getElementById('asigAccCb_' + action);
      // @ts-ignore
      if (cb) cb.checked = true;
    });
    updateHistorialApplyButtonState();
  }

  function getHistorialUiFilters() {
    let actionEl = document.getElementById('asigHistorialFiltroAccion');
    let dateEl = document.getElementById('asigHistorialFiltroFechaCambio');
    let cuadranteEl = document.getElementById(
      'asigHistorialFiltroFechaCuadrante'
    );
    let acciones = actionEl
      ? Array.from(
          actionEl.querySelectorAll('input[type=checkbox]:checked')
        ).map(function (cb) {
          // @ts-ignore
          return cb.value;
        })
      : [];
    let fechasCambio = dateEl
      ? Array.from(dateEl.querySelectorAll('input[type=checkbox]:checked')).map(
          function (cb) {
            // @ts-ignore
            return cb.value;
          }
        )
      : [];
    let fechasCuadrante = cuadranteEl
      ? Array.from(
          cuadranteEl.querySelectorAll('input[type=checkbox]:checked')
        ).map(function (cb) {
          // @ts-ignore
          return cb.value;
        })
      : [];
    let incluirComunicados = false;
    let incluirEl = document.getElementById('asigHistorialIncluirComunicados');
    // @ts-ignore
    if (incluirEl) incluirComunicados = !!incluirEl.checked;

    return {
      acciones: acciones,
      usuario_id:
        // @ts-ignore
        document.getElementById('asigHistorialFiltroUsuario')?.value || '',
      fechas_cambio: fechasCambio,
      fechas_cuadrante: fechasCuadrante,
      repetir_comunicados: incluirComunicados,
    };
  }

  function hasActiveHistorialFilters() {
    let uiFilters = getHistorialUiFilters();
    return Boolean(
      (uiFilters.acciones && uiFilters.acciones.length) ||
      uiFilters.usuario_id ||
      (uiFilters.fechas_cambio && uiFilters.fechas_cambio.length) ||
      (uiFilters.fechas_cuadrante && uiFilters.fechas_cuadrante.length)
    );
  }

  function updateHistorialApplyButtonState() {
    let btnEl = document.getElementById('btnAsigHistorialAplicarFiltros');
    if (!btnEl) return;
    // @ts-ignore
    btnEl.disabled = !hasActiveHistorialFilters();
  }

  function resetHistorialUiFilters() {
    let actionEl = document.getElementById('asigHistorialFiltroAccion');
    let userEl = document.getElementById('asigHistorialFiltroUsuario');
    let dateEl = document.getElementById('asigHistorialFiltroFechaCambio');
    let cuadranteEl = document.getElementById('asigHistorialFiltroFechaCuadrante');
    let incluirEl = document.getElementById('asigHistorialIncluirComunicados');
    if (actionEl)
      actionEl.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
        // @ts-ignore
        cb.checked = false;
      });
    // @ts-ignore
    if (userEl) userEl.value = '';
    if (cuadranteEl)
      cuadranteEl.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
        // @ts-ignore
        cb.checked = false;
      });
    if (dateEl)
      dateEl.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
        // @ts-ignore
        cb.checked = false;
      });
    // @ts-ignore
    if (incluirEl) incluirEl.checked = false;
    updateHistorialApplyButtonState();
  }

  function populateHistorialUsers(logs) {
    let userEl = document.getElementById('asigHistorialFiltroUsuario');
    if (!userEl) return;
    // @ts-ignore
    let selected = userEl.value || '';
    let users = [];
    let seen = new Set();
    (logs || []).forEach(function (entry) {
      let userId = Number(entry.usuario_id || 0);
      if (!Number.isInteger(userId) || userId <= 0 || seen.has(userId)) return;
      seen.add(userId);
      users.push({
        id: userId,
        label: entry.usuario_nombre || 'Usuario #' + userId,
      });
    });
    users.sort(function (a, b) {
      return a.label.localeCompare(b.label, 'es', { sensitivity: 'base' });
    });
    userEl.innerHTML =
      '<option value="">Todos los usuarios</option>' +
      users
        .map(function (user) {
          return (
            '<option value="' +
            user.id +
            '">' +
            app.escapeHtml(user.label) +
            '</option>'
          );
        })
        .join('');
    // @ts-ignore
    userEl.value = users.some(function (user) {
      return String(user.id) === String(selected);
    })
      ? String(selected)
      : '';
    updateHistorialApplyButtonState();
  }

  function populateHistorialDates(logs) {
    let dateEl = document.getElementById('asigHistorialFiltroFechaCambio');
    if (!dateEl) return;
    let selected = new Set(
      Array.from(dateEl.querySelectorAll('input[type=checkbox]:checked')).map(
        function (cb) {
          // @ts-ignore
          return String(cb.value);
        }
      )
    );
    let uniqueDates = [];
    let seen = new Set();
    (logs || []).forEach(function (entry) {
      let key = normalizeDateKey(entry.created_at);
      if (!key || seen.has(key)) return;
      seen.add(key);
      uniqueDates.push(key);
    });
    uniqueDates.sort(function (a, b) {
      return b.localeCompare(a);
    });
    if (!uniqueDates.length) {
      dateEl.innerHTML =
        '<div class="text-muted small">Sin fechas disponibles</div>';
      return;
    }
    dateEl.innerHTML = uniqueDates
      .map(function (dateKey, idx) {
        let id = 'asigFechaCambioCb_' + idx;
        let checked = selected.has(dateKey) ? ' checked' : '';
        return (
          '<label style="display:flex;align-items:center;gap:5px;padding:2px 0;cursor:pointer;white-space:nowrap;">' +
          '<input type="checkbox" id="' +
          id +
          '" value="' +
          app.escapeHtml(dateKey) +
          '" style="cursor:pointer;"' +
          checked +
          '>' +
          '<span>' +
          app.escapeHtml(formatHistorialDate(dateKey, false)) +
          '</span>' +
          '</label>'
        );
      })
      .join('');
    updateHistorialApplyButtonState();
  }
  function populateHistorialFechaCuadrante(logs) {
    let cuadranteEl = document.getElementById(
      'asigHistorialFiltroFechaCuadrante'
    );
    if (!cuadranteEl) return;
    let selected = new Set(
      Array.from(
        cuadranteEl.querySelectorAll('input[type=checkbox]:checked')
      ).map(function (cb) {
        // @ts-ignore
        return String(cb.value);
      })
    );
    let uniqueDates = [];
    let seen = new Set();
    let hasNullFecha = false;
    (logs || []).forEach(function (entry) {
      if (!entry.fecha) {
        hasNullFecha = true;
        return;
      }
      let key = normalizeDateKey(entry.fecha);
      if (!key || seen.has(key)) return;
      seen.add(key);
      uniqueDates.push(key);
    });
    uniqueDates.sort(function (a, b) {
      return a.localeCompare(b);
    });
    if (hasNullFecha) uniqueDates.push('__SIN_FECHA_MASIVO__');
    if (!uniqueDates.length) {
      cuadranteEl.innerHTML =
        '<div class="text-muted small">Sin fechas disponibles</div>';
      return;
    }
    cuadranteEl.innerHTML = uniqueDates
      .map(function (dateKey, idx) {
        let id = 'asigFechaCuadranteCb_' + idx;
        let checked = selected.has(dateKey) ? ' checked' : '';
        let label =
          dateKey === '__SIN_FECHA_MASIVO__'
            ? 'Edición masiva (sin fecha día)'
            : formatHistorialDate(dateKey, false);
        return (
          '<label style="display:flex;align-items:center;gap:5px;padding:2px 0;cursor:pointer;white-space:nowrap;">' +
          '<input type="checkbox" id="' +
          id +
          '" value="' +
          app.escapeHtml(dateKey) +
          '" style="cursor:pointer;"' +
          checked +
          '>' +
          '<span>' +
          app.escapeHtml(label) +
          '</span>' +
          '</label>'
        );
      })
      .join('');
    updateHistorialApplyButtonState();
  }
  // ── Filtros y query ─────────────────────────────────────────────
  function getHistorialFilters() {
    let periodo = _.getPeriodo();
    let agentIds = _.getSelectedHistorialAgentIds();
    let borradorId = _.getSelectedBorradorId();
    let planningDays =
      Array.isArray(app.asignacionesState.cuadranteDays) &&
      app.asignacionesState.cuadranteDays.length
        ? app.asignacionesState.cuadranteDays
        : _.getPlanningWindow(periodo.anio, periodo.mes);
    return {
      periodo: periodo,
      borradorId: borradorId,
      agentIds: agentIds,
      fechas: planningDays.map(function (day) {
        return day.key;
      }),
      nombreBorrador: _.getCurrentBorradorLabel(),
    };
  }

  function buildHistorialQueryString(extraFilters) {
    let filters = getHistorialFilters();
    let uiFilters = extraFilters || getHistorialUiFilters();
    let params = new URLSearchParams({
      anio: String(filters.periodo.anio),
      mes: String(filters.periodo.mes),
      nombre_borrador: filters.nombreBorrador,
      page: '1',
      limit: '5000',
    });
    if (filters.borradorId)
      params.set('borrador_id', String(filters.borradorId));
    if (filters.agentIds.length)
      params.set('agente_ids', filters.agentIds.join(','));
    if (uiFilters.acciones && uiFilters.acciones.length)
      params.set('acciones', uiFilters.acciones.join(','));
    if (uiFilters.usuario_id)
      params.set('usuario_id', String(uiFilters.usuario_id));
    if (uiFilters.fechas_cambio && uiFilters.fechas_cambio.length)
      params.set('fechas_cambio', uiFilters.fechas_cambio.join(','));
    if (uiFilters.fechas_cuadrante && uiFilters.fechas_cuadrante.length)
      params.set('fechas_cuadrante', uiFilters.fechas_cuadrante.join(','));
    if (uiFilters.repetir_comunicados) {
      params.set('repetir_comunicados', '1');
    }
    return params.toString();
  }

  // ── Helpers de formato ──────────────────────────────────────────
  function formatHistorialDate(value, withTime) {
    if (!value) return 'Cuadrante completo';
    let dt = new Date(withTime ? value : String(value) + 'T00:00:00');
    return withTime
      ? dt.toLocaleString('es-ES')
      : dt.toLocaleDateString('es-ES');
  }

  function normalizeDateKey(value) {
    if (!value) return null;
    let raw = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);
    let dt = new Date(raw);
    if (!Number.isNaN(dt.getTime())) {
      return (
        dt.getFullYear() +
        '-' +
        String(dt.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(dt.getDate()).padStart(2, '0')
      );
    }
    return null;
  }

  function normalizeActividadIds(raw) {
    if (Array.isArray(raw))
      return raw
        .map(function (x) {
          return Number(x);
        })
        .filter(Boolean);
    let n = Number(raw);
    return Number.isFinite(n) && n > 0 ? [n] : [];
  }

  function getTurnoById(turnoId) {
    let id = Number(turnoId);
    if (!id) return null;
    let turnos =
      (app.asignacionesState.meta && app.asignacionesState.meta.turnos) || [];
    return (
      turnos.find(function (t) {
        return Number(t.id_turno) === id;
      }) || null
    );
  }

  function getActividadById(actId) {
    let id = Number(actId);
    if (!id) return null;
    let acts =
      (app.asignacionesState.meta && app.asignacionesState.meta.actividades) ||
      [];
    return (
      acts.find(function (a) {
        return Number(a.id_actividad) === id;
      }) || null
    );
  }

  function colorContrast(hex) {
    if (!hex || hex === 'none') return '#000';
    let c = hex.replace('#', '');
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    let r = parseInt(c.substring(0, 2), 16);
    let g = parseInt(c.substring(2, 4), 16);
    let b = parseInt(c.substring(4, 6), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b > 145 ? '#222' : '#fff';
  }

  function formatHistorialDayEntry(data) {
    if (!data || typeof data !== 'object') return '—';
    let html = '';
    let turno = getTurnoById(data.turno_id);
    if (turno) {
      let bg = turno.color || '#6c757d';
      let fg = colorContrast(bg);
      let codigo = turno.codigo || '#' + turno.id_turno;
      let nombre = turno.nombre || '';
      html +=
        '<span style="display:inline-block;background:' +
        bg +
        ';color:' +
        fg +
        ';border-radius:3px;padding:1px 5px;font-size:.7rem;font-weight:600;white-space:nowrap;margin-bottom:2px">' +
        app.escapeHtml(codigo) +
        '</span>' +
        (nombre
          ? ' <span style="font-size:.7rem">' +
            app.escapeHtml(nombre) +
            '</span>'
          : '');
    } else if (data.turno_id) {
      html +=
        '<span style="font-size:.7rem;color:#888">#' +
        Number(data.turno_id) +
        '</span>';
    } else {
      html += '<span style="color:#aaa">—</span>';
    }
    let actIds = normalizeActividadIds(data.actividad_ids);
    if (actIds.length) {
      actIds.forEach(function (id) {
        let act = getActividadById(id);
        if (act) {
          let abg = act.color || '#adb5bd';
          let afg = colorContrast(abg);
          let acodigo = act.codigo || '#' + id;
          let anombre = act.nombre || '';
          html +=
            '<br><span style="display:inline-block;background:' +
            abg +
            ';color:' +
            afg +
            ';border-radius:3px;padding:0px 4px;font-size:.67rem;white-space:nowrap;margin-top:1px">' +
            app.escapeHtml(acodigo) +
            '</span>' +
            (anombre
              ? ' <span style="font-size:.67rem">' +
                app.escapeHtml(anombre) +
                '</span>'
              : '');
        } else {
          html +=
            '<br><span style="font-size:.67rem;color:#888">#' + id + '</span>';
        }
      });
    }
    return html || '—';
  }

  function getHistorialDayValue(entry, dateKey, side) {
    let datos = side === 'before' ? entry.datos_anteriores : entry.datos_nuevos;
    if (!datos || typeof datos !== 'object') return null;
    if (datos.fechas && typeof datos.fechas === 'object') {
      if (!(dateKey in datos.fechas)) return null;
      let dayData = datos.fechas[dateKey];
      if (dayData === null) return side === 'before' ? '—' : null;
      return formatHistorialDayEntry(dayData);
    }
    let entryFecha = normalizeDateKey(entry.fecha);
    if (entryFecha !== dateKey) return null;
    return formatHistorialDayEntry(datos);
  }

  // ── Helper: consolida cambios por agente, con valores agrupados por día ────
  function consolidateHistorialByAgent(logs) {
    let byAgent = {};
    logs.forEach(function(entry) {
      let agentId = entry.agente_id || 'global';
      if (!byAgent[agentId]) {
        byAgent[agentId] = {
          agente_id: entry.agente_id,
          agente_nombre: entry.agente_nombre,
          agente_apellido1: entry.agente_apellido1,
          agente_apellido2: entry.agente_apellido2,
          agente_tip: entry.agente_tip,
          empleo_nombre: entry.empleo_nombre,
          dayValues: {}
        };
      }
      
      let agent = byAgent[agentId];
      let dayKeys = extractHistorialDayKeysFromEntry(entry);
      dayKeys.forEach(function(dateKey) {
        if (!agent.dayValues[dateKey]) {
          agent.dayValues[dateKey] = { before: null, after: null };
        }
        let beforeVal = getHistorialDayValueFromEntry(entry, dateKey, 'before');
        let afterVal = getHistorialDayValueFromEntry(entry, dateKey, 'after');
        if (beforeVal) agent.dayValues[dateKey].before = beforeVal;
        if (afterVal) agent.dayValues[dateKey].after = afterVal;
      });
    });
    return Object.values(byAgent);
  }

  // ── Helper: extrae las claves de fechas de un entry (antes o después) ────
  function extractHistorialDayKeysFromEntry(entry) {
    let keys = new Set();
    let beforeData = entry.datos_anteriores;
    let afterData = entry.datos_nuevos;
    
    if (beforeData && typeof beforeData === 'object' && beforeData.fechas) {
      Object.keys(beforeData.fechas).forEach(function(key) {
        keys.add(key);
      });
    }
    if (afterData && typeof afterData === 'object' && afterData.fechas) {
      Object.keys(afterData.fechas).forEach(function(key) {
        keys.add(key);
      });
    }
    
    // Si no hay fechas, usa la fecha del entry
    if (keys.size === 0) {
      let entryFecha = normalizeDateKey(entry.fecha);
      if (entryFecha) keys.add(entryFecha);
    }
    
    return Array.from(keys).sort();
  }

  // ── Helper: obtiene el valor formateado de un día desde un entry ────
  function getHistorialDayValueFromEntry(entry, dateKey, side) {
    return getHistorialDayValue(entry, dateKey, side);
  }

  // ── Funciones de expansión y agrupación ─────────────────────────
  // ── Resumen y contenido ─────────────────────────────────────────
  function renderHistorialResumen(total, filters) {
    let resumenEl = document.getElementById('asigHistorialResumen');
    let subtitleEl = document.getElementById('asigHistorialModalSubtitulo');
    if (!resumenEl) return;
    if (subtitleEl) {
      subtitleEl.textContent =
        filters.nombreBorrador +
        ' · ' +
        filters.periodo.anio +
        '/' +
        String(filters.periodo.mes).padStart(2, '0');
    }
    resumenEl.innerHTML =
      '<div class="d-flex flex-wrap gap-2">' +
      GRS1Utils.renderSemanticBadgeHtml('<strong>Fuente:</strong> Borrador', 'light', {
        escapeHtmlFn: function (v) { return String(v); },
        className: 'border',
      }) +
      GRS1Utils.renderSemanticBadgeHtml('<strong>Agentes:</strong> ' + filters.agentIds.length, 'light', {
        escapeHtmlFn: function (v) { return String(v); },
        className: 'border',
      }) +
      GRS1Utils.renderSemanticBadgeHtml('<strong>Borrador:</strong> ' + app.escapeHtml(filters.nombreBorrador), 'light', {
        escapeHtmlFn: function (v) { return String(v); },
        className: 'border',
      }) +
      GRS1Utils.renderSemanticBadgeHtml('<strong>Cambios:</strong> ' + total, 'primary', {
        escapeHtmlFn: function (v) { return String(v); },
        variant: 'solid',
      }) +
      '</div>';
  }

  function renderHistorialContent(logs, filters) {
    let contentEl = document.getElementById('asigHistorialContent');
    if (!contentEl) return;
    contentEl.innerHTML = '';
    if (!logs.length) {
      contentEl.innerHTML =
        '<div class="text-center text-muted py-4">No hay cambios registrados para los agentes seleccionados.</div>';
      return;
    }

    let WEEKDAY_SHORT = _.WEEKDAY_SHORT;
    let planningDays = (
      filters && Array.isArray(filters.fechas) ? filters.fechas : []
    ).map(function (key, idx) {
      let dt = new Date(key + 'T00:00:00');
      let weekday = WEEKDAY_SHORT[idx % 7] || '';
      return {
        key: key,
        label:
          weekday +
          ' ' +
          String(dt.getDate()).padStart(2, '0') +
          '/' +
          String(dt.getMonth() + 1).padStart(2, '0'),
      };
    });

    // Filtrar últimas entradas y consolidar por agente
    let sorted = filterLatestEntries(logs || []);
    let consolidados = consolidateHistorialByAgent(sorted);
    
    // Ordenar agentes por nombre
    consolidados.sort(function (a, b) {
      let nameA = [a.agente_apellido1, a.agente_apellido2, a.agente_nombre]
        .filter(Boolean)
        .join(' ');
      let nameB = [b.agente_apellido1, b.agente_apellido2, b.agente_nombre]
        .filter(Boolean)
        .join(' ');
      return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' });
    });

    // Columnas fijas simplificadas
    let FIXED_COLS = ['Estado', 'TIP', 'Agente', 'Empleo'];
    let FIXED_W = ['80px', '72px', '180px', '130px'];
    let thBase =
      'white-space:nowrap;font-size:.75rem;padding:3px 6px;border:1px solid #dee2e6;';

    let html = '<div style="overflow-x:auto;max-height:52vh;overflow-y:auto;">';
    html +=
      '<table class="table table-sm table-bordered mb-0" style="border-collapse:separate;border-spacing:0;font-size:.78rem;">';
    html += '<thead><tr>';
    FIXED_COLS.forEach(function (col, i) {
      html +=
        '<th style="' +
        thBase +
        'min-width:' +
        FIXED_W[i] +
        ';background:#f8f9fa;">' +
        col +
        '</th>';
    });
    planningDays.forEach(function (d) {
      html +=
        '<th style="' +
        thBase +
        'min-width:78px;max-width:90px;text-align:center;background:#f8f9fa;">' +
        app.escapeHtml(d.label) +
        '</th>';
    });
    html += '</tr></thead><tbody>';

    let tdBase =
      'padding:3px 5px;border:1px solid #dee2e6;vertical-align:top;white-space:nowrap;';
    let tdDay =
      'padding:3px 4px;border:1px solid #dee2e6;vertical-align:top;font-size:.72rem;max-width:90px;white-space:normal;line-height:1.2;text-align:center;';

    // Renderizar por agente consolidado
    consolidados.forEach(function (agent) {
      let agentName = [agent.agente_apellido1, agent.agente_apellido2, agent.agente_nombre]
        .filter(Boolean)
        .join(' ') || 'Acción global';

      // Encabezado del agente
      let totalCols = FIXED_COLS.length + planningDays.length;
      html +=
        '<tr style="background:#e9ecef;"><td colspan="' +
        totalCols +
        '" style="font-size:.78rem;padding:3px 8px;font-weight:600;border:1px solid #dee2e6;">' +
        app.escapeHtml(agentName) +
        ' · ' +
        app.escapeHtml(agent.agente_tip || '') +
        ' · ' +
        app.escapeHtml(agent.empleo_nombre || '—') +
        '</td></tr>';

      // Fila "Anterior"
      html += '<tr style="background:#fff5f5;">';
      html +=
        '<td style="' +
        tdBase +
        'font-weight:600;color:#c0392b;">Anterior</td>';
      html +=
        '<td style="' +
        tdBase +
        '">' +
        app.escapeHtml(agent.agente_tip || '') +
        '</td>';
      html +=
        '<td style="' + tdBase + '">' + app.escapeHtml(agentName) + '</td>';
      html +=
        '<td style="' +
        tdBase +
        '">' +
        app.escapeHtml(agent.empleo_nombre || '—') +
        '</td>';
      planningDays.forEach(function (d) {
        let dayVal = agent.dayValues[d.key];
        let val = dayVal && dayVal.before ? dayVal.before : null;
        html +=
          '<td style="' +
          tdDay +
          '">' +
          (val && val !== '—' ? val : '<span style="color:#aaa">—</span>') +
          '</td>';
      });
      html += '</tr>';

      // Fila "Posterior"
      html += '<tr style="background:#f0faf0;border-top:1px dashed #a8d5b5;">';
      html +=
        '<td style="' +
        tdBase +
        'font-weight:600;color:#1a7a3c;">Posterior</td>';
      html +=
        '<td style="' + tdBase + '"></td>';
      html +=
        '<td style="' + tdBase + '"></td>';
      html +=
        '<td style="' + tdBase + '"></td>';
      planningDays.forEach(function (d) {
        let dayVal = agent.dayValues[d.key];
        let val = dayVal && dayVal.after ? dayVal.after : null;
        html +=
          '<td style="' +
          tdDay +
          '">' +
          (val ? val : '<span style="color:#aaa">—</span>') +
          '</td>';
      });
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    contentEl.innerHTML = html;
  }

  // ── Precarga de filtros ─────────────────────────────────────────
  async function preloadAsignacionesHistorialFilterOptions() {
    let filters = getHistorialFilters();
    let userEl = document.getElementById('asigHistorialFiltroUsuario');
    let dateEl = document.getElementById('asigHistorialFiltroFechaCambio');
    let cuadranteDateEl = document.getElementById(
      'asigHistorialFiltroFechaCuadrante'
    );

    if (userEl) {
      userEl.innerHTML = '<option value="">Cargando usuarios...</option>';
      // @ts-ignore
      userEl.value = '';
    }
    if (dateEl) {
      dateEl.innerHTML =
        '<div class="text-muted small">Cargando fechas...</div>';
    }
    if (cuadranteDateEl) {
      cuadranteDateEl.innerHTML =
        '<div class="text-muted small">Cargando fechas...</div>';
    }

    if (
      !filters.periodo.anio ||
      !filters.periodo.mes ||
      !filters.agentIds.length ||
      !filters.borradorId
    ) {
      if (userEl)
        userEl.innerHTML = '<option value="">Todos los usuarios</option>';
      if (dateEl)
        dateEl.innerHTML =
          '<div class="text-muted small">Sin fechas disponibles</div>';
      if (cuadranteDateEl)
        cuadranteDateEl.innerHTML =
          '<div class="text-muted small">Sin fechas disponibles</div>';
      app.asignacionesState.historialDateSourceLogs = [];
      return;
    }

    try {
      let queryString = buildHistorialQueryString({
        acciones: [],
        usuario_id: '',
        fechas_cambio: [],
        fechas_cuadrante: [],
      });
      let response = await fetch('/api/asignaciones/historial?' + queryString, {
        headers: _.headers(),
      });
      if (!response.ok)
        throw new Error('No se pudieron cargar los filtros del historial');
      let data = await response.json();
      let logs = Array.isArray(data.logs) ? data.logs : [];
      let total = Number(data.total || 0);
      app.asignacionesState.historialDateSourceLogs = logs.slice();
      renderHistorialResumen(total, filters);
      populateHistorialUsers(logs);
      populateHistorialDates(logs);
      populateHistorialFechaCuadrante(logs);
    } catch (error) {
      if (userEl)
        userEl.innerHTML = '<option value="">Todos los usuarios</option>';
      if (dateEl)
        dateEl.innerHTML =
          '<div class="text-danger small">No se pudieron cargar las fechas</div>';
      if (cuadranteDateEl)
        cuadranteDateEl.innerHTML =
          '<div class="text-danger small">No se pudieron cargar las fechas</div>';
      app.asignacionesState.historialDateSourceLogs = [];
      renderHistorialResumen(0, filters);
    }
  }

  // ── Carga principal del historial ───────────────────────────────
  async function loadAsignacionesHistorial() {
    let filters = getHistorialFilters();
    let uiFilters = getHistorialUiFilters();
    if (!filters.periodo.anio || !filters.periodo.mes) {
      _.showAlert('Selecciona primero el período del cuadrante.', 'warning');
      return;
    }
    if (!filters.agentIds.length) {
      _.showAlert(
        'Marca al menos un agente en la tabla para consultar el historial.',
        'warning'
      );
      return;
    }
    if (!filters.borradorId) {
      _.showAlert(
        'Selecciona un borrador para consultar el historial exacto del cuadrante.',
        'warning'
      );
      return;
    }

    let contentEl = document.getElementById('asigHistorialContent');
    let pdfBtn = document.getElementById('btnAsigHistorialPdf');
    let excelBtn = document.getElementById('btnAsigHistorialExcel');
    if (!contentEl) return;

    contentEl.innerHTML =
      '<div class="text-center text-muted py-4"><div class="spinner-border spinner-border-sm me-2" role="status"></div>Cargando historial...</div>';
    renderHistorialResumen(0, filters);
    // @ts-ignore
    if (pdfBtn) pdfBtn.disabled = true;
    // @ts-ignore
    if (excelBtn) excelBtn.disabled = true;

    try {
      let queryString = buildHistorialQueryString(uiFilters);
      let response = await fetch('/api/asignaciones/historial?' + queryString, {
        headers: _.headers(),
      });
      if (!response.ok)
        throw new Error('No se pudo cargar el historial del cuadrante');
      let data = await response.json();
      let logs = Array.isArray(data.logs) ? data.logs : [];
      let total = Number(data.total || 0);

      let dateSourceLogs =
        Array.isArray(app.asignacionesState.historialDateSourceLogs) &&
        app.asignacionesState.historialDateSourceLogs.length
          ? app.asignacionesState.historialDateSourceLogs
          : logs;

      app.asignacionesState.historialLogs = logs;
      renderHistorialResumen(total, filters);
      populateHistorialUsers(dateSourceLogs);
      populateHistorialDates(dateSourceLogs);
      populateHistorialFechaCuadrante(dateSourceLogs);
      renderHistorialContent(logs, filters);
      if (pdfBtn) {
        // @ts-ignore
        pdfBtn.disabled = !logs.length;
        pdfBtn.dataset.query = queryString;
      }
      if (excelBtn) {
        // @ts-ignore
        excelBtn.disabled = !logs.length;
      }
    } catch (error) {
      contentEl.innerHTML =
        '<div class="alert alert-danger mb-0">' +
        app.escapeHtml(error.message || 'Error al cargar historial') +
        '</div>';
      if (pdfBtn) {
        // @ts-ignore
        pdfBtn.disabled = true;
        delete pdfBtn.dataset.query;
      }
      // @ts-ignore
      if (excelBtn) excelBtn.disabled = true;
    }
  }


  // ── Filtro: último cambio por (agente + día). Siempre, comunicado o no ──
  function filterLatestEntries(logs) {
    if (!Array.isArray(logs) || !logs.length) return logs;
    var latestByAgentDay = new Map();
    logs.forEach(function (entry) {
      var day = entry.fecha ? String(entry.fecha).slice(0, 10) : '__MASIVO__';
      var key = String(entry.agente_id || '') + '|' + day;
      var existing = latestByAgentDay.get(key);
      if (!existing) {
        latestByAgentDay.set(key, entry);
      } else {
        var tExisting = new Date(existing.created_at || 0).getTime();
        var tNew      = new Date(entry.created_at   || 0).getTime();
        if (tNew > tExisting) latestByAgentDay.set(key, entry);
      }
    });
    return Array.from(latestByAgentDay.values());
  }

  async function exportHistorialExcel() {
    let excelBtn = document.getElementById('btnAsigHistorialExcel');
    let logs = Array.isArray(app.asignacionesState.historialLogs)
      ? app.asignacionesState.historialLogs
      : [];
    if (!logs.length) {
      _.showAlert('No hay datos de historial para exportar.', 'warning');
      return;
    }

    if (excelBtn) {
      // @ts-ignore
      excelBtn.disabled = true;
      excelBtn.dataset.loading = '1';
    }

    // Llama al endpoint server-side que genera el .xlsx con ExcelJS
    let filters = getHistorialFilters();
    let queryString = buildHistorialQueryString(getHistorialUiFilters());
    let fechasParam = (Array.isArray(filters.fechas) ? filters.fechas : []).join(',');
    let url = '/api/asignaciones/historial/excel?' + queryString +
      (fechasParam ? '&fechas=' + encodeURIComponent(fechasParam) : '');

    try {
      let response = await fetch(url, { headers: _.headers() });
      if (!response.ok) {
        let err = await response.json().catch(function () {
          return { error: 'Error al exportar historial a Excel' };
        });
        throw new Error(err.error || 'Error al exportar historial a Excel');
      }

      let blob = await response.blob();
      let disposition = response.headers.get('Content-Disposition') || '';
      let match = disposition.match(/filename="?([^";]+)"?/i);
      let filename = match && match[1] ? match[1] : 'historial_cuadrante.xlsx';

      let blobUrl = URL.createObjectURL(blob);
      let link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      _.showAlert(error.message || 'Error al exportar historial a Excel', 'danger');
    } finally {
      if (excelBtn) {
        delete excelBtn.dataset.loading;
        // @ts-ignore
        excelBtn.disabled = !logs.length;
      }
    }
  }

  // ── Abrir modal ─────────────────────────────────────────────────
  async function openAsignacionesHistorialModal() {
    let filters = getHistorialFilters();
    if (!filters.agentIds.length) {
      _.showAlert(
        'Marca al menos un agente en la tabla para consultar el historial.',
        'warning'
      );
      return;
    }
    let modalEl = document.getElementById('modalHistorialAsignaciones');
    if (!modalEl) return;
    ensureHistorialFilterControls();
    resetHistorialUiFilters();
    setHistorialDefaultActionFilters();
    app.asignacionesState.historialDateSourceLogs = [];
    if (!modalEl.dataset.historialShownBound) {
      modalEl.dataset.historialShownBound = '1';
      modalEl.addEventListener('hide.bs.modal', function () {
        if (document.activeElement && modalEl.contains(document.activeElement))
          // @ts-ignore
          document.activeElement.blur();
      });
    }
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
    let contentEl = document.getElementById('asigHistorialContent');
    if (contentEl)
      contentEl.innerHTML =
        '<div class="text-center text-muted py-4">Selecciona los filtros y pulsa <strong>Consultar</strong> para cargar el historial.</div>';
    let pdfBtn = document.getElementById('btnAsigHistorialPdf');
    let excelBtn = document.getElementById('btnAsigHistorialExcel');
    if (excelBtn && excelBtn.dataset.boundInternal !== '1') {
      excelBtn.dataset.boundInternal = '1';
      excelBtn.addEventListener('click', function () {
        exportHistorialExcel();
      });
    }
    // @ts-ignore
    if (pdfBtn) pdfBtn.disabled = true;
    // @ts-ignore
    if (excelBtn) excelBtn.disabled = true;
    renderHistorialResumen(0, getHistorialFilters());
    updateHistorialApplyButtonState();
    await preloadAsignacionesHistorialFilterOptions();
  }

  // ── Exportar al namespace compartido ────────────────────────────
  _.openAsignacionesHistorialModal = openAsignacionesHistorialModal;
  _.loadAsignacionesHistorial = loadAsignacionesHistorial;
  _.resetHistorialUiFilters = resetHistorialUiFilters;
  _.populateHistorialUsers = populateHistorialUsers;
  _.populateHistorialDates = populateHistorialDates;
  _.populateHistorialFechaCuadrante = populateHistorialFechaCuadrante;
  _.getHistorialFilters = getHistorialFilters;
  _.renderHistorialResumen = renderHistorialResumen;
  _.updateHistorialApplyButtonState = updateHistorialApplyButtonState;
  _.exportHistorialExcel = exportHistorialExcel;
})();
