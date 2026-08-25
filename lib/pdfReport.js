const path = require('path');
const PDFDocument = require('pdfkit');

const FONT_REGULAR = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');

const RESULT_LABEL = { PASS: 'ĐẠT', FAIL: 'KHÔNG ĐẠT', PENDING: 'CHỜ KẾT QUẢ' };
const RESULT_COLOR = { PASS: '#1f7a3f', FAIL: '#b3261e', PENDING: '#8a6d1a' };

function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString('vi-VN', { hour12: false });
}

function fmtVal(v, suffix = '') {
  if (v === null || v === undefined || v === '') return '—';
  return `${v}${suffix}`;
}

async function fetchImageBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tải ảnh thất bại (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

function ensureSpace(doc, needed, margin = 40) {
  const bottom = doc.page.height - margin;
  if (doc.y + needed > bottom) doc.addPage();
}

function sectionTitle(doc, text) {
  ensureSpace(doc, 30);
  doc.font('vn-bold').fontSize(12).fillColor('#b5622c').text(text.toUpperCase());
  doc.moveDown(0.15);
  const y = doc.y;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y)
    .strokeColor('#d8cfc2').lineWidth(1).stroke();
  doc.fillColor('#1d1b18');
  doc.moveDown(0.5);
}

function keyValueGrid(doc, pairs) {
  const left = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = usable / 2;
  const labelWidth = 118;
  const rowH = 20;

  for (let i = 0; i < pairs.length; i += 2) {
    ensureSpace(doc, rowH);
    const y = doc.y;
    const rowPairs = [pairs[i], pairs[i + 1]].filter(Boolean);
    rowPairs.forEach(([label, value], idx) => {
      const x = left + idx * colWidth;
      doc.font('vn').fontSize(9.5).fillColor('#7a7266').text(label, x, y, { width: labelWidth });
      doc.font('vn').fontSize(10.5).fillColor('#1d1b18').text(String(value), x + labelWidth, y, { width: colWidth - labelWidth - 10 });
    });
    doc.y = y + rowH;
  }
  doc.moveDown(0.3);
}

function logTable(doc, logs) {
  const left = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const cols = [
    { key: 'time_label', label: 'Thời gian', w: 0.10 },
    { key: 'wick_status', label: 'Trạng thái bấc', w: 0.14 },
    { key: 'flame_status', label: 'Trạng thái ngọn lửa', w: 0.16 },
    { key: 'wick_height_mm', label: 'Chiều cao bấc', w: 0.13 },
    { key: 'vessel_condition', label: 'Tình trạng bể đốt', w: 0.15 },
    { key: 'temperature_c', label: 'Nhiệt độ', w: 0.10 },
    { key: 'note', label: 'Ghi chú', w: 0.22 }
  ].map(c => ({ ...c, w: c.w * usable }));

  if (!logs.length) {
    doc.font('vn').fontSize(10).fillColor('#7a7266').text('Chưa có log kiểm tra định kỳ.');
    doc.fillColor('#1d1b18');
    doc.moveDown(0.5);
    return;
  }

  function drawHeader() {
    doc.font('vn-bold').fontSize(8.5);
    const headerH = Math.max(...cols.map(c => doc.heightOfString(c.label, { width: c.w - 8 }))) + 12;
    ensureSpace(doc, headerH);
    const y = doc.y;
    let x = left;
    doc.rect(left, y, usable, headerH).fill('#f2ede4');
    doc.fillColor('#7a7266').font('vn-bold').fontSize(8.5);
    for (const c of cols) {
      doc.text(c.label, x + 4, y + 6, { width: c.w - 8 });
      x += c.w;
    }
    doc.y = y + headerH;
    doc.fillColor('#1d1b18');
  }

  ensureSpace(doc, 40);
  drawHeader();

  for (const log of logs) {
    const values = cols.map(c => {
      if (c.key === 'wick_height_mm') return fmtVal(log.wick_height_mm, ' mm');
      if (c.key === 'temperature_c') return fmtVal(log.temperature_c, '°C');
      return fmtVal(log[c.key]);
    });

    doc.font('vn').fontSize(9);
    const heights = values.map((v, i) => doc.heightOfString(v, { width: cols[i].w - 8 }));
    const rowH = Math.max(16, ...heights) + 8;

    ensureSpace(doc, rowH);
    const y = doc.y;
    let x = left;
    doc.font('vn').fontSize(9).fillColor('#1d1b18');
    values.forEach((v, i) => {
      doc.text(v, x + 4, y + 4, { width: cols[i].w - 8 });
      x += cols[i].w;
    });
    doc.moveTo(left, y + rowH).lineTo(left + usable, y + rowH).strokeColor('#e5ded2').lineWidth(0.5).stroke();
    doc.y = y + rowH;
  }
  doc.moveDown(0.5);
}

