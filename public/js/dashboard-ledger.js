(function () {
  let app = window.GRS1Dashboard;
  if (!app) return;

  // ── State ────────────────────────────────────────────────────────────────
  let st = {
    selectedSaldo: null, // fila activa en acumulados (carga movimientos)
    saldosTabulator: null,
    movimientosTabulator: null,
    movReqSeq: 0,
    saldosReqSeq: 0,
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

  function asText(v) {
    return app.escapeHtml(v == null ? '' : String(v));
  }

  function normalizeHexColor(color) {
    let c = String(color || '').trim();
    if (!c) return null;
    if (/^#[0-9a-fA-F]{3}$/.test(c) || /^#[0-9a-fA-F]{6}$/.test(c)) return c;
    if (/^[0-9a-fA-F]{6}$/.test(c)) return '#' + c;
    return null;
  }

  function contrastColor(hex) {
    if (typeof app._contrastColor === 'function')
      return app._contrastColor(hex);
    let h = String(hex || '').replace('#', '');
    if (h.length === 3) {
      h = h
        .split('')
        .map(function (x) {
          return x + x;
        })
        .join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return '#212529';
    let r = parseInt(h.slice(0, 2), 16);
    let g = parseInt(h.slice(2, 4), 16);
    let b = parseInt(h.slice(4, 6), 16);
    let yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 140 ? '#212529' : '#ffffff';
  }

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

  function fmtDays(v) {
    let n = Number(v || 0);
    return Number.isFinite(n) ? n.toFixed(2) : '0.00';
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

  function currentAnio() {
    let el = document.getElementById('ledgerAnioInput');
    return el ? Number(el.value) : null;
  }

  function hasConsolidarPermission() {
    return typeof app.hasPermission === 'function'
      ? app.hasPermission('asignaciones:crear')
      : true;
  }

  function updateConsolidarButtonState(pendingCount) {
    let btn = document.getElementById('ledgerConsolidarPendientes');
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
    if (!el || typeof Tabulator === 'undefined') return null;

    st.saldosTabulator = new Tabulator(el, {
      index: 'id',
      layout: 'fitColumns',
      height: 'calc(100vh - 250px)',
      placeholder: 'Sin saldos para este año.',
      selectableRows: 1,
      movableColumns: false,
      data: [],
      rowClick: function (_e, row) {
        row.select();
      },

      columns: [
        {
          title: 'Escalafón',
          field: 'escalafon',
          visible: false,
        },
        {
          title: 'TIP',
          field: 'tip',
          width: 60,
          sorter: 'alphanumeric',
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
    st.saldosTabulator.on('rowSelectionChanged', function (data) {
      if (!Array.isArray(data) || !data.length) {
        clearMovimientos();
        return;
      }
      selectSaldo(data[0]);
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
      tab.setData(rows);
      if (rows.length > 0) {
        showSaldosPanel(true);
        let emptyElOk = document.getElementById('ledgerSaldosEmptyMsg');
        if (emptyElOk) emptyElOk.style.display = 'none';
        let activeRows = tab.getRows('active') || [];
        if (activeRows.length) activeRows[0].select();
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

  function selectSaldo(rowData) {
    st.selectedSaldo = rowData;
    loadMovimientosForSaldo(rowData);
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
    if (!el || typeof Tabulator === 'undefined') return null;
    if (st.movimientosTabulator) {
      st.movimientosTabulator.destroy();
      st.movimientosTabulator = null;
    }
    st.movimientosTabulator = new Tabulator(el, {
      data: movimientos,
      layout: 'fitColumns',
      height: 'calc(100vh - 250px)',
      placeholder: 'Sin movimientos para este mes.',
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
          minWidth: 170,
          maxWidth: 170,
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
          title: 'S. antes',
          field: 'saldo_antes',
          width: 82,
          hozAlign: 'right',
          headerFilter: 'input',
          headerFilterPlaceholder: 'Filtrar...',
          formatter: function (cell) {
            return fmtDays(cell.getValue());
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
          title: 'S. después',
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
    let prevBtn = document.getElementById('ledgerYearPrev');
    let nextBtn = document.getElementById('ledgerYearNext');
    let anioInput = document.getElementById('ledgerAnioInput');

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

    let btnRefresh = document.getElementById('ledgerRefresh');
    if (btnRefresh && !btnRefresh.dataset.bound) {
      btnRefresh.dataset.bound = '1';
      btnRefresh.addEventListener('click', async function () {
        await loadSaldos();
      });
    }

    let btnConsolidar = document.getElementById('ledgerConsolidarPendientes');
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

    let btnExportSaldos = document.getElementById('ledgerExportSaldosExcel');
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

    let btnExportMovs = document.getElementById('ledgerExportMovimientosExcel');
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
  }

  function initDefaultAnio() {
    let dt =
      window.luxon && window.luxon.DateTime ? window.luxon.DateTime : null;
    let now = dt ? dt.now().setZone('Europe/Madrid') : null;
    let anioInput = document.getElementById('ledgerAnioInput');
    if (anioInput && !anioInput.value)
      anioInput.value = String(now ? now.year : new Date().getFullYear());
  }

  // ── Entry point ───────────────────────────────────────────────────────────

  app.initializeLedger = async function initializeLedger() {
    initDefaultAnio();
    bindEvents();
    ensureSaldosTabulator();
    await refreshPendientesResumen();
    await loadSaldos();
  };
})();
