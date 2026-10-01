// @ts-nocheck
// ═══════════════════════════════════════════════════════
//  GRS1 — Backups de tablas de trabajo (Sistema > Backups)
// ═══════════════════════════════════════════════════════
(function () {
  const app = window.GRS1Dashboard;

  let catalogoTrabajo = [];
  let catalogoCatalogos = [];
  let backupsDisponibles = [];
  let ultimaExportacion = null; // { rutaRelativa, manifest }
  let confirmModalCallback = null;
  let inicializado = false;

  function headers() {
    let h = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + app.globalState.token,
    };
    if (app.globalState.activeArsId) h['X-Ars-Id'] = app.globalState.activeArsId;
    return h;
  }

  function showAlert(message, type) {
    const el = document.getElementById('alertContainerBackup');
    if (!el) return;
    el.innerHTML =
      '<div class="alert alert-' +
      type +
      ' alert-dismissible py-1 mb-1 fade show" role="alert">' +
      message +
      '<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>';
    if (type !== 'danger') {
      setTimeout(() => {
        el.innerHTML = '';
      }, 8000);
    }
  }

  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    let json = null;
    try {
      json = await res.json();
    } catch (_e) {
      // respuesta sin cuerpo JSON
    }
    if (!res.ok || !json || json.ok === false) {
      const msg = (json && (json.message || json.error)) || 'Error HTTP ' + res.status;
      throw new Error(msg);
    }
    return json;
  }

  function getTablasSeleccionadas(containerId, claseFiltro) {
    const selector = claseFiltro
      ? '#' + containerId + ' input.' + claseFiltro + ':checked'
      : '#' + containerId + ' input[type=checkbox]:checked';
    return Array.from(document.querySelectorAll(selector)).map((el) => el.value);
  }

  // Devuelve las etiquetas de todos los descendientes (recursivo), para el texto "(incluye: ...)".
  function etiquetasDescendientes(entry) {
    const propias = (entry.hijos || []).map((h) => h.label);
    const deNietos = (entry.hijos || []).flatMap((h) => etiquetasDescendientes(h));
    return propias.concat(deNietos);
  }

  function renderChecklist(containerId, entries, claseCheckbox) {
    const cont = document.getElementById(containerId);
    if (!cont) return;
    if (!entries.length) {
      cont.innerHTML = '<span class="text-muted small">No hay tablas disponibles.</span>';
      return;
    }
    cont.innerHTML = entries
      .map((entry) => {
        const descendientes = etiquetasDescendientes(entry);
        const hijosTxt = descendientes.length
          ? ' <span class="text-muted">(incluye: ' +
            descendientes.map((l) => app.escapeHtml(l)).join(', ') +
            ')</span>'
          : '';
        const id = 'bkChk_' + claseCheckbox + '_' + entry.key;
        return (
          '<div class="form-check">' +
          '<input class="form-check-input ' +
          claseCheckbox +
          '" type="checkbox" value="' +
          entry.key +
          '" id="' +
          id +
          '">' +
          '<label class="form-check-label small" for="' +
          id +
          '">' +
          app.escapeHtml(entry.label) +
          hijosTxt +
          '</label>' +
          '</div>'
        );
      })
      .join('');
  }

  function sincronizarCheckboxMaestro(masterId, claseCheckbox) {
    const master = document.getElementById(masterId);
    if (!master) return;
    const items = Array.from(document.querySelectorAll('input.' + claseCheckbox));
    if (!items.length) {
      master.checked = false;
      master.indeterminate = false;
      return;
    }
    const marcados = items.filter((el) => el.checked).length;
    master.checked = marcados === items.length;
    master.indeterminate = marcados > 0 && marcados < items.length;
  }

  async function cargarCatalogo() {
    const json = await fetchJson('/api/backup/catalogo', { headers: headers() });
    catalogoTrabajo = (json.data && json.data.trabajo) || [];
    catalogoCatalogos = (json.data && json.data.catalogos) || [];
    renderChecklist('bkTablasContainer', catalogoTrabajo, 'bk-tabla-trabajo');
    renderChecklist('bkCatalogosContainer', catalogoCatalogos, 'bk-tabla-catalogo');
    sincronizarCheckboxMaestro('bkTablasSeleccionarTodo', 'bk-tabla-trabajo');
    sincronizarCheckboxMaestro('bkCatalogosSeleccionarTodo', 'bk-tabla-catalogo');
  }

  function validarFormularioExport() {
    const desde = document.getElementById('bkFechaDesde').value;
    const hasta = document.getElementById('bkFechaHasta').value;
    const tablasTrabajo = getTablasSeleccionadas('bkTablasContainer', 'bk-tabla-trabajo');
    const tablasCatalogo = getTablasSeleccionadas('bkCatalogosContainer', 'bk-tabla-catalogo');
    const carpeta = document.getElementById('bkCarpetaDestino').value.trim();
    if (!tablasTrabajo.length && !tablasCatalogo.length) {
      showAlert('Seleccione al menos una tabla de trabajo o un catálogo a exportar.', 'warning');
      return null;
    }
    if (tablasTrabajo.length) {
      if (!desde || !hasta) {
        showAlert('Indique el rango de fechas (desde / hasta) para las tablas de trabajo.', 'warning');
        return null;
      }
      if (desde > hasta) {
        showAlert('La fecha "desde" no puede ser posterior a "hasta".', 'warning');
        return null;
      }
    }
    if (!carpeta) {
      showAlert('Indique una carpeta destino.', 'warning');
      return null;
    }
    return { desde: desde || null, hasta: hasta || null, tablasTrabajo, tablasCatalogo, carpeta };
  }

  function sumarTotalArbol(nodos) {
    return (nodos || []).reduce((acc, n) => acc + n.total + sumarTotalArbol(n.hijos), 0);
  }

  function renderListaArbol(nodos) {
    if (!nodos || !nodos.length) return '';
    let html = '<ul class="mb-0 small">';
    nodos.forEach((n) => {
      html += '<li>' + app.escapeHtml(n.label) + ': <strong>' + n.total + '</strong> fila(s)';
      const hijosHtml = renderListaArbol(n.hijos);
      if (hijosHtml) html += hijosHtml;
      html += '</li>';
    });
    html += '</ul>';
    return html;
  }

  async function ejecutarPreview() {
    const datos = validarFormularioExport();
    if (!datos) return;
    try {
      const json = await fetchJson('/api/backup/preview', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          desde: datos.desde,
          hasta: datos.hasta,
          tablasTrabajo: datos.tablasTrabajo,
          tablasCatalogo: datos.tablasCatalogo,
        }),
      });
      const data = json.data || { trabajo: [], catalogos: [] };
      const totalGeneral = sumarTotalArbol(data.trabajo) + sumarTotalArbol(data.catalogos);
      let html = '';
      if (data.trabajo && data.trabajo.length) {
        html += '<div class="fw-semibold">Tablas de trabajo</div>' + renderListaArbol(data.trabajo);
      }
      if (data.catalogos && data.catalogos.length) {
        html += '<div class="fw-semibold mt-1">Catálogos</div>' + renderListaArbol(data.catalogos);
      }
      showAlert(
        'Vista previa (' + totalGeneral + ' fila(s) en total):<div class="mt-1">' + html + '</div>',
        'info'
      );
    } catch (e) {
      showAlert(app.escapeHtml(e.message), 'danger');
    }
  }

  function renderFilasArbol(nodos, nivel) {
    let rows = '';
    (nodos || []).forEach((n) => {
      const sangria = nivel > 0 ? 'ps-' + Math.min(nivel * 2 + 2, 5) + ' text-muted' : '';
      const prefijo = nivel > 0 ? '↳ ' : '';
      rows +=
        '<tr><td class="' + sangria + '">' + prefijo + app.escapeHtml(n.label || n.table) +
        '</td><td class="text-end">' + n.total + '</td></tr>';
      rows += renderFilasArbol(n.hijos, nivel + 1);
    });
    return rows;
  }

  function renderResumenExportacion(manifest) {
    const cont = document.getElementById('bkExportResumenTabla');
    if (!cont) return;
    let rows = renderFilasArbol(manifest.trabajo, 0) + renderFilasArbol(manifest.catalogos, 0);
    cont.innerHTML =
      '<table class="table table-sm table-striped mb-0">' +
      '<thead><tr><th>Tabla</th><th class="text-end">Filas exportadas</th></tr></thead>' +
      '<tbody>' +
      rows +
      '</tbody></table>';
    const wrapper = document.getElementById('bkExportResultado');
    if (wrapper) wrapper.classList.remove('d-none');
    const btnEliminar = document.getElementById('btnBkEliminarExportado');
    if (btnEliminar) {
      btnEliminar.classList.toggle('d-none', !manifest.trabajo || !manifest.trabajo.length);
    }
  }

  async function ejecutarExportar() {
    const datos = validarFormularioExport();
    if (!datos) return;
    const btn = document.getElementById('btnBkExportar');
    if (btn) btn.disabled = true;
    try {
      const json = await fetchJson('/api/backup/exportar', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(datos),
      });
      ultimaExportacion = json.data;
      renderResumenExportacion(ultimaExportacion.manifest);
      showAlert(
        'Exportación completada en: <code>' + app.escapeHtml(ultimaExportacion.rutaRelativa) + '</code>',
        'success'
      );
      await cargarListadoImportar();
    } catch (e) {
      showAlert(app.escapeHtml(e.message), 'danger');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function abrirConfirmacion(titulo, cuerpoHtml, onConfirm) {
    const modalEl = document.getElementById('confirmBackupActionModal');
    if (!modalEl || typeof bootstrap === 'undefined') {
      onConfirm();
      return;
    }
    document.getElementById('confirmBackupActionTitle').textContent = titulo;
    document.getElementById('confirmBackupActionBody').innerHTML = cuerpoHtml;
    confirmModalCallback = onConfirm;
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  async function ejecutarEliminarExportado() {
    if (!ultimaExportacion) return;
    const tablasTrabajo = (ultimaExportacion.manifest.trabajo || []).map((t) => t.key);
    if (!tablasTrabajo.length) {
      showAlert('Esta exportación no incluye tablas de trabajo que se puedan eliminar.', 'warning');
      return;
    }
    try {
      const json = await fetchJson('/api/backup/eliminar', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          rutaRelativa: ultimaExportacion.rutaRelativa,
          tablas: tablasTrabajo,
        }),
      });
      const resumen = json.data.resumen || [];
      const sumarEliminadas = (nodos) =>
        (nodos || []).reduce((acc, n) => acc + n.eliminadas + sumarEliminadas(n.hijos), 0);
      const total = sumarEliminadas(resumen);
      showAlert('Se eliminaron ' + total + ' fila(s) de las tablas de trabajo exportadas.', 'success');
      const wrapper = document.getElementById('bkExportResultado');
      if (wrapper) wrapper.classList.add('d-none');
      ultimaExportacion = null;
    } catch (e) {
      showAlert(app.escapeHtml(e.message), 'danger');
    }
  }

  async function cargarListadoImportar() {
    const select = document.getElementById('bkImportarSelect');
    if (!select) return;
    try {
      const json = await fetchJson('/api/backup/listar', { headers: headers() });
      backupsDisponibles = json.data || [];
      select.innerHTML =
        '<option value="">Seleccione una copia de seguridad...</option>' +
        backupsDisponibles
          .map((b, idx) => {
            const fecha = b.generatedAt
              ? new Date(b.generatedAt).toLocaleString('es-ES')
              : b.exportId;
            const rangoTxt = b.desde && b.hasta ? ' (' + b.desde + ' a ' + b.hasta + ')' : ' (solo catálogos)';
            return (
              '<option value="' +
              idx +
              '">' +
              app.escapeHtml(b.rutaRelativa) +
              ' — ' +
              fecha +
              rangoTxt +
              '</option>'
            );
          })
          .join('');
    } catch (e) {
      showAlert(app.escapeHtml(e.message), 'danger');
    }
  }

  function prefillRangoImportar(backup) {
    const desdeEl = document.getElementById('bkImportarFechaDesde');
    const hastaEl = document.getElementById('bkImportarFechaHasta');
    if (!desdeEl || !hastaEl) return;
    desdeEl.value = backup ? backup.desde || '' : '';
    hastaEl.value = backup ? backup.hasta || '' : '';
  }

  function renderOpcionesImportar(nodos, categoriaLabel) {
    return (nodos || [])
      .map((n) => {
        const descendientes = etiquetasDescendientes(n);
        const hijosTxt = descendientes.length
          ? ' <span class="text-muted">(incluye: ' +
            descendientes.map((l) => app.escapeHtml(l)).join(', ') +
            ')</span>'
          : '';
        const id = 'bkImpTabla_' + n.key;
        return (
          '<div class="form-check">' +
          '<input class="form-check-input bk-tabla-importar" type="checkbox" value="' +
          n.key +
          '" id="' +
          id +
          '" checked>' +
          '<label class="form-check-label small" for="' +
          id +
          '">' +
          '<span class="badge bg-secondary-subtle text-secondary-emphasis me-1">' +
          categoriaLabel +
          '</span>' +
          app.escapeHtml(n.label) +
          ' (' +
          n.total +
          ' fila(s))' +
          hijosTxt +
          '</label>' +
          '</div>'
        );
      })
      .join('');
  }

  function renderTablasImportar(backup) {
    const cont = document.getElementById('bkImportarTablasContainer');
    if (!cont) return;
    if (!backup) {
      cont.innerHTML = '<span class="text-muted small">Seleccione primero una copia de seguridad.</span>';
      return;
    }
    const html =
      renderOpcionesImportar(backup.trabajo, 'Trabajo') + renderOpcionesImportar(backup.catalogos, 'Catálogo');
    cont.innerHTML = html || '<span class="text-muted small">Esta copia no contiene tablas.</span>';
  }

  function renderFilasResumenImportacion(nodos, nivel) {
    let rows = '';
    (nodos || []).forEach((n) => {
      const totalTxt =
        n.totalDisponible !== undefined && n.totalDisponible !== n.total
          ? n.total + ' de ' + n.totalDisponible
          : n.total;
      const sangria = nivel > 0 ? 'ps-' + Math.min(nivel * 2 + 2, 5) + ' text-muted' : '';
      const prefijo = nivel > 0 ? '↳ ' : '';
      rows +=
        '<tr><td class="' + sangria + '">' + prefijo + app.escapeHtml(n.table) +
        '</td><td class="text-end">' + n.insertadas + ' / ' + totalTxt + '</td></tr>';
      rows += renderFilasResumenImportacion(n.hijos, nivel + 1);
    });
    return rows;
  }

  function renderResumenImportacion(resumen) {
    const cont = document.getElementById('bkImportarResumenTabla');
    if (!cont) return;
    const rows =
      renderFilasResumenImportacion(resumen.catalogos, 0) + renderFilasResumenImportacion(resumen.trabajo, 0);
    cont.innerHTML =
      '<table class="table table-sm table-striped mb-0">' +
      '<thead><tr><th>Tabla</th><th class="text-end">Insertadas / Total</th></tr></thead>' +
      '<tbody>' +
      rows +
      '</tbody></table>';
    const wrapper = document.getElementById('bkImportarResultado');
    if (wrapper) wrapper.classList.remove('d-none');
  }

  async function ejecutarImportar() {
    const select = document.getElementById('bkImportarSelect');
    const idx = select ? select.value : '';
    if (idx === '') {
      showAlert('Seleccione una copia de seguridad para importar.', 'warning');
      return;
    }
    const backup = backupsDisponibles[Number(idx)];
    const tablas = getTablasSeleccionadas('bkImportarTablasContainer', 'bk-tabla-importar');
    if (!tablas.length) {
      showAlert('Seleccione al menos una tabla a importar.', 'warning');
      return;
    }

    const desde = document.getElementById('bkImportarFechaDesde').value || null;
    const hasta = document.getElementById('bkImportarFechaHasta').value || null;
    if (desde && hasta && desde > hasta) {
      showAlert('La fecha "desde" no puede ser posterior a "hasta" en la importación.', 'warning');
      return;
    }

    const rangoTxt = desde || hasta ? ' (rango: ' + (desde || '…') + ' a ' + (hasta || '…') + ')' : '';

    abrirConfirmacion(
      'Importar copia de seguridad',
      'Se importarán ' +
        tablas.length +
        ' tabla(s) desde <code>' +
        app.escapeHtml(backup.rutaRelativa) +
        '</code>' +
        app.escapeHtml(rangoTxt) +
        '. Los registros ya existentes no se duplican. ¿Continuar?',
      async () => {
        try {
          const json = await fetchJson('/api/backup/importar', {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ rutaRelativa: backup.rutaRelativa, tablas, desde, hasta }),
          });
          renderResumenImportacion(json.data.resumen || { catalogos: [], trabajo: [] });
          showAlert('Importación completada.', 'success');
        } catch (e) {
          showAlert(app.escapeHtml(e.message), 'danger');
        }
      }
    );
  }

  function wireCheckboxMaestro(masterId, claseCheckbox) {
    const master = document.getElementById(masterId);
    if (!master) return;
    master.addEventListener('change', () => {
      document.querySelectorAll('input.' + claseCheckbox).forEach((el) => {
        el.checked = master.checked;
      });
      master.indeterminate = false;
    });
  }

  function setupEventListeners() {
    const btnPreview = document.getElementById('btnBkPreview');
    if (btnPreview) btnPreview.addEventListener('click', ejecutarPreview);

    wireCheckboxMaestro('bkTablasSeleccionarTodo', 'bk-tabla-trabajo');
    wireCheckboxMaestro('bkCatalogosSeleccionarTodo', 'bk-tabla-catalogo');
    document.addEventListener('change', (event) => {
      const target = event.target;
      if (!target || !target.classList) return;
      if (target.classList.contains('bk-tabla-trabajo')) {
        sincronizarCheckboxMaestro('bkTablasSeleccionarTodo', 'bk-tabla-trabajo');
      } else if (target.classList.contains('bk-tabla-catalogo')) {
        sincronizarCheckboxMaestro('bkCatalogosSeleccionarTodo', 'bk-tabla-catalogo');
      }
    });

    const btnExportar = document.getElementById('btnBkExportar');
    if (btnExportar) {
      btnExportar.addEventListener('click', () => {
        const datos = validarFormularioExport();
        if (!datos) return;
        const totalTablas = datos.tablasTrabajo.length + datos.tablasCatalogo.length;
        const rangoTxt = datos.tablasTrabajo.length
          ? ' (tablas de trabajo entre ' + datos.desde + ' y ' + datos.hasta + ')'
          : '';
        abrirConfirmacion(
          'Exportar copia de seguridad',
          'Se exportarán ' + totalTablas + ' tabla(s)' + app.escapeHtml(rangoTxt) + '. ¿Continuar?',
          ejecutarExportar
        );
      });
    }

    const btnEliminar = document.getElementById('btnBkEliminarExportado');
    if (btnEliminar) {
      btnEliminar.addEventListener('click', () => {
        abrirConfirmacion(
          'Eliminar datos exportados',
          'Esta acción eliminará de forma <strong>permanente</strong> los registros ya exportados en <code>' +
            (ultimaExportacion ? app.escapeHtml(ultimaExportacion.rutaRelativa) : '') +
            '</code>. Esta operación no se puede deshacer. ¿Desea continuar?',
          ejecutarEliminarExportado
        );
      });
    }

    const selectImportar = document.getElementById('bkImportarSelect');
    if (selectImportar) {
      selectImportar.addEventListener('change', () => {
        const idx = selectImportar.value;
        const btnImportar = document.getElementById('btnBkImportar');
        if (idx === '') {
          renderTablasImportar(null);
          prefillRangoImportar(null);
          if (btnImportar) btnImportar.disabled = true;
          return;
        }
        const backup = backupsDisponibles[Number(idx)];
        renderTablasImportar(backup);
        prefillRangoImportar(backup);
        if (btnImportar) btnImportar.disabled = false;
      });
    }

    const btnImportar = document.getElementById('btnBkImportar');
    if (btnImportar) btnImportar.addEventListener('click', ejecutarImportar);

    const btnRefrescar = document.getElementById('btnBkRefrescarListado');
    if (btnRefrescar) btnRefrescar.addEventListener('click', cargarListadoImportar);

    const confirmModalEl = document.getElementById('confirmBackupActionModal');
    const confirmBtn = document.getElementById('btnConfirmBackupAction');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        const cb = confirmModalCallback;
        confirmModalCallback = null;
        if (confirmModalEl && typeof bootstrap !== 'undefined') {
          bootstrap.Modal.getOrCreateInstance(confirmModalEl).hide();
        }
        if (typeof cb === 'function') await cb();
      });
    }
  }

  app.initializeBackups = async function initializeBackups() {
    if (inicializado) return;
    inicializado = true;
    try {
      await cargarCatalogo();
      await cargarListadoImportar();
      setupEventListeners();
    } catch (e) {
      showAlert(app.escapeHtml(e.message), 'danger');
    }
  };
})();
