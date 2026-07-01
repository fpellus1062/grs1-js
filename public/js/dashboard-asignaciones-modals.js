/* ========================================================================
 *  dashboard-asignaciones-modals.js
 *  Modales (ensure*, fill*, openCellModal) y helpers de celda.
 * ======================================================================== */
(function () {
  let app = window.GRS1Dashboard;
  let _ = app._asig || {};
  let ASIG_TURNO_CONSTANTE_ID = 1;

  // ── Helpers de celda (state + Tabulator) ────────────────────────

  function buildServiciosMap(serviciosRows, keyField) {
    let map = new Map();
    (serviciosRows || []).forEach(function (s) {
      let key = Number(s[keyField]);
      if (!map.has(key)) map.set(key, []);
      let actividadId = Number(s.actividad_id);
      let arr = map.get(key);
      // Guardia de duplicados: un mismo actividad_id no se agrega dos veces
      // por la misma clave (puede ocurrir cuando el cuadrante abarca varios meses).
      if (
        arr.some(function (item) {
          return item.id === actividadId;
        })
      )
        return;
      let codigo = String(s.actividad_codigo || '').trim();
      let nombre = String(s.actividad_nombre || '').trim();
      arr.push({
        id: actividadId,
        actividad:
          String(s.actividad || '').trim() ||
          codigo ||
          (Number.isFinite(actividadId) && actividadId > 0
            ? String(actividadId)
            : ''),
        label:
          codigo && nombre
            ? codigo + ' - ' + nombre
            : codigo || nombre || '#' + s.actividad_id,
      });
    });
    return map;
  }

  function updateStateFromUpsert(asignacion) {
    let cuadrante = app.asignacionesState.cuadrante;
    if (!cuadrante) return;
    let agenteId = Number(asignacion.agente_id);
    let fecha = String(asignacion.fecha).slice(0, 10);

    if (cuadrante.borrador) {
      let idx = -1;
      for (let i = 0; i < cuadrante.borrador.length; i++) {
        if (
          Number(cuadrante.borrador[i].agente_id) === agenteId &&
          String(cuadrante.borrador[i].fecha).slice(0, 10) === fecha
        ) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) {
        cuadrante.borrador[idx] = asignacion;
      } else {
        cuadrante.borrador.push(asignacion);
      }
    }

    if (cuadrante.borradorServicios) {
      cuadrante.borradorServicios = cuadrante.borradorServicios.filter(
        function (s) {
          return Number(s.asignacion_borrador_id) !== Number(asignacion.id);
        }
      );
      (asignacion.servicios || []).forEach(function (s) {
        cuadrante.borradorServicios.push({
          asignacion_borrador_id: asignacion.id,
          actividad_id: s.actividad_id,
          actividad_codigo: s.actividad_codigo,
          actividad_nombre: s.actividad_nombre,
        });
      });
    }
  }

  function updateCell(asignacion) {
    let agenteId = Number(asignacion.agente_id);
    let fecha = String(asignacion.fecha).slice(0, 10);
    updateStateFromUpsert(asignacion);

    if (!_.tabulator) return;
    let rows = _.tabulator.getRows();
    let row = null;
    for (let ri = 0; ri < rows.length; ri++) {
      if (Number(rows[ri].getData().agente_id) === agenteId) {
        row = rows[ri];
        break;
      }
    }
    if (!row) return;

    let tColor = asignacion.turno_color || '#6c757d';
    let tServs = asignacion.servicios || [];
    let tServsMapped = tServs.map(function (s) {
      let codigo = String(s.actividad_codigo || '').trim();
      let nombre = String(s.actividad_nombre || '').trim();
      return {
        id: Number(s.actividad_id),
        actividad:
          String(s.actividad || '').trim() ||
          codigo ||
          (Number(s.actividad_id) ? String(Number(s.actividad_id)) : ''),
        label:
          codigo && nombre
            ? codigo + ' - ' + nombre
            : codigo || nombre || '#' + s.actividad_id,
      };
    });
    let tObs = asignacion.observaciones || '';
    let updateObj = {};
    updateObj['dia_' + fecha] = {
      asignacionId: asignacion.id || null,
      turnoLabel: '',
      turnoColor: tColor,
      turno_id: Number(asignacion.turno_id),
      servicios: tServsMapped,
      actividad_ids: tServs.map(function (s) {
        return Number(s.actividad_id);
      }),
      observaciones: tObs || null,
      revision:
        asignacion.revision != null ? Number(asignacion.revision) : null,
    };
    row.update(updateObj);
  }

  function attachSelectFilter(inputEl, el) {
    if (!inputEl || !el) return;
    inputEl.addEventListener('input', function () {
      let term = _.normalizeSearchText(inputEl.value);
      if (el.tagName === 'SELECT') {
        for (let i = 0; i < el.options.length; i++) {
          let opt = el.options[i];
          opt.style.display =
            _.normalizeSearchText(opt.text).indexOf(term) !== -1 ? '' : 'none';
        }
      } else {
        let items = el.querySelectorAll('.asig-act-item');
        items.forEach(function (item) {
          let labelEl = item.querySelector('.asig-act-label');
          let text = labelEl ? labelEl.textContent : item.textContent;
          item.style.display =
            _.normalizeSearchText(text).indexOf(term) !== -1 ? '' : 'none';
        });
      }
    });
  }

  _.renderConfirmSwitchBlock = function renderConfirmSwitchBlock(options) {
    let opts = options || {};
    let title = String(opts.title || 'Aceptar');
    let description = String(opts.description || 'Confirma la acción');
    let switchId = String(opts.switchId || 'confirmSwitch');
    let labelId = String(opts.labelId || 'confirmSwitchLabel');
    let initialLabel = String(opts.initialLabel || 'No');

    return (
      '' +
      '<div class="d-flex align-items-center justify-content-between p-2 rounded border bg-white">' +
      '<div class="me-2">' +
      '<div class="fw-semibold" style="font-size:.9rem;">' +
      app.escapeHtml(title) +
      '</div>' +
      '<div class="text-muted" style="font-size:.82rem;">' +
      app.escapeHtml(description) +
      '</div>' +
      '</div>' +
      '<div class="form-check form-switch m-0">' +
      '<input class="form-check-input" type="checkbox" role="switch" id="' +
      app.escapeHtml(switchId) +
      '">' +
      '<label class="form-check-label ms-1" for="' +
      app.escapeHtml(switchId) +
      '" id="' +
      app.escapeHtml(labelId) +
      '">' +
      app.escapeHtml(initialLabel) +
      '</label>' +
      '</div>' +
      '</div>'
    );
  };

  _.resetConfirmSwitchState = function resetConfirmSwitchState(options) {
    let opts = options || {};
    let switchEl = opts.switchEl;
    let labelEl = opts.labelEl;
    let buttonEl = opts.buttonEl;
    let errorEl = opts.errorEl;
    let inactiveText = opts.inactiveText || 'No';

    if (errorEl) errorEl.innerHTML = '';
    if (switchEl) switchEl.checked = false;
    if (labelEl) labelEl.textContent = inactiveText;
    if (buttonEl) buttonEl.disabled = true;
  };

  _.bindConfirmSwitch = function bindConfirmSwitch(options) {
    let opts = options || {};
    let switchEl = opts.switchEl;
    let labelEl = opts.labelEl;
    let buttonEl = opts.buttonEl;
    let activeText = opts.activeText || 'Sí';
    let inactiveText = opts.inactiveText || 'No';
    if (!switchEl) return;

    switchEl.onchange = function () {
      let accepted = !!switchEl.checked;
      if (labelEl) labelEl.textContent = accepted ? activeText : inactiveText;
      if (buttonEl) buttonEl.disabled = !accepted;
    };
  };

  // ── Ensure modals ──────────────────────────────────────────────

  function ensureConfirmBorradorModal() {
    let existing = document.getElementById('asigConfirmDeleteBorradorModal');
    if (existing) return existing;
    let wrapper = document.createElement('div');
    wrapper.innerHTML =
      '<div class="modal fade" id="asigConfirmDeleteBorradorModal" tabindex="-1" aria-labelledby="asigConfirmDeleteBorradorLabel" aria-hidden="true">' +
      '<div class="modal-dialog modal-dialog-centered"><div class="modal-content modal-notion asig-modal-notion asig-modal-danger shadow-sm">' +
      '<div class="modal-header">' +
      '<h5 class="modal-title" id="asigConfirmDeleteBorradorLabel"><i class="bi bi-exclamation-triangle me-2"></i>Confirmar eliminación</h5>' +
      '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>' +
      '<div class="modal-body">' +
      '<div class="alert alert-warning mb-3"><strong>Atención:</strong> Para eliminar este borrador, todas las celdas deben estar vacías. Esta acción no se puede deshacer!</div>' +
      '<p class="mb-1"><strong>Borrador:</strong></p>' +
      '<div id="asigConfirmBorradorNombre" class="mb-3 p-2 bg-light rounded border" style="font-size:.95rem;"></div>' +
      '<p class="text-muted mb-0" style="font-size:.9rem;">¿Desea continuar con la eliminación?</p></div>' +
      '<div class="modal-footer d-flex justify-content-between align-items-center">' +
      '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>' +
      '<button type="button" class="btn btn-danger" id="btnConfirmDeleteBorrador"><i class="bi bi-trash me-1"></i>Eliminar</button>' +
      '</div></div></div></div>';
    document.body.appendChild(wrapper.firstChild);
    let modal = document.getElementById('asigConfirmDeleteBorradorModal');
    _.makeModalDraggable(modal);
    return modal;
  }

  function ensureAsignacionCellModal() {
    let existing = document.getElementById('asigCellModal');
    if (existing) existing.parentNode.removeChild(existing);
    let wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="modal fade" id="asigCellModal" tabindex="-1" aria-labelledby="asigCellModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-lg modal-dialog-centered"><div class="modal-content modal-notion asig-modal-notion shadow-sm">
          <div class="modal-header">
            <h5 class="modal-title" id="asigCellModalLabel"><i class="bi bi-calendar2-week me-2"></i>Editar asignación</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>
          <div class="modal-body">
            <div id="asigCellContext" class="text-muted mb-3" style="font-size:.98rem"></div>
            <div class="row g-2">
              <div class="d-none">
                <select id="asigCellTurno" class="form-select form-select-sm py-1" style="min-height:2.1em;"></select></div>
              <div class="col-12">
                <label class="form-label mb-1">Servicios/Actividades</label>
                <input type="text" id="asigCellFilterActividades" class="form-control form-control-sm mb-1" placeholder="Buscar actividad..." style="font-size:.85em">
                <div id="asigCellActividades" class="asig-act-list" style="min-height:200px;max-height:200px;overflow-y:auto;"></div>
                <div class="form-text" style="font-size:.85em">La fecha es la celda seleccionada del cuadrante. Ctrl/Cmd para selección múltiple.</div></div>
              <div class="col-12 mt-2">
                <label class="form-label mb-1">Observaciones</label>
                <textarea id="asigCellObservaciones" class="form-control form-control-sm" rows="2" maxlength="500" placeholder="Añadir observaciones..."></textarea></div>
            </div></div>
          <div class="modal-footer d-flex justify-content-between align-items-center">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>
            <button type="button" class="btn btn-primary" id="btnSaveAsigCell"><i class="bi bi-check2 me-1"></i>Guardar</button></div>
        </div></div></div>`;
    document.body.appendChild(wrapper.firstElementChild);
    let modal = document.getElementById('asigCellModal');
    _.makeModalDraggable(modal);
    return modal;
  }

  function ensureAsignacionesBulkModal() {
    let existing = document.getElementById('asigBulkModal');
    if (existing) return existing;
    let wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="modal fade" id="asigBulkModal" tabindex="-1" aria-labelledby="asigBulkModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-lg modal-dialog-centered"><div class="modal-content modal-notion asig-modal-notion shadow-sm">
          <div class="modal-header">
            <h5 class="modal-title" id="asigBulkModalLabel"><i class="bi bi-grid-3x3-gap me-2"></i>Asignación masiva</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>
          <div class="modal-body"><div class="row g-2">
            <div class="col-12 d-none" id="asigBulkSelectionWarningWrap">
              <div class="alert alert-warning py-1 mb-1" id="asigBulkSelectionWarning" style="font-size:.85em;">Debe seleccionar al menos un agente para aplicar la asignación masiva.</div></div>
            <div class="col-md-4">
              <label class="form-label mb-1">Agentes</label>
              <input type="text" id="asigBulkFilterAgentes" class="form-control form-control-sm mb-1" placeholder="Buscar agente..." style="font-size:.85em">
              <div class="d-flex align-items-center mb-1">
                <input type="checkbox" id="asigBulkCheckAllAgentes" class="form-check-input me-2">
                <label for="asigBulkCheckAllAgentes" class="form-check-label mb-0" style="cursor:pointer;font-size:.95em">Marcar todos</label></div>
              <select id="asigBulkAgentes" class="form-select form-select-sm py-1" multiple size="8" style="min-height:2.1em;"></select>
              <div id="asigBulkAgentesHint" class="form-text" style="font-size:.8em"></div>
              <div id="asigBulkSelectedCount" class="form-text" style="font-size:.8em"></div></div>
            <div class="col-md-4">
              <label class="form-label mb-1">Día(s)</label>
              <div class="d-flex align-items-center mb-1">
                <input type="checkbox" id="asigBulkCheckAllDias" class="form-check-input me-2">
                <label for="asigBulkCheckAllDias" class="form-check-label mb-0" style="cursor:pointer;font-size:.95em">Marcar todos</label></div>
              <select id="asigBulkDias" class="form-select form-select-sm py-1" multiple size="8" style="min-height:2.1em;"></select>
              <div id="asigBulkDiasMarcadosWrap" class="mt-2 d-none">
                <div class="form-text mb-1" style="font-size:.8em">Ya marcados</div>
                <select id="asigBulkDiasMarcados" class="form-select form-select-sm py-1" multiple size="5" style="min-height:2.1em;"></select>
              </div></div>
            <div class="col-md-4">
              <div class="d-none">
                <select id="asigBulkTurno" class="form-select form-select-sm py-1" style="min-height:2.1em;"></select>
              </div>
              <label class="form-label mb-1 mt-2">Servicios/Actividades</label>
              <input type="text" id="asigBulkFilterActividades" class="form-control form-control-sm mb-1" placeholder="Buscar actividad..." style="font-size:.85em">
              <div id="asigBulkActividades" class="asig-act-list" style="min-height:160px;max-height:160px;overflow-y:auto;"></div>
              <div class="form-text" style="font-size:.85em">Ctrl/Cmd para múltiple</div></div>
            <div class="col-12 mt-2">
              <label class="form-label mb-1">Observaciones</label>
              <textarea id="asigBulkObservaciones" class="form-control form-control-sm" rows="2" maxlength="500" placeholder="Añadir observaciones..."></textarea></div>
            <div class="col-12 mt-2 d-none" id="asigBulkProgressWrap">
              <div class="progress" role="progressbar" aria-label="Progreso de asignación masiva" aria-valuemin="0" aria-valuemax="100">
                <div id="asigBulkProgressBar" class="progress-bar progress-bar-striped progress-bar-animated" style="width:0%" aria-valuenow="0">0%</div></div>
              <div id="asigBulkProgressText" class="form-text mt-1">Procesando...</div></div>
          </div></div>
          <div class="modal-footer d-flex justify-content-between align-items-center">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>
            <button type="button" class="btn btn-primary" id="btnSaveAsigBulk"><i class="bi bi-check2 me-1"></i>Aplicar</button></div>
        </div></div></div>`;
    document.body.appendChild(wrapper.firstElementChild);
    let modal = document.getElementById('asigBulkModal');
    _.makeModalDraggable(modal);
    return modal;
  }

  function ensureAsignacionesDeleteModal() {
    let existing = document.getElementById('asigDeleteModal');
    if (existing) return existing;
    let wrapper = document.createElement('div');
    wrapper.innerHTML =
      '<div class="modal fade" id="asigDeleteModal" tabindex="-1" aria-labelledby="asigDeleteModalLabel" aria-hidden="true">' +
      '<div class="modal-dialog modal-dialog-centered"><div class="modal-content modal-notion asig-modal-notion asig-modal-danger shadow-sm">' +
      '<div class="modal-header">' +
      '<h5 class="modal-title" id="asigDeleteModalLabel"><i class="bi bi-eraser me-2"></i>Eliminar asignaciones</h5>' +
      '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>' +
      '<div class="modal-body">' +
      '<div class="alert alert-warning mb-3"><strong>Atención:</strong> Esta acción no se puede deshacer!.</div>' +
      '<label class="form-label mb-1">Agentes</label>' +
      '<input type="text" id="asigDeleteFilterAgentes" class="form-control form-control-sm mb-1" placeholder="Buscar agente..." style="font-size:.85em">' +
      '<div class="d-flex align-items-center mb-1">' +
      '<input type="checkbox" id="asigDeleteCheckAllAgentes" class="form-check-input me-2">' +
      '<label for="asigDeleteCheckAllAgentes" class="form-check-label mb-0" style="cursor:pointer;font-size:.95em">Marcar todos</label></div>' +
      '<select id="asigDeleteAgentes" class="form-select form-select-sm py-1" multiple size="8" style="min-height:2.1em;"></select>' +
      '<div id="asigDeleteAgentesHint" class="form-text"></div>' +
      '<label class="form-label mb-1 mt-2">Fechas visibles del cuadrante</label>' +
      '<div class="d-flex align-items-center mb-1">' +
      '<input type="checkbox" id="asigDeleteCheckAllFechas" class="form-check-input me-2">' +
      '<label for="asigDeleteCheckAllFechas" class="form-check-label mb-0" style="cursor:pointer;font-size:.95em">Marcar todas</label></div>' +
      '<div id="asigDeleteDates" class="d-flex gap-2 overflow-auto pb-2"></div>' +
      '<div id="asigDeleteDatesSummary" class="form-text">Seleccione una o varias fechas visibles del cuadrante.</div></div>' +
      '<div class="modal-footer d-flex justify-content-between align-items-center">' +
      '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>' +
      '<button type="button" class="btn btn-danger" id="btnRunAsigDelete"><i class="bi bi-trash me-1"></i>Eliminar</button></div>' +
      '</div></div></div>';
    document.body.appendChild(wrapper.firstChild);
    let modal = document.getElementById('asigDeleteModal');
    _.makeModalDraggable(modal);
    return modal;
  }

  function ensureAsignacionesCopyModal() {
    let existing = document.getElementById('asigCopyModal');
    if (existing) return existing;
    let wrapper = document.createElement('div');
    wrapper.innerHTML =
      '<div class="modal fade" id="asigCopyModal" tabindex="-1" aria-labelledby="asigCopyModalLabel" aria-hidden="true">' +
      '<div class="modal-dialog modal-lg modal-dialog-centered"><div class="modal-content modal-notion asig-modal-notion shadow-sm">' +
      '<div class="modal-header">' +
      '<h5 class="modal-title" id="asigCopyModalLabel"><i class="bi bi-files me-2"></i>Copiar mes</h5>' +
      '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>' +
      '<div class="modal-body"><div class="row g-2">' +
      '<div class="col-6"><label class="form-label mb-1">Origen año</label><input id="asigCopyOrigenAnio" type="number" class="form-control form-control-sm"></div>' +
      '<div class="col-6"><label class="form-label mb-1">Origen mes</label><select id="asigCopyOrigenMes" class="form-select form-select-sm"></select></div>' +
      '<div class="col-6"><label class="form-label mb-1">Destino año</label><input id="asigCopyDestinoAnio" type="number" class="form-control form-control-sm"></div>' +
      '<div class="col-6"><label class="form-label mb-1">Destino mes</label><select id="asigCopyDestinoMes" class="form-select form-select-sm"></select></div>' +
      '<div class="col-12 mt-2"><label class="form-label mb-1">Agentes (opcional)</label>' +
      '<select id="asigCopyAgentes" class="form-select form-select-sm py-1" multiple size="6" style="min-height:2.1em;"></select></div>' +
      '<div class="col-12 mt-2"><label class="form-label mb-1">Fechas visibles del cuadrante (opcional)</label>' +
      '<div class="d-flex align-items-center mb-1">' +
      '<input type="checkbox" id="asigCopyCheckAllFechas" class="form-check-input me-2">' +
      '<label for="asigCopyCheckAllFechas" class="form-check-label mb-0" style="cursor:pointer;font-size:.95em">Marcar todas</label></div>' +
      '<div id="asigCopyDates" class="d-flex gap-2 overflow-auto pb-2"></div>' +
      '<div id="asigCopyDatesSummary" class="form-text">Seleccione una o varias fechas visibles del cuadrante.</div></div>' +
      '</div></div>' +
      '<div class="modal-footer d-flex justify-content-between align-items-center">' +
      '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>' +
      '<button type="button" class="btn btn-primary" id="btnRunAsigCopy"><i class="bi bi-files me-1"></i>Copia Servicios</button></div>' +
      '</div></div></div>';
    document.body.appendChild(wrapper.firstChild);
    let modal = document.getElementById('asigCopyModal');
    _.makeModalDraggable(modal);
    return modal;
  }

  function ensureAsignacionesValidarModal() {
    let existing = document.getElementById('asigValidarModal');
    if (existing) return existing;
    let wrapper = document.createElement('div');
    wrapper.innerHTML =
      '<div class="modal fade" id="asigValidarModal" tabindex="-1" aria-labelledby="asigValidarModalLabel" aria-hidden="true">' +
      '<div class="modal-dialog modal-dialog-centered"><div class="modal-content modal-notion asig-modal-notion asig-modal-danger shadow-sm">' +
      '<div class="modal-header">' +
      '<h5 class="modal-title" id="asigValidarModalLabel"><i class="bi bi-exclamation-triangle me-2"></i>Validar borrador</h5>' +
      '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>' +
      '<div class="modal-body">' +
      '<div id="asigValidarModalContext" class="text-muted mb-2" style="font-size:.95rem;"></div>' +
      '<div class="alert alert-warning mb-3"><strong>Atención:</strong> Esta acción no se puede deshacer.</div>' +
      '<div id="asigValidarReglasWrap" class="d-none mb-3">' +
      '<div id="asigValidarReglasTitle" class="small fw-semibold mb-2">Reglas especiales candidatas</div>' +
      '<div id="asigValidarReglasHelp" class="text-muted small mb-2"></div>' +
      '<div id="asigValidarReglasStatus" class="small text-muted mb-2"></div>' +
      '<div id="asigValidarReglasList" class="border rounded-3 p-2 bg-white" style="max-height:16rem; overflow:auto;"></div>' +
      '</div>' +
      '<div id="asigValidarProgressWrap" class="d-none mb-3">' +
      '<div class="progress" role="progressbar" aria-label="Progreso de validación" aria-valuemin="0" aria-valuemax="100">' +
      '<div id="asigValidarProgressBar" class="progress-bar progress-bar-striped progress-bar-animated bg-danger" style="width:0%" aria-valuenow="0">0%</div></div>' +
      '<div id="asigValidarProgressText" class="form-text mt-1">Validando borrador...</div>' +
      '</div>' +
      _.renderConfirmSwitchBlock({
        title: 'Aceptar',
        description: 'Confirma que quieres validar este borrador',
        switchId: 'asigValidarAceptarSwitch',
        labelId: 'asigValidarAceptarLabel',
        initialLabel: 'No',
      }) +
      '</div>' +
      '<div class="modal-footer d-flex justify-content-between align-items-center">' +
      '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>' +
      '<button type="button" class="btn btn-danger" id="btnConfirmAsigValidar" disabled><i class="bi bi-check2-circle me-1"></i>Confirmar</button>' +
      '</div></div></div></div>';
    document.body.appendChild(wrapper.firstChild);
    let modal = document.getElementById('asigValidarModal');
    _.makeModalDraggable(modal);
    return modal;
  }

  // ── Fill helpers ────────────────────────────────────────────────

  function fillAgenteOptions(selectEl, options) {
    if (!selectEl) return;
    let opts = options || {};
    let onlySelectedForBulk = !!opts.onlySelectedForBulk;
    let preselectSelected = !!opts.preselectSelected;
    let selectedIds = new Set(
      (app.asignacionesState.selectedAgenteIdsVista || [])
        .concat(app.globalState.selectedAgenteIdsForBulk || [])
        .map(Number)
        .filter(function (id) {
          return Number.isFinite(id) && id > 0;
        })
    );
    let agentes =
      (app.asignacionesState.meta && app.asignacionesState.meta.agentes) || [];
    if (onlySelectedForBulk) {
      agentes = agentes.filter(function (a) {
        return selectedIds.has(Number(a.id_agente));
      });
    }
    selectEl.innerHTML = agentes
      .map(function (a) {
        let id = Number(a.id_agente);
        let label = (a.tip ? a.tip + ' · ' : '') + _.agenteNombre(a);
        return (
          '<option value="' +
          id +
          '">' +
          app.escapeHtml(label || 'Agente #' + id) +
          '</option>'
        );
      })
      .join('');

    if (opts.preselectAll) {
      for (let i = 0; i < selectEl.options.length; i++)
        selectEl.options[i].selected = true;
    } else if (preselectSelected) {
      for (let j = 0; j < selectEl.options.length; j++) {
        selectEl.options[j].selected = selectedIds.has(
          Number(selectEl.options[j].value)
        );
      }
    }
    if (opts.hintEl) {
      if (onlySelectedForBulk && !agentes.length) {
        opts.hintEl.textContent =
          'No hay agentes marcados en la vista de cuadrante.';
      } else if (onlySelectedForBulk) {
        opts.hintEl.textContent =
          'Se muestran ' + agentes.length + ' agente(s) seleccionados.';
      } else {
        opts.hintEl.textContent = '';
      }
    }
  }

  function fillTurnosOptions(selectEl) {
    if (!selectEl) return;
    let turnos =
      (app.asignacionesState.meta && app.asignacionesState.meta.turnos) || [];
    let fixedTurno = null;
    for (let ti = 0; ti < turnos.length; ti++) {
      if (Number(turnos[ti].id_turno) === ASIG_TURNO_CONSTANTE_ID) {
        fixedTurno = turnos[ti];
        break;
      }
    }
    let label = fixedTurno
      ? ((fixedTurno.codigo || '') + ' · ' + (fixedTurno.nombre || '')).trim()
      : 'Turno fijo (ID 1)';
    selectEl.innerHTML =
      '<option value="' +
      ASIG_TURNO_CONSTANTE_ID +
      '" selected>' +
      app.escapeHtml(label) +
      '</option>';
    selectEl.value = String(ASIG_TURNO_CONSTANTE_ID);
    selectEl.disabled = true;
    selectEl.setAttribute('aria-label', 'Turno fijo');
  }

  function fillActividadesOptions(containerEl, selectedIds) {
    if (!containerEl) return;
    let set = new Set((selectedIds || []).map(Number));
    let actividades =
      (app.asignacionesState.meta && app.asignacionesState.meta.actividades) ||
      [];
    containerEl.innerHTML = actividades
      .map(function (a) {
        let id = Number(a.id_actividad);
        let label = (a.codigo || '') + ' · ' + (a.nombre || '');
        let color = String(a.actividad_color || '').trim();
        let hasColor = /^#[0-9a-fA-F]{6}$/.test(color);
        let dotStyle = hasColor
          ? ' style="background:' + color + '"'
          : '';
        let dotClass = 'asig-act-dot' + (hasColor ? '' : ' asig-act-dot-empty');
        let selectedClass = set.has(id) ? ' selected' : '';
        return (
          '<div class="asig-act-item' + selectedClass + '" data-value="' + id + '" tabindex="-1">' +
          '<span class="' + dotClass + '"' + dotStyle + '></span>' +
          '<span class="asig-act-label">' + app.escapeHtml(label.trim()) + '</span>' +
          '</div>'
        );
      })
      .join('');
    let items = containerEl.querySelectorAll('.asig-act-item');
    items.forEach(function (item) {
      item.addEventListener('click', function (e) {
        if (e.ctrlKey || e.metaKey) {
          item.classList.toggle('selected');
        } else {
          items.forEach(function (i) { i.classList.remove('selected'); });
          item.classList.add('selected');
        }
      });
    });
  }

  // ── openAsignacionCellModal ─────────────────────────────────────

  app.openAsignacionCellModal = function openAsignacionCellModal(payload) {
    let modalEl = ensureAsignacionCellModal();
    if (!modalEl) {
      alert('No se pudo crear el modal de asignación.');
      return;
    }

    let contextEl = document.getElementById('asigCellContext');
    let turnoEl = document.getElementById('asigCellTurno');
    let actividadesEl = document.getElementById('asigCellActividades');
    let obsEl = document.getElementById('asigCellObservaciones');
    let saveBtn = document.getElementById('btnSaveAsigCell');
    if (!turnoEl || !actividadesEl || !obsEl || !saveBtn) return;

    let newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    let actualSaveBtn = document.getElementById('btnSaveAsigCell');

    let isConsultaReadOnly =
      typeof _.isConsultaReadOnlyRole === 'function' &&
      _.isConsultaReadOnlyRole();
    if (isConsultaReadOnly && actualSaveBtn) {
      // @ts-ignore
      actualSaveBtn.disabled = true;
      actualSaveBtn.classList.add('disabled');
      actualSaveBtn.title = 'Perfil consulta: solo lectura';
    }

    actualSaveBtn.onclick = async function () {
      if (isConsultaReadOnly) {
        _.showAlert('Perfil consulta: solo lectura', 'warning');
        return;
      }
      let turnoId = ASIG_TURNO_CONSTANTE_ID;
      let actividadIds = Array.from(actividadesEl.querySelectorAll('.asig-act-item.selected'))
        .map(function (item) {
          return Number(item.dataset.value);
        })
        .filter(Boolean);
      let selectedFecha = payload.fecha
        ? String(payload.fecha).slice(0, 10)
        : String(payload.anio) +
          '-' +
          String(payload.mes).padStart(2, '0') +
          '-' +
          String(payload.dia).padStart(2, '0');
      let fechaParts = String(selectedFecha).split('-');
      let anioSel = Number(fechaParts[0]);
      let mesSel = Number(fechaParts[1]);
      let diaSel = Number(fechaParts[2]);

      if (!actividadIds.length) {
        _.showAlert('Debe seleccionar al menos una actividad', 'warning');
        return;
      }
      if (!anioSel || !mesSel || !diaSel || !selectedFecha) {
        _.showAlert(
          'No se pudo resolver la fecha de la celda seleccionada',
          'warning'
        );
        return;
      }

      try {
        let applyHotDevengo = function (agenteId, saldoValue) {
          let agIdDevengo = Number(agenteId);
          let nuevoSaldo = Number(saldoValue);
          if (!Number.isFinite(agIdDevengo) || !Number.isFinite(nuevoSaldo))
            return;

          if (
            app.asignacionesState.cuadranteData &&
            app.asignacionesState.cuadranteData.saldosDevengo
          ) {
            app.asignacionesState.cuadranteData.saldosDevengo[agIdDevengo] =
              nuevoSaldo;
          }
          if (
            app.asignacionesState.cuadrante &&
            app.asignacionesState.cuadrante.saldosDevengo
          ) {
            app.asignacionesState.cuadrante.saldosDevengo[agIdDevengo] =
              nuevoSaldo;
          }
          if (_.tabulator) {
            let tRows = _.tabulator.getRows();
            for (let tRi = 0; tRi < tRows.length; tRi++) {
              if (Number(tRows[tRi].getData().agente_id) === agIdDevengo) {
                tRows[tRi].update({ devengo: nuevoSaldo });
                break;
              }
            }
          }
        };

        let DateTime = window.luxon && window.luxon.DateTime;
        let cuadSelUpsert =
          app.asignacionesState && app.asignacionesState.cuadranteSeleccionado;
        let upsertFechaCorte = null;
        let upsertFechaFin = null;
        if (DateTime && cuadSelUpsert && cuadSelUpsert.fecha_inicio) {
          let _iv = DateTime.fromISO(String(cuadSelUpsert.fecha_inicio), {
            zone: 'utc',
          });
          if (_iv.isValid)
            upsertFechaCorte = _iv.minus({ days: 1 }).toISODate();
        }
        if (DateTime && cuadSelUpsert && cuadSelUpsert.fecha_fin) {
          let _fv = DateTime.fromISO(String(cuadSelUpsert.fecha_fin), {
            zone: 'utc',
          });
          if (_fv.isValid) upsertFechaFin = _fv.toISODate();
        }
        let body = {
          anio: anioSel,
          mes: mesSel,
          borrador_id: _.getSelectedBorradorId(),
          agente_id: payload.agente_id,
          dia: diaSel,
          fecha: selectedFecha,
          turno_id: turnoId,
          actividad_ids: actividadIds,
          observaciones: obsEl.value.trim() || null,
          revision: payload.revision != null ? Number(payload.revision) : null,
          fecha_corte: upsertFechaCorte,
          fecha_fin: upsertFechaFin,
        };
        let res = await fetch('/api/asignaciones/upsert', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + app.globalState.token,
            'X-Asig-Client-Version': _.ASIG_FE_VERSION,
          },
          body: JSON.stringify(body),
        });
        let responseJson = null;
        try {
          responseJson = await res.json();
        } catch (_e) {
          responseJson = null;
        }
        if (res.status === 409) {
          _.showAlert(
            'La celda fue modificada por otro usuario. Recargando cuadrante...',
            'warning'
          );
          await app.loadAsignacionesCuadrante();
          return;
        }
        if (!res.ok || (responseJson && responseJson.ok === false)) {
          let message =
            responseJson && responseJson.message
              ? responseJson.message
              : 'No se pudo guardar la asignación';
          if (
            responseJson &&
            Array.isArray(responseJson.details) &&
            responseJson.details.length
          )
            message +=
              ': ' + (responseJson.details[0].message || 'Error de validación');
          throw new Error(message);
        }
        if (typeof app.applyAsignacionesDevengosPendingState === 'function') {
          app.applyAsignacionesDevengosPendingState(
            responseJson,
            _.getSelectedBorradorId()
          );
        }
        if (responseJson && responseJson.asignacion) {
          updateCell(responseJson.asignacion);
          // Actualizar saldo devengo en caliente
          if (responseJson.asignacion.saldo_devengo != null) {
            applyHotDevengo(
              responseJson.asignacion.agente_id,
              responseJson.asignacion.saldo_devengo
            );
          }

          // Confirmar saldo autoritativo desde cuadrante (sin recargar todo el grid).
          try {
            let pNow = _.getPeriodo();
            if (pNow && pNow.anio && pNow.mes) {
              let paramsDev = [];
              if (upsertFechaCorte) {
                paramsDev.push(
                  'fecha_corte=' + encodeURIComponent(upsertFechaCorte)
                );
              }
              if (upsertFechaFin) {
                paramsDev.push(
                  'fecha_fin=' + encodeURIComponent(upsertFechaFin)
                );
              }
              let borradorSel = _.getSelectedBorradorId();
              if (borradorSel) {
                paramsDev.push(
                  'borrador_id=' + encodeURIComponent(String(borradorSel))
                );
              }
              let qsDev = paramsDev.length ? '?' + paramsDev.join('&') : '';
              let devRes = await fetch(
                '/api/asignaciones/cuadrante/' +
                  pNow.anio +
                  '/' +
                  pNow.mes +
                  qsDev,
                { headers: _.headers() }
              );
              if (devRes.ok) {
                let devJson = await devRes.json();
                let saldosDev = (devJson && devJson.saldosDevengo) || {};
                let agId = Number(responseJson.asignacion.agente_id);
                if (saldosDev[agId] != null) {
                  applyHotDevengo(agId, saldosDev[agId]);
                }
              }
            }
          } catch (_devErr) {
            // No interrumpir flujo de guardado por fallo en refresco de devengo.
          }
        }
        _.showAlert(
          'Asignación guardada en borrador ' + _.ASIG_FE_VERSION,
          'success'
        );

        let cellModalEl = document.getElementById('asigCellModal');
        if (cellModalEl)
          bootstrap.Modal.getOrCreateInstance(cellModalEl).hide();
      } catch (e) {
        _.showAlert(e.message, 'danger');
      }
    };

    let p = _.getPeriodo();

    if (contextEl) {
      let fechaTxt =
        payload.fecha ||
        String(payload.anio) +
          '-' +
          String(payload.mes).padStart(2, '0') +
          '-' +
          String(payload.dia).padStart(2, '0');
      contextEl.innerHTML =
        '<span class="me-2"><strong>Agente:</strong> ' +
        app.escapeHtml(payload.agenteNombre || '#' + payload.agente_id) +
        '</span>' +
        '<span class="badge ms-1" style="background:var(--primary-gc-color,#276836);color:#fff;">' +
        app.escapeHtml(fechaTxt) +
        '</span>' +
        '<span class="ms-2"><strong>Período:</strong> ' +
        app.escapeHtml(String(p.anio) + '/' + String(p.mes).padStart(2, '0')) +
        '</span>';
    }

    fillTurnosOptions(turnoEl);

    fillActividadesOptions(actividadesEl, payload.actividad_ids || []);

    obsEl.value = payload.observaciones || '';
    let filterActCell = document.getElementById('asigCellFilterActividades');
    if (filterActCell) {
      filterActCell.value = '';
      attachSelectFilter(filterActCell, actividadesEl);
    }

    try {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    } catch (e) {
      alert('Error al mostrar el modal: ' + e.message);
    }
  };

  // ── Exportar ────────────────────────────────────────────────────
  _.buildServiciosMap = buildServiciosMap;
  _.updateCell = updateCell;
  _.attachSelectFilter = attachSelectFilter;
  _.ensureConfirmBorradorModal = ensureConfirmBorradorModal;
  _.ensureAsignacionesBulkModal = ensureAsignacionesBulkModal;
  _.ensureAsignacionesDeleteModal = ensureAsignacionesDeleteModal;
  _.ensureAsignacionesCopyModal = ensureAsignacionesCopyModal;
  _.ensureAsignacionesValidarModal = ensureAsignacionesValidarModal;
  _.fillAgenteOptions = fillAgenteOptions;
  _.fillTurnosOptions = fillTurnosOptions;
  _.fillActividadesOptions = fillActividadesOptions;
})();
