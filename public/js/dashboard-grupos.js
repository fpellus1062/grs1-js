/* ========================================================================
 *  dashboard-grupos.js
 *  CRUD standalone: Grupos de Servicio
 *  Sección propia en el menú lateral.
 * ======================================================================== */
(function () {
  let app = window.GRS1Dashboard;
  let utils = window['GRS1Utils'] || {};

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function normalizeHexColor(value, fallback) {
    let normalized =
      typeof utils.normalizeHexColor === 'function'
        ? utils.normalizeHexColor(value)
        : '';
    return normalized || fallback || '#6c757d';
  }

  function textColorFromBackground(bg) {
    let normalized = normalizeHexColor(bg, '');
    if (!normalized) return '#212529';
    return typeof utils.getTextColorForHexBackground === 'function'
      ? utils.getTextColorForHexBackground(normalized, 0.6)
      : '#212529';
  }

  function colorBadgeFormatter(cell) {
    let color = String(cell.getValue() || '').trim();
    let display = color || '-';
    let swatch = color || '#adb5bd';
    return (
      '<span style="display:inline-flex;align-items:center;gap:6px;font-size:.75rem;line-height:1.2;">' +
      '<span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:' +
      app.escapeHtml(swatch) +
      ';border:1px solid rgba(0,0,0,.2);"></span>' +
      '<span style="font-weight:600;">' +
      app.escapeHtml(display) +
      '</span></span>'
    );
  }

  function colorizedLabelFormatter(cell) {
    let row = cell.getRow().getData() || {};
    let label = String(cell.getValue() || '').trim();
    let bg = String(row.color || '').trim();
    if (!bg) return app.escapeHtml(label || '-');
    let tc = textColorFromBackground(bg);
    return (
      '<span class="badge" style="background:' +
      app.escapeHtml(bg) +
      ';color:' +
      app.escapeHtml(tc) +
      ';font-weight:600;font-size:.75rem;padding:.3em .55em;">' +
      app.escapeHtml(label || '-') +
      '</span>'
    );
  }

  function colorPickerEditor(cell, onRendered, success, cancel) {
    let input = document.createElement('input');
    input.type = 'color';
    input.className = 'form-control form-control-color';
    input.style.cssText =
      'width:100%;height:30px;padding:0;border:none;background:transparent;';
    input.value = normalizeHexColor(cell.getValue(), '#6c757d');
    onRendered(function () {
      input.focus();
      input.click();
    });
    input.addEventListener('input', function () {
      success(normalizeHexColor(input.value, '#6c757d'));
    });
    input.addEventListener('blur', function () {
      cancel();
    });
    return input;
  }

  // ─── State ────────────────────────────────────────────────────────────────

  let state = { rows: [], original: [], pending: new Map(), tabulator: null };

  function headers() {
    let h = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + app.globalState.token,
    };
    if (app.globalState.activeArsId)
      h['X-Ars-Id'] = app.globalState.activeArsId;
    return h;
  }

  function showAlert(msg, type) {
    let el = document.getElementById('alertContainerGrupo');
    if (!el) return;
    el.innerHTML =
      '<div class="alert alert-' +
      type +
      ' alert-dismissible py-1 mb-1 fade show" role="alert">' +
      app.escapeHtml(msg) +
      '<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>';
    setTimeout(function () {
      el.innerHTML = '';
    }, 5000);
  }

  function updateBar() {
    let count = state.pending.size;
    let bar = document.getElementById('saveChangesGrupo');
    let cntEl = document.getElementById('pendingCountGrupo');
    let saveBtn = document.getElementById('btnSaveGrupo');
    let discardBtn = document.getElementById('btnDiscardGrupo');
    if (cntEl) cntEl.textContent = count;
    if (bar) {
      bar.classList.toggle('pending-changes-active', count > 0);
      bar.classList.toggle('pending-changes-idle', count === 0);
    }
    if (saveBtn) saveBtn.disabled = count === 0;
    if (discardBtn) discardBtn.disabled = count === 0;
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async function load() {
    try {
      let res = await fetch('/api/config/grupos', { headers: headers() });
      if (!res.ok) throw new Error('Error al cargar grupos');
      let json = await res.json();
      state.rows = json.data || [];
      state.original = app.cloneRecords(state.rows);
      state.pending.clear();
      if (state.tabulator) state.tabulator.setData(state.rows);
      updateBar();
    } catch (e) {
      showAlert(e.message, 'danger');
    }
  }

  function initTabulator() {
    let LANGS = {
      'es-es': {
        data: { loading: 'Cargando...', error: 'Error' },
        pagination: {
          page_size: 'Por página',
          first: '«',
          last: '»',
          prev: '‹',
          next: '›',
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

    let deleteBtnCol = {
      title: '',
      width: 60,
      headerSort: false,
      editable: false,
      formatter: function () {
        return '<button class="btn btn-sm btn-outline-danger" type="button" title="Eliminar"><i class="bi bi-trash"></i></button>';
      },
      cellClick: function (e, cell) {
        if (e.target.closest('button'))
          confirmDelete(cell.getRow().getData().id_grupo);
      },
    };

    state.tabulator = new Tabulator('#tabulatorGrupos', {
      locale: 'es-es',
      langs: LANGS,
      layout: 'fitDataFill',
      height: 'calc(100vh - 290px)',
      pagination: true,
      paginationSize: 25,
      paginationSizeSelector: [10, 25, 50, 100, true],
      columnDefaults: { resizable: true },
      columns: [
        {
          title: 'ID',
          field: 'id_grupo',
          editable: false,
          width: 60,
          sorter: 'number',
        },
        {
          title: 'Nombre',
          field: 'nombre',
          editor: 'input',
          headerFilter: 'input',
          formatter: colorizedLabelFormatter,
        },
        {
          title: 'Color',
          field: 'color',
          editor: colorPickerEditor,
          width: 120,
          formatter: colorBadgeFormatter,
        },
        deleteBtnCol,
      ],
    });

    state.tabulator.on('cellEdited', function (cell) {
      let rowData = cell.getRow().getData();
      let pk = rowData.id_grupo;
      let field = cell.getField();
      let newVal = cell.getValue();
      let oldVal = cell.getOldValue();
      let orig = state.original.find(function (r) {
        return String(r.id_grupo) === String(pk);
      });
      if (!orig || String(oldVal ?? '') === String(newVal ?? '')) {
        updateBar();
        return;
      }
      if (!state.pending.has(pk))
        state.pending.set(pk, Object.assign({}, orig));
      state.pending.get(pk)[field] = newVal;
      if (cell.getField() === 'color') cell.getRow().reformat();
      updateBar();
    });
  }

  async function saveAll() {
    let promises = [];
    for (let entry of state.pending) {
      let pk = entry[0];
      let changes = entry[1];
      promises.push(
        fetch('/api/config/grupos/' + encodeURIComponent(pk), {
          method: 'PUT',
          headers: headers(),
          body: JSON.stringify(changes),
        })
      );
    }
    try {
      let results = await Promise.all(promises);
      let failed = results.filter(function (r) {
        return !r.ok;
      }).length;
      if (failed === 0) {
        showAlert('Cambios guardados', 'success');
        await load();
      } else {
        showAlert(failed + ' cambio(s) fallaron', 'warning');
      }
    } catch (e) {
      showAlert(e.message, 'danger');
    }
  }

  function discard() {
    state.pending.clear();
    state.rows = app.cloneRecords(state.original);
    if (state.tabulator) state.tabulator.setData(state.rows);
    updateBar();
    showAlert('Cambios descartados', 'info');
  }

  function confirmDelete(pk) {
    let modalEl = document.getElementById('modalConfirmDeleteGrupo');
    if (!modalEl) return;
    let modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    let confirmBtn = document.getElementById('btnConfirmDeleteGrupo');

    let handler = async function () {
      confirmBtn.removeEventListener('click', handler);
      modal.hide();
      try {
        let res = await fetch('/api/config/grupos/' + encodeURIComponent(pk), {
          method: 'DELETE',
          headers: headers(),
        });
        if (!res.ok) {
          let err = await res.json();
          throw new Error(err.message || 'Error al eliminar');
        }
        showAlert('Grupo eliminado', 'success');
        await load();
      } catch (e) {
        showAlert(e.message, 'danger');
      }
    };
    modalEl.addEventListener('hide.bs.modal', function cleanup() {
      confirmBtn.removeEventListener('click', handler);
      modalEl.removeEventListener('hide.bs.modal', cleanup);
    });
    confirmBtn.addEventListener('click', handler);
    modal.show();
  }

  async function createRecord() {
    let form = document.getElementById('formNuevoGrupo');
    if (!form || !form.checkValidity()) {
      if (form) form.classList.add('was-validated');
      return;
    }
    let data = {
      nombre: document.getElementById('nuevoGrupoNombre')?.value.trim(),
      color: normalizeHexColor(
        document.getElementById('nuevoGrupoColorHex')?.value ||
          document.getElementById('nuevoGrupoColor')?.value,
        '#6c757d'
      ),
    };
    try {
      let res = await fetch('/api/config/grupos', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        let err = await res.json().catch(function () {
          return {};
        });
        throw new Error(err.message || err.error || 'Error al crear');
      }
      let modalEl = document.getElementById('modalNuevoGrupo');
      if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
      resetForm();
      showAlert('Grupo creado', 'success');
      await load();
    } catch (e) {
      showAlert(e.message, 'danger');
    }
  }

  function resetForm() {
    let f = document.getElementById('formNuevoGrupo');
    if (f) {
      f.reset();
      f.classList.remove('was-validated');
    }
  }

  // ─── Export ───────────────────────────────────────────────────────────────

  function exportExcel() {
    if (!state.tabulator) return;
    let ts = new Date()
      .toISOString()
      .slice(0, 19)
      .replace('T', '_')
      .replace(/:/g, '-');
    state.tabulator.download('xlsx', 'grupos_servicio_' + ts + '.xlsx', {
      sheetName: 'Grupos de Servicio',
    });
  }

  function exportPdf() {
    if (!state.tabulator || typeof window.jspdf === 'undefined') return;
    let usuario = app.globalState.userName || '';
    let fecha = new Date().toLocaleString('es-ES');
    let ts = new Date()
      .toISOString()
      .slice(0, 19)
      .replace('T', '_')
      .replace(/:/g, '-');
    let title = 'Grupos de Servicio';
    let cols = state.tabulator.getColumns().filter(function (c) {
      return c.getDefinition().title && c.getDefinition().field;
    });
    let head = [
      cols.map(function (c) {
        return c.getDefinition().title;
      }),
    ];
    let body = state.tabulator.getData('active').map(function (row) {
      return cols.map(function (c) {
        return row[c.getDefinition().field] ?? '';
      });
    });
    let jsPDF = window.jspdf.jsPDF;
    let doc = new jsPDF({ orientation: 'landscape' });
    doc.autoTable({
      head: head,
      body: body,
      startY: 18,
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [52, 58, 64], fontSize: 7 },
      margin: { top: 18, bottom: 14 },
      didDrawPage: function () {
        let pw = doc.internal.pageSize.getWidth();
        let ph = doc.internal.pageSize.getHeight();
        let p = doc.internal.getCurrentPageInfo().pageNumber;
        let t = doc.internal.getNumberOfPages();
        doc.setFontSize(11);
        doc.setTextColor(0);
        doc.text(title, 14, 12);
        doc.setFontSize(7);
        doc.setTextColor(120);
        doc.text('Usuario: ' + usuario + '   Fecha: ' + fecha, 14, ph - 5);
        doc.text('Página ' + p + ' de ' + t, pw - 14, ph - 5, {
          align: 'right',
        });
      },
    });
    doc.save('grupos_servicio_' + ts + '.pdf');
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  function setupEvents() {
    let newBtn = document.getElementById('btnNuevoGrupo');
    if (newBtn)
      newBtn.addEventListener('click', function () {
        resetForm();
        let modalEl = document.getElementById('modalNuevoGrupo');
        let modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modalEl.addEventListener(
          'hide.bs.modal',
          function () {
            if (document.activeElement) document.activeElement.blur();
          },
          { once: true }
        );
        modal.show();
      });

    let saveModalBtn = document.getElementById('btnGuardarNuevoGrupo');
    if (saveModalBtn) saveModalBtn.addEventListener('click', createRecord);

    let form = document.getElementById('formNuevoGrupo');
    if (form)
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        createRecord();
      });

    document.getElementById('btnSaveGrupo')?.addEventListener('click', saveAll);
    document
      .getElementById('btnDiscardGrupo')
      ?.addEventListener('click', discard);
    document
      .getElementById('btnExportExcelGrupo')
      ?.addEventListener('click', exportExcel);
    document
      .getElementById('btnExportPdfGrupo')
      ?.addEventListener('click', exportPdf);
  }

  // ─── Public initializer ──────────────────────────────────────────────────

  app.initializeGrupos = async function initializeGrupos() {
    initTabulator();
    await load();
    setupEvents();
    // Wire notion color picker
    let gPicker = document.getElementById('nuevoGrupoColor');
    let gHex = document.getElementById('nuevoGrupoColorHex');
    if (gPicker && gHex) {
      gPicker.addEventListener('input', function () {
        gHex.value = gPicker.value;
      });
      gHex.addEventListener('input', function () {
        if (/^#[0-9a-fA-F]{6}$/.test(gHex.value)) gPicker.value = gHex.value;
      });
      if (!gHex.value || gHex.value === '#6c757d') gHex.value = gPicker.value;
    }
  };
})();
