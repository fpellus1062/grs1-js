/* ========================================================================
 *  dashboard-cuadrantes.js
 *  Gestión de cuadrantes de planificación (modal master-detail).
 * ======================================================================== */
(function () {
  let app = window.GRS1Dashboard;
  let _ = app._asig;
  let DateTime = window.luxon && window.luxon.DateTime;

  let state = {
    cuadrantes: [],
    selectedId: null,
    preview: null,
  };

  let MESES_REFERENCIA = [
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

  function headers() {
    let h = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + app.globalState.token,
    };
    if (app.globalState.activeArsId)
      h['X-Ars-Id'] = app.globalState.activeArsId;
    return h;
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
    if (_) _.showAlert('Perfil consulta: solo lectura', 'warning');
    return true;
  }

  function applyConsultaReadOnlyUi() {
    if (!isConsultaReadOnly()) return;
    if (!window.GRS1Utils || typeof window.GRS1Utils.disableElementsById !== 'function') {
      return;
    }
    window.GRS1Utils.disableElementsById([
      'btnNuevoCuadrante',
      'btnGuardarCuadrante',
      'btnActivarCuadrante',
      'btnArchivarCuadrante',
      'btnEliminarCuadrante',
      'btnConfirmDeleteCuadrante',
    ]);
  }

  function buildMesReferenciaOptions(selectedMes) {
    return MESES_REFERENCIA.map(function (label, index) {
      let value = index + 1;
      let selected = Number(selectedMes) === value ? ' selected' : '';
      return (
        '<option value="' + value + '"' + selected + '>' + label + '</option>'
      );
    }).join('');
  }

  function buildAnioReferenciaOptions(selectedAnio) {
    let currentYear = DateTime
      ? DateTime.now().year
      : Number(selectedAnio) || 2026;
    let baseYear = Number(selectedAnio) || currentYear;
    let startYear = baseYear - 3;
    let endYear = 2050;
    let options = '';

    for (let year = startYear; year <= endYear; year += 1) {
      let selected = year === Number(selectedAnio) ? ' selected' : '';
      options +=
        '<option value="' + year + '"' + selected + '>' + year + '</option>';
    }

    return options;
  }

  function renderDismissibleAlert(container, type, message, extraClasses) {
    if (!container) return;
    let classes = extraClasses ? ' ' + extraClasses : '';
    container.innerHTML =
      '<div class="alert alert-' +
      app.escapeHtml(type || 'info') +
      ' alert-dismissible fade show' +
      classes +
      '" role="alert">' +
      app.escapeHtml(String(message || '')) +
      '<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Cerrar"></button>' +
      '</div>';
  }

  function hasReferenceDays(cuadrante) {
    return Boolean(
      cuadrante &&
      Array.isArray(cuadrante.dias) &&
      cuadrante.dias.some(function (dia) {
        return dia.es_del_mes_ref;
      })
    );
  }

  function updateCreateButtonState() {
    let btn = document.getElementById('btnGuardarCuadrante');
    let alertEl = document.getElementById('cuadranteFormAlert');
    if (!btn) return;

    let isValid = hasReferenceDays(state.preview);
    // @ts-ignore
    btn.disabled = !isValid;

    if (!alertEl) return;
    if (!state.preview) {
      alertEl.innerHTML = '';
      return;
    }

    if (!isValid) {
      alertEl.innerHTML =
        '<div class="alert alert-warning py-1 small">La referencia seleccionada debe aparecer dentro del rango del cuadrante.</div>';
      return;
    }

    let currentAlert = alertEl.textContent || '';
    if (
      currentAlert.indexOf(
        'La referencia seleccionada debe aparecer dentro del rango del cuadrante.'
      ) !== -1
    ) {
      alertEl.innerHTML = '';
    }
  }

  // ── Modal (se construye una sola vez) ─────────────────────────

  let _modalEl = null;

  function ensureModal() {
    if (_modalEl) return _modalEl;

    let div = document.createElement('div');
    div.id = 'modalGestionCuadrantes';
    div.innerHTML =
      '<div class="modal fade" tabindex="-1" aria-labelledby="modalGestionCuadrantesTitle" aria-hidden="true">' +
      '<div class="modal-dialog modal-lg modal-dialog-centered">' +
      '<div class="modal-content modal-notion asig-modal-notion cuad-modal-notion shadow-sm">' +
      '<div class="modal-header py-2">' +
      '<h5 class="modal-title" id="modalGestionCuadrantesTitle">' +
      '<i class="bi bi-calendar3-week me-2"></i>Cuadrantes de Planificación</h5>' +
      '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>' +
      '</div>' +
      '<div class="modal-body p-0">' +
      '<div class="row g-0 h-100">' +
      '<!-- Lista -->' +
      '<div class="col-md-3 border-end cuad-modal-list">' +
      '<div class="p-2 pb-1">' +
      '<button id="btnNuevoCuadrante" class="btn btn-primary btn-sm w-100 mb-2">' +
      '<i class="bi bi-plus-lg me-1"></i>Nuevo cuadrante</button>' +
      '</div>' +
      '<div id="cuadrantesListContainer" class="list-group list-group-flush"></div>' +
      '</div>' +
      '<!-- Detalle -->' +
      '<div class="col-md-9 cuad-modal-detail">' +
      '<div id="cuadranteDetalle" class="px-4 py-3">' +
      '<div class="text-center text-muted py-5">' +
      '<i class="bi bi-arrow-left-circle" style="font-size:2rem;"></i>' +
      '<p class="mt-2">Seleccione un cuadrante o cree uno nuevo</p>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="modal-footer py-2">' +
      '<button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cerrar</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';

    document.body.appendChild(div);
    _modalEl = div.querySelector('.modal');
    _.makeModalDraggable(_modalEl);
    return _modalEl;
  }

  function ensureDeleteModal() {
    let existing = document.getElementById('cuadranteConfirmDeleteModal');
    if (existing) return existing;

    let wrapper = document.createElement('div');
    wrapper.innerHTML =
      '<div class="modal fade" id="cuadranteConfirmDeleteModal" tabindex="-1" aria-labelledby="cuadranteConfirmDeleteLabel" aria-hidden="true">' +
      '<div class="modal-dialog modal-dialog-centered">' +
      '<div class="modal-content modal-notion asig-modal-notion asig-modal-danger shadow-sm">' +
      '<div class="modal-header">' +
      '<h5 class="modal-title" id="cuadranteConfirmDeleteLabel"><i class="bi bi-exclamation-triangle me-2"></i>Confirmar eliminación</h5>' +
      '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>' +
      '</div>' +
      '<div class="modal-body">' +
      '<div class="alert alert-warning mb-3"><strong>Atención:</strong> Esta acción eliminará el cuadrante y no se puede deshacer.</div>' +
      '<p class="mb-1"><strong>Cuadrante:</strong></p>' +
      '<div id="cuadranteDeleteNombre" class="mb-2 p-2 bg-light rounded border" style="font-size:.95rem;"></div>' +
      '<p id="cuadranteDeleteRango" class="text-muted mb-0" style="font-size:.9rem;"></p>' +
      '<div id="cuadranteDeleteError" class="mt-3"></div>' +
      (_.renderConfirmSwitchBlock
        ? _.renderConfirmSwitchBlock({
            title: 'Borrar',
            description: 'Confirma que quieres eliminar este cuadrante',
            switchId: 'cuadranteDeleteConfirmSwitch',
            labelId: 'cuadranteDeleteConfirmLabel',
            initialLabel: 'No',
          })
        : '<div class="form-check form-switch mt-3 mb-0">' +
          '<input class="form-check-input" type="checkbox" role="switch" id="cuadranteDeleteConfirmSwitch">' +
          '<label class="form-check-label ms-1" for="cuadranteDeleteConfirmSwitch" id="cuadranteDeleteConfirmLabel">No</label>' +
          '</div>') +
      '</div>' +
      '<div class="modal-footer d-flex justify-content-between align-items-center">' +
      '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>' +
      '<button type="button" class="btn btn-danger" id="btnConfirmDeleteCuadrante"><i class="bi bi-trash me-1"></i>Eliminar</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';

    document.body.appendChild(wrapper.firstChild);
    let modal = document.getElementById('cuadranteConfirmDeleteModal');
    _.makeModalDraggable(modal);
    return modal;
  }

  function openDeleteModal(cuadrante) {
    if (guardReadOnlyAction()) return;
    let modalEl = ensureDeleteModal();
    let modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    let confirmBtn = document.getElementById('btnConfirmDeleteCuadrante');
    let nombreEl = document.getElementById('cuadranteDeleteNombre');
    let rangoEl = document.getElementById('cuadranteDeleteRango');
    let errorEl = document.getElementById('cuadranteDeleteError');
    let confirmSwitch = document.getElementById('cuadranteDeleteConfirmSwitch');
    let confirmLabel = document.getElementById('cuadranteDeleteConfirmLabel');
    let toolbarSel = document.getElementById('asigCuadrante');
    let wasActiveInGrid =
      // @ts-ignore
      Number((toolbarSel || {}).value) === Number(cuadrante && cuadrante.id);

    if (nombreEl)
      nombreEl.textContent =
        cuadrante && cuadrante.nombre ? cuadrante.nombre : 'Cuadrante';
    if (rangoEl) {
      rangoEl.textContent = cuadrante
        ? cuadrante.fecha_inicio +
          ' → ' +
          cuadrante.fecha_fin +
          ' · ' +
          cuadrante.num_semanas +
          ' semanas'
        : '';
    }

    if (errorEl) errorEl.innerHTML = '';
    if (_.resetConfirmSwitchState) {
      _.resetConfirmSwitchState({
        switchEl: confirmSwitch,
        labelEl: confirmLabel,
        buttonEl: confirmBtn,
        errorEl: errorEl,
        inactiveText: 'No',
      });
    } else {
      // @ts-ignore
      if (confirmSwitch) confirmSwitch.checked = false;
      if (confirmLabel) confirmLabel.textContent = 'No';
      // @ts-ignore
      if (confirmBtn) confirmBtn.disabled = true;
    }
    if (_.bindConfirmSwitch) {
      _.bindConfirmSwitch({
        switchEl: confirmSwitch,
        labelEl: confirmLabel,
        buttonEl: confirmBtn,
        activeText: 'Sí',
        inactiveText: 'No',
      });
    } else if (confirmSwitch) {
      confirmSwitch.onchange = function () {
        // @ts-ignore
        let accepted = !!confirmSwitch.checked;
        if (confirmLabel) confirmLabel.textContent = accepted ? 'Sí' : 'No';
        // @ts-ignore
        if (confirmBtn) confirmBtn.disabled = !accepted;
      };
    }

    let handler = async function () {
      // @ts-ignore
      if (confirmSwitch && !confirmSwitch.checked) return;
      try {
        if (errorEl) errorEl.innerHTML = '';
        // @ts-ignore
        confirmBtn.disabled = true;
        let r = await fetch('/api/cuadrantes/' + cuadrante.id, {
          method: 'DELETE',
          headers: headers(),
        });
        if (!r.ok) {
          let errorJson = null;
          try {
            errorJson = await r.json();
          } catch (_ignore) {
            errorJson = null;
          }
          throw new Error(
            (errorJson && errorJson.message) || 'Error al eliminar el cuadrante'
          );
        }
        confirmBtn.removeEventListener('click', handler);
        modal.hide();
        state.selectedId = null;
        if (wasActiveInGrid) {
          await loadCuadrantes({
            allowAutoSelect: false,
            reloadAsignacionesWhenCleared: true,
          });
        } else {
          await loadCuadrantes();
        }
        let detalleEl = document.getElementById('cuadranteDetalle');
        if (detalleEl)
          detalleEl.innerHTML =
            '<div class="text-center text-muted py-5">Cuadrante eliminado</div>';
      } catch (e) {
        if (errorEl) {
          errorEl.innerHTML =
            '<div class="alert alert-danger py-1 small mb-0">' +
            app.escapeHtml(e.message) +
            '</div>';
        }
        let alertEl = document.getElementById('cuadranteDetalleAlert');
        renderDismissibleAlert(alertEl, 'danger', e.message, 'py-1 small mt-2');
        // @ts-ignore
        confirmBtn.disabled = !(confirmSwitch && confirmSwitch.checked);
      }
    };

    modalEl.addEventListener('hide.bs.modal', function cleanup() {
      confirmBtn.removeEventListener('click', handler);
      modalEl.removeEventListener('hide.bs.modal', cleanup);
    });

    confirmBtn.addEventListener('click', handler);
    modal.show();
    applyConsultaReadOnlyUi();
  }

  // ── Formulario de nuevo cuadrante ─────────────────────────────

  function renderFormNuevo() {
    if (guardReadOnlyAction()) return;
    let p = _.getPeriodo();
    let detalle = document.getElementById('cuadranteDetalle');
    if (!detalle) return;

    detalle.innerHTML =
      '<h6 class="fw-semibold mb-2" style="font-size:.82rem;"><i class="bi bi-plus-circle me-1"></i>Nuevo cuadrante</h6>' +
      '<div class="row g-0 ms-2">' +
      /* ── Columna izquierda: campos ── */
      '<div class="col-5 pe-3 border-end">' +
      '<div class="row g-2 mb-2">' +
      '<div class="col-6">' +
      '<label class="form-label small mb-1">Mes referencia</label>' +
      '<select id="cuadranteMesReferencia" class="form-select form-select-sm">' +
      buildMesReferenciaOptions(p.mes) +
      '</select>' +
      '</div>' +
      '<div class="col-6">' +
      '<label class="form-label small mb-1">Año referencia</label>' +
      '<select id="cuadranteAnioReferencia" class="form-select form-select-sm">' +
      buildAnioReferenciaOptions(p.anio) +
      '</select>' +
      '</div>' +
      '</div>' +
      '<div class="mb-2">' +
      '<label class="form-label small mb-1">Fecha inicio <span class="text-muted" style="font-size:.65rem;">(lunes)</span></label>' +
      '<input type="date" id="cuadranteFechaInicio" class="form-control form-control-sm">' +
      '</div>' +
      '<div class="mb-2">' +
      '<label class="form-label small mb-1">Semanas</label>' +
      '<select id="cuadranteNumSemanas" class="form-select form-select-sm">' +
      '<option value="">Selecciona semanas</option>' +
      '<option value="3">3 Semanas</option>' +
      '<option value="4">4 Semanas</option>' +
      '<option value="5">5 Semanas</option>' +
      '<option value="6">6 Semanas</option>' +
      '<option value="7">7 Semanas</option>' +
      '</select>' +
      '</div>' +
      '<div class="mb-2">' +
      '<label class="form-label small mb-1">Fecha fin <span class="text-muted" style="font-size:.65rem;">(calculada)</span></label>' +
      '<input type="date" id="cuadranteFechaFin" class="form-control form-control-sm" readonly>' +
      '</div>' +
      '<div class="mb-2">' +
      '<label class="form-label small mb-1">Nombre</label>' +
      '<input type="text" id="cuadranteNombre" class="form-control form-control-sm" placeholder="(se genera automáticamente)">' +
      '</div>' +
      '<div class="mb-0">' +
      '<label class="form-label small mb-1">Descripción</label>' +
      '<textarea id="cuadranteDescripcion" class="form-control form-control-sm" rows="2"></textarea>' +
      '</div>' +
      '</div>' +
      /* ── Columna derecha: preview + acciones ── */
      '<div class="col-7 ps-3 d-flex flex-column">' +
      '<div id="cuadrantePreviewInfo" class="mb-1 small text-muted"></div>' +
      '<div id="cuadrantePreviewContainer" class="flex-grow-1 mb-2"></div>' +
      '<div id="cuadranteFormAlert" class="mb-1"></div>' +
      '<div class="d-flex gap-2">' +
      '<button id="btnGuardarCuadrante" class="btn btn-primary btn-sm">' +
      '<i class="bi bi-check2 me-1"></i>Crear cuadrante</button>' +
      '</div>' +
      '</div>' +
      '</div>';

    let semanasEl = document.getElementById('cuadranteNumSemanas');
    let fechaInicioEl = document.getElementById('cuadranteFechaInicio');
    let mesReferenciaEl = document.getElementById('cuadranteMesReferencia');
    let anioReferenciaEl = document.getElementById('cuadranteAnioReferencia');

    function autoPreview() {
      loadPreview();
    }
    if (semanasEl) semanasEl.addEventListener('change', autoPreview);
    if (fechaInicioEl) fechaInicioEl.addEventListener('change', autoPreview);
    if (fechaInicioEl) fechaInicioEl.addEventListener('input', autoPreview);
    if (mesReferenciaEl)
      mesReferenciaEl.addEventListener('change', autoPreview);
    if (anioReferenciaEl)
      anioReferenciaEl.addEventListener('change', autoPreview);

    document
      .getElementById('btnGuardarCuadrante')
      .addEventListener('click', guardarCuadrante);

    loadPreview();
    applyConsultaReadOnlyUi();
  }

  async function loadPreview() {
    let numSemanas =
      // @ts-ignore
      Number(document.getElementById('cuadranteNumSemanas').value) || null;
    let fechaInicio =
      // @ts-ignore
      (document.getElementById('cuadranteFechaInicio') || {}).value || '';
    let mesReferencia =
      // @ts-ignore
      Number((document.getElementById('cuadranteMesReferencia') || {}).value) ||
      null;
    let anioReferencia =
      Number(
        // @ts-ignore
        (document.getElementById('cuadranteAnioReferencia') || {}).value
      ) || null;
    let fechaFinEl = document.getElementById('cuadranteFechaFin');
    let infoEl = document.getElementById('cuadrantePreviewInfo');
    let containerEl = document.getElementById('cuadrantePreviewContainer');

    if (!fechaInicio || !numSemanas || !mesReferencia || !anioReferencia) {
      state.preview = null;
      // @ts-ignore
      if (fechaFinEl) fechaFinEl.value = '';
      if (containerEl) containerEl.innerHTML = '';
      if (infoEl)
        infoEl.textContent =
          'Seleccione fecha de inicio, semanas y periodo de referencia';
      updateCreateButtonState();
      return;
    }

    if (!DateTime) {
      state.preview = null;
      if (infoEl)
        infoEl.textContent = 'Luxon no está disponible para calcular fechas';
      if (containerEl) {
        containerEl.innerHTML =
          '<div class="alert alert-warning py-1 small">Luxon no está disponible para calcular fechas.</div>';
      }
      updateCreateButtonState();
      return;
    }

    let start = DateTime.fromISO(fechaInicio, { zone: 'utc' });
    if (!start.isValid) return;
    let fechaFin = start.plus({ days: numSemanas * 7 - 1 }).toISODate();
    // @ts-ignore
    if (fechaFinEl) fechaFinEl.value = fechaFin;

    try {
      let qs =
        'fecha_inicio=' +
        encodeURIComponent(fechaInicio) +
        '&fecha_fin=' +
        encodeURIComponent(fechaFin) +
        '&mes_referencia=' +
        encodeURIComponent(mesReferencia) +
        '&anio_referencia=' +
        encodeURIComponent(anioReferencia);
      let res = await fetch('/api/cuadrantes/preview?' + qs, {
        headers: headers(),
      });

      // Proteger contra respuestas HTML (404, etc.)
      let contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(
          'El endpoint /api/cuadrantes no está disponible. ¿Registraste la ruta en app.js?'
        );
      }

      if (!res.ok) {
        let errJson = await res.json();
        throw new Error(errJson.message || 'Error al generar preview');
      }
      let json = await res.json();
      state.preview = json.data;

      let nombreEl = document.getElementById('cuadranteNombre');
      // @ts-ignore
      if (nombreEl && !nombreEl.value.trim())
        // @ts-ignore
        nombreEl.value = state.preview.nombre;

      // Rellenar fecha inicio y fin
      let fechaInicioEl = document.getElementById('cuadranteFechaInicio');
      // @ts-ignore
      if (fechaInicioEl) fechaInicioEl.value = state.preview.fecha_inicio;
      // @ts-ignore
      if (fechaFinEl) fechaFinEl.value = state.preview.fecha_fin;

      if (infoEl) {
        infoEl.textContent =
          state.preview.fecha_inicio +
          ' → ' +
          state.preview.fecha_fin +
          ' · ' +
          state.preview.num_semanas +
          ' semanas · ' +
          state.preview.dias.length +
          ' días · ref. ' +
          MESES_REFERENCIA[state.preview.mes_referencia - 1] +
          ' ' +
          state.preview.anio_referencia;
      }

      updateCreateButtonState();

      if (containerEl && typeof window.renderCuadrantePreview === 'function') {
        window.renderCuadrantePreview(
          'cuadrantePreviewContainer',
          state.preview
        );
      } else if (containerEl) {
        containerEl.innerHTML =
          '<div class="alert alert-warning py-1 small">No se pudo renderizar el preview de cuadrante.</div>';
      }
    } catch (e) {
      state.preview = null;
      updateCreateButtonState();
      if (infoEl) infoEl.textContent = 'Error: ' + e.message;
      if (containerEl)
        containerEl.innerHTML =
          '<div class="alert alert-warning py-1 small">' +
          app.escapeHtml(e.message) +
          '</div>';
    }
  }

  async function guardarCuadrante() {
    if (guardReadOnlyAction()) return;
    let alertEl = document.getElementById('cuadranteFormAlert');
    let numSemanas =
      // @ts-ignore
      Number(document.getElementById('cuadranteNumSemanas').value) || null;
    let fechaInicio =
      // @ts-ignore
      (document.getElementById('cuadranteFechaInicio').value || '').trim() ||
      null;
    let fechaFin =
      // @ts-ignore
      (document.getElementById('cuadranteFechaFin').value || '').trim() || null;
    let mesReferencia =
      // @ts-ignore
      Number((document.getElementById('cuadranteMesReferencia') || {}).value) ||
      null;
    let anioReferencia =
      Number(
        // @ts-ignore
        (document.getElementById('cuadranteAnioReferencia') || {}).value
      ) || null;
    let nombre =
      // @ts-ignore
      document.getElementById('cuadranteNombre').value.trim() || null;
    let descripcion =
      // @ts-ignore
      document.getElementById('cuadranteDescripcion').value.trim() || null;

    if (
      !fechaInicio ||
      !numSemanas ||
      !fechaFin ||
      !mesReferencia ||
      !anioReferencia
    ) {
      renderDismissibleAlert(
        alertEl,
        'warning',
        'Fecha inicio, semanas, mes y año de referencia son obligatorios',
        'py-1 small'
      );
      return;
    }

    if (!hasReferenceDays(state.preview)) {
      renderDismissibleAlert(
        alertEl,
        'warning',
        'La referencia seleccionada debe aparecer dentro del rango del cuadrante.',
        'py-1 small'
      );
      updateCreateButtonState();
      return;
    }

    try {
      let res = await fetch('/api/cuadrantes', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          num_semanas: numSemanas,
          fecha_inicio: fechaInicio,
          fecha_fin: fechaFin,
          mes_referencia: mesReferencia,
          anio_referencia: anioReferencia,
          nombre: nombre,
          descripcion: descripcion,
        }),
      });
      let json = await res.json();
      if (!res.ok)
        throw new Error((json && json.message) || 'Error al crear cuadrante');
      renderDismissibleAlert(
        alertEl,
        'success',
        'Cuadrante creado correctamente',
        'py-1 small'
      );
      await loadCuadrantes();
      if (json.data && json.data.id) selectCuadrante(json.data.id);
    } catch (e) {
      renderDismissibleAlert(alertEl, 'danger', e.message, 'py-1 small');
    }
  }

  // ── Lista de cuadrantes ───────────────────────────────────────

  async function loadCuadrantes(options) {
    try {
      let res = await fetch('/api/cuadrantes', { headers: headers() });
      if (!res.ok) throw new Error('Error al cargar cuadrantes');
      let json = await res.json();
      state.cuadrantes = json.data || [];
      renderList();
      await loadCuadranteSelector(options || {});
    } catch (e) {
      console.error('[cuadrantes]', e);
    }
  }

  function renderList() {
    let container = document.getElementById('cuadrantesListContainer');
    if (!container) return;

    if (!state.cuadrantes.length) {
      container.innerHTML =
        '<div class="text-center text-muted py-4 small">No hay cuadrantes. Cree uno nuevo.</div>';
      return;
    }

    let ESTADO_BADGE = {
      borrador: 'bg-warning text-dark',
      activo: 'bg-success',
      archivado: 'bg-secondary',
    };

    container.innerHTML = state.cuadrantes
      .map(function (c) {
        let isActive = Number(c.id) === Number(state.selectedId);
        let activeBg = isActive
          ? 'background:#e3f2fd;border-left:3px solid #1976d2;'
          : '';
        let badge = ESTADO_BADGE[c.estado] || 'bg-secondary';
        let itemShift = 'margin-left:8px;width:calc(100% - 8px);';
        return (
          '<a href="#" class="list-group-item list-group-item-action py-2" style="' +
          itemShift +
          activeBg +
          '" data-cuadrante-id="' +
          c.id +
          '">' +
          '<div>' +
          '<div class="fw-semibold small">' +
          app.escapeHtml(c.nombre) +
          '</div>' +
          '<div style="font-size:.7rem;color:#757575;">' +
          c.fecha_inicio +
          ' → ' +
          c.fecha_fin +
          ' · ' +
          c.num_semanas +
          ' sem.' +
          '</div>' +
          '<div class="d-flex justify-content-end mt-1">' +
          '<span class="badge ' +
          badge +
          '" style="font-size:.65rem;">' +
          app.escapeHtml(c.estado) +
          '</span>' +
          '</div>' +
          '</div>' +
          '</a>'
        );
      })
      .join('');

    container.querySelectorAll('[data-cuadrante-id]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        // @ts-ignore
        selectCuadrante(Number(el.dataset.cuadranteId));
      });
    });
  }

  // ── Detalle de cuadrante ──────────────────────────────────────

  async function selectCuadrante(id) {
    state.selectedId = id;
    renderList();

    let detalle = document.getElementById('cuadranteDetalle');
    if (!detalle) return;
    detalle.innerHTML =
      '<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div></div>';

    try {
      let res = await fetch('/api/cuadrantes/' + id, { headers: headers() });
      if (!res.ok) throw new Error('Error al cargar cuadrante');
      let json = await res.json();
      let c = json.data;

      detalle.innerHTML =
        '<div class="d-flex justify-content-between align-items-start mb-3">' +
        '<div>' +
        '<h6 class="fw-semibold mb-1">' +
        app.escapeHtml(c.nombre) +
        '</h6>' +
        '<div class="small text-muted">' +
        c.fecha_inicio +
        ' → ' +
        c.fecha_fin +
        ' · ' +
        c.num_semanas +
        ' semanas · ' +
        (c.dias || []).length +
        ' días' +
        '</div>' +
        (c.descripcion
          ? '<div class="small text-muted mt-1">' +
            app.escapeHtml(c.descripcion) +
            '</div>'
          : '') +
        '</div>' +
        '<span class="badge ' +
        ({
          borrador: 'bg-warning text-dark',
          activo: 'bg-success',
          archivado: 'bg-secondary',
        }[c.estado] || 'bg-secondary') +
        '">' +
        app.escapeHtml(c.estado) +
        '</span>' +
        '</div>' +
        '<div id="cuadranteDetallePreview" class="mb-3"></div>' +
        '<div id="cuadranteDetalleAlert"></div>' +
        '<div class="d-flex gap-2">' +
        (c.estado === 'borrador'
          ? '<button id="btnActivarCuadrante" class="btn btn-success btn-sm"><i class="bi bi-check-circle me-1"></i>Activar</button>'
          : '') +
        (c.estado !== 'archivado'
          ? '<button id="btnArchivarCuadrante" class="btn btn-outline-secondary btn-sm"><i class="bi bi-archive me-1"></i>Archivar</button>'
          : '') +
        (c.estado === 'borrador'
          ? '<button id="btnEliminarCuadrante" class="btn btn-outline-danger btn-sm"><i class="bi bi-trash me-1"></i>Eliminar</button>'
          : '') +
        '</div>';

      // Render preview
      if (c.dias && c.dias.length) {
        let previewContainer = document.getElementById(
          'cuadranteDetallePreview'
        );
        if (typeof window.renderCuadrantePreview === 'function') {
          window.renderCuadrantePreview('cuadranteDetallePreview', c);
        } else if (previewContainer) {
          previewContainer.innerHTML =
            '<div class="alert alert-warning py-1 small">No se pudo renderizar el preview de cuadrante.</div>';
        }
      }

      // Bind acciones
      let alertEl = document.getElementById('cuadranteDetalleAlert');

      let btnActivar = document.getElementById('btnActivarCuadrante');
      if (btnActivar) {
        btnActivar.addEventListener('click', async function () {
          if (guardReadOnlyAction()) return;
          try {
            let r = await fetch('/api/cuadrantes/' + id, {
              method: 'PUT',
              headers: headers(),
              body: JSON.stringify({ estado: 'activo' }),
            });
            let payload = null;
            try {
              payload = await r.json();
            } catch (_e) {
              payload = null;
            }
            if (!r.ok)
              throw new Error(
                (payload && payload.message) || 'Error al activar'
              );
            renderDismissibleAlert(
              alertEl,
              'success',
              'Cuadrante activado',
              'py-1 small mt-2'
            );
            await handleCuadranteActivado(id, {
              waitForModalHidden: true,
              source: 'cuadrante_activado',
            });
          } catch (e) {
            renderDismissibleAlert(
              alertEl,
              'danger',
              e.message,
              'py-1 small mt-2'
            );
          }
        });
      }

      let btnArchivar = document.getElementById('btnArchivarCuadrante');
      if (btnArchivar) {
        btnArchivar.addEventListener('click', async function () {
          if (guardReadOnlyAction()) return;
          try {
            let r = await fetch('/api/cuadrantes/' + id, {
              method: 'PUT',
              headers: headers(),
              body: JSON.stringify({ estado: 'archivado' }),
            });
            if (!r.ok) throw new Error('Error al archivar');
            await loadCuadrantes();
            selectCuadrante(id);
          } catch (e) {
            renderDismissibleAlert(
              alertEl,
              'danger',
              e.message,
              'py-1 small mt-2'
            );
          }
        });
      }

      let btnEliminar = document.getElementById('btnEliminarCuadrante');
      if (btnEliminar) {
        btnEliminar.addEventListener('click', async function () {
          if (guardReadOnlyAction()) return;
          openDeleteModal(c);
        });
      }

      applyConsultaReadOnlyUi();
    } catch (e) {
      detalle.innerHTML =
        '<div class="text-center text-danger py-4">' +
        app.escapeHtml(e.message) +
        '</div>';
    }
  }

  // ── Selector en la toolbar de asignaciones ────────────────────

  function syncCuadranteAPeriodo(c) {
    let anioEl = document.getElementById('asigAnio');
    let mesEl = document.getElementById('asigMes');
    if (c) {
      // @ts-ignore
      if (anioEl) anioEl.value = c.anio_referencia;
      // @ts-ignore
      if (mesEl) mesEl.value = c.mes_referencia;
    }
  }

  function setHeaderActionsDisabled(disabled) {
    let buttonIds = [
      'btnEditObservacionesBorrador',
      'btnAsigNuevoBorrador',
      'btnAsigDeleteBorrador',
      'btnAsigBulk',
      'btnAsigDelete',
      'btnAsigCopy',
      'btnAsigHistorial',
      'btnAsigValidate',
      'btnReloadAsignaciones',
    ];

    buttonIds.forEach(function (id) {
      let el = document.getElementById(id);
      if (!el) return;
      // @ts-ignore
      el.disabled = !!disabled;
      if (disabled) el.classList.add('disabled');
      else el.classList.remove('disabled');
    });

    let borradorSel = document.getElementById('asigBorrador');
    // @ts-ignore
    if (borradorSel) borradorSel.disabled = !!disabled;
  }

  async function handleCuadranteActivado(cuadranteId, options) {
    options = options || {};
    let id = Number(cuadranteId) || null;
    if (!id) return;

    let source = String(options.source || 'cuadrante_activado');
    let waitForModalHidden = options.waitForModalHidden !== false;

    await loadCuadrantes();
    selectCuadrante(id);

    let asigCuadranteSel = /** @type {HTMLSelectElement | null} */ (
      document.getElementById('asigCuadrante')
    );
    if (asigCuadranteSel) {
      asigCuadranteSel.value = String(id);
    }

    await applyCuadranteSelection(id, false);

    if (typeof app.openAsignacionesValidarModal !== 'function') {
      _.showAlert(
        'Cuadrante activado. No se pudo abrir el onboarding de descansos especiales.',
        'warning'
      );
      return;
    }

    let launchOnboarding = async function () {
      await app.openAsignacionesValidarModal({
        mode: 'onboarding',
        source: source,
        onSaved: async function () {
          if (typeof loadCuadrantes === 'function') {
            await loadCuadrantes();
          }
        },
      });
    };

    let shouldWaitHidden =
      waitForModalHidden &&
      !!(
        _modalEl &&
        _modalEl.classList &&
        _modalEl.classList.contains('show')
      );

    if (shouldWaitHidden && _modalEl) {
      await new Promise(function (resolve) {
        let resolved = false;
        let finish = function () {
          if (resolved) return;
          resolved = true;
          resolve();
        };

        _modalEl.addEventListener('hidden.bs.modal', finish, { once: true });
        bootstrap.Modal.getOrCreateInstance(_modalEl).hide();

        // Fallback: si el evento hidden no llega por cualquier motivo, continuamos.
        setTimeout(finish, 500);
      });
    }

    await launchOnboarding();
  }

  app.handleCuadranteActivado = handleCuadranteActivado;

  async function applyCuadranteSelection(cuadranteId, reloadAsignaciones) {
    let id = Number(cuadranteId) || null;

    if (!id) {
      app.asignacionesState.cuadranteSeleccionado = null;
      syncCuadranteAPeriodo(null);
      setHeaderActionsDisabled(true);
      if (reloadAsignaciones) {
        await app.loadAsignacionesCuadrante();
      }
      return;
    }

    try {
      let res = await fetch('/api/cuadrantes/' + id, { headers: headers() });
      if (!res.ok) throw new Error('Error al cargar cuadrante');
      let json = await res.json();
      app.asignacionesState.cuadranteSeleccionado = json.data;
      syncCuadranteAPeriodo(json.data);
      setHeaderActionsDisabled(false);

      if (reloadAsignaciones) {
        await app.loadAsignacionesBorradores();
        await app.loadAsignacionesCuadrante();
      }
    } catch (e) {
      _.showAlert(e.message, 'danger');
      app.asignacionesState.cuadranteSeleccionado = null;
      syncCuadranteAPeriodo(null);
      setHeaderActionsDisabled(true);
      if (reloadAsignaciones) {
        await app.loadAsignacionesCuadrante();
      }
    }
  }

  async function loadCuadranteSelector(options) {
    options = options || {};
    let allowAutoSelect = options.allowAutoSelect !== false;
    let reloadAsignacionesWhenCleared =
      options.reloadAsignacionesWhenCleared === true;

    let sel = document.getElementById('asigCuadrante');
    if (!sel) return;

    let activos = state.cuadrantes.filter(function (c) {
      return String((c && c.estado) || '').toLowerCase() === 'activo';
    });
    let currentSelectedId =
      // @ts-ignore
      Number(sel.value) ||
      Number((app.asignacionesState.cuadranteSeleccionado || {}).id) ||
      null;

    if (!activos.length) {
      sel.innerHTML = '<option value="">— Sin cuadrantes activos —</option>';
      // @ts-ignore
      sel.value = '';
      // @ts-ignore
      sel.disabled = true;
      app.asignacionesState.cuadranteSeleccionado = null;
      syncCuadranteAPeriodo(null);
      setHeaderActionsDisabled(true);
      if (reloadAsignacionesWhenCleared) {
        await app.loadAsignacionesCuadrante();
      }
      return;
    }

    // @ts-ignore
    sel.disabled = false;

    let opts = '<option value="">— Selecciona un cuadrante —</option>';
    activos.forEach(function (c) {
      let label = c.nombre + ' · ' + c.fecha_inicio + ' → ' + c.fecha_fin;
      opts +=
        '<option value="' + c.id + '">' + app.escapeHtml(label) + '</option>';
    });
    sel.innerHTML = opts;

    let selectedFromList = activos.find(function (c) {
      return Number(c.id) === Number(currentSelectedId);
    });

    if (selectedFromList) {
      // @ts-ignore
      sel.value = String(selectedFromList.id);
      syncCuadranteAPeriodo(selectedFromList);
      setHeaderActionsDisabled(false);
      return;
    }

    if (!allowAutoSelect) {
      // @ts-ignore
      sel.value = '';
      app.asignacionesState.cuadranteSeleccionado = null;
      syncCuadranteAPeriodo(null);
      setHeaderActionsDisabled(true);
      if (reloadAsignacionesWhenCleared) {
        await app.loadAsignacionesCuadrante();
      }
      return;
    }

    // Auto-seleccionar el primero y cargar asignaciones automáticamente.
    // @ts-ignore
    sel.value = String(activos[0].id);
    await applyCuadranteSelection(activos[0].id, true);
  }

  // ── Binding del botón principal ───────────────────────────────

  app.setupCuadrantesListeners = function setupCuadrantesListeners() {
    let gestionBtn = document.getElementById('btnGestionCuadrantes');
    if (gestionBtn && gestionBtn.dataset.bound !== '1') {
      gestionBtn.dataset.bound = '1';
      gestionBtn.addEventListener('click', async function () {
        let modalEl = ensureModal();
        state.selectedId = null;
        await loadCuadrantes();

        // Reset detalle
        let detalle = document.getElementById('cuadranteDetalle');
        if (detalle) {
          detalle.innerHTML =
            '<div class="text-center text-muted py-5">' +
            '<i class="bi bi-arrow-left-circle" style="font-size:2rem;"></i>' +
            '<p class="mt-2">Seleccione un cuadrante o cree uno nuevo</p>' +
            '</div>';
        }

        bootstrap.Modal.getOrCreateInstance(modalEl).show();
        applyConsultaReadOnlyUi();
      });
    }

    // Botón "Nuevo" dentro del modal
    document.addEventListener('click', function (e) {
      // @ts-ignore
      if (e.target && e.target.id === 'btnNuevoCuadrante') {
        if (guardReadOnlyAction()) return;
        state.selectedId = null;
        renderList();
        renderFormNuevo();
      }
    });

    // Selector de cuadrante en toolbar
    let cuadSel = document.getElementById('asigCuadrante');
    if (cuadSel && cuadSel.dataset.bound !== '1') {
      cuadSel.dataset.bound = '1';
      cuadSel.addEventListener('change', async function () {
        // @ts-ignore
        await applyCuadranteSelection(cuadSel.value, true);
      });
    }

    // Cargar cuadrantes al iniciar para rellenar el selector de la toolbar
    loadCuadrantes();
  };

  // ── Auto-init cuando se carga el módulo de asignaciones ───────
  let _origSetup = app.setupAsignacionesEventListeners;
  app.setupAsignacionesEventListeners = function () {
    if (typeof _origSetup === 'function') _origSetup();
    return app.setupCuadrantesListeners();
  };
})();
