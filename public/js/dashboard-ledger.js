(function () {
  let app = window.GRS1Dashboard;
  if (!app) return;
  let utils = window['GRS1Utils'] || {};

  // ── State ────────────────────────────────────────────────────────────────
  let st = {
    selectedSaldo: null, // fila activa en acumulados (carga movimientos)
    activeSaldoKey: '',
    activeRowEl: null,
    lastCellMouseDown: null,
    saldosTabulator: null,
    movimientosTabulator: null,
    movReqSeq: 0,
    saldosReqSeq: 0,
    ajusteSelected: new Set(),
    ajusteActividades: [],
  };

  function getHeaders(json) {
    if (typeof app.getHeaders === 'function') return app.getHeaders(!!json);
    let h = { Authorization: 'Bearer ' + app.globalState.token };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async function parseApiError(res, fallback) {
    let msg = fallback || 'Error inesperado';
    try {
      let p = await res.json();
      if (p && p.message) msg = p.message;
      if (p && p.error) msg = p.error;
      if (
        p &&
        Array.isArray(p.details) &&
        p.details.length &&
        p.details[0].message
      )
        msg = p.details[0].message;
    } catch (_e) {
      // noop
    }
    return msg;
  }

  let asText =
    typeof utils.esc === 'function'
      ? utils.esc
      : function (v) {
          return app.escapeHtml(v == null ? '' : String(v));
        };

  let normalizeHexColor =
    typeof utils.normalizeHexColor === 'function'
      ? utils.normalizeHexColor
      : function (color) {
          return typeof app.normalizeHexColor === 'function'
            ? app.normalizeHexColor(color, '')
            : '';
        };

  let contrastColor =
    typeof utils.getTextColorForHexBackground === 'function'
      ? utils.getTextColorForHexBackground
      : function (hex) {
          return typeof app._contrastColor === 'function'
            ? app._contrastColor(hex)
            : '#212529';
        };

  function showAlert(message, type) {
    let el = document.getElementById('ledgerAlert');
    if (!el) return;
    el.innerHTML =
      '<div class="alert alert-' +
      (type || 'danger') +
      ' alert-dismissible py-1 mb-1 fade show" role="alert">' +
      asText(message || 'Error inesperado') +
      '<button type="button" class="btn-close" data-bs-dismiss="alert"></button>' +
      '</div>';
    setTimeout(function () {
      if (el) el.innerHTML = '';
    }, 6000);
  }
  function applyRuntimeMarker() {
    let hint = document.getElementById('ledgerSaldosHint');
    if (!hint) return;
    if (hint.dataset.runtimeApplied === '1') return;
    hint.dataset.runtimeApplied = '1';
    let marker = document.createElement('span');
    marker.className = 'ms-1 badge bg-light text-dark border';
    hint.insertAdjacentElement('afterend', marker);
  }

  function fmtDays(v) {
    let n = Number(v || 0);
    return Number.isFinite(n) ? n.toFixed(0) : '0';
  }

  function fullName(row) {
    return [row && row.apellido_1, row && row.apellido_2, row && row.nombre]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  function agenteIdentity(row) {
    let tip =
      row && row.tip ? 'TIP ' + row.tip : 'Agente #' + (row && row.agente_id);
    let nombre = fullName(row);
    return nombre ? tip + ' · ' + nombre : tip;
  }

  function triggerBlobDownload(blob, filename) {
    let a = document.createElement('a');
    let href = URL.createObjectURL(blob);
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  async function readTextFile(file) {
    return new Promise(function (resolve, reject) {
      let reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ''));
      };
      reader.onerror = function () {
        reject(new Error('No se pudo leer el fichero CSV.'));
      };
      reader.readAsText(file);
    });
  }

  function splitCsvLine(line, delimiter) {
    let out = [];
    let value = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      let ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          value += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (ch === delimiter && !inQuotes) {
        out.push(value);
        value = '';
        continue;
      }
      value += ch;
    }
    out.push(value);
    return out;
  }

  function normalizeCsvHeaderName(raw) {
    return String(raw || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function normalizeImportDate(rawValue, lineNumber) {
    let raw = String(rawValue || '').trim();
    if (!raw) {
      throw new Error('Línea ' + lineNumber + ': fecha vacía');
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    let m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return m[3] + '-' + m[2] + '-' + m[1];
    let mShort = raw.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
    if (mShort) {
      let yy = Number(mShort[3]);
      let yyyy = 2000 + yy;
      return String(yyyy) + '-' + mShort[2] + '-' + mShort[1];
    }
    throw new Error(
      'Línea ' +
        lineNumber +
        ': fecha inválida. Usa YYYY-MM-DD, DD/MM/YYYY o DD/MM/YY'
    );
  }

  function parseImportDias(rawValue, lineNumber) {
    let normalized = String(rawValue || '')
      .trim()
      .replace(',', '.');
    let dias = Number(normalized);
    if (!Number.isFinite(dias) || dias === 0) {
      throw new Error('Línea ' + lineNumber + ': Días debe ser distinto de 0');
    }
    return Number(dias.toFixed(2));
  }

  function parseMovimientosImportCsv(text) {
    let raw = String(text || '');
    let normalizedText = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    let lines = normalizedText
      .split('\n')
      .filter(function (line) {
        return String(line || '').trim() !== '';
      });

    if (!lines.length) {
      throw new Error('El CSV está vacío.');
    }

    let delimiter =
      (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length
        ? ';'
        : ',';

    let headers = splitCsvLine(lines[0], delimiter).map(normalizeCsvHeaderName);
    let fechaIdx = headers.indexOf('fecha');
    let tipIdx = headers.indexOf('tip');
    let diasIdx = headers.indexOf('dias');
    let obsIdx = headers.indexOf('observaciones');
    if (obsIdx < 0) obsIdx = headers.indexOf('observacion');

    if (fechaIdx < 0 || tipIdx < 0 || diasIdx < 0) {
      throw new Error(
        'El CSV debe incluir las columnas obligatorias: Fecha, TIP, Dias.'
      );
    }

    let items = [];
    for (let i = 1; i < lines.length; i += 1) {
      let lineNumber = i + 1;
      let row = splitCsvLine(lines[i], delimiter);
      let tip = String(row[tipIdx] || '').trim().toUpperCase();
      let fecha = normalizeImportDate(row[fechaIdx], lineNumber);
      let dias = parseImportDias(row[diasIdx], lineNumber);
      let observaciones = obsIdx >= 0 ? String(row[obsIdx] || '').trim() : '';

      if (!tip) {
        throw new Error('Línea ' + lineNumber + ': TIP vacío');
      }

      items.push({
        line: lineNumber,
        fecha: fecha,
        tip: tip,
        dias: dias,
        observaciones: observaciones,
      });
    }

    if (!items.length) {
      throw new Error('El CSV no contiene filas de datos.');
    }

    return items;
  }

  async function importMovimientosCsv(file) {
    if (!file) return;

    let text = await readTextFile(file);
    let items = parseMovimientosImportCsv(text);
    let payload = {
      file_name: String(file.name || 'importacion.csv'),
      file_size: Number(file.size || 0),
      file_last_modified:
        typeof file.lastModified === 'number' ? file.lastModified : null,
      items: items,
    };

    let res = await fetch('/api/asignaciones-reglas/ledger-movimientos/import-csv', {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(
        await parseApiError(res, 'No se pudieron importar movimientos desde CSV')
      );
    }

    return res.json();
  }

  function getInputElement(id) {
    return /** @type {HTMLInputElement | null} */ (document.getElementById(id));
  }

  function getButtonElement(id) {
    return /** @type {HTMLButtonElement | null} */ (document.getElementById(id));
  }

  function getSelectElement(id) {
    return /** @type {HTMLSelectElement | null} */ (document.getElementById(id));
  }

  function currentAnio() {
    let el = getInputElement('ledgerAnioInput');
    return el ? Number(el.value) : null;
  }

  function setAjusteStatus(message, tone) {
    let el = document.getElementById('ledgerAjusteStatus');
    if (!el) return;
    if (!message) {
      el.className = 'small mt-2 d-none';
      el.textContent = '';
      return;
    }
    el.className =
      'small mt-2 ' +
      (tone === 'success'
        ? 'text-success'
        : tone === 'warning'
          ? 'text-warning-emphasis'
          : 'text-danger');
    el.textContent = message;
  }

  function setAjusteSelectionSummary() {
    let el = document.getElementById('ledgerAjusteSeleccionInfo');
    if (!el) return;
    let count = st.ajusteSelected.size;
    el.textContent = count
      ? 'Se aplicará sobre ' + String(count) + ' agente(s) seleccionados en la tabla principal.'
      : 'Selecciona uno o varios agentes en la tabla principal.';
  }

  function updateAjusteActividadPreview() {
    let preview = document.getElementById('ledgerAjusteActividadPreview');
    let sel = getSelectElement('ledgerAjusteActividad');
    if (!preview || !sel) return;

    let id = Number(sel.value || 0);
    if (!Number.isInteger(id) || id <= 0) {
      preview.innerHTML = '';
      return;
    }

    let act = (st.ajusteActividades || []).find(function (a) {
      return Number(a.id_actividad || a.id) === id;
    });
    if (!act) {
      preview.innerHTML = '';
      return;
    }

    let code = String(act.actividad || '').trim();
    let name = String(act.nombre || '').trim();
    let label = code ? code + ' - ' + name : name || 'Actividad #' + id;
    let bg = normalizeHexColor(act.color) || '#6c757d';
    let fg = contrastColor(bg);
    preview.innerHTML =
      '<span class="badge" style="background:' +
      asText(bg) +
      ';color:' +
      asText(fg) +
      '">' +
      asText(label) +
      '</span>';
  }

  async function ensureAjusteActividadesLoaded() {
    let sel = getSelectElement('ledgerAjusteActividad');
    if (!sel) return;

    if (!st.ajusteActividades.length) {
      let res = await fetch('/api/actividades', {
        headers: getHeaders(false),
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, 'No se pudieron cargar actividades'));
      }
      let payload = await res.json();
      let list = Array.isArray(payload)
        ? payload
        : Array.isArray(payload && payload.actividades)
          ? payload.actividades
          : Array.isArray(payload && payload.data)
            ? payload.data
            : Array.isArray(payload && payload.items)
              ? payload.items
              : [];
      st.ajusteActividades = list;
    }

    if (sel.dataset.loaded === '1' && st.ajusteActividades.length) {
      updateAjusteActividadPreview();
      return;
    }

    sel.innerHTML = '<option value="">Selecciona actividad...</option>';
    (st.ajusteActividades || []).forEach(function (act) {
      let id = Number(act && (act.id_actividad || act.id));
      if (!Number.isInteger(id) || id <= 0) return;
      let code = String((act && act.actividad) || '').trim();
      let name = String((act && act.nombre) || '').trim();
      let text = code ? code + ' - ' + name : name || 'Actividad #' + id;
      let opt = document.createElement('option');
      opt.value = String(id);
      opt.textContent = text;
      sel.appendChild(opt);
    });
    sel.dataset.loaded = '1';
    updateAjusteActividadPreview();
  }

  function syncAjusteButtons() {
    let btnAplicar = getButtonElement('ledgerAjusteAplicar');
    let btnCero = getButtonElement('ledgerAjustePonerCero');
    let disabled = !st.ajusteSelected.size;
    if (btnAplicar) btnAplicar.disabled = disabled;
    if (btnCero) btnCero.disabled = disabled;
  }

  function agenteId(ag) {
    let id = Number(ag && (ag.agente_id || ag.id_agente || ag.id));
    return Number.isInteger(id) && id > 0 ? id : 0;
  }

  function saldoKey(row) {
    if (!row) return '';
    return [
      String(row.agente_id || ''),
      String(row.anio || ''),
      String(row.mes || ''),
      String(row.empleo_id || ''),
    ].join('|');
  }

  function clearActiveSaldoVisual() {
    if (st.activeRowEl && st.activeRowEl.classList) {
      st.activeRowEl.classList.remove('ledger-row-active');
    }
    st.activeRowEl = null;
  }

  function setActiveSaldoFromRow(row) {
    if (!row || !row.getData) return;
    let data = row.getData() || {};
    let rowEl = row.getElement ? row.getElement() : null;

    clearActiveSaldoVisual();
    if (rowEl && rowEl.classList) rowEl.classList.add('ledger-row-active');

    st.activeRowEl = rowEl;
    st.activeSaldoKey = saldoKey(data);
    st.selectedSaldo = data;
    loadMovimientosForSaldo(data);
  }

  function isSelectionColumnCell(cell) {
    if (!cell || !cell.getColumn) return false;
    let colDef = cell.getColumn().getDefinition
      ? cell.getColumn().getDefinition()
      : null;
    return !!(
      colDef &&
      (colDef.formatter === 'rowSelection' ||
        colDef.titleFormatter === 'rowSelection')
    );
  }

  function syncSelectedAjusteFromTable() {
    if (!st.saldosTabulator) return;
    let rows = st.saldosTabulator.getSelectedRows
      ? st.saldosTabulator.getSelectedRows()
      : [];
    let ids = new Set();
    (rows || []).forEach(function (row) {
      let id = agenteId(row.getData() || {});
      if (id) ids.add(id);
    });
    st.ajusteSelected = ids;
    setAjusteSelectionSummary();
    syncAjusteButtons();
  }

  function restoreAjusteSelectionOnTable() {
    if (!st.saldosTabulator) return;
    let ids = Array.from(st.ajusteSelected || []);
    try {
      st.saldosTabulator.deselectRow();
      if (ids.length) st.saldosTabulator.selectRow(ids);
    } catch (_err) {
      // noop
    }
  }

  function clearAjusteTableStateOnModalClose() {
    st.ajusteSelected = new Set();
    st.lastCellMouseDown = null;

    if (st.saldosTabulator) {
      try {
        st.saldosTabulator.deselectRow();
      } catch (_err) {
        // noop
      }
      try {
        if (typeof st.saldosTabulator.clearFilter === 'function') {
          st.saldosTabulator.clearFilter(true);
        }
      } catch (_err) {
        // noop
      }
      try {
        if (typeof st.saldosTabulator.clearHeaderFilter === 'function') {
          st.saldosTabulator.clearHeaderFilter();
        }
      } catch (_err) {
        // noop
      }
    }

    clearMovimientos();
    setAjusteStatus('', null);
    setAjusteSelectionSummary();
    syncAjusteButtons();
  }

  async function openAjusteModal() {
    let modalEl = document.getElementById('ledgerAjusteModal');
    if (!modalEl) return;
    setAjusteStatus('', null);
    setAjusteSelectionSummary();
    syncAjusteButtons();
    if (!st.ajusteSelected.size) {
      throw new Error('Selecciona uno o varios agentes en la tabla principal.');
    }
    await ensureAjusteActividadesLoaded();
    let dateInput = getInputElement('ledgerAjusteFecha');
    if (dateInput && !dateInput.value) {
      let dt = window.luxon && window.luxon.DateTime ? window.luxon.DateTime : null;
      dateInput.value = dt
        ? dt.now().setZone('Europe/Madrid').toISODate()
        : new Date().toISOString().slice(0, 10);
    }
    if (window.bootstrap && window.bootstrap.Modal) {
      window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  }

  async function aplicarAjusteDesdeLedger(modo) {
    if (!st.ajusteSelected.size) {
      throw new Error('Debe seleccionar al menos un agente.');
    }
    let fecha = String((getInputElement('ledgerAjusteFecha') || { value: '' }).value || '').trim();
    if (!fecha) throw new Error('Debe indicar la fecha del ajuste.');

    let esCero = String(modo || '') === 'poner_cero';
    let tipo = 'devengo';
    let dias = 0;

    if (!esCero) {
      tipo = String((getInputElement('ledgerAjusteTipo') || { value: '' }).value || '').trim().toLowerCase();
      if (tipo !== 'devengo' && tipo !== 'descanso') {
        throw new Error('Tipo de ajuste inválido.');
      }

      dias = Number((getInputElement('ledgerAjusteDias') || { value: '0' }).value || 0);
      if (!Number.isFinite(dias) || dias <= 0) {
        throw new Error('Días debe ser mayor que 0.');
      }
    }

    let observaciones = String((getInputElement('ledgerAjusteObservaciones') || { value: '' }).value || '').trim();
    if (!observaciones) observaciones = 'Ajuste Manual. Ajuste a ' + (esCero ? 'poner a cero' : tipo + ' de ' + String(dias) + ' día(s)') + '.';

    let actividadIdRaw = Number((getSelectElement('ledgerAjusteActividad') || { value: '' }).value || 0);
    let actividadId = Number.isInteger(actividadIdRaw) && actividadIdRaw > 0
      ? actividadIdRaw
      : null;

    let payload = {
      agente_ids: Array.from(st.ajusteSelected),
      fecha: fecha,
      modo: esCero ? 'poner_cero' : 'ajuste',
      observaciones: observaciones,
      actividad_id: actividadId,
    };

    if (!esCero) {
      payload.tipo_movimiento = tipo;
      payload.cantidad_dias = dias;
    }

    let res = await fetch('/api/asignaciones-reglas/movimientos-ajustes/bulk', {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(await parseApiError(res, 'No se pudo aplicar el ajuste'));
    }
    let json = await res.json();
    setAjusteStatus(
      (json && json.message) ||
        ('Ajuste aplicado a ' + String((json && json.count) || 0) + ' agente(s).'),
      'success'
    );

    await loadSaldos();
    if (st.selectedSaldo) {
      await loadMovimientosForSaldo(st.selectedSaldo);
    }
  }

  function hasConsolidarPermission() {
    return typeof app.hasPermission === 'function'
      ? app.hasPermission('asignaciones:crear')
      : true;
  }

  function updateConsolidarButtonState(pendingCount) {
    let btn = getButtonElement('ledgerConsolidarPendientes');
    let pill = document.getElementById('ledgerPendientesPill');
    if (!btn) return;

    let count = Number(pendingCount || 0);
    let canConsolidar = hasConsolidarPermission();

    if (pill) {
      pill.textContent = String(count);
      pill.classList.toggle('d-none', count <= 0);
    }

    if (!canConsolidar) {
      btn.disabled = true;
      return;
    }

    btn.disabled = count <= 0;
    btn.title =
      count > 0
        ? 'Consolidar todos los borradores con devengos pendientes'
        : 'No hay borradores pendientes de consolidar';
  }

  async function refreshPendientesResumen() {
    let btn = document.getElementById('ledgerConsolidarPendientes');
    if (!btn) return;

    if (!hasConsolidarPermission()) {
      updateConsolidarButtonState(0);
      return;
    }

    try {
      let res = await fetch('/api/asignaciones/devengos/pendientes-resumen', {
        headers: getHeaders(false),
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      let payload = await res.json();
      updateConsolidarButtonState(payload.total_borradores_pendientes || 0);
    } catch (err) {
      updateConsolidarButtonState(0);
      console.error('[Ledger pendientes resumen]', err.message);
    }
  }

  // ── Panel 1: Acumulados (saldos de todos los agentes) ─────────────────────

  function showSaldosPanel(show) {
    let empty = document.getElementById('ledgerSaldosEmptyMsg');
    let panel = document.getElementById('ledgerSaldosPanel');
    if (empty) empty.style.display = show ? 'none' : '';
    if (panel) panel.style.display = show ? '' : 'none';
  }

  function ensureSaldosTabulator() {
    if (st.saldosTabulator) return st.saldosTabulator;

    let el = document.getElementById('ledgerSaldosTabulatorHost');
    let TabulatorCtor = window['Tabulator'];
    if (!el || typeof TabulatorCtor === 'undefined') return null;

    st.saldosTabulator = new TabulatorCtor(el, {
      index: 'agente_id',
      layout: 'fitColumns',
      height: 'calc(100vh - 250px)',
      placeholder: 'Sin saldos para este año.',
      selectableRows: true,
      movableColumns: false,
      data: [],

      columns: [
        {
          formatter: 'rowSelection',
          titleFormatter: 'rowSelection',
          headerSort: false,
          width: 40,
          frozen: true,
          hozAlign: 'center',
          headerHozAlign: 'center',
          editable: false,
          cellClick: function (e, cell) {
            if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
            cell.getRow().toggleSelect();
          },
        },
        {
          title: 'Escalafón',
          field: 'escalafon',
          visible: false,
        },
        {
          title: 'TIP',
          field: 'tip',
          width: 60,
          sorter: 'string',
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
          formatter: function (cell) {
            return asText(cell.getValue() || '');
          },
        },
        {
          title: 'Agente',
          field: 'apellido_1',
          minWidth: 150,
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
          headerFilterFunc: function (headerValue, _rowValue, rowData) {
            let h = String(headerValue || '')
              .toLowerCase()
              .trim();
            if (!h) return true;
            return fullName(rowData).toLowerCase().indexOf(h) >= 0;
          },
          formatter: function (cell) {
            let r = cell.getRow().getData();
            return asText(fullName(r) || 'Agente #' + r.agente_id);
          },
        },
        {
          title: 'Empleo',
          field: 'empleo_nombre',
          minWidth: 100,
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
          formatter: function (cell) {
            let row = cell.getRow().getData() || {};
            let label = asText(cell.getValue() || '-');
            let bg = normalizeHexColor(row.empleo_color);
            if (!bg) return label;
            let fg = contrastColor(bg);
            return (
              '<span class="badge" style="background:' +
              asText(bg) +
              ';color:' +
              asText(fg) +
              ';font-weight:500">' +
              label +
              '</span>'
            );
          },
        },
        {
          title: 'Inicial',
          field: 'saldo_inicial',
          width: 68,
          hozAlign: 'right',
          formatter: function (cell) {
            return fmtDays(cell.getValue());
          },
        },
        {
          title: 'Dev.',
          field: 'total_devengado',
          width: 62,
          hozAlign: 'right',
          formatter: function (cell) {
            return (
              '<span class="text-success">' +
              fmtDays(cell.getValue()) +
              '</span>'
            );
          },
        },
        {
          title: 'Dis.',
          field: 'total_disfrutado',
          width: 62,
          hozAlign: 'right',
          formatter: function (cell) {
            let v = Number(cell.getValue() || 0);
            return v > 0
              ? '<span class="text-danger">' + fmtDays(v) + '</span>'
              : fmtDays(v);
          },
        },
        {
          title: 'Final',
          field: 'saldo_final',
          width: 68,
          hozAlign: 'right',
          formatter: function (cell) {
            let val = Number(cell.getValue() || 0);
            let css =
              val < 0 ? 'text-danger fw-semibold' : 'text-success fw-semibold';
            return '<span class="' + css + '">' + fmtDays(val) + '</span>';
          },
        },
      ],
      initialSort: [
        { column: 'escalafon', dir: 'asc' },
      ],
    });

    st.saldosTabulator.on('cellMouseDown', function (_e, cell) {
      if (!cell || isSelectionColumnCell(cell)) {
        st.lastCellMouseDown = null;
        return;
      }
      let row = cell.getRow ? cell.getRow() : null;
      let data = row && row.getData ? row.getData() : null;
      st.lastCellMouseDown = {
        key: saldoKey(data),
        wasSelected: !!(row && row.isSelected && row.isSelected()),
      };
    });

    st.saldosTabulator.on('cellClick', function (e, cell) {
      if (!cell || isSelectionColumnCell(cell)) return;

      if (e && e.target && typeof e.target.closest === 'function') {
        if (e.target.closest('.tabulator-row-selection')) return;
      }

      let row = cell.getRow ? cell.getRow() : null;
      let data = row && row.getData ? row.getData() : null;

      let snapshot = st.lastCellMouseDown;
      if (row && row.isSelected && snapshot && snapshot.key === saldoKey(data)) {
        let isNow = !!row.isSelected();
        let shouldBe = !!snapshot.wasSelected;
        if (isNow !== shouldBe) {
          if (shouldBe) row.select();
          else row.deselect();
        }
      }

      setActiveSaldoFromRow(row);
      st.lastCellMouseDown = null;
    });

    st.saldosTabulator.on('rowSelectionChanged', function () {
      syncSelectedAjusteFromTable();
    });

    return st.saldosTabulator;
  }

  async function loadSaldos() {
    let hintEl = document.getElementById('ledgerSaldosHint');
    if (hintEl) hintEl.textContent = 'Cargando…';

    let anio = currentAnio();
    let seq = ++st.saldosReqSeq;

    let qs = new URLSearchParams();
    if (anio) qs.set('anio', String(anio));

    try {
      let res = await fetch(
        '/api/asignaciones-reglas/ledger-saldos-mensuales?' + qs.toString(),
        { headers: getHeaders(false), cache: 'no-store' }
      );
      if (seq !== st.saldosReqSeq) return;
      if (!res.ok)
        throw new Error(await parseApiError(res, 'Error al cargar saldos'));
      let json = await res.json();
      let rows = Array.isArray(json.saldos) ? json.saldos : [];
      if (hintEl)
        hintEl.textContent =
          rows.length + ' acumulados' + (anio ? ' · ' + anio : '');
      let tab = ensureSaldosTabulator();
      if (!tab) return;
      let selectionSnapshot = new Set(st.ajusteSelected);
      tab.setData(rows);
      // Restaurar desde snapshot: setData dispara rowSelectionChanged que vacía st.ajusteSelected
      st.ajusteSelected = selectionSnapshot;
      restoreAjusteSelectionOnTable();
      syncSelectedAjusteFromTable();

      if (rows.length > 0 && st.activeSaldoKey) {
        let activeRow = (tab.getRows ? tab.getRows() : []).find(function (r) {
          let data = r && r.getData ? r.getData() : null;
          return saldoKey(data) === st.activeSaldoKey;
        });
        if (activeRow) {
          let activeData = activeRow.getData ? activeRow.getData() || {} : {};
          let activeEl = activeRow.getElement ? activeRow.getElement() : null;
          clearActiveSaldoVisual();
          if (activeEl && activeEl.classList) activeEl.classList.add('ledger-row-active');
          st.activeRowEl = activeEl;
          st.selectedSaldo = activeData;
          await loadMovimientosForSaldo(activeData);
        } else {
          st.activeSaldoKey = '';
          clearActiveSaldoVisual();
          clearMovimientos();
        }
      }

      if (rows.length > 0) {
        showSaldosPanel(true);
        let emptyElOk = document.getElementById('ledgerSaldosEmptyMsg');
        if (emptyElOk) emptyElOk.style.display = 'none';
      } else {
        clearMovimientos();
        showSaldosPanel(false);
        let emptyEl = document.getElementById('ledgerSaldosEmptyMsg');
        if (emptyEl) emptyEl.style.display = '';
      }
    } catch (err) {
      if (seq !== st.saldosReqSeq) return;
      if (hintEl) hintEl.textContent = 'Error al cargar';
      console.error('[Ledger saldos]', err.message);
    }
  }

  // ── Panel 3: Movimientos ──────────────────────────────────────────────────

  function showMovimientosPanel(show) {
    let empty = document.getElementById('ledgerMovimientosEmptyMsg');
    let panel = document.getElementById('ledgerMovimientosPanel');
    if (empty) empty.style.display = show ? 'none' : '';
    if (panel) panel.style.display = show ? '' : 'none';
  }

  function clearMovimientos() {
    st.selectedSaldo = null;
    st.activeSaldoKey = '';
    clearActiveSaldoVisual();
    if (st.movimientosTabulator) {
      st.movimientosTabulator.destroy();
      st.movimientosTabulator = null;
    }
    showMovimientosPanel(false);
    let hint = document.getElementById('ledgerMovimientosHint');
    if (hint) hint.textContent = 'Selecciona una fila';
  }

  function ensureMovimientosTabulator(movimientos) {
    let el = document.getElementById('ledgerMovimientosTabulatorHost');
    let TabulatorCtor = window['Tabulator'];
    if (!el || typeof TabulatorCtor === 'undefined') return null;
    if (st.movimientosTabulator) {
      st.movimientosTabulator.destroy();
      st.movimientosTabulator = null;
    }
    st.movimientosTabulator = new TabulatorCtor(el, {
      data: movimientos,
      layout: 'fitColumns',
      height: 'calc(100vh - 250px)',
      placeholder: 'Sin movimientos para este periodo.',
      movableColumns: false,
      initialSort: [{ column: 'fecha', dir: 'desc' }],
      columns: [
        {
          title: 'Fecha',
          field: 'fecha',
          width: 90,
          sorter: 'string',
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
        },
        {
          title: 'Origen',
          field: 'origen',
          width: 80,
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
          formatter: function (cell) {
            let v = String(cell.getValue() || '');
            let badge =
              v === 'borrador'
                ? 'bg-secondary'
                : v === 'validado'
                  ? 'bg-success'
                  : 'bg-primary';
            return (
              '<span class="badge ' +
              badge +
              ' fw-normal" style="font-size:.68rem">' +
              asText(v) +
              '</span>'
            );
          },
        },
        {
          title: 'Borrador',
          field: 'borrador_nombre',
          width: 170,
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
          formatter: function (cell) {
            let raw = String(cell.getValue() || '-');
            let safe = asText(raw);
            return (
              '<span class="d-inline-block text-truncate" style="max-width:100%" title="' +
              safe +
              '">' +
              safe +
              '</span>'
            );
          },
        },
        {
          title: 'Tipo',
          field: 'tipo_movimiento',
          width: 80,
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
          formatter: function (cell) {
            let v = String(cell.getValue() || '');
            let cls = v === 'devengo' ? 'text-success' : 'text-danger';
            return '<span class="' + cls + '">' + asText(v) + '</span>';
          },
        },

        {
          title: 'Días',
          field: 'cantidad_dias',
          width: 68,
          hozAlign: 'right',
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
          formatter: function (cell) {
            let r = cell.getRow().getData();
            let n = Number(cell.getValue() || 0);
            let sign = Number(r.signo || 1);
            let cls = sign >= 0 ? 'text-success' : 'text-danger';
            return (
              '<span class="' +
              cls +
              '">' +
              (sign >= 0 ? '+' : '-') +
              fmtDays(n) +
              '</span>'
            );
          },
        },
        {
          title: 'Saldo',
          field: 'saldo_despues',
          width: 88,
          hozAlign: 'right',
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
          formatter: function (cell) {
            let val = Number(cell.getValue() || 0);
            let css = val < 0 ? 'text-danger fw-semibold' : '';
            return css
              ? '<span class="' + css + '">' + fmtDays(val) + '</span>'
              : fmtDays(val);
          },
        },
        {
          title: 'Actividad',
          field: 'actividad_nombre',
          sorter: 'string',
          minWidth: 130,
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
          formatter: function (cell) {
            let r = cell.getRow().getData();
            let code = r.actividad_codigo
              ? String(r.actividad_codigo) + ' - '
              : '';
            return asText(code + (r.actividad_nombre || '-'));
          },
        },
        {
          title: 'Observaciones',
          field: 'observaciones',
          minWidth: 190,
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
          formatter: function (cell) {
            let row = cell.getRow().getData() || {};
            let value = row.observaciones;

            if (!value && row.metadata) {
              let metadata = row.metadata;
              if (typeof metadata === 'string') {
                try {
                  metadata = JSON.parse(metadata);
                } catch (_err) {
                  metadata = null;
                }
              }
              if (metadata && typeof metadata === 'object') {
                value = metadata.observaciones;
              }
            }

            let raw = String(value || '-');
            let safe = asText(raw);
            return (
              '<span class="d-inline-block text-truncate" style="max-width:100%" title="' +
              safe +
              '">' +
              safe +
              '</span>'
            );
          },
        },
      ],
    });
    return st.movimientosTabulator;
  }

  async function loadMovimientosForSaldo(rowData) {
    let hintEl = document.getElementById('ledgerMovimientosHint');
    showMovimientosPanel(false);
    if (hintEl)
      hintEl.textContent = 'Cargando ' + agenteIdentity(rowData) + '…';

    let seq = ++st.movReqSeq;
    let qs = new URLSearchParams();
    qs.set('anio', String(rowData.anio || currentAnio()));
    if (rowData.mes) qs.set('mes', String(rowData.mes));
    qs.set('agente_id', String(rowData.agente_id));
    if (rowData.empleo_id) {
      qs.set('empleo_id', String(rowData.empleo_id));
    }

    try {
      let res = await fetch(
        '/api/asignaciones-reglas/ledger-movimientos?' + qs.toString(),
        { headers: getHeaders(false), cache: 'no-store' }
      );
      if (seq !== st.movReqSeq) return;
      if (!res.ok)
        throw new Error(
          await parseApiError(res, 'Error al cargar movimientos')
        );
      let json = await res.json();
      let movs = Array.isArray(json.movimientos) ? json.movimientos : [];
      if (hintEl)
        hintEl.textContent =
          asText(agenteIdentity(rowData)) + ' · ' + movs.length + ' mov.';
      let tab = ensureMovimientosTabulator(movs);
      if (tab) showMovimientosPanel(true);
    } catch (err) {
      if (seq !== st.movReqSeq) return;
      if (hintEl) hintEl.textContent = 'Error al cargar';
      console.error('[Ledger movimientos]', err.message);
    }
  }

  // ── Eventos ───────────────────────────────────────────────────────────────

  function bindEvents() {
    let prevBtn = getButtonElement('ledgerYearPrev');
    let nextBtn = getButtonElement('ledgerYearNext');
    let anioInput = getInputElement('ledgerAnioInput');

    if (prevBtn && !prevBtn.dataset.bound) {
      prevBtn.dataset.bound = '1';
      prevBtn.addEventListener('click', async function () {
        if (anioInput) anioInput.value = String(Number(anioInput.value) - 1);
        await loadSaldos();
      });
    }
    if (nextBtn && !nextBtn.dataset.bound) {
      nextBtn.dataset.bound = '1';
      nextBtn.addEventListener('click', async function () {
        if (anioInput) anioInput.value = String(Number(anioInput.value) + 1);
        await loadSaldos();
      });
    }
    if (anioInput && !anioInput.dataset.bound) {
      anioInput.dataset.bound = '1';
      anioInput.addEventListener('change', async function () {
        await loadSaldos();
      });
    }

    let btnRefresh = getButtonElement('ledgerRefresh');
    if (btnRefresh && !btnRefresh.dataset.bound) {
      btnRefresh.dataset.bound = '1';
      btnRefresh.addEventListener('click', async function () {
        await loadSaldos();
      });
    }

    let btnConsolidar = getButtonElement('ledgerConsolidarPendientes');
    if (btnConsolidar && !btnConsolidar.dataset.bound) {
      btnConsolidar.dataset.bound = '1';
      btnConsolidar.addEventListener('click', async function () {
        let hintEl = document.getElementById('ledgerSaldosHint');
        let prevHtml = btnConsolidar.innerHTML;
        btnConsolidar.disabled = true;
        btnConsolidar.innerHTML =
          '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
        if (hintEl) hintEl.textContent = 'Consolidando devengos pendientes...';
        try {
          let res = await fetch(
            '/api/asignaciones/devengos/consolidar-pendientes',
            {
              method: 'POST',
              headers: getHeaders(true),
              body: JSON.stringify({}),
            }
          );
          if (!res.ok) {
            throw new Error(
              await parseApiError(
                res,
                'Error al consolidar devengos pendientes'
              )
            );
          }
          let payload = await res.json();
          if (hintEl) {
            hintEl.textContent =
              (payload && payload.message) ||
              'Devengos pendientes consolidados correctamente';
          }
          await loadSaldos();
          await refreshPendientesResumen();
        } catch (err) {
          if (hintEl) hintEl.textContent = err.message || 'Error al consolidar';
          console.error('[Ledger consolidar pendientes]', err.message);
        } finally {
          btnConsolidar.innerHTML = prevHtml;
          await refreshPendientesResumen();
        }
      });
    }

    let btnExportSaldos = getButtonElement('ledgerExportSaldosExcel');
    if (btnExportSaldos && !btnExportSaldos.dataset.bound) {
      btnExportSaldos.dataset.bound = '1';
      btnExportSaldos.addEventListener('click', async function () {
        try {
          let anio = currentAnio();
          let qs = new URLSearchParams();
          if (anio) qs.set('anio', String(anio));
          let res = await fetch(
            '/api/asignaciones-reglas/ledger-saldos-mensuales/export?' +
              qs.toString(),
            { headers: getHeaders(false), cache: 'no-store' }
          );
          if (!res.ok)
            throw new Error(
              await parseApiError(res, 'Error al exportar acumulados')
            );
          let blob = await res.blob();
          triggerBlobDownload(blob, 'ledger-acumulados.xlsx');
        } catch (err) {
          console.error('[Ledger export acumulados]', err.message);
          showAlert(
            'No se pudo exportar acumulados: ' + (err.message || 'Error'),
            'danger'
          );
        }
      });
    }

    let btnExportMovs = getButtonElement('ledgerExportMovimientosExcel');
    if (btnExportMovs && !btnExportMovs.dataset.bound) {
      btnExportMovs.dataset.bound = '1';
      btnExportMovs.addEventListener('click', async function () {
        if (!st.selectedSaldo) return;
        try {
          let qs = new URLSearchParams();
          qs.set('anio', String(st.selectedSaldo.anio || currentAnio()));
          qs.set('agente_id', String(st.selectedSaldo.agente_id));
          if (st.selectedSaldo.mes) qs.set('mes', String(st.selectedSaldo.mes));
          if (st.selectedSaldo.empleo_id) {
            qs.set('empleo_id', String(st.selectedSaldo.empleo_id));
          }
          let res = await fetch(
            '/api/asignaciones-reglas/ledger-movimientos/export?' +
              qs.toString(),
            { headers: getHeaders(false), cache: 'no-store' }
          );
          if (!res.ok)
            throw new Error(
              await parseApiError(res, 'Error al exportar movimientos')
            );
          let blob = await res.blob();
          triggerBlobDownload(blob, 'ledger-movimientos.xlsx');
        } catch (err) {
          console.error('[Ledger export movimientos]', err.message);
          showAlert(
            'No se pudo exportar movimientos: ' + (err.message || 'Error'),
            'danger'
          );
        }
      });
    }

    let btnImportMovs = getButtonElement('ledgerImportMovimientosExcel');
    if (btnImportMovs && !btnImportMovs.dataset.bound) {
      btnImportMovs.dataset.bound = '1';
      btnImportMovs.addEventListener('click', function () {
        let picker = document.createElement('input');
        picker.type = 'file';
        picker.accept = '.csv,text/csv';
        picker.style.display = 'none';
        document.body.appendChild(picker);
        picker.addEventListener('change', async function () {
          let file = picker.files && picker.files[0] ? picker.files[0] : null;
          picker.remove();
          if (!file) return;

          let prevHtml = btnImportMovs.innerHTML;
          btnImportMovs.disabled = true;
          btnImportMovs.innerHTML =
            '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';

          try {
            let result = await importMovimientosCsv(file);
            showAlert(
              (result && result.message) || 'Importación CSV completada',
              'success'
            );
            await loadSaldos();
            if (st.selectedSaldo) {
              await loadMovimientosForSaldo(st.selectedSaldo);
            }
          } catch (err) {
            showAlert(
              err.message || 'No se pudieron importar movimientos desde CSV',
              'danger'
            );
          } finally {
            btnImportMovs.disabled = false;
            btnImportMovs.innerHTML = prevHtml;
          }
        });
        picker.click();
      });
    }

    let btnOpenAjuste = getButtonElement('ledgerOpenAjusteModal');
    if (btnOpenAjuste && !btnOpenAjuste.dataset.bound) {
      btnOpenAjuste.dataset.bound = '1';
      btnOpenAjuste.addEventListener('click', function () {
        openAjusteModal().catch(function (err) {
          showAlert(err.message || 'No se pudo abrir el ajuste', 'danger');
        });
      });
    }

    let btnAplicar = getButtonElement('ledgerAjusteAplicar');
    if (btnAplicar && !btnAplicar.dataset.bound) {
      btnAplicar.dataset.bound = '1';
      btnAplicar.addEventListener('click', async function () {
        let prevHtml = btnAplicar.innerHTML;
        btnAplicar.disabled = true;
        btnAplicar.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
        try {
          await aplicarAjusteDesdeLedger();
        } catch (err) {
          setAjusteStatus(err.message || 'No se pudo aplicar el ajuste', 'error');
        } finally {
          btnAplicar.innerHTML = prevHtml;
          syncAjusteButtons();
        }
      });
    }

    let btnCero = getButtonElement('ledgerAjustePonerCero');
    if (btnCero && !btnCero.dataset.bound) {
      btnCero.dataset.bound = '1';
      btnCero.addEventListener('click', async function () {
        let prevHtml = btnCero.innerHTML;
        btnCero.disabled = true;
        btnCero.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
        try {
          await aplicarAjusteDesdeLedger('poner_cero');
        } catch (err) {
          setAjusteStatus(err.message || 'No se pudo poner a cero el saldo', 'error');
        } finally {
          btnCero.innerHTML = prevHtml;
          syncAjusteButtons();
        }
      });
    }

    let actividadSelect = getSelectElement('ledgerAjusteActividad');
    if (actividadSelect && !actividadSelect.dataset.bound) {
      actividadSelect.dataset.bound = '1';
      actividadSelect.addEventListener('change', function () {
        updateAjusteActividadPreview();
      });
    }

    let ajusteModalEl = document.getElementById('ledgerAjusteModal');
    if (ajusteModalEl && !ajusteModalEl.dataset.boundClose) {
      ajusteModalEl.dataset.boundClose = '1';
      ajusteModalEl.addEventListener('hidden.bs.modal', function () {
        clearAjusteTableStateOnModalClose();
      });
    }
  }

  function initDefaultAnio() {
    let dt =
      window.luxon && window.luxon.DateTime ? window.luxon.DateTime : null;
    let now = dt ? dt.now().setZone('Europe/Madrid') : null;
    let anioInput = getInputElement('ledgerAnioInput');
    if (anioInput && !anioInput.value)
      anioInput.value = String(now ? now.year : new Date().getFullYear());
  }

  // ── Entry point ───────────────────────────────────────────────────────────

  app.initializeLedger = async function initializeLedger() {
    initDefaultAnio();
    bindEvents();
    ensureSaldosTabulator();
    applyRuntimeMarker();
    setAjusteSelectionSummary();
    syncAjusteButtons();
    await refreshPendientesResumen();
    await loadSaldos();
  };
})();
