(function () {
  let app = window.GRS1Dashboard;
  let DateTime = window.luxon && window.luxon.DateTime;

  if (!app) return;

  let MESES = [
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

  let state = {
    initialized: false,
    year: DateTime ? DateTime.now().year : 2026,
    monthFilter: 0,
    cuadrantes: [],
    detailById: {},
    editingId: null,
    editingCanEditStructure: false,
    pendingDeleteId: null,
    preview: null,
  };

  function getEl(id) {
    return document.getElementById(id);
  }

  function esc(v) {
    return app.escapeHtml(v);
  }

  function headers(includeJson) {
    return app.getHeaders(includeJson === true);
  }

  function isConsultaReadOnly() {
    return (
      window.GRS1Utils &&
      typeof window.GRS1Utils.isConsultaReadOnlyRole === 'function' &&
      window.GRS1Utils.isConsultaReadOnlyRole(app)
    );
  }

  function guardReadOnlyAction() {
    if (!isConsultaReadOnly()) return false;
    showAlert('Perfil consulta: solo lectura', 'warning');
    return true;
  }

  function applyConsultaReadOnlyUi() {
    if (!isConsultaReadOnly()) return;
    if (!window.GRS1Utils || typeof window.GRS1Utils.disableElementsById !== 'function') {
      return;
    }
    window.GRS1Utils.disableElementsById([
      'planCuadBtnCreate',
      'planCuadBtnSave',
      'planCuadDeleteConfirmBtn',
    ]);

    document.querySelectorAll('#planCuadGrid [data-action="edit"], #planCuadGrid [data-action="delete"], #planCuadGrid [data-action="state"]').forEach(function (btn) {
      // @ts-ignore
      btn.disabled = true;
      btn.classList.add('disabled');
      btn.setAttribute('aria-disabled', 'true');
      btn.setAttribute('title', 'Perfil consulta: solo lectura');
    });
  }

  async function fetchJson(url, options) {
    let res = await fetch(url, options || {});
    let contentType = res.headers.get('content-type') || '';
    let json =
      contentType.indexOf('application/json') !== -1 ? await res.json() : {};
    if (!res.ok) throw new Error((json && json.message) || 'Error de API');
    return json;
  }

  function resetDeleteModalState() {
    let errorEl = getEl('planCuadDeleteError');
    let confirmSwitch = getEl('planCuadDeleteConfirmSwitch');
    let confirmLabel = getEl('planCuadDeleteConfirmLabel');
    let confirmBtn = getEl('planCuadDeleteConfirmBtn');

    if (errorEl) errorEl.innerHTML = '';
    // @ts-ignore
    if (confirmSwitch) confirmSwitch.checked = false;
    if (confirmLabel) confirmLabel.textContent = 'No';
    // @ts-ignore
    if (confirmBtn) confirmBtn.disabled = true;
  }

  function bindDeleteSwitch() {
    let confirmSwitch = getEl('planCuadDeleteConfirmSwitch');
    let confirmLabel = getEl('planCuadDeleteConfirmLabel');
    let confirmBtn = getEl('planCuadDeleteConfirmBtn');
    if (!confirmSwitch || !confirmLabel || !confirmBtn) return;

    confirmSwitch.onchange = function () {
      // @ts-ignore
      let accepted = !!confirmSwitch.checked;
      confirmLabel.textContent = accepted ? 'Si' : 'No';
      // @ts-ignore
      confirmBtn.disabled = !accepted;
    };
  }

  function showAlert(message, type) {
    let el = getEl('planCuadAlert');
    if (!el) return;
    el.innerHTML =
      '<div class="alert alert-' +
      esc(type || 'info') +
      ' alert-dismissible fade show py-1 small mb-1" role="alert">' +
      esc(message) +
      '<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Cerrar"></button>' +
      '</div>';
  }

  function setMonthOptions() {
    let sel = getEl('planCuadMonthFilter');
    let mesRef = getEl('planCuadMesRef');
    if (sel) {
      let html = '<option value="0">Todos</option>';
      for (let i = 1; i <= 12; i += 1)
        html += '<option value="' + i + '">' + MESES[i - 1] + '</option>';
      sel.innerHTML = html;
      // @ts-ignore
      sel.value = String(state.monthFilter || 0);
    }
    if (mesRef) {
      let refHtml = '';
      for (let j = 1; j <= 12; j += 1)
        refHtml += '<option value="' + j + '">' + MESES[j - 1] + '</option>';
      mesRef.innerHTML = refHtml;
    }
  }

  function updateHeaderInputs() {
    let yearInput = getEl('planCuadYearInput');
    // @ts-ignore
    if (yearInput) yearInput.value = String(state.year);
    let monthFilter = getEl('planCuadMonthFilter');
    // @ts-ignore
    if (monthFilter) monthFilter.value = String(state.monthFilter || 0);
  }

  function normalize(rows) {
    return (rows || []).map(function (c) {
      return {
        id: Number(c.id),
        nombre: c.nombre,
        descripcion: c.descripcion,
        estado: c.estado,
        fecha_inicio: c.fecha_inicio,
        fecha_fin: c.fecha_fin,
        num_semanas: Number(c.num_semanas || 0),
        mes_referencia: Number(c.mes_referencia || 0),
        anio_referencia: Number(c.anio_referencia || 0),
      };
    });
  }

  async function loadCuadrantes() {
    let json = await fetchJson('/api/cuadrantes', { headers: headers(false) });
    state.cuadrantes = normalize(json.data || []);
    renderGrid();
    hydrateVisibleDetails();
  }

  function renderGrid() {
    let grid = getEl('planCuadGrid');
    if (!grid) return;

    let ESTADO_BADGE = {
      borrador: 'bg-warning text-dark',
      activo: 'bg-success',
      archivado: 'bg-secondary',
    };
    let html = '';

    for (let mes = 1; mes <= 12; mes += 1) {
      let items = state.cuadrantes.filter(function (c) {
        return (
          c.anio_referencia === state.year &&
          c.mes_referencia === mes &&
          (!state.monthFilter || state.monthFilter === mes)
        );
      });

      let cardContent = '';
      if (!items.length) {
        cardContent = '<div class="text-muted small">Sin cuadrantes</div>';
      } else {
        cardContent = items
          .map(function (c) {
            let badge = ESTADO_BADGE[c.estado] || 'bg-secondary';
            let previewId = 'planCuadPreview_' + c.id;
            let toggleTo = c.estado === 'activo' ? 'archivado' : 'activo';
            let toggleIcon =
              c.estado === 'activo' ? 'bi-archive' : 'bi-check-circle';
            let toggleLabel = c.estado === 'activo' ? 'Archivar' : 'Activar';

            return (
              '' +
              '<div class="border rounded p-2 mb-2">' +
              '<div class="d-flex justify-content-between align-items-start mb-1">' +
              '<div>' +
              '<div class="fw-semibold small">' +
              esc(c.nombre || 'Cuadrante') +
              '</div>' +
              '<div class="text-muted" style="font-size:.72rem;">' +
              esc(c.fecha_inicio) +
              ' -> ' +
              esc(c.fecha_fin) +
              ' · ' +
              esc(c.num_semanas) +
              ' sem.</div>' +
              '</div>' +
              '<span class="badge ' +
              badge +
              '" style="font-size:.65rem;">' +
              esc(c.estado) +
              '</span>' +
              '</div>' +
              '<div id="' +
              previewId +
              '" data-preview-id="' +
              c.id +
              '" class="p-1 border rounded bg-light" style="min-height:118px;"></div>' +
              '<div class="d-flex gap-1 mt-2 flex-wrap">' +
              '<button class="btn btn-outline-primary btn-sm" data-action="edit" data-id="' +
              c.id +
              '"><i class="bi bi-pencil me-1"></i>Editar</button>' +
              '<button class="btn btn-outline-danger btn-sm" data-action="delete" data-id="' +
              c.id +
              '"><i class="bi bi-trash me-1"></i>Eliminar</button>' +
              '<button class="btn btn-outline-secondary btn-sm" data-action="state" data-id="' +
              c.id +
              '" data-next-state="' +
              toggleTo +
              '"><i class="bi ' +
              toggleIcon +
              ' me-1"></i>' +
              toggleLabel +
              '</button>' +
              '</div>' +
              '</div>'
            );
          })
          .join('');
      }

      html +=
        '' +
        '<div class="col-12 col-md-6 col-xl-4">' +
        '<div class="card shadow-sm h-100">' +
        '<div class="card-header py-2 px-2 d-flex justify-content-between align-items-center">' +
        '<strong style="font-size:.9rem;">' +
        MESES[mes - 1] +
        ' ' +
        esc(state.year) +
        '</strong>' +
        '<span class="badge bg-light text-dark border">' +
        items.length +
        '</span>' +
        '</div>' +
        '<div class="card-body p-2">' +
        cardContent +
        '</div>' +
        '</div>' +
        '</div>';
    }

    grid.innerHTML = html;
    applyConsultaReadOnlyUi();
  }

  async function hydrateVisibleDetails() {
    let nodes = document.querySelectorAll('[data-preview-id]');
    let idsToLoad = [];

    nodes.forEach(function (node) {
      let id = Number(node.getAttribute('data-preview-id'));
      if (!state.detailById[id]) idsToLoad.push(id);
    });

    if (idsToLoad.length) {
      await Promise.all(
        idsToLoad.map(async function (id) {
          try {
            let json = await fetchJson('/api/cuadrantes/' + id, {
              headers: headers(false),
            });
            state.detailById[id] = json.data;
          } catch (_e) {
            state.detailById[id] = null;
          }
        })
      );
    }

    nodes.forEach(function (node) {
      let id = Number(node.getAttribute('data-preview-id'));
      let data = state.detailById[id];
      if (
        data &&
        Array.isArray(data.dias) &&
        typeof window.renderCuadrantePreview === 'function'
      ) {
        window.renderCuadrantePreview(node.id, data);
      } else {
        node.innerHTML =
          '<div class="text-muted small">Preview no disponible</div>';
      }
    });
  }

  function hasReferenceDays(cuadrante) {
    return Boolean(
      cuadrante &&
      Array.isArray(cuadrante.dias) &&
      cuadrante.dias.some(function (d) {
        return d.es_del_mes_ref;
      })
    );
  }

  function setStructureFieldsDisabled(disabled) {
    [
      'planCuadMesRef',
      'planCuadAnioRef',
      'planCuadFechaInicio',
      'planCuadSemanas',
    ].forEach(function (id) {
      let el = getEl(id);
      // @ts-ignore
      if (el) el.disabled = Boolean(disabled);
    });
  }

  async function refreshPreview() {
    // @ts-ignore
    let semanas = Number((getEl('planCuadSemanas') || {}).value) || null;
    // @ts-ignore
    let fechaInicio = ((getEl('planCuadFechaInicio') || {}).value || '').trim();
    // @ts-ignore
    let mesRef = Number((getEl('planCuadMesRef') || {}).value) || null;
    // @ts-ignore
    let anioRef = Number((getEl('planCuadAnioRef') || {}).value) || null;
    let fechaFinEl = getEl('planCuadFechaFin');
    let infoEl = getEl('planCuadPreviewInfo');
    let previewEl = getEl('planCuadFormPreview');
    let saveBtn = getEl('planCuadBtnSave');

    if (!fechaInicio || !semanas || !mesRef || !anioRef) {
      state.preview = null;
      // @ts-ignore
      if (fechaFinEl) fechaFinEl.value = '';
      if (previewEl) previewEl.innerHTML = '';
      if (infoEl)
        infoEl.textContent =
          'Completa fecha inicio, semanas y referencia para generar preview';
      // @ts-ignore
      if (saveBtn) saveBtn.disabled = true;
      return;
    }

    if (!DateTime) {
      state.preview = null;
      if (previewEl)
        previewEl.innerHTML =
          '<div class="alert alert-warning py-1 small mb-0">Luxon no disponible</div>';
      // @ts-ignore
      if (saveBtn) saveBtn.disabled = true;
      return;
    }

    let start = DateTime.fromISO(fechaInicio, { zone: 'utc' });
    if (!start.isValid) return;
    let fechaFin = start.plus({ days: semanas * 7 - 1 }).toISODate();
    // @ts-ignore
    if (fechaFinEl) fechaFinEl.value = fechaFin;

    try {
      let qs =
        'fecha_inicio=' +
        encodeURIComponent(fechaInicio) +
        '&fecha_fin=' +
        encodeURIComponent(fechaFin) +
        '&mes_referencia=' +
        encodeURIComponent(mesRef) +
        '&anio_referencia=' +
        encodeURIComponent(anioRef);

      let json = await fetchJson('/api/cuadrantes/preview?' + qs, {
        headers: headers(false),
      });
      state.preview = json.data;

      let nombreEl = getEl('planCuadNombre');
      if (
        nombreEl &&
        // @ts-ignore
        !nombreEl.value.trim() &&
        state.preview &&
        state.preview.nombre
      ) {
        // @ts-ignore
        nombreEl.value = state.preview.nombre;
      }

      if (infoEl && state.preview) {
        infoEl.textContent =
          state.preview.fecha_inicio +
          ' -> ' +
          state.preview.fecha_fin +
          ' · ' +
          state.preview.num_semanas +
          ' semanas · ' +
          state.preview.dias.length +
          ' dias';
      }
      if (previewEl && typeof window.renderCuadrantePreview === 'function') {
        window.renderCuadrantePreview('planCuadFormPreview', state.preview);
      }

      let valid = hasReferenceDays(state.preview);
      let alertEl = getEl('planCuadFormAlert');
      // @ts-ignore
      if (saveBtn) saveBtn.disabled = !valid;
      if (alertEl) {
        alertEl.innerHTML = valid
          ? ''
          : '<div class="alert alert-warning py-1 small mb-1">La referencia seleccionada debe aparecer en el rango</div>';
      }
    } catch (e) {
      state.preview = null;
      // @ts-ignore
      if (saveBtn) saveBtn.disabled = true;
      if (previewEl)
        previewEl.innerHTML =
          '<div class="alert alert-danger py-1 small mb-0">' +
          esc(e.message) +
          '</div>';
    }
  }

  function resetForm() {
    state.editingId = null;
    state.editingCanEditStructure = true;
    state.preview = null;
    getEl('planCuadFormTitle').innerHTML =
      '<i class="bi bi-calendar3-week me-2"></i>Nuevo cuadrante';
    // @ts-ignore
    getEl('planCuadMesRef').value = String(DateTime ? DateTime.now().month : 1);
    // @ts-ignore
    getEl('planCuadAnioRef').value = String(state.year);
    // @ts-ignore
    getEl('planCuadFechaInicio').value = '';
    // @ts-ignore
    getEl('planCuadSemanas').value = '';
    // @ts-ignore
    getEl('planCuadFechaFin').value = '';
    // @ts-ignore
    getEl('planCuadNombre').value = '';
    // @ts-ignore
    getEl('planCuadDescripcion').value = '';
    getEl('planCuadFormPreview').innerHTML = '';
    getEl('planCuadPreviewInfo').textContent = '';
    getEl('planCuadFormAlert').innerHTML = '';
    setStructureFieldsDisabled(false);
    // @ts-ignore
    getEl('planCuadBtnSave').disabled = true;
  }

  async function openEdit(id) {
    let detail = state.detailById[id];
    if (!detail) {
      let json = await fetchJson('/api/cuadrantes/' + id, {
        headers: headers(false),
      });
      detail = json.data;
      state.detailById[id] = detail;
    }

    state.editingId = id;
    state.editingCanEditStructure = detail.estado === 'borrador';
    state.preview = detail;

    getEl('planCuadFormTitle').innerHTML =
      '<i class="bi bi-pencil-square me-2"></i>Editar cuadrante';
    // @ts-ignore
    getEl('planCuadMesRef').value = String(detail.mes_referencia || 1);
    // @ts-ignore
    getEl('planCuadAnioRef').value = String(
      detail.anio_referencia || state.year
    );
    // @ts-ignore
    getEl('planCuadFechaInicio').value = detail.fecha_inicio || '';
    // @ts-ignore
    getEl('planCuadSemanas').value = String(detail.num_semanas || '');
    // @ts-ignore
    getEl('planCuadFechaFin').value = detail.fecha_fin || '';
    // @ts-ignore
    getEl('planCuadNombre').value = detail.nombre || '';
    // @ts-ignore
    getEl('planCuadDescripcion').value = detail.descripcion || '';
    getEl('planCuadPreviewInfo').textContent =
      (detail.fecha_inicio || '') +
      ' -> ' +
      (detail.fecha_fin || '') +
      ' · ' +
      (detail.num_semanas || '') +
      ' semanas';
    if (state.editingCanEditStructure) {
      getEl('planCuadFormAlert').innerHTML =
        '<div class="alert alert-info py-1 small mb-1">Puedes editar estructura porque el cuadrante esta en borrador</div>';
    } else {
      getEl('planCuadFormAlert').innerHTML =
        '<div class="alert alert-warning py-1 small mb-1">Solo se permiten cambios de nombre y descripcion fuera de borrador</div>';
    }
    setStructureFieldsDisabled(!state.editingCanEditStructure);

    if (typeof window.renderCuadrantePreview === 'function') {
      window.renderCuadrantePreview('planCuadFormPreview', detail);
    }

    // @ts-ignore
    getEl('planCuadBtnSave').disabled = false;
    bootstrap.Modal.getOrCreateInstance(getEl('planCuadFormModal')).show();
  }

  async function saveForm() {
    if (guardReadOnlyAction()) return;
    let alertEl = getEl('planCuadFormAlert');
    // @ts-ignore
    let nombre = ((getEl('planCuadNombre') || {}).value || '').trim() || null;
    let descripcion =
      // @ts-ignore
      ((getEl('planCuadDescripcion') || {}).value || '').trim() || null;

    try {
      if (state.editingId) {
        let editPayload = { nombre: nombre, descripcion: descripcion };

        if (state.editingCanEditStructure) {
          let editSemanas =
            // @ts-ignore
            Number((getEl('planCuadSemanas') || {}).value) || null;
          let editFechaInicio =
            // @ts-ignore
            ((getEl('planCuadFechaInicio') || {}).value || '').trim() || null;
          let editFechaFin =
            // @ts-ignore
            ((getEl('planCuadFechaFin') || {}).value || '').trim() || null;
          let editMesRef =
            // @ts-ignore
            Number((getEl('planCuadMesRef') || {}).value) || null;
          let editAnioRef =
            // @ts-ignore
            Number((getEl('planCuadAnioRef') || {}).value) || null;

          if (
            !editFechaInicio ||
            !editSemanas ||
            !editFechaFin ||
            !editMesRef ||
            !editAnioRef
          ) {
            throw new Error('Completa fecha inicio, semanas y referencia');
          }
          if (!hasReferenceDays(state.preview)) {
            throw new Error(
              'La referencia seleccionada debe aparecer en el rango'
            );
          }

          editPayload.num_semanas = editSemanas;
          editPayload.fecha_inicio = editFechaInicio;
          editPayload.fecha_fin = editFechaFin;
          editPayload.mes_referencia = editMesRef;
          editPayload.anio_referencia = editAnioRef;
        }

        await fetchJson('/api/cuadrantes/' + state.editingId, {
          method: 'PUT',
          headers: headers(true),
          body: JSON.stringify(editPayload),
        });
      } else {
        // @ts-ignore
        let semanas = Number((getEl('planCuadSemanas') || {}).value) || null;
        let fechaInicio =
          // @ts-ignore
          ((getEl('planCuadFechaInicio') || {}).value || '').trim() || null;
        let fechaFin =
          // @ts-ignore
          ((getEl('planCuadFechaFin') || {}).value || '').trim() || null;
        // @ts-ignore
        let mesRef = Number((getEl('planCuadMesRef') || {}).value) || null;
        // @ts-ignore
        let anioRef = Number((getEl('planCuadAnioRef') || {}).value) || null;

        if (!fechaInicio || !semanas || !fechaFin || !mesRef || !anioRef) {
          throw new Error('Completa fecha inicio, semanas y referencia');
        }
        if (!hasReferenceDays(state.preview)) {
          throw new Error(
            'La referencia seleccionada debe aparecer en el rango'
          );
        }

        await fetchJson('/api/cuadrantes', {
          method: 'POST',
          headers: headers(true),
          body: JSON.stringify({
            num_semanas: semanas,
            fecha_inicio: fechaInicio,
            fecha_fin: fechaFin,
            mes_referencia: mesRef,
            anio_referencia: anioRef,
            nombre: nombre,
            descripcion: descripcion,
          }),
        });

        state.year = anioRef;
      }

      // Despues de grabar, volver siempre el filtro mensual a "Todos".
      state.monthFilter = 0;

      bootstrap.Modal.getOrCreateInstance(getEl('planCuadFormModal')).hide();
      showAlert(
        state.editingId ? 'Cuadrante actualizado' : 'Cuadrante creado',
        'success'
      );
      updateHeaderInputs();
      await loadCuadrantes();
    } catch (e) {
      if (alertEl)
        alertEl.innerHTML =
          '<div class="alert alert-danger py-1 small mb-1">' +
          esc(e.message) +
          '</div>';
    }
  }

  function openDelete(id) {
    if (guardReadOnlyAction()) return;
    let c =
      state.detailById[id] ||
      state.cuadrantes.find(function (x) {
        return x.id === id;
      });
    if (!c) return;
    state.pendingDeleteId = id;
    getEl('planCuadDeleteName').textContent = c.nombre || 'Cuadrante';
    getEl('planCuadDeleteMeta').textContent =
      (c.fecha_inicio || '') +
      ' -> ' +
      (c.fecha_fin || '') +
      ' · ' +
      (c.num_semanas || '') +
      ' semanas';
    resetDeleteModalState();
    bootstrap.Modal.getOrCreateInstance(getEl('planCuadDeleteModal')).show();
  }

  async function confirmDelete() {
    if (guardReadOnlyAction()) return;
    if (!state.pendingDeleteId) return;
    let confirmSwitch = getEl('planCuadDeleteConfirmSwitch');
    let errorEl = getEl('planCuadDeleteError');
    let confirmBtn = getEl('planCuadDeleteConfirmBtn');
    // @ts-ignore
    if (confirmSwitch && !confirmSwitch.checked) return;

    try {
      if (errorEl) errorEl.innerHTML = '';
      // @ts-ignore
      if (confirmBtn) confirmBtn.disabled = true;
      await fetchJson('/api/cuadrantes/' + state.pendingDeleteId, {
        method: 'DELETE',
        headers: headers(false),
      });
      bootstrap.Modal.getOrCreateInstance(getEl('planCuadDeleteModal')).hide();
      state.pendingDeleteId = null;
      showAlert('Cuadrante eliminado', 'success');
      await loadCuadrantes();
    } catch (e) {
      if (errorEl) {
        errorEl.innerHTML =
          '<div class="alert alert-danger py-1 small mb-0">' +
          esc(e.message) +
          '</div>';
      }
      showAlert(e.message, 'danger');
      if (confirmBtn)
        // @ts-ignore
        confirmBtn.disabled = !(confirmSwitch && confirmSwitch.checked);
    }
  }

  async function openOnboardingFallback() {
    if (typeof app.openAsignacionesValidarModal === 'function') {
      await app.openAsignacionesValidarModal({
        mode: 'onboarding',
        source: 'cuadrante_activado_dashboard',
        onSaved: async function () {
          await loadCuadrantes();
        },
      });
    }
  }

  async function changeState(id, nextState) {
    if (guardReadOnlyAction()) return;
    try {
      await fetchJson('/api/cuadrantes/' + id, {
        method: 'PUT',
        headers: headers(true),
        body: JSON.stringify({ estado: nextState }),
      });

      if (
        String(nextState || '').toLowerCase() === 'activo' &&
        typeof app.handleCuadranteActivado === 'function'
      ) {
        await app.handleCuadranteActivado(id, {
          waitForModalHidden: false,
          source: 'cuadrante_activado_dashboard',
        });
        let onboardingModal = document.getElementById('asigValidarModal');
        let onboardingVisible = !!(
          onboardingModal &&
          onboardingModal.classList &&
          onboardingModal.classList.contains('show')
        );
        if (!onboardingVisible) {
          await openOnboardingFallback();
        }
        showAlert('Cuadrante activado', 'success');
        return;
      }

      if (String(nextState || '').toLowerCase() === 'activo') {
        await openOnboardingFallback();
        showAlert('Cuadrante activado', 'success');
        return;
      }

      showAlert('Estado actualizado', 'success');
      await loadCuadrantes();
    } catch (e) {
      showAlert(e.message, 'danger');
    }
  }

  function bindEvents() {
    getEl('planCuadYearPrev').addEventListener('click', function () {
      state.year = Math.max(2020, Number(state.year) - 1);
      updateHeaderInputs();
      renderGrid();
      hydrateVisibleDetails();
    });

    getEl('planCuadYearNext').addEventListener('click', function () {
      state.year = Math.min(2050, Number(state.year) + 1);
      updateHeaderInputs();
      renderGrid();
      hydrateVisibleDetails();
    });

    getEl('planCuadYearInput').addEventListener('change', function () {
      // @ts-ignore
      let value = Number(getEl('planCuadYearInput').value) || state.year;
      state.year = Math.max(2020, Math.min(2050, value));
      updateHeaderInputs();
      renderGrid();
      hydrateVisibleDetails();
    });

    getEl('planCuadMonthFilter').addEventListener('change', function () {
      // @ts-ignore
      state.monthFilter = Number(getEl('planCuadMonthFilter').value) || 0;
      renderGrid();
      hydrateVisibleDetails();
    });

    getEl('planCuadBtnRefresh').addEventListener('click', loadCuadrantes);

    getEl('planCuadBtnCreate').addEventListener('click', function () {
      if (guardReadOnlyAction()) return;
      resetForm();
      bootstrap.Modal.getOrCreateInstance(getEl('planCuadFormModal')).show();
      applyConsultaReadOnlyUi();
    });

    [
      'planCuadMesRef',
      'planCuadAnioRef',
      'planCuadFechaInicio',
      'planCuadSemanas',
    ].forEach(function (id) {
      let el = getEl(id);
      if (!el) return;
      el.addEventListener('change', refreshPreview);
      el.addEventListener('input', refreshPreview);
    });

    getEl('planCuadBtnSave').addEventListener('click', saveForm);
    bindDeleteSwitch();
    getEl('planCuadDeleteConfirmBtn').addEventListener('click', confirmDelete);

    getEl('planCuadGrid').addEventListener('click', function (e) {
      // @ts-ignore
      let btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (guardReadOnlyAction()) return;
      let id = Number(btn.getAttribute('data-id'));
      let action = btn.getAttribute('data-action');
      if (!id || !action) return;

      if (action === 'edit') {
        openEdit(id);
      } else if (action === 'delete') {
        openDelete(id);
      } else if (action === 'state') {
        changeState(id, btn.getAttribute('data-next-state'));
      }
    });

    getEl('planCuadDeleteModal').addEventListener(
      'hidden.bs.modal',
      function () {
        state.pendingDeleteId = null;
        resetDeleteModalState();
      }
    );
  }

  app.initializeCuadrantesPlanificacion =
    async function initializeCuadrantesPlanificacion() {
      let root = getEl('cuadrantesPlanificacionSection');
      if (!root) return;

      if (!state.initialized) {
        state.initialized = true;
        setMonthOptions();
        updateHeaderInputs();

        if (app._asig && typeof app._asig.makeModalDraggable === 'function') {
          app._asig.makeModalDraggable(getEl('planCuadFormModal'));
          app._asig.makeModalDraggable(getEl('planCuadDeleteModal'));
        }

        bindEvents();
      }

      // Siempre recargar datos (necesario cuando cambia el ARS)
      state.cuadrantes = [];
      state.detailById = {};
      await loadCuadrantes();
    };
})();
