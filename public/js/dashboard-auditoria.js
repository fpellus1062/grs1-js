(function () {
  const app = window.GRS1Dashboard;

  let TABULATOR_LANGS = window.GRS1TabulatorLangs;

  let tabulatorAudit = null;

  function headers() {
    let h = { Authorization: 'Bearer ' + app.globalState.token };
    if (app.globalState.activeArsId)
      h['X-Ars-Id'] = app.globalState.activeArsId;
    return h;
  }

  function showAlert(message, type) {
    let el = document.getElementById('alertContainerAudit');
    if (!el) return;
    el.innerHTML =
      '<div class="alert alert-' +
      type +
      ' alert-dismissible py-1 mb-1 fade show" role="alert">' +
      app.escapeHtml(message) +
      '<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>';
    setTimeout(function () {
      el.innerHTML = '';
    }, 5000);
  }

  function resultadoBadge(cell) {
    let val = cell.getValue();
    let map = {
      OK: { label: 'OK', cls: 'bg-success' },
      PASSWORD_FAIL: { label: 'Contraseña', cls: 'bg-danger' },
      BLOQUEADO: { label: 'Bloqueado', cls: 'bg-warning text-dark' },
      INACTIVO: { label: 'Inactivo', cls: 'bg-secondary' },
      USUARIO_NO_EXISTE: { label: 'No existe', cls: 'bg-dark' },
    };
    let info = map[val] || { label: val, cls: 'bg-info' };
    return '<span class="badge ' + info.cls + '">' + info.label + '</span>';
  }

  function formatDateTime(cell) {
    let val = cell.getValue();
    if (!val) return '';
    try {
      let d = new Date(val);
      return (
        d.toLocaleDateString('es-ES', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }) +
        ' ' +
        d.toLocaleTimeString('es-ES', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    } catch (_) {
      return val;
    }
  }

  app.initTabulatorAudit = function initTabulatorAudit() {
    tabulatorAudit = new Tabulator('#tabulatorAudit', {
      locale: 'es-es',
      langs: TABULATOR_LANGS,
      layout: 'fitDataFill',
      height: 'calc(100vh - 420px)',
      pagination: true,
      paginationSize: 25,
      paginationSizeSelector: [10, 25, 50, true],
      placeholder: 'No hay registros de auditoría',
      columnDefaults: { resizable: true, headerFilter: 'input' },
      columns: [
        {
          title: 'Fecha / Hora',
          field: 'created_at',
          width: 165,
          sorter: 'datetime',
          formatter: formatDateTime,
          headerFilter: false,
        },
        {
          title: 'Usuario',
          field: 'usuario_nombre',
          width: 150,
          formatter: function (cell) {
            return cell.getValue() || '<em class="text-muted">—</em>';
          },
        },
        { title: 'Email / Login', field: 'email', width: 200 },
        {
          title: 'Resultado',
          field: 'resultado',
          width: 130,
          formatter: resultadoBadge,
          headerFilter: 'select',
          headerFilterParams: {
            values: {
              '': 'Todos',
              OK: 'OK',
              PASSWORD_FAIL: 'Contraseña',
              BLOQUEADO: 'Bloqueado',
              INACTIVO: 'Inactivo',
              USUARIO_NO_EXISTE: 'No existe',
            },
          },
        },
        { title: 'Detalle', field: 'detalle', width: 160 },
        { title: 'IP', field: 'ip', width: 130 },
        {
          title: 'User-Agent',
          field: 'user_agent',
          minWidth: 200,
          formatter: function (cell) {
            let val = cell.getValue() || '';
            if (val.length > 60)
              return (
                '<span title="' +
                app.escapeHtml(val) +
                '">' +
                app.escapeHtml(val.substring(0, 60)) +
                '…</span>'
              );
            return app.escapeHtml(val);
          },
        },
      ],
    });
  };

  app.loadAuditLogin = async function loadAuditLogin() {
    try {
      let desde = document.getElementById('auditDesde')?.value || '';
      let hasta = document.getElementById('auditHasta')?.value || '';

      let url = '/api/audit/login?limit=500';
      if (desde) url += '&desde=' + encodeURIComponent(desde + 'T00:00:00');
      if (hasta) url += '&hasta=' + encodeURIComponent(hasta + 'T23:59:59');

      let res = await fetch(url, { headers: headers() });
      if (!res.ok)
        throw new Error('Error al cargar auditoría (' + res.status + ')');

      let json = await res.json();
      let records = json.data || [];

      if (tabulatorAudit) {
        await tabulatorAudit.setData(records);
      }
    } catch (e) {
      console.error('[Auditoría]', e);
      showAlert(e.message, 'danger');
    }
  };

  app.setupAuditEventListeners = function setupAuditEventListeners() {
    // Filtrar por fecha
    document
      .getElementById('btnAuditFiltrar')
      ?.addEventListener('click', function () {
        app.loadAuditLogin();
      });

    // Exportar Excel
    document
      .getElementById('btnExportExcelAudit')
      ?.addEventListener('click', function () {
        if (!tabulatorAudit) return;
        let ts = new Date()
          .toISOString()
          .slice(0, 19)
          .replace('T', '_')
          .replace(/:/g, '-');
        tabulatorAudit.download('xlsx', 'auditoria_login_' + ts + '.xlsx', {
          sheetName: 'Auditoría Login',
        });
      });

    // Exportar PDF
    document
      .getElementById('btnExportPdfAudit')
      ?.addEventListener('click', function () {
        if (!tabulatorAudit) return;
        let usuario = app.globalState.userName || '';
        let fecha = new Date().toLocaleString('es-ES');
        let ts = new Date()
          .toISOString()
          .slice(0, 19)
          .replace('T', '_')
          .replace(/:/g, '-');
        let title = 'Auditoría de Login';
        let cols = tabulatorAudit.getColumns().filter(function (c) {
          return c.getDefinition().title && c.getDefinition().field;
        });
        let head = [
          cols.map(function (c) {
            return c.getDefinition().title;
          }),
        ];
        let body = tabulatorAudit.getData('active').map(function (row) {
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
            doc.setFontSize(11);
            doc.text(title, 14, 12);
            doc.setFontSize(7);
            doc.text('Usuario: ' + usuario + '   Fecha: ' + fecha, 14, ph - 5);
            doc.text(
              'Página ' +
                doc.internal.getCurrentPageInfo().pageNumber +
                ' de ' +
                doc.internal.getNumberOfPages(),
              pw - 14,
              ph - 5,
              { align: 'right' }
            );
          },
        });
        doc.save('auditoria_login_' + ts + '.pdf');
      });
  };
})();
