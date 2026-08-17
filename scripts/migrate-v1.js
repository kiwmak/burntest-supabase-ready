// Chuyển dữ liệu từ database v1 (Client/PO/PO_Detail) sang v2.
// Chạy: node scripts/migrate-v1.js "đường_dẫn_burn_test_v1.db"
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const { db, prepare, transaction } = require('../database/database');

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error('Dùng: node scripts/migrate-v1.js <duong-dan-burn_test_v1.db>');
  process.exit(1);
}
if (!fs.existsSync(sourcePath)) {
  console.error(`Không tìm thấy file: ${sourcePath}`);
  process.exit(1);
}

const old = new DatabaseSync(path.resolve(sourcePath));
old.exec('PRAGMA foreign_keys = ON');

function rows(sql) { return old.prepare(sql).all(); }
const clients = rows('SELECT Cus_id, Cus_Name FROM Client');
const pos = rows('SELECT PO_Id, Cus_id, PO_Name FROM PO');
const tests = rows('SELECT * FROM PO_Detail ORDER BY Id');

transaction(() => {
  const clientMap = new Map();
  for (const c of clients) {
    let row = prepare('SELECT id FROM customers WHERE name = ?').get(c.Cus_Name);
    if (!row) {
      const r = prepare('INSERT INTO customers (name) VALUES (?)').run(c.Cus_Name);
      row = { id: Number(r.lastInsertRowid) };
    }
    clientMap.set(c.Cus_id, row.id);
  }

  const poMap = new Map();
  for (const p of pos) {
    const customerId = clientMap.get(p.Cus_id);
    if (!customerId) continue;
    let row = prepare('SELECT id FROM purchase_orders WHERE customer_id=? AND po_number=?').get(customerId, p.PO_Name);
    if (!row) {
      const r = prepare('INSERT INTO purchase_orders (customer_id, po_number) VALUES (?, ?)').run(customerId, p.PO_Name);
      row = { id: Number(r.lastInsertRowid) };
    }
    poMap.set(p.PO_Id, row.id);
  }

  const insertTest = prepare(`INSERT INTO burn_tests
    (purchase_order_id, product_code, diameter_mm, height_mm, fragrance, color, wick, temperature_c,
     test_date, test_time, tester, approver, result, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`);

  const insertPhoto = prepare(`INSERT OR IGNORE INTO burn_test_photos
    (burn_test_id, slot, file_name, file_url, original_name, mime_type, file_size)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);

  for (const t of tests) {
    const poId = poMap.get(t.PO_Id);
    if (!poId) continue;
    const result = t.Test_result || 'PENDING';
    const r = insertTest.run(poId, t.Product_Code, t.Diameter, t.Height, t.Frag, t.Color, t.Wick,
      t.Temperature, t.Test_date, t.Time, t.Tester, t.Approved, result, t.Created_at, t.Updated_at);
    const newId = Number(r.lastInsertRowid);
    for (let slot = 1; slot <= 5; slot++) {
      const url = t[`PIC_${slot}`];
      if (!url) continue;
      const fileName = path.basename(url);
      insertPhoto.run(newId, slot, fileName, url, fileName, null, null);
    }
  }
});

console.log(`Migration complete: ${clients.length} customers, ${pos.length} PO, ${tests.length} burn tests.`);
