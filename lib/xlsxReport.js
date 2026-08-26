const ExcelJS = require('exceljs');
const sharp = require('sharp');

const RESULT_LABEL = { PASS: 'ĐẠT', FAIL: 'KHÔNG ĐẠT', PENDING: 'CHỜ KẾT QUẢ' };
const RESULT_ARGB = { PASS: 'FF1F7A3F', FAIL: 'FFB3261E', PENDING: 'FF8A6D1A' };
const BRAND_ARGB = 'FFB5622C';
const BRAND_HEX = '#b5622c';
const INK_HEX = '#1d1b18';
const SOFT_HEX = '#7a7266';
const HEADER_FILL_ARGB = 'FFF2EDE4';
const BORDER_ARGB = 'FFD8CFC2';
const thinBorder = { style: 'thin', color: { argb: BORDER_ARGB } };

// 7 cột dùng chung cho cả lưới thông tin 2 cột và bảng log (giống tỉ lệ bên PDF)
const COL_WIDTHS = [24, 16, 14, 18, 16, 12, 18];

function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString('vi-VN', { hour12: false });
}
function fmtVal(v) { return (v === null || v === undefined || v === '') ? '—' : v; }

async function fetchImageBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tải ảnh thất bại (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

function sectionTitle(sheet, row, text) {
  sheet.mergeCells(row, 1, row, 7);
  const cell = sheet.getCell(row, 1);
  cell.value = text.toUpperCase();
  cell.font = { bold: true, size: 11, color: { argb: BRAND_ARGB } };
  const borderRow = row + 1;
  for (let c = 1; c <= 7; c++) {
    sheet.getCell(borderRow, c).border = { top: { style: 'thin', color: { argb: BORDER_ARGB } } };
  }
  return row + 2;
}

function headerBlock(sheet, test) {
  sheet.mergeCells('A1:G1');
  const title = sheet.getCell('A1');
  title.value = 'BÁO CÁO TEST ĐỐT';
  title.font = { size: 18, bold: true, color: { argb: 'FF1D1B18' } };
  title.alignment = { horizontal: 'center' };
  sheet.getRow(1).height = 28;

  sheet.mergeCells('A2:G2');
  const sub = sheet.getCell('A2');
  sub.value = `Xuất lúc: ${fmtDateTime(new Date().toISOString())}`;
  sub.font = { size: 9, italic: true, color: { argb: 'FF7A7266' } };
  sub.alignment = { horizontal: 'center' };

  sheet.mergeCells('A4:D4');
  const codeCell = sheet.getCell('A4');
  codeCell.value = fmtVal(test.Product_Code);
  codeCell.font = { size: 15, bold: true };

  const resultKey = test.result || 'PENDING';
  sheet.mergeCells('E4:G4');
  const resultCell = sheet.getCell('E4');
  resultCell.value = RESULT_LABEL[resultKey] || resultKey;
  resultCell.font = { size: 13, bold: true, color: { argb: RESULT_ARGB[resultKey] || 'FF1D1B18' } };
  resultCell.alignment = { horizontal: 'right' };

  return 6; // dòng bắt đầu section tiếp theo
}

function infoGrid(sheet, startRow, test) {
  const pairs = [
    ['PO', fmtVal(test.po_number)], ['Khách hàng', fmtVal(test.customer_name)],
    ['Đường kính (mm)', fmtVal(test.Diameter)], ['Chiều cao (mm)', fmtVal(test.Height)],
    ['Hương liệu', fmtVal(test.Frag)], ['Màu', fmtVal(test.Color)],
    ['Bấc', fmtVal(test.Wick)], ['Nhiệt độ (°C)', fmtVal(test.Temperature)],
    ['Ngày test', fmtVal(test.Test_date)], ['Bắt đầu', fmtDateTime(test.Start)],
    ['Kết thúc', fmtDateTime(test.End)], ['Tổng thời gian đốt', fmtVal(test.Total_Burn_Time)],
    ['Người test', fmtVal(test.Tester)], ['Người duyệt', fmtVal(test.Approved)]
  ];

  let r = startRow;
  for (let i = 0; i < pairs.length; i += 2) {
    const rowPairs = [pairs[i], pairs[i + 1]].filter(Boolean);
    // Cặp 1: Label ở cột A, giá trị gộp B:C
    const l1 = sheet.getCell(r, 1);
    l1.value = rowPairs[0][0];
    l1.font = { color: { argb: 'FF7A7266' }, size: 10 };
    sheet.mergeCells(r, 2, r, 3);
    const v1 = sheet.getCell(r, 2);
    v1.value = rowPairs[0][1];
    v1.alignment = { horizontal: 'left' };

    if (rowPairs[1]) {
      const l2 = sheet.getCell(r, 4);
      l2.value = rowPairs[1][0];
      l2.font = { color: { argb: 'FF7A7266' }, size: 10 };
      sheet.mergeCells(r, 5, r, 7);
      const v2 = sheet.getCell(r, 5);
      v2.value = rowPairs[1][1];
      v2.alignment = { horizontal: 'left' };
    }
    r++;
  }

  if (test.note) {
    const l = sheet.getCell(r, 1);
    l.value = 'Ghi chú';
    l.font = { color: { argb: 'FF7A7266' }, size: 10 };
    sheet.mergeCells(r, 2, r, 7);
    const v = sheet.getCell(r, 2);
    v.value = String(test.note);
    v.alignment = { horizontal: 'left', wrapText: true };
    r++;
  }

  return r + 1;
}

function logTable(sheet, startRow, logs) {
  const headers = ['Thời gian', 'Trạng thái bấc', 'Trạng thái ngọn lửa', 'Chiều cao bấc (mm)', 'Tình trạng bể đốt', 'Nhiệt độ (°C)', 'Ghi chú'];
  let r = startRow;
  headers.forEach((h, i) => {
    const cell = sheet.getCell(r, i + 1);
    cell.value = h;
    cell.font = { bold: true, size: 9.5, color: { argb: 'FF7A7266' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL_ARGB } };
    cell.border = { top: thinBorder, bottom: thinBorder };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  r++;

  if (!logs.length) {
    sheet.mergeCells(r, 1, r, 7);
    const cell = sheet.getCell(r, 1);
    cell.value = 'Chưa có log kiểm tra định kỳ.';
    cell.font = { italic: true, color: { argb: 'FF7A7266' } };
    return { nextRow: r + 2, firstLogRow: null, lastLogRow: null };
  }

  const firstLogRow = r;
  for (const log of logs) {
    sheet.getCell(r, 1).value = fmtVal(log.time_label);
    sheet.getCell(r, 2).value = fmtVal(log.wick_status);
    sheet.getCell(r, 3).value = fmtVal(log.flame_status);
    sheet.getCell(r, 4).value = (log.wick_height_mm === null || log.wick_height_mm === undefined) ? null : Number(log.wick_height_mm);
    sheet.getCell(r, 5).value = fmtVal(log.vessel_condition);
    sheet.getCell(r, 6).value = (log.temperature_c === null || log.temperature_c === undefined) ? null : Number(log.temperature_c);
    sheet.getCell(r, 7).value = fmtVal(log.note);
    for (let c = 1; c <= 7; c++) sheet.getCell(r, c).border = { bottom: thinBorder };
    r++;
  }
  const lastLogRow = r - 1;
  r++;

  // Dùng công thức Excel thật thay vì số tính sẵn -> tự cập nhật nếu người xem sửa số liệu trong log.
  sheet.getCell(r, 1).value = 'Nhiệt độ trung bình (°C)';
  sheet.getCell(r, 1).font = { italic: true, color: { argb: 'FF7A7266' } };
  sheet.getCell(r, 2).value = { formula: `AVERAGE(F${firstLogRow}:F${lastLogRow})` };
  sheet.getCell(r, 2).numFmt = '0.0';
  r++;
  sheet.getCell(r, 1).value = 'Nhiệt độ cao nhất (°C)';
  sheet.getCell(r, 1).font = { italic: true, color: { argb: 'FF7A7266' } };
  sheet.getCell(r, 2).value = { formula: `MAX(F${firstLogRow}:F${lastLogRow})` };
  r++;
  sheet.getCell(r, 1).value = 'Chiều cao bấc giảm (mm)';
  sheet.getCell(r, 1).font = { italic: true, color: { argb: 'FF7A7266' } };
  sheet.getCell(r, 2).value = { formula: `D${firstLogRow}-D${lastLogRow}` };
  r += 2;

  return { nextRow: r, firstLogRow, lastLogRow };
}

// Vẽ biểu đồ nhiệt độ dạng SVG rồi rasterize thành PNG để nhúng vào Excel
// (exceljs không hỗ trợ tạo native Excel chart), style giống hệt biểu đồ bên PDF.
async function buildTemperatureChartImage(logs) {
  const points = (logs || [])
    .map(l => ({ label: l.time_label, value: Number(l.temperature_c) }))
    .filter(p => Number.isFinite(p.value));
  if (points.length < 2) return null;

  const W = 760, H = 300, padLeft = 46, padBottom = 30, padTop = 16, padRight = 20;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;
  const values = points.map(p => p.value);
  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.15;
  min -= pad; max += pad;

  const xAt = i => padLeft + (points.length > 1 ? i * (plotW / (points.length - 1)) : 0);
  const yAt = v => padTop + plotH - ((v - min) / (max - min)) * plotH;
  const gridVals = [min + pad, (min + max) / 2, max - pad];

  const gridLines = gridVals.map(v => {
    const y = yAt(v);
    return `<line x1="${padLeft}" y1="${y}" x2="${padLeft + plotW}" y2="${y}" stroke="#eee7da" stroke-width="1"/>
      <text x="${padLeft - 6}" y="${y + 3}" font-size="11" fill="#a39c8f" text-anchor="end" font-family="Arial">${Math.round(v)}°C</text>`;
  }).join('');

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(p.value)}`).join(' ');

  const dots = points.map((p, i) => {
    const x = xAt(i), y = yAt(p.value);
    return `<circle cx="${x}" cy="${y}" r="3.5" fill="${BRAND_HEX}"/>
      <text x="${x}" y="${y - 10}" font-size="11" fill="${INK_HEX}" text-anchor="middle" font-family="Arial">${p.value}°C</text>
      <text x="${x}" y="${padTop + plotH + 18}" font-size="11" fill="${SOFT_HEX}" text-anchor="middle" font-family="Arial">${p.label ?? ''}</text>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#ffffff"/>
    ${gridLines}
    <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + plotH}" stroke="#c9bfae" stroke-width="1"/>
    <line x1="${padLeft}" y1="${padTop + plotH}" x2="${padLeft + plotW}" y2="${padTop + plotH}" stroke="#c9bfae" stroke-width="1"/>
    <path d="${linePath}" fill="none" stroke="${BRAND_HEX}" stroke-width="2"/>
    ${dots}
  </svg>`;

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { buffer: png, width: W, height: H };
}

async function photoGrid(wb, sheet, startRow, photos) {
  let r = startRow;
  if (!photos.length) {
    sheet.mergeCells(r, 1, r, 7);
    const cell = sheet.getCell(r, 1);
    cell.value = 'Chưa có ảnh minh chứng.';
    cell.font = { italic: true, color: { argb: 'FF7A7266' } };
    return r + 2;
  }

  const imgW = 280, imgH = 210;
  const rowsPerImage = 12; // số dòng chừa cho 1 ảnh (dựa theo chiều cao dòng mặc định ~15px)

  for (let i = 0; i < photos.length; i += 2) {
    const rowPhotos = [photos[i], photos[i + 1]].filter(Boolean);
    for (let idx = 0; idx < rowPhotos.length; idx++) {
      const photo = rowPhotos[idx];
      const labelCell = sheet.getCell(r, idx === 0 ? 1 : 5);
      labelCell.value = `Ảnh ${photo.slot}`;
      labelCell.font = { bold: true, color: { argb: 'FF7A7266' } };

      try {
        const buffer = await fetchImageBuffer(photo.file_url);
        const imgId = wb.addImage({ buffer, extension: 'jpeg' });
        // +1 dòng đệm phía trên nữa (thay vì chỉ 1 dòng) để tránh ảnh đè lên nhãn
        // khi render qua LibreOffice/Excel với nhiều merge cell ở phía trên.
        sheet.addImage(imgId, {
          tl: { col: idx === 0 ? 0 : 4, row: r + 1 },
          ext: { width: imgW, height: imgH }
        });
      } catch (_e) {
        const errCell = sheet.getCell(r + 2, idx === 0 ? 1 : 5);
        errCell.value = 'Không tải được ảnh';
        errCell.font = { color: { argb: 'FFB3261E' } };
      }
    }
    r += rowsPerImage;
  }
  return r + 1;
}

function buildInfoSheet(wb, test) {
  const sheet = wb.addWorksheet('Thông tin & Log');
  sheet.columns = COL_WIDTHS.map(w => ({ width: w }));
  sheet.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  return sheet;
}

async function buildPhotoSheet(wb, photos) {
  const sheet = wb.addWorksheet('Ảnh minh chứng');
  sheet.columns = [{ width: 60 }];
  sheet.pageSetup = { orientation: 'portrait', margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };

  if (!photos.length) {
    sheet.getCell('A1').value = 'Chưa có ảnh minh chứng.';
    sheet.getCell('A1').font = { italic: true, color: { argb: 'FF7A7266' } };
    return;
  }

  let row = 1;
  for (const photo of photos) {
    sheet.getCell(row, 1).value = `Ảnh ${photo.slot}`;
    sheet.getCell(row, 1).font = { bold: true, color: { argb: 'FF7A7266' } };
    row += 1;
    try {
      const buffer = await fetchImageBuffer(photo.file_url);
      const imgId = wb.addImage({ buffer, extension: 'jpeg' });
      sheet.addImage(imgId, { tl: { col: 0, row: row - 1 }, ext: { width: 420, height: 315 } });
      row += 17;
    } catch (_e) {
      sheet.getCell(row, 1).value = 'Không tải được ảnh';
      sheet.getCell(row, 1).font = { color: { argb: 'FFB3261E' } };
      row += 2;
    }
    row += 1;
  }
}

async function generateBurnTestReportXlsx(res, test) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QC Burn Test';
  wb.created = new Date();

  const sheet = buildInfoSheet(wb, test);

  let r = headerBlock(sheet, test);
  r = sectionTitle(sheet, r, 'Thông tin chung');
  r = infoGrid(sheet, r, test);

  r = sectionTitle(sheet, r, 'Log kiểm tra định kỳ');
  const { nextRow } = logTable(sheet, r, test.logs || []);
  r = nextRow;

  r = sectionTitle(sheet, r, 'Biểu đồ nhiệt độ theo thời gian');
  const chart = await buildTemperatureChartImage(test.logs || []);
  if (chart) {
    const imgId = wb.addImage({ buffer: chart.buffer, extension: 'png' });
    sheet.addImage(imgId, { tl: { col: 0, row: r - 1 }, ext: { width: chart.width * 0.68, height: chart.height * 0.68 } });
    r += 15;
  } else {
    sheet.getCell(r, 1).value = 'Không đủ dữ liệu (cần ít nhất 2 lần đo) để vẽ biểu đồ nhiệt độ.';
    sheet.getCell(r, 1).font = { italic: true, color: { argb: 'FF7A7266' } };
    r += 2;
  }

  r = sectionTitle(sheet, r, 'Ảnh minh chứng');
  await photoGrid(wb, sheet, r, test.photos || []);

  await wb.xlsx.write(res);
}

module.exports = { generateBurnTestReportXlsx };
