/*
  Migrate the existing SQLite Burn Test database to Supabase.

  1) Run database/schema.sql in Supabase SQL Editor first.
  2) Copy .env.example to .env and fill SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
  3) Run: npm install
  4) Run: node scripts/migrate-to-supabase.js

  The script preserves all existing numeric IDs.
  Photos are copied from ./uploads/ when the files exist.
  Your uploaded source package currently contains the SQLite DB but no uploads
  directory files, so missing image files are reported and database photo rows
  keep their metadata with the old URL until the actual files are supplied.
*/
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const sqlite3 = require('node:sqlite');
const { createClient } = require('@supabase/supabase-js');

const DB_PATH = process.env.BURN_TEST_DB || path.join(__dirname, '..', 'database', 'burn_test.db');
const UPLOAD_DIR = process.env.BURN_TEST_UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'burn-test-photos';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const db = new sqlite3.DatabaseSync(DB_PATH);

function all(sql) { return db.prepare(sql).all(); }

async function upsert(table, rows) {
  if (!rows.length) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`${table}: ${error.message}`);
}

async function migrate() {
  console.log(`SQLite: ${DB_PATH}`);

  const customers = all('SELECT id, name, created_at FROM customers ORDER BY id');
  const pos = all('SELECT id, customer_id, po_number, created_at FROM purchase_orders ORDER BY id');
  const tests = all(`SELECT id, purchase_order_id, product_code, diameter_mm, height_mm,
    fragrance, color, wick, temperature_c, test_date, test_time, start_datetime,
    end_datetime, total_burn_time, tester, approver, result, note, created_at, updated_at
    FROM burn_tests ORDER BY id`);
  const photos = all(`SELECT id, burn_test_id, slot, file_name, file_url,
    original_name, mime_type, file_size, created_at
    FROM burn_test_photos ORDER BY id`);

  console.log(`Customers: ${customers.length}`);
  await upsert('customers', customers);

  console.log(`POs: ${pos.length}`);
  await upsert('purchase_orders', pos);

  console.log(`Burn tests: ${tests.length}`);
  await upsert('burn_tests', tests);

  // Re-create photo metadata. file_url is replaced with Supabase public URL
  // only when the actual local file can be uploaded.
  let uploaded = 0, missing = 0;
  for (const photo of photos) {
    const localPath = path.join(UPLOAD_DIR, photo.file_name);
    let fileUrl = photo.file_url;
    let storagePath = photo.file_name;

    if (fs.existsSync(localPath)) {
      const buffer = fs.readFileSync(localPath);
      const contentType = photo.mime_type || 'application/octet-stream';
      const { error: ue } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
        contentType,
        upsert: true,
        cacheControl: '3600'
      });
      if (ue) throw new Error(`Upload ${photo.file_name}: ${ue.message}`);
      fileUrl = supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
      uploaded++;
    } else {
      missing++;
      console.warn(`⚠ Không tìm thấy file ảnh: ${localPath}`);
    }

    const { error } = await supabase.from('burn_test_photos').upsert({
      id: photo.id,
      burn_test_id: photo.burn_test_id,
      slot: photo.slot,
      file_name: storagePath,
      file_url: fileUrl,
      original_name: photo.original_name,
      mime_type: photo.mime_type,
      file_size: photo.file_size,
      created_at: photo.created_at
    }, { onConflict: 'id' });
    if (error) throw new Error(`burn_test_photos ${photo.id}: ${error.message}`);
  }

  // This function is created by database/schema.sql.
  const { error: rpcError } = await supabase.rpc('sync_burntest_identity_sequences');
  if (rpcError) {
    console.warn(`⚠ Không đồng bộ được identity sequence tự động: ${rpcError.message}`);
    console.warn('Hãy chạy lại phần function sync_burntest_identity_sequences trong schema.sql.');
  }

  console.log('\n=== HOÀN TẤT ===');
  console.log(`Customers: ${customers.length}`);
  console.log(`POs: ${pos.length}`);
  console.log(`Burn tests: ${tests.length}`);
  console.log(`Photos metadata: ${photos.length}`);
  console.log(`Photos uploaded: ${uploaded}`);
  console.log(`Photos missing locally: ${missing}`);
  if (missing) {
    console.log('\nCác ảnh bị thiếu file local cần cung cấp lại thư mục uploads/ để upload bổ sung.');
  }
}

migrate()
  .catch(err => {
    console.error('\n✖ Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    try { db.close(); } catch (_) {}
  });