async function photoGrid(doc, photos) {
  if (!photos.length) {
    doc.font('vn').fontSize(10).fillColor('#7a7266').text('Chưa có ảnh minh chứng.');
    doc.fillColor('#1d1b18');
    return;
  }

  const left = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const gap = 12;
  const cellW = (usable - gap) / 2;
  const cellImgH = cellW * 0.72;
  const cellH = cellImgH + 22;

  for (let i = 0; i < photos.length; i += 2) {
    ensureSpace(doc, cellH + 10);
    const y = doc.y;
    const rowPhotos = [photos[i], photos[i + 1]].filter(Boolean);

    for (let idx = 0; idx < rowPhotos.length; idx++) {
      const photo = rowPhotos[idx];
      const x = left + idx * (cellW + gap);
      doc.rect(x, y, cellW, cellH).strokeColor('#e5ded2').lineWidth(1).stroke();
      try {
        const buffer = await fetchImageBuffer(photo.file_url);
        doc.image(buffer, x + 6, y + 6, { fit: [cellW - 12, cellImgH - 12], align: 'center', valign: 'center' });
      } catch (_e) {
        doc.font('vn').fontSize(9).fillColor('#b3261e')
          .text('Không tải được ảnh', x + 6, y + cellImgH / 2, { width: cellW - 12, align: 'center' });
        doc.fillColor('#1d1b18');
      }
      doc.font('vn').fontSize(9).fillColor('#7a7266')
        .text(`Ảnh ${photo.slot}`, x + 6, y + cellImgH + 4, { width: cellW - 12, align: 'center' });
      doc.fillColor('#1d1b18');
    }
    doc.y = y + cellH + 10;
  }
}

async function generateBurnTestReportPdf(res, test) {
  const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
  doc.registerFont('vn', FONT_REGULAR);
  doc.registerFont('vn-bold', FONT_BOLD);
  doc.pipe(res);

  // ---- Header ----
  doc.font('vn-bold').fontSize(18).fillColor('#1d1b18').text('BÁO CÁO TEST ĐỐT', { align: 'center' });
  doc.font('vn').fontSize(9.5).fillColor('#7a7266')
    .text(`Xuất lúc: ${fmtDateTime(new Date().toISOString())}`, { align: 'center' });
  doc.fillColor('#1d1b18');
  doc.moveDown(0.8);

  // Mã hàng lớn + kết quả
  doc.font('vn-bold').fontSize(15).text(test.Product_Code || '—', doc.page.margins.left, doc.y);
  const resultKey = test.result || 'PENDING';
  const resultLabel = RESULT_LABEL[resultKey] || resultKey;
  doc.font('vn-bold').fontSize(12).fillColor(RESULT_COLOR[resultKey] || '#1d1b18')
    .text(resultLabel, doc.page.width - doc.page.margins.right - 160, doc.y - 17, { width: 160, align: 'right' });
  doc.fillColor('#1d1b18');
  doc.moveDown(0.6);

  // ---- Thông tin chung ----
  sectionTitle(doc, 'Thông tin chung');
  keyValueGrid(doc, [
    ['PO', fmtVal(test.po_number)],
    ['Khách hàng', fmtVal(test.customer_name)],
    ['Đường kính (mm)', fmtVal(test.Diameter)],
    ['Chiều cao (mm)', fmtVal(test.Height)],
    ['Hương liệu', fmtVal(test.Frag)],
    ['Màu', fmtVal(test.Color)],
    ['Bấc', fmtVal(test.Wick)],
    ['Nhiệt độ (°C)', fmtVal(test.Temperature)],
    ['Ngày test', fmtVal(test.Test_date)],
    ['Bắt đầu', fmtDateTime(test.Start)],
    ['Kết thúc', fmtDateTime(test.End)],
    ['Tổng thời gian đốt', fmtVal(test.Total_Burn_Time)],
    ['Người test', fmtVal(test.Tester)],
    ['Người duyệt', fmtVal(test.Approved)]
  ]);

  if (test.note) {
    doc.font('vn').fontSize(9.5).fillColor('#7a7266').text('Ghi chú', doc.page.margins.left, doc.y, { width: 118 });
    doc.font('vn').fontSize(10.5).fillColor('#1d1b18').text(String(test.note), doc.page.margins.left + 118, doc.y - doc.currentLineHeight(), { width: 350 });
    doc.moveDown(0.5);
  }
  doc.moveDown(0.4);

  // ---- Log kiểm tra định kỳ ----
  sectionTitle(doc, 'Log kiểm tra định kỳ');
  logTable(doc, test.logs || []);

  // ---- Ảnh minh chứng ----
  sectionTitle(doc, 'Ảnh minh chứng');
  await photoGrid(doc, test.photos || []);

  // ---- Số trang ----
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // cho phép vẽ trong vùng lề dưới mà không tự tạo trang mới
    doc.font('vn').fontSize(8).fillColor('#a39c8f')
      .text(`Trang ${i + 1}/${range.count}`, 0, doc.page.height - 30, { align: 'center', lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
}

module.exports = { generateBurnTestReportPdf };
