/* ========================================================================
 *  dashboard-asignaciones-utils.js
 *  Constantes, utilidades genéricas, helpers de formulario/periodo
 *  para el módulo de Asignaciones.
 * ======================================================================== */

(function () {
  let app = window.GRS1Dashboard;

  function ensureDeleteDateGridStyles() {
    let styleId = 'asig-delete-date-grid-style';
    if (document.getElementById(styleId)) return;
    let style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
.delete-date-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr); /* 7 columnas */
  grid-template-rows: repeat(4, 1fr);    /* 4 filas fijas */
  gap: 2px;
  margin-bottom: 4px;
  max-width: 350px; /* controla tamaño total */
}

.delete-date-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  aspect-ratio: 1 / 1;
  width: 100%;
  font-size: 0.85rem;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  background: #f8f9fa;
  cursor: pointer;
  transition: background 0.2s;
}
    .delete-date-cell input[type="checkbox"] {
      margin-bottom: 2px;
    }
    .delete-date-cell.empty {
      border: none;
      background: transparent;
      pointer-events: none;
    }
    .delete-date-cell input[type="checkbox"]:checked + span,
    .delete-date-cell input[type="checkbox"]:checked {
      background: #ffe082;
    }
  `;
    document.head.appendChild(style);
  }

  ensureDeleteDateGridStyles();

  // ── Namespace interno compartido entre módulos de asignaciones ──
  app._asig = app._asig || {};

  // ── Constantes ──────────────────────────────────────────────────
  let ASIG_FE_VERSION = 'asig-fe-20260401l';

  // @ts-ignore
  let TABULATOR_LANGS = window.GRS1TabulatorLangs;

  let MONTHS = [
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

  let WEEKDAY_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  let BULK_REQUEST_AGENT_CHUNK_SIZE = Number(
    // @ts-ignore
    window.BULK_REQUEST_AGENT_CHUNK_SIZE || 50
  );

  // ── Helpers genéricos ───────────────────────────────────────────

  function agenteNombre(ag) {
    return [
      ag.apellido_1 || ag.agente_apellido1,
      ag.apellido_2 || ag.agente_apellido2,
      ag.nombre || ag.agente_nombre,
    ]
      .filter(Boolean)
      .join(' ');
  }

  function headers() {
    let h = { Authorization: 'Bearer ' + app.globalState.token };
    if (app.globalState.activeArsId)
      h['X-Ars-Id'] = app.globalState.activeArsId;
    return h;
  }

  function chunkItems(items, chunkSize) {
    let safeSize = Math.max(1, Number(chunkSize) || 1);
    let chunks = [];
    for (let i = 0; i < items.length; i += safeSize) {
      chunks.push(items.slice(i, i + safeSize));
    }
    return chunks;
  }

  function isConsultaReadOnlyRole() {
    return String(app.globalState && app.globalState.userRole || '')
      .trim()
      .toLowerCase() === 'consulta';
  }

  function disableWriteActionButtons(buttonIds, titleText) {
    if (!isConsultaReadOnlyRole()) return;
    let ids = Array.isArray(buttonIds) ? buttonIds : [];
    let title = String(titleText || 'Perfil consulta: solo lectura');
    ids.forEach(function (id) {
      let el = document.getElementById(String(id || ''));
      if (!el) return;
      // @ts-ignore
      el.disabled = true;
      el.classList.add('disabled');
      el.setAttribute('title', title);
      el.setAttribute('aria-disabled', 'true');
    });
  }

  function updateBulkProgress(percent, text) {
    let wrap = document.getElementById('asigBulkProgressWrap');
    let bar = document.getElementById('asigBulkProgressBar');
    let label = document.getElementById('asigBulkProgressText');
    if (!wrap || !bar || !label) return;

    let value = Math.max(0, Math.min(100, Number(percent) || 0));
    wrap.classList.remove('d-none');
    bar.style.width = value + '%';
    bar.setAttribute('aria-valuenow', String(Math.round(value)));
    bar.textContent = Math.round(value) + '%';
    label.textContent = text || 'Procesando...';
  }

  function resetBulkProgress() {
    let wrap = document.getElementById('asigBulkProgressWrap');
    let bar = document.getElementById('asigBulkProgressBar');
    let label = document.getElementById('asigBulkProgressText');
    if (wrap) wrap.classList.add('d-none');
    if (bar) {
      bar.style.width = '0%';
      bar.setAttribute('aria-valuenow', '0');
      bar.textContent = '0%';
    }
    if (label) label.textContent = '';
  }

  function showAlert(message, type) {
    let el = document.getElementById('alertContainerAsignaciones');
    if (!el) return;
    el.innerHTML =
      '<div class="alert alert-' +
      type +
      ' alert-dismissible py-1 mb-0 fade show" role="alert">' +
      app.escapeHtml(message) +
      '<button type="button" class="btn-close" data-bs-dismiss="alert"></button>' +
      '</div>';
    setTimeout(function () {
      el.innerHTML = '';
    }, 3000);
  }

  function parseDias(value) {
    return Array.from(
      new Set(
        String(value || '')
          .split(',')
          .map(function (x) {
            return Number(String(x).trim());
          })
          .filter(function (n) {
            return Number.isInteger(n) && n >= 1 && n <= 31;
          })
      )
    ).sort(function (a, b) {
      return a - b;
    });
  }

  function daysInMonth(anio, mes) {
    return new Date(anio, mes, 0).getDate();
  }

  function toIsoDate(dateObj) {
    let y = dateObj.getFullYear();
    let m = String(dateObj.getMonth() + 1).padStart(2, '0');
    let d = String(dateObj.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function getPlanningWindow(anio, mes) {
    let DateTime = window.luxon && window.luxon.DateTime;
    if (!DateTime) return [];

    // Si hay un cuadrante seleccionado y coincide con el periodo actual, usarlo.
    let cuad = app.asignacionesState.cuadranteSeleccionado;
    let samePeriod =
      cuad &&
      Number(cuad.anio_referencia) === Number(anio) &&
      Number(cuad.mes_referencia) === Number(mes);

    if (samePeriod && Array.isArray(cuad.dias) && cuad.dias.length) {
      return cuad.dias
        .map(function (d) {
          let dt = DateTime.fromISO(String(d.fecha), { zone: 'utc' });
          if (!dt.isValid) return null;
          let weekdayIndex = Math.max(0, Math.min(6, Number(d.dia_semana) - 1));
          return {
            key: dt.toISODate(),
            anio: dt.year,
            mes: dt.month,
            dia: dt.day,
            weekdayIndex: weekdayIndex,
            label: WEEKDAY_SHORT[weekdayIndex],
            labelDate:
              String(dt.day).padStart(2, '0') +
              '/' +
              String(dt.month).padStart(2, '0'),
            esTraspaso: !d.es_del_mes_ref,
            esFestivo: Boolean(d.es_festivo),
          };
        })
        .filter(Boolean);
    }

    // Sin cuadrante seleccionado (o no coincide con el periodo): no se calcula automáticamente.
    return [];
  }

  function resolvePlanningDatesFromDays(anio, mes, dias) {
    let wanted = new Set(
      (dias || []).map(function (n) {
        return Number(n);
      })
    );
    return getPlanningWindow(anio, mes)
      .filter(function (day) {
        return wanted.has(Number(day.dia));
      })
      .map(function (day) {
        return day.key;
      });
  }

  function periodoKey(anio, mes) {
    return String(anio) + '-' + String(mes).padStart(2, '0');
  }

  function normalizeAgenteId(value) {
    return Number(value || 0);
  }

  function normalizeSearchText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function getAgentSearchTerm() {
    return normalizeSearchText(app.asignacionesState.searchTerm || '');
  }

  function updateSearchSummary(visibleCount, totalCount) {
    let el = document.getElementById('asigSearchSummary');
    if (!el) return;
    let term = String(app.asignacionesState.searchTerm || '').trim();
    if (!term) {
      el.textContent = 'Sin filtro activo';
      return;
    }
    el.textContent =
      'Mostrando ' +
      visibleCount +
      ' de ' +
      totalCount +
      ' agente(s) para "' +
      term +
      '"';
  }

  // ── Periodo y borradores ────────────────────────────────────────

  function getPeriodo() {
    // @ts-ignore
    let anio = Number(document.getElementById('asigAnio')?.value);
    // @ts-ignore
    let mes = Number(document.getElementById('asigMes')?.value);
    return { anio: anio, mes: mes };
  }

  function getSelectedBorradorId() {
    let sel = document.getElementById('asigBorrador');
    // @ts-ignore
    let id = Number(sel?.value || 0);
    if (!(id > 0)) return null;

    let borradores =
      (app.asignacionesState && app.asignacionesState.borradores) || [];
    if (
      borradores.length &&
      !borradores.some(function (b) {
        return Number(b.id) === id;
      })
    ) {
      // @ts-ignore
      if (sel) sel.value = '';
      if (app.asignacionesState) app.asignacionesState.borradorId = null;
      return null;
    }

    return id;
  }

  function updateObsBtnStyle() {
    let btn = document.getElementById('btnEditObservacionesBorrador');
    if (!btn) return;
    if (isConsultaReadOnlyRole()) {
      // @ts-ignore
      btn.disabled = true;
      btn.classList.add('disabled');
      btn.title = 'Perfil consulta: solo lectura';
      return;
    }
    let borradorId = getSelectedBorradorId();
    let borradores = app.asignacionesState.borradores || [];
    let borrador = borradores.find(function (b) {
      return Number(b.id) === Number(borradorId);
    });
    let tieneObs =
      borrador && borrador.observaciones && borrador.observaciones.trim();
    btn.className = tieneObs
      ? 'btn btn-outline-primary btn-sm px-2 py-1'
      : 'btn btn-outline-secondary btn-sm px-2 py-1';
    btn.title = tieneObs
      ? 'Ver/editar observaciones del borrador'
      : 'Crear observaciones del borrador';
  }

  function updateConsolidarDevengosBtnState() {
    let btn = document.getElementById('btnAsigConsolidarDevengos');
    if (!btn) return;
    if (isConsultaReadOnlyRole()) {
      // @ts-ignore
      btn.disabled = true;
      btn.classList.add('disabled');
      btn.title = 'Perfil consulta: solo lectura';
      return;
    }
    let borradorId = getSelectedBorradorId();
    // @ts-ignore
    btn.disabled = !borradorId;
    btn.title = borradorId
      ? 'Consolidar devengos (recalcular)'
      : 'Seleccione un borrador para consolidar devengos';
  }

  function updateNuevoBorradorBtnState() {
    let btn = document.getElementById('btnAsigNuevoBorrador');
    let badge = document.getElementById('asigPeriodoCerradoBadge');
    if (!btn) return;

    if (isConsultaReadOnlyRole()) {
      // @ts-ignore
      btn.disabled = true;
      btn.classList.add('disabled');
      btn.title = 'Perfil consulta: solo lectura';
      if (badge) {
        badge.classList.add('d-none');
        badge.textContent = '';
      }
      return;
    }

    let borradores = app.asignacionesState.borradores || [];
    let hasCanonico = borradores.some(function (b) {
      let estado = String((b && b.estado) || '').toLowerCase();
      return estado === 'validado' || estado === 'modificado';
    });

    btn.disabled = hasCanonico;
    btn.title = hasCanonico
      ? 'No se pueden crear más borradores: ya existe un borrador canónico del período'
      : 'Nuevo borrador';

    if (badge) {
      badge.classList.toggle('d-none', !hasCanonico);
      badge.textContent = hasCanonico ? 'Período cerrado' : '';
      badge.title = hasCanonico
        ? 'Ya existe un borrador canónico validado/modificado para este período'
        : '';
    }
  }

  function renderBorradoresSelect(items, selectedId) {
    let sel = document.getElementById('asigBorrador');
    if (!sel) return;

    let rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
      sel.innerHTML = '<option value="">Sin borradores</option>';
      // @ts-ignore
      sel.value = '';
      app.asignacionesState.borradorId = null;
      app.asignacionesState.borradores = [];
      updateNuevoBorradorBtnState();
      return;
    }

    sel.innerHTML = rows
      .map(function (b) {
        let tag = b.estado === 'validado' ? ' (validado)' : '';
        let owner = b.propietario_username
          ? ' · ' + b.propietario_username
          : '';
        return (
          '<option value="' +
          b.id +
          '">' +
          app.escapeHtml(
            (b.nombre || 'Borrador') + ' v' + (b.version || 1) + tag + owner
          ) +
          '</option>'
        );
      })
      .join('');

    let exists = rows.some(function (b) {
      return Number(b.id) === Number(selectedId);
    });
    // @ts-ignore
    sel.value = String(exists ? selectedId : rows[0].id);

    // @ts-ignore
    app.asignacionesState.borradorId = Number(sel.value);
    app.asignacionesState.borradores = rows;
    updateObsBtnStyle();
    updateConsolidarDevengosBtnState();
    updateNuevoBorradorBtnState();
  }

  app.loadAsignacionesBorradores = async function loadAsignacionesBorradores(
    preferredId
  ) {
    let p = getPeriodo();
    if (!p.anio || !p.mes) return;
    try {
      let ts = Date.now();
      let res = await fetch(
        '/api/asignaciones/borradores/' +
          p.anio +
          '/' +
          p.mes +
          '?_ts=' +
          encodeURIComponent(String(ts)),
        { headers: headers(), cache: 'no-store' }
      );
      if (!res.ok) throw new Error('No se pudieron cargar borradores');
      let json = await res.json();
      let list = json && Array.isArray(json.borradores) ? json.borradores : [];
      renderBorradoresSelect(
        list,
        preferredId || app.asignacionesState.borradorId || null
      );
    } catch (e) {
      renderBorradoresSelect([], null);
      showAlert(e.message, 'danger');
    }
  };

  // ── Caché de días de cuadrante para períodos distintos al activo ──

  let _cuadranteDaysCache = {};

  /**
   * Devuelve los días del cuadrante (formato getPlanningWindow) para cualquier
   * anio/mes, incluso si no es el cuadrante actualmente seleccionado.
   * 1. Si el cuadranteSeleccionado actual coincide → devuelve getPlanningWindow.
   * 2. Si está en caché → devuelve la caché.
   * 3. Si no → busca en GET /api/cuadrantes el cuadrante con ese anio_referencia/mes_referencia,
   *    luego GET /api/cuadrantes/:id para obtener `dias`, los transforma y cachea.
   */
  async function fetchCuadranteDaysForPeriod(anio, mes) {
    let DateTime = window.luxon && window.luxon.DateTime;
    if (!DateTime) return [];

    // 1. Cuadrante activo coincide → usar getPlanningWindow
    let days = getPlanningWindow(anio, mes);
    if (days.length) return days;

    // 2. Caché
    let cacheKey = String(anio) + '-' + String(mes);
    if (_cuadranteDaysCache[cacheKey]) return _cuadranteDaysCache[cacheKey];

    try {
      // 3. Buscar en la lista de cuadrantes
      let listRes = await fetch('/api/cuadrantes', { headers: headers() });
      if (!listRes.ok) return [];
      let listJson = await listRes.json();
      let lista = Array.isArray(listJson.data) ? listJson.data : [];
      let cuad = lista.find(function (c) {
        return (
          Number(c.anio_referencia) === Number(anio) &&
          Number(c.mes_referencia) === Number(mes)
        );
      });
      if (!cuad) return [];

      // 4. Cargar detalle con dias[]
      let detRes = await fetch('/api/cuadrantes/' + cuad.id, {
        headers: headers(),
      });
      if (!detRes.ok) return [];
      let detJson = await detRes.json();
      let detalle = detJson.data || {};
      if (!Array.isArray(detalle.dias) || !detalle.dias.length) return [];

      let WEEKDAY_SHORT_LOCAL = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'];
      let result = detalle.dias
        .map(function (d) {
          let dt = DateTime.fromISO(String(d.fecha), { zone: 'utc' });
          if (!dt.isValid) return null;
          let weekdayIndex = Math.max(0, Math.min(6, Number(d.dia_semana) - 1));
          return {
            key: dt.toISODate(),
            anio: dt.year,
            mes: dt.month,
            dia: dt.day,
            weekdayIndex: weekdayIndex,
            label: WEEKDAY_SHORT_LOCAL[weekdayIndex],
            labelDate:
              String(dt.day).padStart(2, '0') +
              '/' +
              String(dt.month).padStart(2, '0'),
            esTraspaso: !d.es_del_mes_ref,
            esFestivo: Boolean(d.es_festivo),
          };
        })
        .filter(Boolean);

      _cuadranteDaysCache[cacheKey] = result;
      return result;
    } catch (_e) {
      return [];
    }
  }

  // ── Funciones genéricas para grid de fechas (delete / copy) ─────

  function _renderDateGrid(
    containerId,
    checkboxClass,
    summaryId,
    anio,
    mes,
    preFetchedDays
  ) {
    let container = document.getElementById(containerId);
    let summary = document.getElementById(summaryId);
    if (!container) return;

    let planningDays = preFetchedDays || getPlanningWindow(anio, mes);
    let weeks = [];
    for (let i = 0; i < planningDays.length; i += 7) {
      weeks.push(planningDays.slice(i, i + 7));
    }

    container.innerHTML = weeks
      .map(function (week, weekIndex) {
        return (
          '<div class="d-flex gap-1 mb-1" data-week="' +
          weekIndex +
          '">' +
          week
            .map(function (day) {
              let weekend = day.weekdayIndex >= 5;
              return (
                '<label class="border rounded px-1 py-1 small text-center" style="width:52px;min-width:52px;cursor:pointer;line-height:1.1;background:' +
                (weekend ? '#fff8e1' : '#f8f9fa') +
                '">' +
                '<input class="form-check-input mb-1 ' +
                checkboxClass +
                '" type="checkbox" value="' +
                app.escapeHtml(day.key) +
                '" data-dia="' +
                day.dia +
                '">' +
                '<div class="fw-semibold" style="font-size:.72rem">' +
                app.escapeHtml(day.label) +
                '</div>' +
                '<div style="font-size:.7rem">' +
                app.escapeHtml(day.labelDate) +
                '</div>' +
                '</label>'
              );
            })
            .join('') +
          '</div>'
        );
      })
      .join('');

    function updateSummary() {
      let checked = container.querySelectorAll(
        '.' + checkboxClass + ':checked'
      ).length;
      if (summary) {
        summary.textContent = checked
          ? 'Fechas seleccionadas: ' + checked
          : 'Seleccione una o varias fechas visibles del cuadrante.';
      }
    }
    container.querySelectorAll('.' + checkboxClass).forEach(function (input) {
      input.addEventListener('change', updateSummary);
    });
    updateSummary();
  }

  function renderDeleteDateOptions(anio, mes) {
    _renderDateGrid(
      'asigDeleteDates',
      'asig-delete-date-check',
      'asigDeleteDatesSummary',
      anio,
      mes
    );
  }

  function getSelectedDeleteDates() {
    return Array.from(
      document.querySelectorAll(
        '#asigDeleteDates .asig-delete-date-check:checked'
      )
    )
      .map(function (input) {
        // @ts-ignore
        return String(input.value || '');
      })
      .filter(Boolean);
  }

  async function renderCopyDateOptions(anio, mes) {
    let days = await fetchCuadranteDaysForPeriod(anio, mes);
    _renderDateGrid(
      'asigCopyDates',
      'asig-copy-date-check',
      'asigCopyDatesSummary',
      anio,
      mes,
      days
    );
  }

  function getSelectedCopyDates() {
    return Array.from(
      document.querySelectorAll('#asigCopyDates .asig-copy-date-check:checked')
    )
      .map(function (input) {
        // @ts-ignore
        return String(input.value || '');
      })
      .filter(Boolean);
  }

  function getSelectedNumbersFromSelect(el) {
    if (!el) return [];
    if (el.tagName === 'SELECT') {
      return Array.from(el.selectedOptions || [])
        .map(function (opt) { return Number(opt.value); })
        .filter(Boolean);
    }
    // div-based custom list (.asig-act-list)
    return Array.from(el.querySelectorAll('.asig-act-item.selected'))
      .map(function (item) { return Number(item.dataset.value); })
      .filter(Boolean);
  }

  // ── Modal draggable ─────────────────────────────────────────────

  function makeModalDraggable(modalEl) {
    if (!modalEl || modalEl.dataset.draggableBound === '1') return;
    let dialog = modalEl.querySelector('.modal-dialog');
    let header = modalEl.querySelector('.modal-header');
    if (!dialog || !header) return;

    modalEl.dataset.draggableBound = '1';
    header.style.cursor = 'move';

    let dragging = false;
    let startMouseX = 0,
      startMouseY = 0;
    let startOffsetX = 0,
      startOffsetY = 0;
    let offsetX = 0,
      offsetY = 0;

    function applyTransform(x, y) {
      dialog.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
    }

    function resetPosition() {
      offsetX = 0;
      offsetY = 0;
      dialog.style.transform = '';
    }

    modalEl.addEventListener('shown.bs.modal', function () {
      resetPosition();
    });
    modalEl.addEventListener('hidden.bs.modal', function () {
      dragging = false;
      resetPosition();
    });

    header.addEventListener('mousedown', function (ev) {
      if (ev.target.closest('button')) return;
      dragging = true;
      startMouseX = ev.clientX;
      startMouseY = ev.clientY;
      startOffsetX = offsetX;
      startOffsetY = offsetY;
      ev.preventDefault();
    });

    document.addEventListener('mousemove', function (ev) {
      if (!dragging) return;
      let nextX = startOffsetX + (ev.clientX - startMouseX);
      let nextY = startOffsetY + (ev.clientY - startMouseY);
      let vw = window.innerWidth,
        vh = window.innerHeight;
      let rect = dialog.getBoundingClientRect();
      let projectedLeft = rect.left + (nextX - offsetX);
      let projectedTop = rect.top + (nextY - offsetY);
      if (projectedLeft < 0) nextX += -projectedLeft;
      if (projectedLeft + rect.width > vw)
        nextX -= projectedLeft + rect.width - vw;
      if (projectedTop < 0) nextY += -projectedTop;
      if (projectedTop + 80 > vh) nextY -= projectedTop + 80 - vh;
      offsetX = nextX;
      offsetY = nextY;
      applyTransform(offsetX, offsetY);
    });

    document.addEventListener('mouseup', function () {
      dragging = false;
    });
  }

  // ── Metadatos helpers ───────────────────────────────────────────

  function getTurnoLabel(entry) {
    let codigo = entry.turno_codigo || '-';
    let nombre = entry.turno_nombre || '';
    return nombre ? codigo + ' · ' + nombre : codigo;
  }

  function getActividadLabelById(id) {
    let actividades =
      (app.asignacionesState.meta && app.asignacionesState.meta.actividades) ||
      [];
    let item = actividades.find(function (actividad) {
      return Number(actividad.id_actividad) === Number(id);
    });
    if (!item) return String(id);
    if (item.codigo && item.nombre) return item.codigo + ' - ' + item.nombre;
    return item.codigo || item.nombre;
  }

  function getSelectedHistorialAgentIds() {
    return Array.from(
      new Set(
        (app.asignacionesState.selectedAgenteIdsVista || [])
          .map(function (id) {
            return Number(id);
          })
          .filter(function (id) {
            return Number.isInteger(id) && id > 0;
          })
      )
    );
  }

  function getCurrentBorradorLabel() {
    let borradorId = getSelectedBorradorId();
    if (!borradorId) return 'Sin borrador seleccionado';
    let borrador = (app.asignacionesState.borradores || []).find(
      function (item) {
        return Number(item.id) === Number(borradorId);
      }
    );
    if (!borrador) return 'Borrador #' + borradorId;
    let estado = 'borrador';
    if (borrador.estado === 'validado') estado = 'validado';
    else if (borrador.estado === 'modificado') estado = 'modificado';
    return (
      (borrador.nombre || 'Borrador') +
      ' v' +
      (borrador.version || 1) +
      ' · ' +
      estado
    );
  }

  function getCurrentFuenteLabel() {
    return 'Borrador · ' + getCurrentBorradorLabel();
  }

  // ── Conversión mes string ↔ number ──────────────────────────────

  function mesStringToNumber(value) {
    function normalizeMonthText(v) {
      return String(v || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
    }
    let raw = String(value || '').trim();
    if (!raw) return NaN;
    let asNum = Number(raw);
    if (Number.isInteger(asNum) && asNum >= 1 && asNum <= 12) return asNum;
    let norm = normalizeMonthText(raw);
    for (let i = 0; i < MONTHS.length; i++) {
      if (normalizeMonthText(MONTHS[i]) === norm) return i + 1;
    }
    return NaN;
  }

  function mesNumberToString(mes) {
    let n = Number(mes);
    if (!Number.isInteger(n) || n < 1 || n > 12) return '';
    return MONTHS[n - 1];
  }

  // ── Exportar al namespace compartido ────────────────────────────
  app._asig.ASIG_FE_VERSION = ASIG_FE_VERSION;
  app._asig.TABULATOR_LANGS = TABULATOR_LANGS;
  app._asig.MONTHS = MONTHS;
  app._asig.WEEKDAY_SHORT = WEEKDAY_SHORT;
  app._asig.BULK_REQUEST_AGENT_CHUNK_SIZE = BULK_REQUEST_AGENT_CHUNK_SIZE;
  app._asig.tabulator = null; // referencia compartida a la instancia Tabulator

  app._asig.agenteNombre = agenteNombre;
  app._asig.headers = headers;
  app._asig.chunkItems = chunkItems;
  app._asig.isConsultaReadOnlyRole = isConsultaReadOnlyRole;
  app._asig.disableWriteActionButtons = disableWriteActionButtons;
  app._asig.updateBulkProgress = updateBulkProgress;
  app._asig.resetBulkProgress = resetBulkProgress;
  app._asig.showAlert = showAlert;
  app._asig.parseDias = parseDias;
  app._asig.daysInMonth = daysInMonth;
  app._asig.toIsoDate = toIsoDate;
  app._asig.getPlanningWindow = getPlanningWindow;
  app._asig.fetchCuadranteDaysForPeriod = fetchCuadranteDaysForPeriod;
  app._asig.resolvePlanningDatesFromDays = resolvePlanningDatesFromDays;
  app._asig.periodoKey = periodoKey;
  app._asig.normalizeAgenteId = normalizeAgenteId;
  app._asig.normalizeSearchText = normalizeSearchText;
  app._asig.getAgentSearchTerm = getAgentSearchTerm;
  app._asig.updateSearchSummary = updateSearchSummary;

  app._asig.getPeriodo = getPeriodo;
  app._asig.getSelectedBorradorId = getSelectedBorradorId;
  app._asig.updateObsBtnStyle = updateObsBtnStyle;
  app._asig.updateConsolidarDevengosBtnState = updateConsolidarDevengosBtnState;
  app._asig.renderBorradoresSelect = renderBorradoresSelect;

  app._asig.renderDeleteDateOptions = renderDeleteDateOptions;
  app._asig.getSelectedDeleteDates = getSelectedDeleteDates;
  app._asig.renderCopyDateOptions = renderCopyDateOptions;
  app._asig.getSelectedCopyDates = getSelectedCopyDates;
  app._asig.getSelectedNumbersFromSelect = getSelectedNumbersFromSelect;

  app._asig.makeModalDraggable = makeModalDraggable;

  app._asig.getTurnoLabel = getTurnoLabel;
  app._asig.getActividadLabelById = getActividadLabelById;
  app._asig.getSelectedHistorialAgentIds = getSelectedHistorialAgentIds;
  app._asig.getCurrentBorradorLabel = getCurrentBorradorLabel;
  app._asig.getCurrentFuenteLabel = getCurrentFuenteLabel;

  app._asig.mesStringToNumber = mesStringToNumber;
  app._asig.mesNumberToString = mesNumberToString;
})();
