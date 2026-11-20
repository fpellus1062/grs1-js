const ExcelJS = require('exceljs');

function sanitize(value) {
  return String(value || '')
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

exports.exportar = async (res, report, ajustes = {}) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Agentes por actividad', {
    views: [{ state: 'frozen', xSplit: 7, ySplit: 6 }],
  });
  const activities = report.actividades || [];
  const weeks = report.semanas || [];
  const rows = report.rows || [];
  const activityColumns = activities.map((activity) => {
    const activityId = Number(activity.id_actividad);
    const activityWeeks = weeks.filter((week) => {
      const field = `a${activityId}_s${week.num_semana}`;
      const total = rows.reduce((sum, row) => sum + Number(row[field] || 0), 0);
      return total !== 0;
    });
    return { activity, activityId, weeks: activityWeeks };
  });
  const colCount = 7 + activityColumns.reduce((sum, item) => sum + item.weeks.length + 3, 0);
  const green = 'FF276836';
  const lightGreen = 'FFEAF3ED';

  sheet.mergeCells(1, 1, 1, colCount);
  sheet.getCell(1, 1).value = 'Agentes por actividad — asignaciones definitivas';
  sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  sheet.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: green } };
  sheet.getCell(1, 1).alignment = { horizontal: 'left' };

  const periodo = report.periodo || {};
  sheet.mergeCells(2, 1, 2, colCount);
  sheet.getCell(2, 1).value =
    `${periodo.fecha_inicio || '—'} a ${periodo.fecha_fin || '—'} · Fuente: definitivo` +
    `${periodo.solo_pernoctas ? ' · Solo Pernoctas' : ''}`;
  sheet.getCell(2, 1).font = { bold: true, size: 16};
  sheet.mergeCells(3, 1, 3, colCount);
  sheet.getCell(3, 1).value =
    'Los semanales y totales calculados cuentan días distintos. Los ajustes son temporales y se incluyen aquí.';
  [2, 3].forEach((row) => {
    sheet.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: lightGreen } };
    sheet.getCell(row, 1).font = { italic: row === 3, size: 10 };
  });

  sheet.mergeCells(5, 1, 6, 1);
  sheet.mergeCells(5, 2, 6, 2);
  sheet.mergeCells(5, 3, 6, 3);
  sheet.mergeCells(5, 4, 6, 4);
  sheet.getCell(5, 1).value = 'Pelotón';
  sheet.getCell(5, 2).value = 'TIP';
  sheet.getCell(5, 3).value = 'Nombre';
  sheet.getCell(5, 4).value = 'Empleo';
  sheet.mergeCells(5, 5, 5, 7);
  sheet.getCell(5, 5).value = 'Resumen general';
  sheet.getCell(6, 5).value = 'Total calculado';
  sheet.getCell(6, 6).value = 'Total ajuste';
  sheet.getCell(6, 7).value = 'Total final';

  let col = 8;
  activityColumns.forEach(({ activity, weeks: activityWeeks }) => {
    const start = col;
    const end = col + activityWeeks.length + 2;
    sheet.mergeCells(5, start, 5, end);
    sheet.getCell(5, start).value = `${activity.actividad} - ${activity.nombre}`;
    activityWeeks.forEach((week) => {
      sheet.getCell(6, col).value =
        `Semana ${week.num_semana}\n${week.fecha_inicio} a ${week.fecha_fin}`;
      col += 1;
    });
    sheet.getCell(6, col++).value = 'Total calculado';
    sheet.getCell(6, col++).value = 'Ajuste';
    sheet.getCell(6, col++).value = 'Total final';
  });

  for (let c = 1; c <= colCount; c += 1) {
    for (let r = 5; r <= 6; r += 1) {
      const cell = sheet.getCell(r, c);
      if (cell.value == null) continue;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: green } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    }
  }
  sheet.getRow(5).height = 22;
  sheet.getRow(6).height = 34;

  rows.forEach((reportRow, index) => {
    const row = sheet.getRow(7 + index);
    row.getCell(1).value = reportRow.peloton;
    row.getCell(2).value = reportRow.tip;
    row.getCell(3).value = reportRow.nombre;
    row.getCell(4).value = reportRow.empleo;
    const totalGeneral = activityColumns.reduce(
      (sum, { activityId }) => sum + Number(reportRow[`a${activityId}_total`] || 0),
      0
    );
    const ajusteGeneral = activityColumns.reduce(
      (sum, { activity }) => {
        const value = Number(ajustes[`${reportRow.agente_id}:${activity.id_actividad}`] || 0);
        return sum + (Number.isInteger(value) ? value : 0);
      },
      0
    );
    row.getCell(5).value = totalGeneral;
    row.getCell(6).value = ajusteGeneral;
    row.getCell(7).value = totalGeneral + ajusteGeneral;
    let cell = 8;
    activityColumns.forEach(({ activityId, weeks: activityWeeks }) => {
      const adjustment = Number(ajustes[`${reportRow.agente_id}:${activityId}`] || 0);
      activityWeeks.forEach((week) => {
        row.getCell(cell++).value = Number(reportRow[`a${activityId}_s${week.num_semana}`] || 0);
      });
      const total = Number(reportRow[`a${activityId}_total`] || 0);
      row.getCell(cell++).value = total;
      row.getCell(cell++).value = Number.isInteger(adjustment) ? adjustment : 0;
      row.getCell(cell++).value = total + (Number.isInteger(adjustment) ? adjustment : 0);
    });
  });

  const totalRowNumber = 7 + rows.length;
  const totalRow = sheet.getRow(totalRowNumber);
  totalRow.getCell(3).value = 'TOTALES';
  for (let column = 5; column <= colCount; column += 1) {
    totalRow.getCell(column).value = rows.reduce(
      (sum, _row, rowIndex) => sum + Number(sheet.getRow(7 + rowIndex).getCell(column).value || 0),
      0
    );
  }
  totalRow.font = { bold: true, color: { argb: green } };
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: lightGreen } };

  sheet.columns = Array.from({ length: colCount }, (_, index) => ({
    width: index === 0 ? 22 : index === 1 ? 14 : index === 2 ? 30 : index === 3 ? 22 : 15,
  }));
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFDDE8E0' } },
        bottom: { style: 'thin', color: { argb: 'FFDDE8E0' } },
        left: { style: 'thin', color: { argb: 'FFDDE8E0' } },
        right: { style: 'thin', color: { argb: 'FFDDE8E0' } },
      };
      cell.alignment = { ...cell.alignment, vertical: 'middle' };
    });
  });

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const filename = `agentes_por_actividad_${sanitize(periodo.fecha_inicio)}_${sanitize(periodo.fecha_fin)}_${stamp}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  res.setHeader('Content-Length', String(buffer.length));
  res.send(buffer);
};
