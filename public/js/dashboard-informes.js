(function () {
  'use strict';

  const app = window.GRS1Dashboard;

  const MESES = [
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

  const state = {
    anio: null,
    mes: null,
    tipo: 'definitivo',
    borradorId: null,
    borradores: [],
    periodos: [],
  };

  function el(id) {
    return document.getElementById(id);
  }

  function getHeaders() {
    return typeof app.getHeaders === 'function'
      ? app.getHeaders(false)
      : { Authorization: `Bearer ${app.globalState.token}` };
  }

  function formatFechaIso(iso) {
    const DateTime = window.luxon && window.luxon.DateTime;
    if (DateTime) {
      const dt = DateTime.fromISO(String(iso || '').slice(0, 10), {
        zone: 'Europe/Madrid',
      });
      if (dt.isValid) return dt.toFormat('dd/LL/yyyy');
    }
    return String(iso || '').slice(0, 10);
  }

  function setStatus(visible, message) {
    const s = el('informesStatus');
    if (!s) return;
    const label = el('informesStatusLabel');
    if (label && message) label.textContent = message;
    s.classList.toggle('informes-hidden', !visible);
  }

  function setError(msg) {
    const e = el('informesError');
    if (!e) return;
    if (msg) {
      e.textContent = msg;
      e.classList.remove('informes-hidden');
    } else {
      e.classList.add('informes-hidden');
      e.textContent = '';
    }
  }

  function actualizarResumenFuente() {
    // @ts-ignore
    const anio = el('informesAnio')?.value || '—';
    // @ts-ignore
    const mesNum = Number(el('informesMes')?.value || 0);
    const mes = MESES[mesNum - 1] || '—';
    // @ts-ignore
    const tipo = el('informesTipo')?.value || 'definitivo';
    const resumen = el('informesFuenteResumen');
    if (!resumen) return;

    if (tipo === 'borrador') {
      const borradorSel = el('informesBorrador');
      // @ts-ignore
      const borradorId = borradorSel?.value || '';
      const borradorTxt =
        // @ts-ignore
        borradorSel && borradorSel.selectedIndex >= 0
          // @ts-ignore
          ? borradorSel.options[borradorSel.selectedIndex]?.textContent ||
            'Sin borrador'
          : 'Sin borrador';
      resumen.textContent = `Fuente: Borrador${borradorId ? ` (${borradorTxt})` : ''} · Período: ${mes} ${anio}`;
      return;
    }

    resumen.textContent = `Fuente: Definitivo · Período: ${mes} ${anio}`;
  }

  function buildPeriodos(cuadrantes) {
    const porAnio = new Map();
    (cuadrantes || []).forEach((c) => {
      if (!c || c.estado === 'archivado') return;
      const anio = Number(c.anio != null ? c.anio : c.anio_referencia);
      const mes = Number(c.mes != null ? c.mes : c.mes_referencia);
      if (!Number.isInteger(anio) || anio <= 0) return;
      if (!Number.isInteger(mes) || mes < 1 || mes > 12) return;
      if (!porAnio.has(anio)) porAnio.set(anio, new Set());
      porAnio.get(anio).add(mes);
    });

    return Array.from(porAnio.entries())
      .map(([anio, mesesSet]) => ({
        anio,
        meses: Array.from(mesesSet).sort((a, b) => a - b),
      }))
      .sort((a, b) => b.anio - a.anio);
  }

  function poblarMesesPorAnio(anioPreferido, mesPreferido) {
    const mesSel = el('informesMes');
    if (!mesSel) return;

    const periodo =
      state.periodos.find((p) => p.anio === Number(anioPreferido)) ||
      state.periodos[0];
    const meses = (periodo && periodo.meses) || [];
    if (!meses.length) {
      mesSel.innerHTML = '<option value="">Sin meses</option>';
      return;
    }

    mesSel.innerHTML = meses
      .map((m) => `<option value="${m}">${MESES[m - 1] || m}</option>`)
      .join('');

    const selectedMes = meses.includes(Number(mesPreferido))
      ? Number(mesPreferido)
      : meses[meses.length - 1];
    // @ts-ignore
    mesSel.value = String(selectedMes);
  }

  function poblarPeriodoDisponible(preferredAnio, preferredMes) {
    const anioSel = el('informesAnio');
    if (!anioSel) return;

    if (!state.periodos.length) {
      anioSel.innerHTML = '<option value="">Sin años</option>';
      const mesSel = el('informesMes');
      if (mesSel) mesSel.innerHTML = '<option value="">Sin meses</option>';
      return;
    }

    anioSel.innerHTML = state.periodos
      .map((p) => `<option value="${p.anio}">${p.anio}</option>`)
      .join('');

    const anios = state.periodos.map((p) => p.anio);
    const selectedAnio = anios.includes(Number(preferredAnio))
      ? Number(preferredAnio)
      : anios[0];
    // @ts-ignore
    anioSel.value = String(selectedAnio);
    poblarMesesPorAnio(selectedAnio, preferredMes);
  }

  async function cargarPeriodosDisponibles() {
    const headers = getHeaders();
    const source = String(
      // @ts-ignore
      el('informesTipo')?.value || 'definitivo'
    ).toLowerCase();

    try {
      const resp = await fetch(
        `/api/asignaciones/periodos-disponibles?source=${encodeURIComponent(source)}`,
        { headers, cache: 'no-store' }
      );
      if (!resp.ok)
        throw new Error('No se pudieron cargar períodos efectivos.');
      const json = await resp.json();
      state.periodos = buildPeriodos(
        Array.isArray(json.periodos) ? json.periodos : []
      );
    } catch (_e) {
      const resp = await fetch('/api/cuadrantes', {
        headers,
        cache: 'no-store',
      });
      if (!resp.ok) {
        throw new Error(
          'No se pudieron cargar los períodos disponibles para informes.'
        );
      }
      const json = await resp.json();
      state.periodos = buildPeriodos(Array.isArray(json.data) ? json.data : []);
    }
  }

  async function poblarFechasCuadrante() {
    // @ts-ignore
    const anio = Number(el('informesAnio')?.value || 0);
    // @ts-ignore
    const mes = Number(el('informesMes')?.value || 0);
    const sel = el('informesFechas');
    if (!anio || !mes || !sel) return;

    const tipo = String(
      // @ts-ignore
      el('informesTipo')?.value || 'definitivo'
    ).toLowerCase();
    const headers = getHeaders();
    const prevSelected = new Set(
      // @ts-ignore
      Array.from(sel.selectedOptions || []).map((o) => o.value)
    );
    // @ts-ignore
    const modoPorDia = !!el('informesModoPorDia')?.checked;
    let url = `/api/asignaciones/cuadrante/${anio}/${mes}`;

    if (tipo === 'definitivo') {
      url += '?source=definitivo';
    } else {
      const borradorId = String(
        // @ts-ignore
        el('informesBorrador')?.value || state.borradorId || ''
      );
      if (!borradorId) {
        resetModoPorDiaState();
        updateExportButtonState();
        sel.innerHTML =
          '<option value="">Selecciona un borrador para ver fechas</option>';
        const container = el('informesCuadrantePreviewContainer');
        if (container)
          container.innerHTML =
            '<div class="text-center text-muted py-3">Selecciona un borrador para ver fechas</div>';
        return;
      }
      url += `?borrador_id=${encodeURIComponent(borradorId)}`;
    }

    let fechas = [];
    try {
      const resp = await fetch(url, { headers, cache: 'no-store' });
      if (!resp.ok)
        throw new Error(
          'No se pudieron cargar las fechas de la fuente seleccionada.'
        );
      const json = await resp.json();
      const rows =
        tipo === 'borrador'
          ? Array.isArray(json.borrador)
            ? json.borrador
            : []
          : Array.isArray(json.definitivo)
            ? json.definitivo
            : [];

      fechas = Array.from(
        new Set(
          rows
            .map((r) => String((r && r.fecha) || '').slice(0, 10))
            .filter((iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso))
        )
      ).sort((a, b) => a.localeCompare(b));
    } catch (_err) {
      resetModoPorDiaState();
      updateExportButtonState();
      sel.innerHTML = '<option value="">Error al cargar fechas</option>';
      const container = el('informesCuadrantePreviewContainer');
      if (container)
        container.innerHTML =
          '<div class="text-center text-danger py-3">Error al cargar fechas</div>';
      return;
    }

    sel.innerHTML = '';
    if (!fechas.length) {
      resetModoPorDiaState();
      updateExportButtonState();
      sel.innerHTML =
        '<option value="">Sin fechas en la fuente seleccionada</option>';
      const container = el('informesCuadrantePreviewContainer');
      if (container)
        container.innerHTML =
          '<div class="text-center text-muted py-3">Sin fechas en la fuente seleccionada</div>';
      return;
    }

    // Poblar el select con las fechas del origen
    fechas.forEach((iso) => {
      const opt = document.createElement('option');
      opt.value = iso;
      opt.textContent = formatFechaIso(iso);
      if (prevSelected.has(iso)) opt.selected = true;
      sel.appendChild(opt);
    });

    updateExportButtonState();

    // Renderizar el calendario del cuadrante
    await cargarYRenderizarCuadranteCalendario();

    // En modo por día, si no hay selección previa válida, seleccionar todas
    // @ts-ignore
    if (modoPorDia && !Array.from(sel.options).some((opt) => opt.selected)) {
      seleccionarTodasFechas();
    }
  }

  async function cargarYRenderizarCuadranteCalendario() {
    // @ts-ignore
    const anio = Number(el('informesAnio')?.value || 0);
    // @ts-ignore
    const mes = Number(el('informesMes')?.value || 0);
    const container = el('informesCuadrantePreviewContainer');
    const sel = el('informesFechas');
    // @ts-ignore
    const modoPorDia = !!el('informesModoPorDia')?.checked;
    if (!container || !sel) return;
    if (!anio || !mes) {
      resetModoPorDiaState();
      updateExportButtonState();
      container.innerHTML =
        '<div class="text-center text-muted py-3">No esxiste Cuadrante ....</div>';
      return;
    }

    const headers = getHeaders();
    try {
      // Obtener lista de cuadrantes
      const cuadrantesResp = await fetch(
        `/api/cuadrantes?anio=${anio}&mes=${mes}`,
        { headers, cache: 'no-store' }
      );
      if (!cuadrantesResp.ok)
        throw new Error('No se pudieron cargar cuadrantes');

      const cuadrantesData = await cuadrantesResp.json();
      const cuadrantes = Array.isArray(cuadrantesData.data)
        ? cuadrantesData.data
        : [];

      // Buscar cuadrante activo o preferente
      let cuadrante = cuadrantes.find(
        (c) =>
          Number(c.anio_referencia) === anio &&
          Number(c.mes_referencia) === mes &&
          String(c.estado || '').toLowerCase() === 'activo'
      );

      if (!cuadrante) {
        cuadrante = cuadrantes.find(
          (c) =>
            Number(c.anio_referencia) === anio &&
            Number(c.mes_referencia) === mes &&
            String(c.estado || '').toLowerCase() !== 'archivado'
        );
      }

      if (!cuadrante) {
        resetModoPorDiaState();
        updateExportButtonState();
        container.innerHTML =
          '<div class="text-center text-muted py-3">No existe Cuadrante ....</div>';
        return;
      }

      // Si el cuadrante no tiene los días cargados, obtener el detalle
      if (
        !cuadrante.dias ||
        !Array.isArray(cuadrante.dias) ||
        cuadrante.dias.length === 0
      ) {
        const detailResp = await fetch(`/api/cuadrantes/${cuadrante.id}`, {
          headers,
          cache: 'no-store',
        });
        if (detailResp.ok) {
          const detailData = await detailResp.json();
          cuadrante =
            detailData && detailData.data ? detailData.data : cuadrante;
        }
      }

      // Obtener fechas seleccionadas
      // @ts-ignore
      const selectedDates = Array.from(sel.selectedOptions || []).map(
        (o) => o.value
      );
      // @ts-ignore
      const allowedDates = Array.from(sel.options || [])
        .map((o) => o.value)
        .filter(Boolean);

      // Verificar que el cuadrante tiene la estructura necesaria
      if (!cuadrante.dias || !Array.isArray(cuadrante.dias)) {
        resetModoPorDiaState();
        updateExportButtonState();
        console.warn('Cuadrante sin estructura de días:', cuadrante);
        container.innerHTML =
          '<div class="text-center text-muted py-3">Estructura de cuadrante inválida.</div>';
        return;
      }

      // Renderizar calendario usando renderCuadrantePreview
      if (typeof window.renderCuadrantePreview === 'function') {
        window.renderCuadrantePreview(
          'informesCuadrantePreviewContainer',
          cuadrante,
          {
            selectable: modoPorDia,
            selectedDates: selectedDates,
            allowedDates: allowedDates,
            onSelect: sincronizarSelectDesdeCalendarioPreview,
          }
        );
      } else {
        container.innerHTML =
          '<div class="text-center text-muted py-3">Función de calendario no disponible.</div>';
      }
    } catch (err) {
      resetModoPorDiaState();
      updateExportButtonState();
      console.error('Error cargando cuadrante:', err);
      container.innerHTML = `<div class="text-center text-danger py-3">Error: ${err.message || 'No se pudo cargar el cuadrante'}</div>`;
    }
  }

  function sincronizarSelectDesdeCalendarioPreview(selectedFechas) {
    const sel = el('informesFechas');
    if (!sel) return;
    // @ts-ignore
    Array.from(sel.options).forEach((opt) => {
      opt.selected = selectedFechas.includes(opt.value);
    });
  }

  function resetModoPorDiaState() {
    const toggle = el('informesModoPorDia');
    const wrap = el('informesFechasWrap');
    const fechasSel = el('informesFechas');
    const btnTodas = el('btninformesFechasTodas');
    const btnLimpiar = el('btninformesFechasLimpiar');

    // @ts-ignore
    if (toggle) toggle.checked = false;
    if (wrap) wrap.classList.add('is-disabled');
    if (fechasSel) {
      // @ts-ignore
      fechasSel.disabled = true;
      // @ts-ignore
      Array.from(fechasSel.options).forEach((opt) => {
        opt.selected = false;
      });
    }
    // @ts-ignore
    if (btnTodas) btnTodas.disabled = true;
    // @ts-ignore
    if (btnLimpiar) btnLimpiar.disabled = true;
  }

  function updateExportButtonState() {
    const btnExcel = el('btninformesExportar');
    const btnPdf = el('btninformesExportarPdf');
    if (!btnExcel && !btnPdf) return;

    // @ts-ignore
    const anio = Number(el('informesAnio')?.value || 0);
    // @ts-ignore
    const mes = Number(el('informesMes')?.value || 0);
    const tipo = String(
      // @ts-ignore
      el('informesTipo')?.value || 'definitivo'
    ).toLowerCase();
    const fechasSel = el('informesFechas');
    // @ts-ignore
    const hasFechas = Array.from(fechasSel?.options || []).some((opt) =>
      Boolean(opt.value)
    );
    const hasBorrador =
      tipo !== 'borrador' ||
      // @ts-ignore
      Boolean(el('informesBorrador')?.value || state.borradorId);
    const enabled = !!(anio && mes && hasFechas && hasBorrador);

    // @ts-ignore
    if (btnExcel) btnExcel.disabled = !enabled;
    // @ts-ignore
    if (btnPdf) btnPdf.disabled = !enabled;
  }

  function actualizarModoPorDia() {
    // @ts-ignore
    const checked = !!el('informesModoPorDia')?.checked;
    const wrap = el('informesFechasWrap');
    if (wrap) wrap.classList.toggle('is-disabled', !checked);

    const fechasSel = el('informesFechas');
    const btnTodas = el('btninformesFechasTodas');
    const btnLimpiar = el('btninformesFechasLimpiar');
    // @ts-ignore
    if (fechasSel) fechasSel.disabled = !checked;
    // @ts-ignore
    if (btnTodas) btnTodas.disabled = !checked;
    // @ts-ignore
    if (btnLimpiar) btnLimpiar.disabled = !checked;

    if (checked) {
      if (
        fechasSel &&
        // @ts-ignore
        !Array.from(fechasSel.options).some((opt) => opt.selected)
      ) {
        seleccionarTodasFechas();
      }
    } else if (fechasSel) {
      // @ts-ignore
      Array.from(fechasSel.options).forEach((opt) => {
        opt.selected = false;
      });
    }

    // Re-render para reflejar modo seleccionable/no seleccionable del cuadrante.
    cargarYRenderizarCuadranteCalendario();
  }

  function seleccionarTodasFechas() {
    const container = el('informesCuadrantePreviewContainer');
    const checkboxes =
      container?.querySelectorAll('.cuadrante-day-check:not(:disabled)') || [];
    const fechas = Array.from(checkboxes).map((ch) => ch.value);
    checkboxes.forEach((ch) => {
      ch.checked = true;
    });
    sincronizarSelectDesdeCalendarioPreview(fechas);
    cargarYRenderizarCuadranteCalendario();
  }

  function limpiarFechasSeleccionadas() {
    const container = el('informesCuadrantePreviewContainer');
    const checkboxes =
      container?.querySelectorAll('.cuadrante-day-check:not(:disabled)') || [];
    checkboxes.forEach((ch) => {
      ch.checked = false;
    });
    sincronizarSelectDesdeCalendarioPreview([]);
    cargarYRenderizarCuadranteCalendario();
  }

  async function cargarBorradores() {
    // @ts-ignore
    const anio = el('informesAnio')?.value;
    // @ts-ignore
    const mes = el('informesMes')?.value;
    if (!anio || !mes) return;

    const sel = el('informesBorrador');
    if (!sel) return;
    // @ts-ignore
    const prevId = String(state.borradorId || sel.value || '');

    sel.innerHTML = '<option value="">Cargando…</option>';

    try {
      const token = app.globalState.token;
      const resp = await fetch(`/api/asignaciones/borradores/${anio}/${mes}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await resp.json();
      state.borradores = data.borradores || [];

      sel.innerHTML = '';
      state.borradores.forEach((b) => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = `${b.nombre} (v${b.version}) — ${b.estado}`;
        opt.dataset.nombre = b.nombre;
        sel.appendChild(opt);
      });

      if (!state.borradores.length) {
        sel.innerHTML =
          '<option value="">Sin borradores para este período</option>';
        state.borradorId = null;
      } else {
        const existsPrev = state.borradores.some(
          (b) => String(b.id) === prevId
        );
        const selected = existsPrev ? prevId : String(state.borradores[0].id);
        // @ts-ignore
        sel.value = selected;
        state.borradorId = selected;
      }
      actualizarResumenFuente();
    } catch (err) {
      sel.innerHTML = '<option value="">Error al cargar borradores</option>';
      state.borradorId = null;
      actualizarResumenFuente();
    }
  }

  async function actualizarVisibilidadBorrador() {
    // @ts-ignore
    const tipo = el('informesTipo')?.value;
    const wrap = el('informesBorradorWrap');
    const sel = el('informesBorrador');
    if (wrap) wrap.style.display = tipo === 'borrador' ? 'block' : 'none';
    if (!sel) return;

    if (tipo === 'borrador') {
      // @ts-ignore
      sel.disabled = false;
      await cargarBorradores();
      return;
    }

    // @ts-ignore
    sel.disabled = true;
    sel.innerHTML = '<option value="">No aplica para Definitivo</option>';
    // @ts-ignore
    sel.value = '';
    state.borradorId = null;
  }

  async function exportar(formato = 'xlsx') {
    setError(null);
    // @ts-ignore
    const anio = el('informesAnio')?.value;
    // @ts-ignore
    const mes = el('informesMes')?.value;
    // @ts-ignore
    const tipo = el('informesTipo')?.value;

    if (!anio || !mes) {
      setError('Selecciona año y mes.');
      return;
    }

    let borrador_id = null;
    let nombre_borrador = '';
    // @ts-ignore
    const modoPorDia = !!el('informesModoPorDia')?.checked;
    const selFechas = el('informesFechas');
    // @ts-ignore
    let fechasSeleccionadas = Array.from(selFechas?.selectedOptions || []).map(
      (o) => o.value
    );

    if (tipo === 'borrador') {
      const sel = el('informesBorrador');
      // @ts-ignore
      borrador_id = sel?.value || state.borradorId || null;
      if (!borrador_id) {
        setError('No hay borrador disponible para el período seleccionado.');
        return;
      }
      // @ts-ignore
      const opt = sel.options[sel.selectedIndex];
      nombre_borrador = opt?.dataset?.nombre || '';
    }
    actualizarResumenFuente();

    setStatus(
      true,
      formato === 'pdf'
        ? 'Generando PDF, por favor espera…'
        : 'Generando Excel, por favor espera…'
    );
    const btnExcel = el('btninformesExportar');
    const btnPdf = el('btninformesExportarPdf');
    // @ts-ignore
    if (btnExcel) btnExcel.disabled = true;
    // @ts-ignore
    if (btnPdf) btnPdf.disabled = true;

    try {
      const headers =
        typeof app.getHeaders === 'function'
          ? app.getHeaders(false)
          : { Authorization: `Bearer ${app.globalState.token}` };
      const params = new URLSearchParams({ anio, mes, formato });
      if (tipo === 'borrador' && borrador_id)
        params.set('borrador_id', borrador_id);
      if (nombre_borrador) params.set('nombre_borrador', nombre_borrador);
      if (modoPorDia || formato === 'pdf') {
        if (!fechasSeleccionadas.length) {
          // @ts-ignore
          fechasSeleccionadas = Array.from(selFechas?.options || [])
            .map((o) => o.value)
            .filter(Boolean);
        }
        if (!fechasSeleccionadas.length) {
          throw new Error('No hay fechas disponibles para exportar por día.');
        }
        params.set('modo', 'por_dia');
        params.set('fechas', fechasSeleccionadas.join(','));
      }

      const resp = await fetch(`/api/asignaciones/exportar?${params}`, {
        headers,
      });

      if (!resp.ok) {
        const err = await resp
          .json()
          .catch(() => ({ error: 'Error desconocido' }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      const blob = await resp.blob();
      if (!blob || Number(blob.size || 0) === 0) {
        throw new Error('El servidor no devolvió contenido para descargar.');
      }
      const url = URL.createObjectURL(blob);
      const disposition = resp.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const filename =
        match && match[1]
          ? match[1]
          : formato === 'pdf'
            ? 'servicio.pdf'
            : 'cuadrante.xlsx';

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Error al exportar: ${err.message}`);
    } finally {
      setStatus(false);
      updateExportButtonState();
    }
  }

  function bindEventos() {
    const bindOnce = (id, eventName, handler) => {
      const node = el(id);
      if (!node) return;
      const key = `bound_${eventName}`;
      if (node.dataset[key] === '1') return;
      node.dataset[key] = '1';
      node.addEventListener(eventName, handler);
    };

    bindOnce('btninformesExportar', 'click', () => exportar('xlsx'));
    bindOnce('btninformesExportarPdf', 'click', () => exportar('pdf'));
    bindOnce('btninformesFechasTodas', 'click', seleccionarTodasFechas);
    bindOnce('btninformesFechasLimpiar', 'click', limpiarFechasSeleccionadas);
    bindOnce('informesTipo', 'change', async () => {
      // @ts-ignore
      const anioActual = Number(el('informesAnio')?.value || 0) || state.anio;
      // @ts-ignore
      const mesActual = Number(el('informesMes')?.value || 0) || state.mes;
      try {
        await cargarPeriodosDisponibles();
        poblarPeriodoDisponible(anioActual, mesActual);
        await actualizarVisibilidadBorrador();
        await poblarFechasCuadrante();
      } catch (err) {
        setError(
          err.message ||
            'No se pudieron cargar los períodos para la fuente seleccionada.'
        );
      }
      actualizarResumenFuente();
    });
    bindOnce('informesModoPorDia', 'change', actualizarModoPorDia);
    bindOnce('informesBorrador', 'change', async () => {
      // @ts-ignore
      state.borradorId = el('informesBorrador')?.value || null;
      await poblarFechasCuadrante();
      actualizarResumenFuente();
    });

    bindOnce('informesAnio', 'change', async () => {
      // @ts-ignore
      poblarMesesPorAnio(el('informesAnio')?.value, null);
      // @ts-ignore
      if (el('informesTipo')?.value === 'borrador') await cargarBorradores();
      await poblarFechasCuadrante();
      actualizarResumenFuente();
    });

    bindOnce('informesMes', 'change', async () => {
      // @ts-ignore
      if (el('informesTipo')?.value === 'borrador') await cargarBorradores();
      await poblarFechasCuadrante();
      actualizarResumenFuente();
    });
  }


  // ══════════════════════════════════════════════════════════════════════════
  // RESUMEN ACTIVIDADES - INDEPENDIENTE (sin compartir estado)
  // ══════════════════════════════════════════════════════════════════════════

  const stateRA = { 
    periodos: [],
    anio: null,
    mes: null,
    borradorId: null,
    borradores: [],
    fechasDisponibles: []
  };

  function elRA(id) { return document.getElementById(id); }

  async function cargarPeriodosRA(preferredAnio, preferredMes) {
    // @ts-ignore
    const source = String(elRA('raFuente')?.value || 'definitivo').toLowerCase();
    try {
      const resp = await fetch(
        `/api/asignaciones/periodos-disponibles?source=${encodeURIComponent(source)}`,
        {
          headers: getHeaders(),
          cache: 'no-store',
        }
      );
      if (!resp.ok) {
        throw new Error('No se pudieron cargar periodos efectivos');
      }

      const json = await resp.json();
      stateRA.periodos = buildPeriodos(
        Array.isArray(json.periodos) ? json.periodos : []
      );
    } catch (_err) {
      const resp = await fetch('/api/cuadrantes', {
        headers: getHeaders(),
        cache: 'no-store',
      });
      if (!resp.ok) {
        stateRA.periodos = [];
      } else {
        const json = await resp.json();
        stateRA.periodos = buildPeriodos(Array.isArray(json.data) ? json.data : []);
      }
    }

    poblarAnoRA(preferredAnio, preferredMes);
  }

  function poblarAnoRA(preferredAnio, preferredMes) {
    const anioSel = elRA('raAnio');
    if (!anioSel) return;
    const mesSel = elRA('raMes');

    if (!stateRA.periodos.length) {
      anioSel.innerHTML = '<option value="">Sin años</option>';
      if (mesSel) mesSel.innerHTML = '<option value="">Sin meses</option>';
      return;
    }

    anioSel.innerHTML = stateRA.periodos
      .map((p) => `<option value="${p.anio}">${p.anio}</option>`)
      .join('');
    const anios = stateRA.periodos.map((p) => p.anio);
    const selectedAnio = anios.includes(Number(preferredAnio))
      ? Number(preferredAnio)
      : anios[0];
    // @ts-ignore
    anioSel.value = String(selectedAnio);
    stateRA.anio = selectedAnio;

    poblarMesRA(preferredMes);
  }

  function poblarMesRA(preferredMes) {
    const mesSel = elRA('raMes');
    if (!mesSel) return;

    // @ts-ignore
    const anio = Number(elRA('raAnio')?.value || stateRA.anio || 0);
    const period = stateRA.periodos.find((p) => p.anio === anio);
    const meses = (period && period.meses) || [];

    if (!meses.length) {
      mesSel.innerHTML = '<option value="">Sin meses</option>';
      stateRA.mes = null;
      return;
    }

    mesSel.innerHTML = meses
      .map((m) => `<option value="${m}">${MESES[m - 1] || m}</option>`)
      .join('');
    const selectedMes = meses.includes(Number(preferredMes))
      ? Number(preferredMes)
      : meses[meses.length - 1];
    // @ts-ignore
    mesSel.value = String(selectedMes);
    stateRA.mes = selectedMes;
    sincronizarRangoFechasRA();
  }

  function formatoIsoFecha(y, m, d) {
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function limitesMesRA() {
    // @ts-ignore
    const anio = Number(elRA('raAnio')?.value || stateRA.anio || 0);
    // @ts-ignore
    const mes = Number(elRA('raMes')?.value || stateRA.mes || 0);
    if (!anio || !mes) return null;
    const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    return {
      desdeMes: formatoIsoFecha(anio, mes, 1),
      hastaMes: formatoIsoFecha(anio, mes, ultimoDia),
    };
  }

  function limitesFechasRA() {
    if (Array.isArray(stateRA.fechasDisponibles) && stateRA.fechasDisponibles.length) {
      return {
        desdeMes: stateRA.fechasDisponibles[0],
        hastaMes: stateRA.fechasDisponibles[stateRA.fechasDisponibles.length - 1],
      };
    }
    return limitesMesRA();
  }

  async function cargarFechasDisponiblesRA() {
    // @ts-ignore
    const anio = Number(elRA('raAnio')?.value || 0);
    // @ts-ignore
    const mes = Number(elRA('raMes')?.value || 0);
    // @ts-ignore
    const tipo = String(elRA('raFuente')?.value || 'definitivo').toLowerCase();
    if (!anio || !mes) {
      stateRA.fechasDisponibles = [];
      sincronizarRangoFechasRA();
      return;
    }

    if (tipo === 'borrador' && !stateRA.borradorId) {
      stateRA.fechasDisponibles = [];
      sincronizarRangoFechasRA();
      return;
    }

    const url = tipo === 'borrador' && stateRA.borradorId
      ? `/api/asignaciones/cuadrante/${anio}/${mes}?borrador_id=${encodeURIComponent(String(stateRA.borradorId))}`
      : `/api/asignaciones/cuadrante/${anio}/${mes}?source=definitivo`;

    try {
      const resp = await fetch(url, { headers: getHeaders(), cache: 'no-store' });
      if (!resp.ok) throw new Error('No se pudieron cargar fechas del cuadrante');
      const json = await resp.json();
      const rows = tipo === 'borrador'
        ? (Array.isArray(json.borrador) ? json.borrador : [])
        : (Array.isArray(json.definitivo) ? json.definitivo : []);

      const fechas = Array.from(
        new Set(
          rows
            .map((r) => String((r && r.fecha) || '').slice(0, 10))
            .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f))
        )
      ).sort((a, b) => a.localeCompare(b));

      stateRA.fechasDisponibles = fechas;
    } catch (_err) {
      stateRA.fechasDisponibles = [];
    }

    sincronizarRangoFechasRA();
  }

  function sincronizarRangoFechasRA() {
    const desdeInput = elRA('raFechaDesde');
    const hastaInput = elRA('raFechaHasta');
    if (!desdeInput || !hastaInput) return;

    const limites = limitesFechasRA();
    if (!limites) return;

    // @ts-ignore
    desdeInput.min = limites.desdeMes;
    // @ts-ignore
    desdeInput.max = limites.hastaMes;
    // @ts-ignore
    hastaInput.min = limites.desdeMes;
    // @ts-ignore
    hastaInput.max = limites.hastaMes;

    // @ts-ignore
    const actualDesde = String(desdeInput.value || '');
    // @ts-ignore
    const actualHasta = String(hastaInput.value || '');
    if (!actualDesde || actualDesde < limites.desdeMes || actualDesde > limites.hastaMes) {
      // @ts-ignore
      desdeInput.value = limites.desdeMes;
    }
    if (!actualHasta || actualHasta < limites.desdeMes || actualHasta > limites.hastaMes) {
      // @ts-ignore
      hastaInput.value = limites.hastaMes;
    }
  }

  function obtenerRangoFechasRA() {
    const limites = limitesFechasRA();
    if (!limites) return { desde: '', hasta: '' };

    const desdeInput = elRA('raFechaDesde');
    const hastaInput = elRA('raFechaHasta');
    // @ts-ignore
    let desde = String(desdeInput?.value || limites.desdeMes);
    // @ts-ignore
    let hasta = String(hastaInput?.value || limites.hastaMes);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) desde = limites.desdeMes;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hasta)) hasta = limites.hastaMes;
    if (desde > hasta) {
      const tmp = desde;
      desde = hasta;
      hasta = tmp;
    }

    return { desde, hasta };
  }

  function expandirRangoFechas(desde, hasta) {
    const out = [];
    if (!desde || !hasta) return out;
    let cursor = new Date(`${desde}T00:00:00Z`);
    const fin = new Date(`${hasta}T00:00:00Z`);
    while (cursor <= fin) {
      out.push(cursor.toISOString().slice(0, 10));
      cursor = new Date(cursor.getTime() + 86400000);
    }
    return out;
  }

  async function cargarBorradoresRA() {
    // @ts-ignore
    const anio = Number(elRA('raAnio')?.value || 0);
    // @ts-ignore
    const mes = Number(elRA('raMes')?.value || 0);
    if (!anio || !mes) return;

    const sel = elRA('raBorrador');
    if (!sel) return;

    sel.innerHTML = '<option value="">Cargando…</option>';
    try {
      const resp = await fetch(`/api/asignaciones/borradores/${anio}/${mes}`, {
        headers: getHeaders(),
      });
      const data = await resp.json();
      stateRA.borradores = data.borradores || [];
      sel.innerHTML = '';

      stateRA.borradores.forEach((b) => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = `${b.nombre} (v${b.version}) — ${b.estado}`;
        sel.appendChild(opt);
      });

      if (!stateRA.borradores.length) {
        sel.innerHTML = '<option value="">Sin borradores</option>';
        stateRA.borradorId = null;
      } else {
        // @ts-ignore
        sel.value = String(stateRA.borradores[0].id);
        stateRA.borradorId = stateRA.borradores[0].id;
      }
    } catch (_e) {
      sel.innerHTML = '<option value="">Error al cargar</option>';
      stateRA.borradorId = null;
    }
  }

  async function actualizarBorradorVisibilidadRA() {
    // @ts-ignore
    const tipo = elRA('raFuente')?.value || 'definitivo';
    const wrap = elRA('raBorradorWrap');
    if (wrap) wrap.style.display = tipo === 'borrador' ? 'block' : 'none';
    if (tipo === 'borrador') {
      await cargarBorradoresRA();
    } else {
      stateRA.borradorId = null;
    }
    await cargarFechasDisponiblesRA();
  }

  async function generarResumenRA() {
    const container = elRA('raTablaContainer');
    if (!container) return;

    // @ts-ignore
    const anio = Number(elRA('raAnio')?.value || 0);
    // @ts-ignore
    const mes = Number(elRA('raMes')?.value || 0);
    // @ts-ignore
    const tipo = String(elRA('raFuente')?.value || 'definitivo').toLowerCase();

    if (!anio || !mes) {
      container.innerHTML = '<div class="alert alert-warning">Selecciona año y mes.</div>';
      return;
    }

    let borradorId = null;
    if (tipo === 'borrador') {
      // @ts-ignore
      borradorId = elRA('raBorrador')?.value || null;
      if (!borradorId) {
        container.innerHTML = '<div class="alert alert-warning">Selecciona un borrador.</div>';
        return;
      }
    }

    try {
      container.innerHTML = '<div class="text-center text-muted py-3">Generando tabla…</div>';
      const btn = elRA('btnRaGenerar');
      // @ts-ignore
      if (btn) btn.disabled = true;

      const headers = getHeaders();
      const cuadranteUrl = tipo === 'borrador' && borradorId
        ? `/api/asignaciones/cuadrante/${anio}/${mes}?borrador_id=${encodeURIComponent(String(borradorId))}`
        : `/api/asignaciones/cuadrante/${anio}/${mes}?source=definitivo`;

      const [cuadranteResp, metaResp] = await Promise.all([
        fetch(cuadranteUrl, { headers, cache: 'no-store' }),
        fetch('/api/asignaciones/meta', { headers, cache: 'no-store' }),
      ]);

      if (!cuadranteResp.ok) {
        const err = await cuadranteResp
          .json()
          .catch(() => ({ error: 'Error al cargar cuadrante' }));
        throw new Error(err.error || `HTTP ${cuadranteResp.status}`);
      }
      if (!metaResp.ok) {
        const err = await metaResp
          .json()
          .catch(() => ({ error: 'Error al cargar meta' }));
        throw new Error(err.error || `HTTP ${metaResp.status}`);
      }

      const cuadranteJson = await cuadranteResp.json();
      const metaJson = await metaResp.json();

      const rango = obtenerRangoFechasRA();

      const baseRowsRaw = tipo === 'borrador'
        ? (Array.isArray(cuadranteJson.borrador) ? cuadranteJson.borrador : [])
        : (Array.isArray(cuadranteJson.definitivo) ? cuadranteJson.definitivo : []);
      const baseRows = baseRowsRaw.filter((r) => {
        const fecha = String((r && r.fecha) || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
        return fecha >= rango.desde && fecha <= rango.hasta;
      });
      const rawServicios = tipo === 'borrador'
        ? (Array.isArray(cuadranteJson.borradorServicios) ? cuadranteJson.borradorServicios : [])
        : (Array.isArray(cuadranteJson.definitivoServicios) ? cuadranteJson.definitivoServicios : []);
      const servicioKey = tipo === 'borrador' ? 'asignacion_borrador_id' : 'asignacion_id';

      const serviciosMap = new Map();
      rawServicios.forEach((s) => {
        const k = Number(s[servicioKey]);
        const actId = Number(s.actividad_id);
        if (!k || !actId) return;
        if (!serviciosMap.has(k)) serviciosMap.set(k, []);
        serviciosMap.get(k).push(actId);
      });

      const actividades = Array.isArray(metaJson.actividades)
        ? metaJson.actividades
        : [];
      const actividadMap = new Map();
      actividades.forEach((a) => {
        const id = Number(a.id_actividad || a.id);
        if (!id) return;
        const codigo = String(a.actividad || a.codigo || '').trim();
        const nombre = String(a.nombre || '').trim();
        actividadMap.set(id, codigo && nombre ? `${codigo} - ${nombre}` : codigo || nombre || `Actividad ${id}`);
      });

      const grupos = new Map();
      baseRows.forEach((r) => {
        const peloton = String(r.peloton_codigo || 'Sin pelotón').trim();
        const pelotonNombre = String(
          r.peloton_nombre || r.peloton || r.peloton_codigo || 'Sin pelotón'
        ).trim();
        const fecha = String((r && r.fecha) || '').slice(0, 10);
        const agenteId = Number(r && r.agente_id);
        if (!agenteId || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return;
        const actIdsFromRow = Array.isArray(r.actividad_ids)
          ? r.actividad_ids.map(Number).filter(Boolean)
          : [];
        const actIdsFromServicios = serviciosMap.get(Number(r.id)) || [];
        const actIds = Array.from(
          new Set(actIdsFromRow.length ? actIdsFromRow : actIdsFromServicios)
        );
        if (!actIds.length) return;

        actIds.forEach((actId) => {
          const key = `${peloton}|||${pelotonNombre}|||${fecha}|||${actId}`;
          if (!grupos.has(key)) {
            grupos.set(key, {
              peloton_codigo: peloton,
              peloton_nombre: pelotonNombre,
              fecha,
              actividad_label: actividadMap.get(actId) || `Actividad ${actId}`,
              agentes: new Set(),
            });
          }
          grupos.get(key).agentes.add(agenteId);
        });
      });

      const rows = Array.from(grupos.values()).sort((a, b) => {
        const pc = a.peloton_codigo.localeCompare(b.peloton_codigo, 'es');
        if (pc !== 0) return pc;
        const fc = String(a.fecha || '').localeCompare(String(b.fecha || ''), 'es');
        if (fc !== 0) return fc;
        return a.actividad_label.localeCompare(b.actividad_label, 'es');
      });

      if (!rows.length) {
        container.innerHTML = '<div class="alert alert-info">Sin datos para mostrar.</div>';
        // @ts-ignore
        if (btn) btn.disabled = false;
        return;
      }

      const formatFechaResumen = (iso) => {
        const text = String(iso || '').slice(0, 10);
        const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return text || '—';
        return `${m[3]}/${m[2]}/${m[1]}`;
      };

      // Agrupar por día + actividad
      const actividadesMapa = new Map();
      rows.forEach((row) => {
        const fecha = String(row.fecha || '').slice(0, 10) || '—';
        const actLabel = row.actividad_label || '—';
        const key = `${fecha}|||${actLabel}`;
        if (!actividadesMapa.has(key)) {
          actividadesMapa.set(key, {
            fecha,
            actividad_label: actLabel,
            agentes: new Set(),
          });
        }
        const act = actividadesMapa.get(key);
        if (row.agentes && row.agentes instanceof Set) {
          row.agentes.forEach((a) => act.agentes.add(a));
        }
      });

      const actividadesArray = Array.from(actividadesMapa.values()).sort((a, b) =>
        String(a.fecha || '').localeCompare(String(b.fecha || ''), 'es') ||
        a.actividad_label.localeCompare(b.actividad_label, 'es')
      );

      const totalAgenteGlobal = Array.from(
        new Set(
          rows.reduce((acc, row) => {
            if (row.agentes && row.agentes instanceof Set) {
              row.agentes.forEach((a) => acc.add(a));
            }
            return acc;
          }, new Set())
        )
      ).length;

      let html = '<div class="informes-ra-table-wrap"><table class="table table-sm table-hover" style="font-size:0.85rem"><thead><tr><th style="background:#276836;color:white;text-align:center">Total Agentes</th><th style="background:#3a7d4a;color:white">Día</th><th style="background:#3a7d4a;color:white">Código Actividad</th><th style="background:#3a7d4a;color:white">Descripción Actividad</th><th style="background:#3a7d4a;color:white;text-align:right">Agentes</th></tr></thead><tbody>';

      actividadesArray.forEach((act, index) => {
        html += '<tr>';
        if (index === 0) {
          html += `<td rowspan="${actividadesArray.length}" style="font-weight:bold;vertical-align:middle;background:#f0f5f1;text-align:center;font-size:1.1em">${totalAgenteGlobal}</td>`;
        }
        const actParts = String(act.actividad_label || '').split(' - ');
        const codigo = actParts[0] || '—';
        const descripcion = actParts.slice(1).join(' - ') || '—';
        html += `<td style="vertical-align:middle">${formatFechaResumen(act.fecha)}</td>`;
        html += `<td style="vertical-align:middle">${codigo}</td>`;
        html += `<td style="vertical-align:middle">${descripcion}</td>`;
        html += `<td style="text-align:right;vertical-align:middle;font-weight:bold">${act.agentes.size}</td>`;
        html += '</tr>';
      });

      html += '</tbody></table></div>';
      container.innerHTML = html;

      const btnExcel = elRA('btnRaExcel');
      // @ts-ignore
      if (btnExcel) btnExcel.disabled = false;

      const badge = elRA('raResumenBadge');
      if (badge) {
        badge.textContent = `${rows.length} registros`;
        badge.style.display = 'inline-block';
      }

      // @ts-ignore
      if (btn) btn.disabled = false;
    } catch (err) {
      container.innerHTML = `<div class="alert alert-danger">Error: ${err.message}</div>`;
      const btn = elRA('btnRaGenerar');
      // @ts-ignore
      if (btn) btn.disabled = false;
    }
  }

  async function exportarResumenExcelRA() {
    const btn = elRA('btnRaExcel');
    // @ts-ignore
    if (btn) btn.disabled = true;

    // @ts-ignore
    const anio = Number(elRA('raAnio')?.value || 0);
    // @ts-ignore
    const mes = Number(elRA('raMes')?.value || 0);
    // @ts-ignore
    const tipo = String(elRA('raFuente')?.value || 'definitivo').toLowerCase();

    let borradorId = null;
    if (tipo === 'borrador') {
      // @ts-ignore
      borradorId = elRA('raBorrador')?.value || null;
    }

    try {
      const params = new URLSearchParams({ anio: String(anio), mes: String(mes) });
      if (tipo === 'borrador' && borradorId) {
        params.set('borrador_id', borradorId);
      } else {
        params.set('source', 'definitivo');
      }
      const rango = obtenerRangoFechasRA();
      const fechas = expandirRangoFechas(rango.desde, rango.hasta);
      if (fechas.length) params.set('fechas', fechas.join(','));

      const resp = await fetch(`/api/asignaciones/resumen-actividades/excel?${params}`, {
        headers: getHeaders(),
      });

      if (!resp.ok) throw new Error(`Error ${resp.status}`);

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const disposition = resp.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i);
      const fromHeader = match && match[1] ? decodeURIComponent(match[1].replace(/\"/g, '')) : '';
      const a = document.createElement('a');
      a.href = url;
      a.download = fromHeader || `resumen-actividades-${anio}-${String(mes).padStart(2, '0')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const errDiv = elRA('raError');
      if (errDiv) {
        errDiv.textContent = `Error al exportar: ${err.message}`;
        errDiv.classList.remove('informes-hidden');
      }
    } finally {
      // @ts-ignore
      if (btn) btn.disabled = false;
    }
  }

  function bindEventosRA() {
    const bindOnce = (id, evt, fn) => {
      const node = elRA(id);
      if (!node) return;
      const key = `bound_${evt}`;
      if (node.dataset[key] === '1') return;
      node.dataset[key] = '1';
      node.addEventListener(evt, fn);
    };

    bindOnce('raFuente', 'change', async () => {
      await cargarPeriodosRA();
      await actualizarBorradorVisibilidadRA();
      sincronizarRangoFechasRA();
    });
    bindOnce('raAnio', 'change', async () => {
      poblarMesRA();
      await actualizarBorradorVisibilidadRA();
      sincronizarRangoFechasRA();
    });
    bindOnce('raMes', 'change', async () => {
      await actualizarBorradorVisibilidadRA();
      sincronizarRangoFechasRA();
    });
    bindOnce('raBorrador', 'change', async () => {
      // @ts-ignore
      stateRA.borradorId = elRA('raBorrador')?.value || null;
      await cargarFechasDisponiblesRA();
    });

    bindOnce('btnRaGenerar', 'click', generarResumenRA);
    bindOnce('btnRaExcel', 'click', exportarResumenExcelRA);

    const accordionEl = document.getElementById('informesResumenActividades');
    if (accordionEl && !accordionEl.dataset.raInitBound) {
      accordionEl.dataset.raInitBound = '1';
      accordionEl.addEventListener('show.bs.collapse', async () => {
        await cargarPeriodosRA(state.anio, state.mes);
        await actualizarBorradorVisibilidadRA();
      });
    }
  }

  app.initializeinformes = async function initializeinformes() {
    bindEventos();
    bindEventosRA();
    setError(null);
    try {
      await cargarPeriodosDisponibles();
      poblarPeriodoDisponible(state.anio, state.mes);
      await cargarPeriodosRA(state.anio, state.mes);
      await actualizarBorradorVisibilidadRA();
    } catch (err) {
      setError(
        err.message || 'No se pudieron inicializar los períodos de informes.'
      );
    }

    await actualizarVisibilidadBorrador();
    await poblarFechasCuadrante();
    actualizarModoPorDia();
    actualizarResumenFuente();
    updateExportButtonState();
  };
})();

