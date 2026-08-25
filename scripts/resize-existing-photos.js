/*
  Resize toàn bộ ảnh test đốt ĐÃ CÓ trên Supabase Storage về tối đa 1280x960
  (giữ tỉ lệ, không phóng to ảnh nhỏ hơn) để giảm dung lượng.

  Đây là bước dọn dẹp 1 lần cho các ảnh upload TRƯỚC khi có resize phía client.
  Ảnh upload SAU này đã tự resize ở trình duyệt trước khi gửi lên, không cần chạy lại.

  Cách chạy:
    1) Copy .env.example thành .env, điền SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
    2) npm install (cần thêm gói "sharp" đã có trong package.json)
    3) node scripts/resize-existing-photos.js
       Thêm --dry-run để chỉ xem trước ảnh nào sẽ bị resize, không thay đổi gì thật:
       node scripts/resize-existing-photos.js --dry-run

  Script sẽ, với mỗi ảnh trong bảng burn_test_photos:
    - Bỏ qua GIF (có thể là ảnh động, resize sẽ làm mất khung hình).
    - Bỏ qua nếu ảnh đã <= 1280x960 VÀ dung lượng đã nhỏ (< 1MB) — không cần đụng vào.
    - Ngược lại: resize về vừa khung 1280x960, nén lại thành JPEG chất lượng 85,
      upload đè lên đúng vị trí cũ trên Storage, cập nhật lại file_size (và
      file_name/file_url/mime_type nếu đuôi file đổi từ .png/.webp sang .jpg),
      rồi xóa file đuôi cũ nếu path đổi.
*/
require('dotenv').config();

const path = require('path');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'burn-test-photos';
const DRY_RUN = process.argv.includes('--dry-run');

const MAX_WIDTH = 1280;
const MAX_HEIGHT = 960;
const JPEG_QUALITY = 85;
const SKIP_IF_UNDER_BYTES = 1024 * 1024; // 1MB — ảnh đã nhỏ & đúng kích thước thì bỏ qua

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env');
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function migrate() {
  console.log(`Bucket: ${BUCKET}${DRY_RUN ? '  (DRY RUN - không thay đổi gì)' : ''}`);
  console.log(`Kích thước tối đa: ${MAX_WIDTH}x${MAX_HEIGHT}, JPEG quality ${JPEG_QUALITY}\n`);

  const { data: photos, error: pe } = await supabase
    .from('burn_test_photos')
    .select('id, slot, file_name, mime_type, file_size')
    .order('id');
  if (pe) throw new Error(`Lấy danh sách ảnh: ${pe.message}`);

  console.log(`Tổng số ảnh trong DB: ${photos.length}\n`);

  let resized = 0, skippedOk = 0, skippedGif = 0, failed = 0;
  let totalBefore = 0, totalAfter = 0;

  for (const photo of photos) {
    if (/\.gif$/i.test(photo.file_name) || /^image\/gif$/i.test(photo.mime_type || '')) {
      skippedGif++;
      continue;
    }

    try {
      const { data: fileData, error: de } = await supabase.storage.from(BUCKET).download(photo.file_name);
      if (de) throw de;
      const inputBuffer = Buffer.from(await fileData.arrayBuffer());

      const meta = await sharp(inputBuffer).metadata();
      const needsResize = (meta.width > MAX_WIDTH || meta.height > MAX_HEIGHT);
      const needsRecompress = inputBuffer.length >= SKIP_IF_UNDER_BYTES;

      if (!needsResize && !needsRecompress) {
        skippedOk++;
        totalBefore += inputBuffer.length;
        totalAfter += inputBuffer.length;
        continue;
      }

      const outputBuffer = await sharp(inputBuffer)
        .rotate() // áp dụng đúng chiều theo EXIF orientation trước khi resize
        .resize({ width: MAX_WIDTH, height: MAX_HEIGHT, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }) // phòng trường hợp PNG có nền trong suốt
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer();

      if (outputBuffer.length >= inputBuffer.length) {
        // Resize xong vẫn không nhỏ hơn (hiếm) -> vẫn giữ vì đã đúng kích thước tối đa,
        // nhưng không có gì để log thêm ở nhánh "không đổi".
      }

      const ext = '.jpg';
      const newPath = path.posix.join(path.posix.dirname(photo.file_name), `${path.posix.basename(photo.file_name, path.posix.extname(photo.file_name))}${ext}`);

      console.log(
        `${DRY_RUN ? '[DRY] ' : ''}#${photo.id} ${photo.file_name} ` +
        `${meta.width}x${meta.height} ${formatBytes(inputBuffer.length)}  ->  ` +
        `${newPath} ${formatBytes(outputBuffer.length)}`
      );

      totalBefore += inputBuffer.length;
      totalAfter += outputBuffer.length;

      if (DRY_RUN) { resized++; continue; }

      const { error: ue } = await supabase.storage.from(BUCKET).upload(newPath, outputBuffer, {
        contentType: 'image/jpeg',
        upsert: true,
        cacheControl: '3600'
      });
      if (ue) throw ue;

      const fileUrl = supabase.storage.from(BUCKET).getPublicUrl(newPath).data.publicUrl;
      const { error: ude } = await supabase.from('burn_test_photos')
        .update({ file_name: newPath, file_url: fileUrl, mime_type: 'image/jpeg', file_size: outputBuffer.length })
        .eq('id', photo.id);
      if (ude) {
        await supabase.storage.from(BUCKET).remove([newPath]);
        throw ude;
      }

      if (newPath !== photo.file_name) {
        const { error: re } = await supabase.storage.from(BUCKET).remove([photo.file_name]);
        if (re) console.warn(`  ⚠ Không xóa được file đuôi cũ (${photo.file_name}): ${re.message}`);
      }

      resized++;
    } catch (err) {
      failed++;
      console.warn(`⚠ Lỗi xử lý ảnh #${photo.id} (${photo.file_name}): ${err.message}`);
    }
  }

  console.log('\n=== HOÀN TẤT ===');
  console.log(`Đã resize: ${resized}`);
  console.log(`Bỏ qua (đã đạt chuẩn): ${skippedOk}`);
  console.log(`Bỏ qua (GIF): ${skippedGif}`);
  console.log(`Lỗi: ${failed}`);
  if (totalBefore > 0) {
    const saved = totalBefore - totalAfter;
    const pct = ((saved / totalBefore) * 100).toFixed(1);
    console.log(`Dung lượng trước: ${formatBytes(totalBefore)}  ->  sau: ${formatBytes(totalAfter)}  (giảm ${formatBytes(saved)}, ${pct}%)`);
  }
  if (DRY_RUN) console.log('\nĐây là DRY RUN, chưa có gì thay đổi thật. Chạy lại không kèm --dry-run để thực hiện.');
}

migrate().catch(err => {
  console.error('\n✖ Resize failed:', err);
  process.exitCode = 1;
});
