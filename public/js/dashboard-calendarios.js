/* ========================================================================
 *  dashboard-calendarios.js
 *  CRUD cabecera-líneas: Calendarios ↔ Festivos
 *  Integrado en la sección Configuración.
 * ======================================================================== */
(function () {
  let app = window.GRS1Dashboard;

  let AMBITO_BADGES = {
    NACIONAL: 'bg-primary',
    AUTONOMICO: 'bg-info text-dark',
    PROVINCIAL: 'bg-success bg-opacity-50 text-dark',
    LOCAL: 'bg-warning text-dark',
    PERSONALIZADO: 'bg-secondary',
  };

  let state = {
    calendarios: [],
    selectedCalId: null,
    festivos: [],
    originalFestivos: [],
    pendingFestivos: new Map(),
    tabulator: null,
    arsList: [],
  };

  function headers() {
    let h = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + app.globalState.token,
    };
    if (app.globalState.activeArsId)
      h['X-Ars-Id'] = app.globalState.activeArsId;
    return h;
  }

  function showCalAlert(msg, type) {
    let el = document.getElementById('alertContainerCalendario');
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

  function showFestAlert(msg, type) {
    let el = document.getElementById('alertContainerFestivo');
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

  // ─── ARS list helper ────────────────────────────────────────────────

  async function loadArsList() {
    try {
      let res = await fetch('/api/config/ars', { headers: headers() });
      if (!res.ok) return;
      let json = await res.json();
      state.arsList = json.data || [];
    } catch (_) {
      /* ignore */
    }
  }

  function populateArsSelect(selectedValue) {
    let menu = document.getElementById('menuCalArs');
    let btn = document.getElementById('btnDropdownCalArs');
    let input = document.getElementById('calArsUnidad');
    if (!menu || !btn || !input) return;

    // Reset
    input.value = selectedValue || '';

    menu.innerHTML =
      '<li><a class="dropdown-item" href="#" data-value="">— Sin asignar —</a></li>' +
      state.arsList
        .map(function (a) {
          let val = a.id_unidad;
          let color = a.color || '#6c757d';
          let badge =
            '<span class="badge me-1" style="background:' +
            app.escapeHtml(color) +
            '">' +
            app.escapeHtml(val) +
            '</span>';
          return (
            '<li><a class="dropdown-item d-flex align-items-center" href="#"' +
            ' data-value="' +
            app.escapeHtml(val) +
            '"' +
            ' data-color="' +
            app.escapeHtml(color) +
            '">' +
            badge +
            '</a></li>'
          );
        })
        .join('');

    // Set button text for selected value
    if (selectedValue) {
      let found = state.arsList.find(function (a) {
        return String(a.id_unidad) === String(selectedValue);
      });
      if (found) {
        let c = found.color || '#6c757d';
        btn.innerHTML =
          '<span class="badge me-1" style="background:' +
          app.escapeHtml(c) +
          '">' +
          app.escapeHtml(found.id_unidad) +
          '</span>';
      } else {
        btn.innerHTML = '<span class="text-muted">— Sin asignar —</span>';
      }
    } else {
      btn.innerHTML = '<span class="text-muted">— Sin asignar —</span>';
    }

    // Click handlers
    menu.querySelectorAll('.dropdown-item').forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.preventDefault();
        let val = this.getAttribute('data-value');
        input.value = val;
        if (!val) {
          btn.innerHTML = '<span class="text-muted">— Sin asignar —</span>';
        } else {
          let color = this.getAttribute('data-color') || '#6c757d';
          btn.innerHTML =
            '<span class="badge me-1" style="background:' +
            app.escapeHtml(color) +
            '">' +
            app.escapeHtml(val) +
            '</span>';
        }
      });
    });
  }

  // ─── Calendarios list ───────────────────────────────────────────────────

  function renderCalendariosList() {
    let container = document.getElementById('calendariosListContainer');
    if (!container) return;

    if (!state.calendarios.length) {
      container.innerHTML =
        '<div class="text-center text-muted py-4">No hay calendarios. Cree uno nuevo.</div>';
      return;
    }

    container.innerHTML = state.calendarios
      .map(function (cal) {
        let isActive = Number(cal.id) === Number(state.selectedCalId);
        let active = isActive ? ' active' : '';
        let activeStyle = isActive
          ? ' style="background-color:#f1f3f5;border-color:#dee2e6;color:#212529"'
          : '';
        let badgeClass = AMBITO_BADGES[cal.ambito] || 'bg-secondary';
        let activoBadge = cal.activo
          ? '<span class="badge bg-success ms-1" style="font-size:.65rem">Activo</span>'
          : '<span class="badge bg-danger ms-1" style="font-size:.65rem">Inactivo</span>';
        return (
          '<a href="#" class="list-group-item list-group-item-action d-flex justify-content-between align-items-start' +
          active +
          '"' +
          activeStyle +
          ' data-cal-id="' +
          cal.id +
          '">' +
          '<div class="ms-2 me-auto">' +
          '<div class="fw-bold">' +
          app.escapeHtml(cal.nombre) +
          activoBadge +
          '</div>' +
          (cal.ars_nombre
            ? '<span class="badge me-1" style="background:' +
              app.escapeHtml(cal.ars_color || '#6c757d') +
              ';font-size:.65rem">' +
              app.escapeHtml(cal.ars_nombre) +
              '</span>'
            : '') +
          '<small class="text-muted">' +
          app.escapeHtml(cal.descripcion || '') +
          '</small>' +
          '</div>' +
          '<div class="d-flex flex-column align-items-end gap-1">' +
          '<span class="badge ' +
          badgeClass +
          '">' +
          app.escapeHtml(cal.ambito) +
          '</span>' +
          '<div class="btn-group btn-group-sm">' +
          '<button class="btn btn-outline-primary btn-sm cal-edit-btn" data-cal-id="' +
          cal.id +
          '" title="Editar"><i class="bi bi-pencil"></i></button>' +
          '<button class="btn btn-outline-danger btn-sm cal-delete-btn" data-cal-id="' +
          cal.id +
          '" title="Eliminar"><i class="bi bi-trash"></i></button>' +
          '</div>' +
          '</div>' +
          '</a>'
        );
      })
      .join('');

    // Click handlers
    container.querySelectorAll('[data-cal-id]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        let calId = Number(el.dataset.calId);

        // Edit button
        if (e.target.closest('.cal-edit-btn')) {
          e.preventDefault();
          e.stopPropagation();
          openCalendarioModal(calId);
          return;
        }
        // Delete button
        if (e.target.closest('.cal-delete-btn')) {
          e.preventDefault();
          e.stopPropagation();
          deleteCalendario(calId);
          return;
        }

        e.preventDefault();
        selectCalendario(calId);
      });
    });
  }

  async function loadCalendarios() {
    try {
      let res = await fetch('/api/calendarios', { headers: headers() });
      if (!res.ok) throw new Error('Error al cargar calendarios');
      let json = await res.json();
      state.calendarios = json.data || [];
      renderCalendariosList();
    } catch (e) {
      showCalAlert(e.message, 'danger');
    }
  }

  function openCalendarioModal(editId) {
    let form = document.getElementById('formCalendario');
    let editIdEl = document.getElementById('calEditId');
    let nombreEl = document.getElementById('calNombre');
    let ambitoEl = document.getElementById('calAmbito');
    let descEl = document.getElementById('calDescripcion');
    let activoEl = document.getElementById('calActivo');
    let titleEl = document.getElementById('modalCalendarioLabel');

    if (form) {
      form.reset();
      form.classList.remove('was-validated');
    }
    populateArsSelect(null);

    if (editId) {
      let cal = state.calendarios.find(function (c) {
        return Number(c.id) === Number(editId);
      });
      if (cal) {
        if (editIdEl) editIdEl.value = cal.id;
        if (nombreEl) nombreEl.value = cal.nombre;
        if (ambitoEl) ambitoEl.value = cal.ambito;
        if (descEl) descEl.value = cal.descripcion || '';
        if (activoEl) activoEl.checked = cal.activo;
        populateArsSelect(cal.ars_unidad_id);
        if (titleEl) titleEl.textContent = 'Editar Calendario';
      }
    } else {
      if (editIdEl) editIdEl.value = '';
      if (activoEl) activoEl.checked = true;
      if (titleEl) titleEl.textContent = 'Nuevo Calendario';
    }

    let modalEl = document.getElementById('modalCalendario');
    if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  async function saveCalendario() {
    let form = document.getElementById('formCalendario');
    if (!form || !form.checkValidity()) {
      if (form) form.classList.add('was-validated');
      return;
    }

    let editId = document.getElementById('calEditId')?.value;
    let data = {
      nombre: document.getElementById('calNombre').value.trim(),
      ambito: document.getElementById('calAmbito').value,
      descripcion:
        document.getElementById('calDescripcion').value.trim() || null,
      activo: document.getElementById('calActivo').checked,
      ars_unidad_id: document.getElementById('calArsUnidad')?.value || null,
    };

    try {
      let url = editId ? '/api/calendarios/' + editId : '/api/calendarios';
      let method = editId ? 'PUT' : 'POST';
      let res = await fetch(url, {
        method: method,
        headers: headers(),
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        let err = await res.json().catch(function () {
          return {};
        });
        throw new Error(err.message || 'Error al guardar calendario');
      }
      let modalEl = document.getElementById('modalCalendario');
      if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
      showCalAlert(
        editId ? 'Calendario actualizado' : 'Calendario creado',
        'success'
      );
      await loadCalendarios();
      // Re-select if was editing the selected one
      if (editId && Number(editId) === Number(state.selectedCalId)) {
        selectCalendario(Number(editId));
      }
    } catch (e) {
      showCalAlert(e.message, 'danger');
    }
  }

  async function deleteCalendario(id) {
    let cal = state.calendarios.find(function (c) {
      return Number(c.id) === Number(id);
    });
    let nombre = cal ? cal.nombre : 'Calendario';

    let modalEl = document.getElementById('modalConfirmDeleteConfig');
    if (!modalEl) return;
    let modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    let confirmBtn = document.getElementById('btnConfirmDeleteConfig');
    let bodyP = modalEl.querySelector('.modal-body p:first-child');
    if (bodyP) bodyP.textContent = '¿Eliminar "' + nombre + '"?';
    let warningP = modalEl.querySelector('.modal-body p:nth-child(2)');
    let originalWarning = warningP ? warningP.innerHTML : '';
    if (warningP)
      warningP.innerHTML =
        '<small class="text-danger"><i class="bi bi-exclamation-triangle me-1"></i>Esta acción borrará todos los festivos asociados a este calendario.</small>';

    let handler = async function () {
      confirmBtn.removeEventListener('click', handler);
      modal.hide();
      try {
        let res = await fetch('/api/calendarios/' + id, {
          method: 'DELETE',
          headers: headers(),
        });
        if (!res.ok) {
          let err = await res.json().catch(function () {
            return {};
          });
          throw new Error(err.message || 'Error al eliminar calendario');
        }
        showCalAlert('Calendario eliminado', 'success');
        if (Number(state.selectedCalId) === Number(id)) {
          state.selectedCalId = null;
          clearFestivosPanel();
        }
        await loadCalendarios();
      } catch (e) {
        showCalAlert(e.message, 'danger');
      }
    };
    modalEl.addEventListener('hide.bs.modal', function cleanup() {
      confirmBtn.removeEventListener('click', handler);
      modalEl.removeEventListener('hide.bs.modal', cleanup);
      if (warningP) warningP.innerHTML = originalWarning;
    });
    confirmBtn.addEventListener('click', handler);
    modal.show();
  }

  function selectCalendario(id) {
    state.selectedCalId = id;
    renderCalendariosList();
    loadFestivos(id);
    let btn = document.getElementById('btnNuevoFestivo');
    if (btn) btn.disabled = false;
    let sub = document.getElementById('calFestivosSubtitle');
    let cal = state.calendarios.find(function (c) {
      return Number(c.id) === Number(id);
    });
    if (sub && cal) sub.textContent = '— ' + cal.nombre;
  }

  // ─── Festivos (detail grid) ─────────────────────────────────────────────

  function clearFestivosPanel() {
    if (state.tabulator) state.tabulator.setData([]);
    state.festivos = [];
    state.originalFestivos = [];
    state.pendingFestivos.clear();
    updateFestivosBar();
    let sub = document.getElementById('calFestivosSubtitle');
    if (sub) sub.textContent = '— seleccione un calendario';
    let btn = document.getElementById('btnNuevoFestivo');
    if (btn) btn.disabled = true;
  }

  function updateFestivosBar() {
    let count = state.pendingFestivos.size;
    let bar = document.getElementById('saveChangesFestivo');
    let cntEl = document.getElementById('pendingCountFestivo');
    let saveBtn = document.getElementById('btnSaveFestivo');
    let discardBtn = document.getElementById('btnDiscardFestivo');
    if (cntEl) cntEl.textContent = count;
    if (bar) {
      bar.classList.toggle('pending-changes-active', count > 0);
      bar.classList.toggle('pending-changes-idle', count === 0);
    }
    if (saveBtn) saveBtn.disabled = count === 0;
    if (discardBtn) discardBtn.disabled = count === 0;
  }

  async function loadFestivos(calId) {
    try {
      let res = await fetch('/api/calendarios/' + calId + '/festivos', {
        headers: headers(),
      });
      if (!res.ok) throw new Error('Error al cargar festivos');
      let json = await res.json();
      state.festivos = (json.data || []).map(function (f) {
        return Object.assign({}, f, { fecha: f.fecha || '' });
      });
      state.originalFestivos = app.cloneRecords(state.festivos);
      state.pendingFestivos.clear();
      if (state.tabulator) state.tabulator.setData(state.festivos);
      updateFestivosBar();
    } catch (e) {
      showFestAlert(e.message, 'danger');
    }
  }

  function initFestivosTabulator() {
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

    let deleteCol = {
      title: '',
      width: 60,
      headerSort: false,
      editable: false,
      formatter: function () {
        return '<button class="btn btn-sm btn-outline-danger" type="button" title="Eliminar"><i class="bi bi-trash"></i></button>';
      },
      cellClick: function (e, cell) {
        if (e.target.closest('button'))
          confirmDeleteFestivo(cell.getRow().getData().id);
      },
    };

    state.tabulator = new Tabulator('#tabulatorFestivos', {
      locale: 'es-es',
      langs: LANGS,
      layout: 'fitDataFill',
      height: 'calc(100vh - 420px)',
      rowHeight: 32,
      pagination: true,
      paginationSize: 25,
      paginationSizeSelector: [10, 25, 50, true],
      placeholder: 'Seleccione un calendario para ver sus festivos',
      columnDefaults: { resizable: true },
      columns: [
        {
          title: 'ID',
          field: 'id',
          editable: false,
          width: 60,
          sorter: 'number',
        },
        {
          title: 'Fecha',
          field: 'fecha',
          width: 150,
          headerFilter: 'input',
          sorter: 'string',
          editor: 'date',
          editorParams: { format: 'yyyy-MM-dd' },
          formatter: function (cell) {
            let v = cell.getValue();
            if (!v) return '';
            let s = String(v).slice(0, 10);
            let dt = luxon.DateTime.fromISO(s);
            if (!dt.isValid) return app.escapeHtml(s);
            let dayName = dt.setLocale('es').toFormat('ccc');
            return (
              app.escapeHtml(s) +
              ' <small class="text-muted">(' +
              app.escapeHtml(dayName) +
              ')</small>'
            );
          },
        },
        {
          title: 'Nombre',
          field: 'nombre',
          editor: 'input',
          headerFilter: 'input',
        },
        {
          title: 'Descripción',
          field: 'descripcion',
          editor: 'input',
          headerFilter: 'input',
        },
        {
          title: 'Recurrente',
          field: 'es_recurrente',
          width: 110,
          hozAlign: 'center',
          vertAlign: 'middle',
          formatter: 'tickCross',
          sorter: 'boolean',
          editor: 'tickCross',
        },
        deleteCol,
      ],
    });

    state.tabulator.on('cellEdited', function (cell) {
      let rowData = cell.getRow().getData();
      let pk = rowData.id;
      let field = cell.getField();
      let newVal = cell.getValue();

      // Normalizar fecha: si Tabulator devuelve un Date, convertir a string YYYY-MM-DD con Luxon
      if (field === 'fecha' && newVal instanceof Date) {
        newVal = luxon.DateTime.fromJSDate(newVal).toISODate();
        cell.setValue(newVal, true); // true = no trigger cellEdited de nuevo
      }

      let orig = state.originalFestivos.find(function (r) {
        return Number(r.id) === Number(pk);
      });
      if (!orig) {
        updateFestivosBar();
        return;
      }
      if (!state.pendingFestivos.has(pk))
        state.pendingFestivos.set(pk, Object.assign({}, orig));
      state.pendingFestivos.get(pk)[field] = newVal;

      // Check if really different
      let pending = state.pendingFestivos.get(pk);
      let hasDiff = Object.keys(orig).some(function (key) {
        return String(orig[key] ?? '') !== String(pending[key] ?? '');
      });
      if (!hasDiff) state.pendingFestivos.delete(pk);
      updateFestivosBar();
    });
  }

  async function saveFestivos() {
    let promises = [];
    for (let entry of state.pendingFestivos) {
      let pk = entry[0];
      let changes = entry[1];
      promises.push(
        fetch('/api/calendarios/festivos/' + pk, {
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
        showFestAlert('Cambios guardados', 'success');
        await loadFestivos(state.selectedCalId);
      } else {
        showFestAlert(failed + ' cambio(s) fallaron', 'warning');
      }
    } catch (e) {
      showFestAlert(e.message, 'danger');
    }
  }

  function discardFestivos() {
    state.pendingFestivos.clear();
    state.festivos = app.cloneRecords(state.originalFestivos);
    if (state.tabulator) state.tabulator.setData(state.festivos);
    updateFestivosBar();
    showFestAlert('Cambios descartados', 'info');
  }

  async function confirmDeleteFestivo(id) {
    let festivo = state.festivos.find(function (f) {
      return Number(f.id) === Number(id);
    });
    let nombre = festivo ? festivo.nombre : 'este festivo';

    let modalEl = document.getElementById('modalConfirmDeleteConfig');
    if (!modalEl) return;
    let modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    let confirmBtn = document.getElementById('btnConfirmDeleteConfig');
    let bodyP = modalEl.querySelector('.modal-body p:first-child');
    if (bodyP) bodyP.textContent = '¿Eliminar el festivo "' + nombre + '"?';

    let handler = async function () {
      confirmBtn.removeEventListener('click', handler);
      modal.hide();
      try {
        let res = await fetch('/api/calendarios/festivos/' + id, {
          method: 'DELETE',
          headers: headers(),
        });
        if (!res.ok) {
          let err = await res.json().catch(function () {
            return {};
          });
          throw new Error(err.message || 'Error al eliminar festivo');
        }
        showFestAlert('Festivo eliminado', 'success');
        await loadFestivos(state.selectedCalId);
      } catch (e) {
        showFestAlert(e.message, 'danger');
      }
    };
    modalEl.addEventListener('hide.bs.modal', function cleanup() {
      confirmBtn.removeEventListener('click', handler);
      modalEl.removeEventListener('hide.bs.modal', cleanup);
    });
    confirmBtn.addEventListener('click', handler);
    modal.show();
  }

  function openFestivoModal() {
    let form = document.getElementById('formFestivo');
    if (form) {
      form.reset();
      form.classList.remove('was-validated');
    }
    let titleEl = document.getElementById('modalFestivoLabel');
    if (titleEl) titleEl.textContent = 'Nuevo Festivo';
    let modalEl = document.getElementById('modalFestivo');
    if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  async function saveFestivo() {
    let form = document.getElementById('formFestivo');
    if (!form || !form.checkValidity()) {
      if (form) form.classList.add('was-validated');
      return;
    }

    let data = {
      fecha: document.getElementById('festFecha').value,
      nombre: document.getElementById('festNombre').value.trim(),
      descripcion:
        document.getElementById('festDescripcion').value.trim() || null,
      es_recurrente: document.getElementById('festRecurrente').checked,
    };

    try {
      let res = await fetch(
        '/api/calendarios/' + state.selectedCalId + '/festivos',
        {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(data),
        }
      );
      if (!res.ok) {
        let err = await res.json().catch(function () {
          return {};
        });
        throw new Error(err.message || 'Error al crear festivo');
      }
      let modalEl = document.getElementById('modalFestivo');
      if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
      showFestAlert('Festivo creado', 'success');
      await loadFestivos(state.selectedCalId);
    } catch (e) {
      showFestAlert(e.message, 'danger');
    }
  }

  // ─── Export festivos ────────────────────────────────────────────────────

  function exportExcelFestivos() {
    if (!state.tabulator) return;
    let cal = state.calendarios.find(function (c) {
      return Number(c.id) === Number(state.selectedCalId);
    });
    let name = cal ? cal.nombre.toLowerCase().replace(/\s+/g, '_') : 'festivos';
    let ts = new Date()
      .toISOString()
      .slice(0, 19)
      .replace('T', '_')
      .replace(/:/g, '-');

    let cols = state.tabulator.getColumns().filter(function (c) {
      return c.getDefinition().title && c.getDefinition().field;
    });
    let header = ['Calendario', 'Ámbito', 'Activo'];
    cols.forEach(function (c) {
      header.push(c.getDefinition().title);
    });

    let rows = state.tabulator.getData('active').map(function (row) {
      let r = [
        cal ? cal.nombre : '',
        cal ? cal.ambito : '',
        cal ? (cal.activo ? 'Sí' : 'No') : '',
      ];
      cols.forEach(function (c) {
        let v = row[c.getDefinition().field];
        r.push(v == null ? '' : v);
      });
      return r;
    });

    let ws = XLSX.utils.aoa_to_sheet([header].concat(rows));
    let wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Festivos');
    XLSX.writeFile(wb, name + '_' + ts + '.xlsx');
  }

  function exportPdfFestivos() {
    if (!state.tabulator || typeof window.jspdf === 'undefined') return;
    let cal = state.calendarios.find(function (c) {
      return Number(c.id) === Number(state.selectedCalId);
    });
    let title = 'Festivos' + (cal ? ' — ' + cal.nombre : '');
    let usuario = app.globalState.userName || '';
    let fecha = new Date().toLocaleString('es-ES');
    let ts = new Date()
      .toISOString()
      .slice(0, 19)
      .replace('T', '_')
      .replace(/:/g, '-');

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
    doc.save(
      (cal ? cal.nombre.toLowerCase().replace(/\s+/g, '_') : 'festivos') +
        '_' +
        ts +
        '.pdf'
    );
  }

  // ─── Setup ──────────────────────────────────────────────────────────────

  function setupEvents() {
    document
      .getElementById('btnNuevoCalendario')
      ?.addEventListener('click', function () {
        openCalendarioModal(null);
      });
    document
      .getElementById('btnGuardarCalendario')
      ?.addEventListener('click', saveCalendario);
    document
      .getElementById('formCalendario')
      ?.addEventListener('submit', function (e) {
        e.preventDefault();
        saveCalendario();
      });

    document
      .getElementById('btnNuevoFestivo')
      ?.addEventListener('click', openFestivoModal);
    document
      .getElementById('btnGuardarFestivo')
      ?.addEventListener('click', saveFestivo);
    document
      .getElementById('formFestivo')
      ?.addEventListener('submit', function (e) {
        e.preventDefault();
        saveFestivo();
      });

    document
      .getElementById('btnSaveFestivo')
      ?.addEventListener('click', saveFestivos);
    document
      .getElementById('btnDiscardFestivo')
      ?.addEventListener('click', discardFestivos);

    document
      .getElementById('btnExportExcelFestivo')
      ?.addEventListener('click', exportExcelFestivos);
    document
      .getElementById('btnExportPdfFestivo')
      ?.addEventListener('click', exportPdfFestivos);
  }

  // ─── Public initializer ────────────────────────────────────────────────

  app.initializeCalendarios = async function initializeCalendarios() {
    initFestivosTabulator();
    await loadArsList();
    await loadCalendarios();
    setupEvents();
  };
})();
