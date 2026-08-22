/*
  Chuyển ảnh test đốt đã có trên Supabase Storage sang cấu trúc thư mục mới:

    Cũ: burn-test-{burn_test_id}/burn-test-{burn_test_id}-{timestamp}-{random}.{ext}
    Mới: {po_number}/{product_code}/burn-test-{slot}.{ext}

  Cách chạy:
    1) Copy .env.example thành .env, điền SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
    2) npm install (nếu chưa có @supabase/supabase-js)
    3) node scripts/migrate-photo-paths.js
       Thêm --dry-run để chỉ xem trước, không thực sự di chuyển file:
       node scripts/migrate-photo-paths.js --dry-run

  Script sẽ:
    - Lấy toàn bộ burn_test_photos kèm po_number (qua purchase_orders) + product_code của burn test tương ứng.
    - Tải file ảnh ở đường dẫn cũ, upload lại vào đường dẫn mới (ghi đè nếu trùng slot).
    - Cập nhật lại file_name / file_url trong bảng burn_test_photos.
    - Xóa file ở đường dẫn cũ sau khi upload đường dẫn mới thành công.
    - Ảnh đã đúng cấu trúc mới từ trước sẽ được bỏ qua tự động.
*/
require('dotenv').config();

const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'burn-test-photos';
const DRY_RUN = process.argv.includes('--dry-run');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env');
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function sanitizeCode(code) {
  const safe = String(code ?? '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || `unknown-${Date.now()}`;
}

// Đường dẫn mới hợp lệ: {po_number}/{product_code}/burn-test-{slot}.{ext}
const NEW_PATH_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+\/burn-test-[1-5]\.[a-z0-9]+$/i;

async function migrate() {
  console.log(`Bucket: ${BUCKET}${DRY_RUN ? '  (DRY RUN - không thay đổi gì)' : ''}`);

  const { data: photos, error: pe } = await supabase
    .from('burn_test_photos')
    .select('id, burn_test_id, slot, file_name, mime_type')
    .order('id');
  if (pe) throw new Error(`Lấy danh sách ảnh: ${pe.message}`);

  console.log(`Tổng số ảnh trong DB: ${photos.length}`);

  let moved = 0, skipped = 0, missingTest = 0, missingFile = 0, failed = 0;

  for (const photo of photos) {
    if (NEW_PATH_RE.test(photo.file_name)) {
      skipped++;
      continue;
    }

    const { data: test, error: te } = await supabase
      .from('burn_tests')
      .select('id, product_code, purchase_order:purchase_orders!inner(po_number)')
      .eq('id', photo.burn_test_id)
      .maybeSingle();
    if (te) { console.warn(`⚠ Lỗi lấy burn_test #${photo.burn_test_id}: ${te.message}`); failed++; continue; }
    if (!test) { console.warn(`⚠ Không tìm thấy burn_test #${photo.burn_test_id} cho ảnh #${photo.id}`); missingTest++; continue; }

    const ext = (path.extname(photo.file_name) || '.jpg').toLowerCase();
    const newPath = `${sanitizeCode(test.purchase_order.po_number)}/${sanitizeCode(test.product_code)}/burn-test-${photo.slot}${ext}`;

    if (newPath === photo.file_name) { skipped++; continue; }

    console.log(`${DRY_RUN ? '[DRY] ' : ''}${photo.file_name}  ->  ${newPath}`);
    if (DRY_RUN) { moved++; continue; }

    const { data: fileData, error: de } = await supabase.storage.from(BUCKET).download(photo.file_name);
    if (de) { console.warn(`⚠ Không tải được file cũ (${photo.file_name}): ${de.message}`); missingFile++; continue; }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const { error: ue } = await supabase.storage.from(BUCKET).upload(newPath, buffer, {
      contentType: photo.mime_type || 'image/jpeg',
      upsert: true,
      cacheControl: '3600'
    });
    if (ue) { console.warn(`⚠ Upload thất bại (${newPath}): ${ue.message}`); failed++; continue; }

    const fileUrl = supabase.storage.from(BUCKET).getPublicUrl(newPath).data.publicUrl;
    const { error: ude } = await supabase.from('burn_test_photos')
      .update({ file_name: newPath, file_url: fileUrl })
      .eq('id', photo.id);
    if (ude) {
      console.warn(`⚠ Cập nhật DB thất bại cho ảnh #${photo.id}: ${ude.message}`);
      await supabase.storage.from(BUCKET).remove([newPath]);
      failed++;
      continue;
    }

    const { error: re } = await supabase.storage.from(BUCKET).remove([photo.file_name]);
    if (re) console.warn(`⚠ Không xóa được file cũ (${photo.file_name}): ${re.message}`);

    moved++;
  }

  console.log('\n=== HOÀN TẤT ===');
  console.log(`Đã chuyển: ${moved}`);
  console.log(`Bỏ qua (đã đúng cấu trúc mới): ${skipped}`);
  console.log(`Không tìm thấy burn_test: ${missingTest}`);
  console.log(`Không tải được file cũ: ${missingFile}`);
  console.log(`Lỗi khác: ${failed}`);
  if (DRY_RUN) console.log('\nĐây là DRY RUN, chưa có gì thay đổi thật. Chạy lại không kèm --dry-run để thực hiện.');
}

migrate().catch(err => {
  console.error('\n✖ Migration failed:', err);
  process.exitCode = 1;
});
