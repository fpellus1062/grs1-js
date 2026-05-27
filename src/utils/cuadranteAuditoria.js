const ExcelJS = require('exceljs');

module.exports = function registerCuadranteAuditoria(app, pool) {
  app.get('/export-cuadrante-db', async (req, res) => {
    try {
      const { fecha_inicio, fecha_fin } = req.query;

      // =========================
      // 1. OBTENER DATOS
      // =========================
      const result = await pool.query(
        `
      SELECT fecha, agente_id, turno_id
      FROM asignaciones
      WHERE fecha BETWEEN $1 AND $2
      ORDER BY agente_id, fecha
    `,
        [fecha_inicio, fecha_fin]
      );

      const rows = result.rows;

      // =========================
      // 2. TRANSFORMAR DATOS
      // =========================
      const diasSet = new Set();
      const agentesMap = {};

      rows.forEach((r) => {
        const fecha = r.fecha.toISOString().slice(0, 10);
        diasSet.add(fecha);

        if (!agentesMap[r.agente_id]) {
          agentesMap[r.agente_id] = {};
        }

        agentesMap[r.agente_id][fecha] = r.turno_id;
      });

      const dias = Array.from(diasSet).sort();
      const agentes = Object.keys(agentesMap);

      // =========================
      // 3. CREAR EXCEL
      // =========================
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Cuadrante');

      // Cabecera
      const headers = ['Agente', ...dias.map((d) => d.slice(8, 10))];
      sheet.addRow(headers);

      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true };

      // Colores por turno
      const turnoColors = {
        1: 'FFCCFFFF',
        2: 'FFCCFFCC',
        3: 'FFFFFFCC',
        4: 'FFFFCCCC',
      };

      // =========================
      // 4. RELLENAR FILAS
      // =========================
      agentes.forEach((agenteId) => {
        const rowData = [agenteId];

        dias.forEach((dia) => {
          const turno = agentesMap[agenteId][dia] || '';
          rowData.push(turno ? `T${turno}` : '');
        });

        const row = sheet.addRow(rowData);

        row.eachCell((cell, colNumber) => {
          if (colNumber > 1 && cell.value) {
            const turnoNum = cell.value.replace('T', '');

            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: turnoColors[turnoNum] || 'FFFFFFFF' },
            };

            cell.alignment = { horizontal: 'center' };
          }
        });
      });

      // =========================
      // 5. AJUSTES VISUALES
      // =========================
      sheet.columns.forEach((col) => (col.width = 5));
      sheet.getColumn(1).width = 15;

      sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }];

      // =========================
      // 6. EXPORT
      // =========================
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );

      res.setHeader(
        'Content-Disposition',
        'attachment; filename=cuadrante_db.xlsx'
      );

      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error generando cuadrante' });
    }
  });
};
