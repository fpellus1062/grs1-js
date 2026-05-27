/**
 * dashboard-planificacion-grid-data.js
 * Builders de datos/columnas para el grid de Planificacion V2.
 */
(function () {
  'use strict';

  var app = window.GRS1Dashboard;
  if (!app) return;

  app.createPlanificacionGridBuilders = function createPlanificacionGridBuilders(deps) {
    var safeBadgeColor = deps.safeBadgeColor;
    var agenteNombreCompleto = deps.agenteNombreCompleto;
    var actividadColor = deps.actividadColor;
    var actividadNombre = deps.actividadNombre;
    var actividadTooltip = deps.actividadTooltip || actividadNombre;
    var escapeHtml = deps.escapeHtml;
    var buildContextMenu = deps.buildContextMenu;
    var getFestivosSet = deps.getFestivosSet;
    var getGridFilterAgentes = deps.getGridFilterAgentes;
    var meses = deps.meses || [];

    function buildAgenteMetaById(agentes) {
      var out = new Map();
      (Array.isArray(agentes) ? agentes : []).forEach(function (ag) {
        out.set(String(ag.id), {
          nombre: agenteNombreCompleto(ag),
          tip: ag.tip || '',
          empleo_desc: ag.empleo_desc || ag.empleo_id || '',
          empleo_color: safeBadgeColor(ag.color_empleo || ag.empleo_color),
          peloton_desc: ag.peloton_desc || ag.peloton_id || '',
          peloton_color: safeBadgeColor(ag.color_peloton || ag.peloton_color),
          situacion_id: ag.situacion_id || '',
          situacion_desc: ag.situacion_desc || '',
          situacion_color: safeBadgeColor(ag.color_situacion || ag.situacion_color),
          aptitudes: ag.aptitudes || '',
          escalafon: ag.escalafon || '',
        });
      });
      return out;
    }

    function buildAgentesMap(agentes, asignaciones, agenteMetaById) {
      var agentesMap = new Map();

      (Array.isArray(agentes) ? agentes : []).forEach(function (ag) {
        var id = String(ag.id);
        var meta = agenteMetaById.get(id) || {};
        agentesMap.set(id, {
          agente_id: id,
          nombre: meta.nombre || agenteNombreCompleto(ag) || 'Agente #' + id,
          tip: meta.tip || '',
          empleo_desc: meta.empleo_desc || '',
          empleo_color: meta.empleo_color || '#6c757d',
          peloton_desc: meta.peloton_desc || '',
          peloton_color: meta.peloton_color || '#6c757d',
          situacion_id: meta.situacion_id || '',
          situacion_desc: meta.situacion_desc || '',
          situacion_color: meta.situacion_color || '#6c757d',
          aptitudes: meta.aptitudes || '',
          escalafon: meta.escalafon || '',
          dias: {},
        });
      });

      (Array.isArray(asignaciones) ? asignaciones : []).forEach(function (a) {
        var id = String(a.agente_id);
        if (!agentesMap.has(id)) {
          var meta = agenteMetaById.get(id) || {};
          agentesMap.set(id, {
            agente_id: id,
            nombre:
              meta.nombre ||
              [a.apellido_1 || '', a.apellido_2 || '', a.agente_nombre || '']
                .filter(Boolean)
                .join(' ') ||
              'Agente #' + id,
            tip: meta.tip || '',
            empleo_desc: meta.empleo_desc || '',
            empleo_color: meta.empleo_color || '#6c757d',
            peloton_desc: meta.peloton_desc || '',
            peloton_color: meta.peloton_color || '#6c757d',
            situacion_id: meta.situacion_id || '',
            situacion_desc: meta.situacion_desc || '',
            situacion_color: meta.situacion_color || '#6c757d',
            aptitudes: meta.aptitudes || '',
            escalafon: meta.escalafon || '',
            dias: {},
          });
        }
        agentesMap.get(id).dias[String(a.fecha).slice(0, 10)] = a.actividad_id;
      });

      return agentesMap;
    }

    function buildTableData(agentesMap, fechas) {
      var rows = [];
      var gridFilterAgentes = getGridFilterAgentes();
      agentesMap.forEach(function (ag) {
        if (gridFilterAgentes && !gridFilterAgentes.has(ag.agente_id)) return;
        var row = {
          agente_id: ag.agente_id,
          nombre: ag.nombre,
          tip: ag.tip || '',
          empleo_desc: ag.empleo_desc || '',
          color_empleo: ag.empleo_color || '#6c757d',
          empleo_color: ag.empleo_color || '#6c757d',
          peloton_desc: ag.peloton_desc || '',
          color_peloton: ag.peloton_color || '#6c757d',
          situacion_id: ag.situacion_id || '',
          situacion_desc: ag.situacion_desc || '',
          color_situacion: ag.situacion_color || '#6c757d',
          aptitudes: ag.aptitudes || '',
          escalafon: ag.escalafon || '',
        };
        fechas.forEach(function (dt) {
          row['d_' + dt.toISODate()] = ag.dias[dt.toISODate()] || null;
        });
        rows.push(row);
      });
      return rows;
    }

    function buildMonthGroupColumns(fechas) {
      var DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
      var grupos = [];
      var festivosSet = getFestivosSet();

      fechas.forEach(function (dt) {
        var key = dt.year + '-' + dt.month;
        if (!grupos.length || grupos[grupos.length - 1].key !== key) {
          grupos.push({
            key: key,
            title: (meses[dt.month] || '') + ' ' + dt.year,
            columns: [],
          });
        }
        var esFinde = dt.weekday >= 6;
        var iso = dt.toISODate();
        var esFestivo = festivosSet.has(iso);
        var field = 'd_' + iso;
        var headerStyle = esFestivo
          ? 'background:#ffebee;'
          : esFinde
            ? 'background:#fff8e1;'
            : '';
        grupos[grupos.length - 1].columns.push({
          title:
            '<div style="' +
            headerStyle +
            'line-height:1.1;font-size:.67rem">' +
            '<div>' +
            DIAS_SEMANA[dt.weekday - 1] +
            '</div>' +
            '<div>' +
            dt.day +
            '</div>' +
            (esFestivo
              ? '<div style="color:#c62828;font-size:.55rem">●</div>'
              : '') +
            '</div>',
          titleFormatter: 'html',
          field: field,
          minWidth: 34,
          hozAlign: 'center',
          headerSort: false,
          cssClass: esFinde ? 'planif-col-finde' : '',
          formatter: function (cell) {
            var actId = cell.getValue();
            if (!actId) return '';
            var bg = actividadColor(actId);
            var label = actividadNombre(actId);
            return (
              '<span style="background:' +
              bg +
              ';padding:1px 3px;border-radius:3px;' +
              'font-size:.63rem;white-space:nowrap">' +
              escapeHtml(label) +
              '</span>'
            );
          },
          // @ts-ignore
          tooltip: function (e, cell) {
            var actId = cell.getValue();
            if (!actId) return iso;
            return actividadTooltip(actId) + '\n' + iso;
          },
          cellContext: function (e, cell) {
            var rowData = cell.getRow().getData();
            buildContextMenu(e, String(rowData.agente_id), iso);
          },
        });
      });

      return grupos.map(function (g) {
        return { title: g.title, columns: g.columns };
      });
    }

    return {
      buildAgenteMetaById: buildAgenteMetaById,
      buildAgentesMap: buildAgentesMap,
      buildTableData: buildTableData,
      buildMonthGroupColumns: buildMonthGroupColumns,
    };
  };
})();
