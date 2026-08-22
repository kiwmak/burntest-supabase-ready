const express = require('express');
const multer = require('multer');
const path = require('path');
const { supabase, SUPABASE_STORAGE_BUCKET } = require('../database/database');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) {
      return cb(new Error('Chỉ chấp nhận JPG, PNG, WEBP hoặc GIF'));
    }
    cb(null, true);
  }
});

function normalizeResult(value) {
  if (value === '' || value === null || value === undefined) return 'PENDING';
  const result = String(value).toUpperCase();
  if (!['PASS', 'FAIL', 'PENDING'].includes(result)) throw new Error('result chỉ nhận PASS, FAIL hoặc PENDING');
  return result;
}

function validatePayload(body, partial = false) {
  const payload = {
    purchase_order_id: Number(body.purchase_order_id ?? body.po_id),
    product_code: String(body.product_code ?? '').trim(),
    diameter_mm: body.diameter_mm ?? body.diameter ?? null,
    height_mm: body.height_mm ?? body.height ?? null,
    fragrance: body.fragrance ?? body.frag ?? null,
    color: body.color ?? null,
    wick: body.wick ?? null,
    temperature_c: body.temperature_c ?? body.temperature ?? null,
    test_date: body.test_date ?? null,
    test_time: body.test_time ?? body.time ?? null,
    start_datetime: body.start_datetime ?? body.start ?? null,
    end_datetime: body.end_datetime ?? body.end ?? null,
    total_burn_time: body.total_burn_time ?? body.totalBurnTime ?? null,
    tester: body.tester ?? null,
    approver: body.approver ?? body.approved ?? null,
    result: normalizeResult(body.result ?? body.test_result),
    note: body.note ?? null
  };

  if (!partial && (!payload.purchase_order_id || !payload.product_code || !payload.test_date)) {
    throw new Error('purchase_order_id, product_code và test_date là bắt buộc');
  }
  for (const [name, value] of [['diameter_mm', payload.diameter_mm], ['height_mm', payload.height_mm], ['temperature_c', payload.temperature_c]]) {
    if (value !== null && value !== '' && (!Number.isFinite(Number(value)) || Number(value) <= 0)) {
      throw new Error(`${name} phải là số lớn hơn 0`);
    }
  }
  return payload;
}

function withLegacyFields(test, photos = []) {
  if (!test) return test;
  const po = test.purchase_order || {};
  const customer = po.customer || {};
  const row = {
    ...test,
    po_number: po.po_number || null,
    customer_name: customer.name || null,
    photos
  };
  row.Id = row.id;
  row.PO_Id = row.purchase_order_id;
  row.Product_Code = row.product_code;
  row.Diameter = row.diameter_mm;
  row.Height = row.height_mm;
  row.Frag = row.fragrance;
  row.Color = row.color;
  row.Wick = row.wick;
  row.Temperature = row.temperature_c;
  row.Test_date = row.test_date;
  row.Time = row.test_time;
  row.Start = row.start_datetime;
  row.End = row.end_datetime;
  row.Total_Burn_Time = row.total_burn_time;
  row.Tester = row.tester;
  row.Approved = row.approver;
  row.Test_result = row.result === 'PENDING' ? null : row.result;
  for (const photo of photos) row[`PIC_${photo.slot}`] = photo.file_url;
  return row;
}

async function fetchPhotos(testId) {
  const { data, error } = await supabase.from('burn_test_photos')
    .select('id,slot,file_name,file_url,original_name,mime_type,file_size,created_at')
    .eq('burn_test_id', testId).order('slot');
  if (error) throw error;
  return data || [];
}

async function getTest(id) {
  const { data, error } = await supabase.from('burn_tests')
    .select('id,purchase_order_id,product_code,diameter_mm,height_mm,fragrance,color,wick,temperature_c,test_date,test_time,start_datetime,end_datetime,total_burn_time,tester,approver,result,note,created_at,updated_at,purchase_order:purchase_orders!inner(id,po_number,customer:customers!inner(id,name))')
    .eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const photos = await fetchPhotos(id);
  return withLegacyFields(data, photos);
}

async function listTests(query) {
  let q = supabase.from('burn_tests')
    .select('id,purchase_order_id,product_code,diameter_mm,height_mm,fragrance,color,wick,temperature_c,test_date,test_time,start_datetime,end_datetime,total_burn_time,tester,approver,result,note,created_at,updated_at,purchase_order:purchase_orders!inner(id,po_number,customer:customers!inner(id,name))');

  const po = query.purchase_order_id || query.po_id;
  const r = query.result || query.test_result;
  if (po) q = q.eq('purchase_order_id', po);
  if (query.product_code) q = q.ilike('product_code', `%${query.product_code}%`);
  if (r) q = q.eq('result', r === 'CHỜ' ? 'PENDING' : r);
  if (query.tester) q = q.ilike('tester', `%${query.tester}%`);
  if (query.from_date) q = q.gte('test_date', query.from_date);
  if (query.to_date) q = q.lte('test_date', query.to_date);

  const { data, error } = await q.order('test_date', { ascending: false }).order('id', { ascending: false });
  if (error) throw error;

  const ids = (data || []).map(x => x.id);
  let photos = [];
  if (ids.length) {
    const { data: ph, error: pe } = await supabase.from('burn_test_photos')
      .select('id,burn_test_id,slot,file_url,original_name,mime_type,file_size,created_at')
      .in('burn_test_id', ids).order('slot');
    if (pe) throw pe;
    photos = ph || [];
  }
  const byTest = {};
  for (const p of photos) (byTest[p.burn_test_id] ||= []).push(p);

  return (data || []).map(t => {
    const row = withLegacyFields(t, byTest[t.id] || []);
    row.photo_count = (byTest[t.id] || []).length;
    for (const p of (byTest[t.id] || [])) row[`PIC_${p.slot}`] = p.file_url;
    return row;
  });
}

router.get('/', async (req, res, next) => {
  try { res.json(await listTests(req.query)); } catch (err) { next(err); }
});

router.get('/summary', async (req, res, next) => {
  try {
    let q = supabase.from('burn_tests').select('result');
    const po = req.query.purchase_order_id || req.query.po_id;
    if (po) q = q.eq('purchase_order_id', po);
    if (req.query.result) q = q.eq('result', req.query.result);
    const { data, error } = await q;
    if (error) throw error;
    const rows = data || [];
    res.json({
      total: rows.length,
      pass_count: rows.filter(x => x.result === 'PASS').length,
      fail_count: rows.filter(x => x.result === 'FAIL').length,
      pending_count: rows.filter(x => x.result === 'PENDING').length
    });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await getTest(req.params.id);
    if (!row) return res.status(404).json({ error: 'Không tìm thấy bản ghi test' });
    res.json(row);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const p = validatePayload(req.body);
    const { data: po, error: pe } = await supabase.from('purchase_orders').select('id').eq('id', p.purchase_order_id).maybeSingle();
    if (pe) throw pe;
    if (!po) return res.status(400).json({ error: 'PO không tồn tại' });

    const { data, error } = await supabase.from('burn_tests').insert({
      purchase_order_id: p.purchase_order_id,
      product_code: p.product_code,
      diameter_mm: p.diameter_mm === '' ? null : p.diameter_mm,
      height_mm: p.height_mm === '' ? null : p.height_mm,
      fragrance: p.fragrance, color: p.color, wick: p.wick,
      temperature_c: p.temperature_c === '' ? null : p.temperature_c,
      test_date: p.test_date, test_time: p.test_time,
      start_datetime: p.start_datetime, end_datetime: p.end_datetime,
      total_burn_time: p.total_burn_time, tester: p.tester, approver: p.approver,
      result: p.result, note: p.note
    }).select('id').single();
    if (error) throw error;
    res.status(201).json(await getTest(data.id));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

function sanitizeProductCode(code) {
  // Dùng làm tên thư mục trên Supabase Storage -> loại bỏ ký tự không an toàn (/, khoảng trắng, v.v).
  const safe = String(code ?? '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!safe) throw new Error('product_code không hợp lệ để tạo đường dẫn lưu ảnh');
  return safe;
}

function buildPhotoPath(poNumber, productCode, slot, ext) {
  return `${sanitizeProductCode(poNumber)}/${sanitizeProductCode(productCode)}/burn-test-${slot}${ext}`;
}

// Khi đổi PO hoặc mã hàng của 1 test đã có ảnh, di chuyển toàn bộ ảnh trong Storage
// sang đường dẫn mới (theo PO/mã hàng mới) và cập nhật lại file_name/file_url trong DB.
async function movePhotosOnCodeChange(testId, oldPoNumber, oldProductCode, newPoNumber, newProductCode) {
  const oldSafe = sanitizeProductCode(oldPoNumber);
  const newSafe = sanitizeProductCode(newPoNumber);
  const oldCodeSafe = sanitizeProductCode(oldProductCode);
  const newCodeSafe = sanitizeProductCode(newProductCode);
  if (oldSafe === newSafe && oldCodeSafe === newCodeSafe) return { moved: 0, failed: 0 };

  const { data: photos, error: fe } = await supabase.from('burn_test_photos')
    .select('id, slot, file_name, mime_type').eq('burn_test_id', testId);
  if (fe) throw fe;
  if (!photos?.length) return { moved: 0, failed: 0 };

  let moved = 0, failed = 0;
  for (const photo of photos) {
    try {
      const ext = (path.extname(photo.file_name) || '.jpg').toLowerCase();
      const newPath = buildPhotoPath(newPoNumber, newProductCode, photo.slot, ext);
      if (newPath === photo.file_name) continue;

      const { data: fileData, error: de } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET).download(photo.file_name);
      if (de) throw de;
      const buffer = Buffer.from(await fileData.arrayBuffer());

      const { error: ue } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET)
        .upload(newPath, buffer, { contentType: photo.mime_type || 'image/jpeg', upsert: true, cacheControl: '3600' });
      if (ue) throw ue;

      const fileUrl = supabase.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(newPath).data.publicUrl;
      const { error: ude } = await supabase.from('burn_test_photos')
        .update({ file_name: newPath, file_url: fileUrl }).eq('id', photo.id);
      if (ude) { await supabase.storage.from(SUPABASE_STORAGE_BUCKET).remove([newPath]); throw ude; }

      const { error: re } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET).remove([photo.file_name]);
      if (re) console.warn(`⚠ Không xóa được ảnh cũ (${photo.file_name}):`, re.message);

      moved++;
    } catch (err) {
      failed++;
      console.warn(`⚠ Không di chuyển được ảnh #${photo.id} (test ${testId}):`, err.message);
    }
  }
  return { moved, failed };
}

router.put('/:id', async (req, res, next) => {
  try {
    const { data: existing, error: ee } = await supabase.from('burn_tests').select('*').eq('id', req.params.id).maybeSingle();
    if (ee) throw ee;
    if (!existing) return res.status(404).json({ error: 'Không tìm thấy bản ghi test' });

    // Ghép dữ liệu tường minh từng trường — KHÔNG dùng {...existing, ...req.body} vì tên field
    // frontend gửi lên (VD: test_result, diameter, approved) khác tên cột thật trong DB
    // (VD: result, diameter_mm, approver). Spread kiểu cũ khiến giá trị cũ trong DB "che mất"
    // giá trị mới gửi lên do 2 field trùng nghĩa nhưng khác tên không hề ghi đè lẫn nhau.
    const p = validatePayload({
      purchase_order_id: req.body.purchase_order_id ?? req.body.po_id ?? existing.purchase_order_id,
      product_code: req.body.product_code ?? existing.product_code,
      diameter_mm: req.body.diameter_mm ?? req.body.diameter ?? existing.diameter_mm,
      height_mm: req.body.height_mm ?? req.body.height ?? existing.height_mm,
      fragrance: req.body.fragrance ?? req.body.frag ?? existing.fragrance,
      color: req.body.color ?? existing.color,
      wick: req.body.wick ?? existing.wick,
      temperature_c: req.body.temperature_c ?? req.body.temperature ?? existing.temperature_c,
      test_date: req.body.test_date ?? existing.test_date,
      test_time: req.body.test_time ?? req.body.time ?? existing.test_time,
      start_datetime: req.body.start_datetime ?? req.body.start ?? existing.start_datetime,
      end_datetime: req.body.end_datetime ?? req.body.end ?? existing.end_datetime,
      total_burn_time: req.body.total_burn_time ?? req.body.totalBurnTime ?? existing.total_burn_time,
      tester: req.body.tester ?? existing.tester,
      approver: req.body.approver ?? req.body.approved ?? existing.approver,
      result: req.body.result ?? req.body.test_result ?? existing.result,
      note: req.body.note ?? existing.note
    }, true);

    const { data: po, error: pe } = await supabase.from('purchase_orders').select('id, po_number').eq('id', p.purchase_order_id).maybeSingle();
    if (pe) throw pe;
    if (!po) return res.status(400).json({ error: 'PO không tồn tại' });

    const { error } = await supabase.from('burn_tests').update({
      purchase_order_id: p.purchase_order_id, product_code: p.product_code,
      diameter_mm: p.diameter_mm === '' ? null : p.diameter_mm,
      height_mm: p.height_mm === '' ? null : p.height_mm,
      fragrance: p.fragrance, color: p.color, wick: p.wick,
      temperature_c: p.temperature_c === '' ? null : p.temperature_c,
      test_date: p.test_date, test_time: p.test_time,
      start_datetime: p.start_datetime, end_datetime: p.end_datetime,
      total_burn_time: p.total_burn_time, tester: p.tester,
      approver: p.approver, result: p.result, note: p.note,
      updated_at: new Date().toISOString()
    }).eq('id', req.params.id);
    if (error) throw error;

    // PO hoặc mã hàng đổi -> di chuyển toàn bộ ảnh sang đường dẫn mới trên Storage (theo po_number).
    try {
      let oldPoNumber = po.po_number;
      if (String(existing.purchase_order_id) !== String(p.purchase_order_id)) {
        const { data: oldPo } = await supabase.from('purchase_orders').select('po_number').eq('id', existing.purchase_order_id).maybeSingle();
        oldPoNumber = oldPo?.po_number ?? String(existing.purchase_order_id);
      }
      await movePhotosOnCodeChange(req.params.id, oldPoNumber, existing.product_code, po.po_number, p.product_code);
    } catch (moveErr) {
      console.warn(`⚠ Lỗi di chuyển ảnh cho test ${req.params.id}:`, moveErr.message);
    }

    res.json(await getTest(req.params.id));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const photos = await fetchPhotos(req.params.id);
    const { data, error } = await supabase.from('burn_tests').delete().eq('id', req.params.id).select('id');
    if (error) {
      if (error.code === '23503') return res.status(409).json({ error: 'Không thể xóa bản ghi test' });
      throw error;
    }
    if (!data?.length) return res.status(404).json({ error: 'Không tìm thấy bản ghi test' });

    const paths = photos.map(p => p.file_name).filter(Boolean);
    if (paths.length) {
      const { error: se } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET).remove(paths);
      if (se) console.warn('Không xóa được một số ảnh khỏi Storage:', se.message);
    }
    res.status(204).send();
  } catch (err) { next(err); }
});

function parseSlot(raw) {
  const slotMatch = String(raw ?? '').trim().toUpperCase().match(/^PIC[_-]?([1-5])$/);
  const slot = slotMatch ? Number(slotMatch[1]) : Number(raw);
  if (!Number.isInteger(slot) || slot < 1 || slot > 5) throw new Error('slot phải từ 1 đến 5');
  return slot;
}

router.post(['/:id/photos', '/:id/images'], upload.single('file'), async (req, res, next) => {
  try {
    const { data: test, error: te } = await supabase.from('burn_tests')
      .select('id, product_code, purchase_order:purchase_orders!inner(po_number)').eq('id', req.params.id).maybeSingle();
    if (te) throw te;
    if (!test) return res.status(404).json({ error: 'Không tìm thấy bản ghi test' });
    if (!req.file) return res.status(400).json({ error: 'Thiếu file ảnh' });

    const slot = parseSlot(req.body.slot ?? req.body.pic_slot);
    const ext = (path.extname(req.file.originalname).toLowerCase() || '.jpg').replace(/[^a-z0-9.]/g, '');
    // Cấu trúc: {po_number}/{product_code}/burn-test-{slot}.{ext}
    // Cố định theo slot -> ảnh mới tự động ghi đè ảnh cũ cùng vị trí.
    const storagePath = buildPhotoPath(test.purchase_order.po_number, test.product_code, slot, ext);

    const { data: old, error: oe } = await supabase.from('burn_test_photos')
      .select('file_name').eq('burn_test_id', req.params.id).eq('slot', slot).maybeSingle();
    if (oe) throw oe;

    const { error: uploadError } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET)
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
        cacheControl: '3600'
      });
    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(storagePath);
    const fileUrl = publicUrlData.publicUrl;

    const { error: dbError } = await supabase.from('burn_test_photos').upsert({
      burn_test_id: Number(req.params.id),
      slot,
      file_name: storagePath,
      file_url: fileUrl,
      original_name: req.file.originalname,
      mime_type: req.file.mimetype,
      file_size: req.file.size,
      created_at: new Date().toISOString()
    }, { onConflict: 'burn_test_id,slot' });
    if (dbError) {
      await supabase.storage.from(SUPABASE_STORAGE_BUCKET).remove([storagePath]);
      throw dbError;
    }

    // Nếu ảnh cũ có đuôi file khác (vd .png -> .jpg) thì path sẽ khác -> xóa file cũ để tránh rác.
    if (old?.file_name && old.file_name !== storagePath) {
      const { error: removeError } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET).remove([old.file_name]);
      if (removeError) console.warn('Không xóa được ảnh cũ:', removeError.message);
    }

    await supabase.from('burn_tests').update({ updated_at: new Date().toISOString() }).eq('id', req.params.id);
    res.json(await getTest(req.params.id));
  } catch (err) { next(err); }
});

router.delete('/:id/photos/:slot', async (req, res, next) => {
  try {
    const slot = parseSlot(req.params.slot);
    const { data: photo, error: pe } = await supabase.from('burn_test_photos')
      .select('file_name').eq('burn_test_id', req.params.id).eq('slot', slot).maybeSingle();
    if (pe) throw pe;
    if (!photo) return res.status(404).json({ error: 'Không tìm thấy ảnh' });

    const { error } = await supabase.from('burn_test_photos').delete()
      .eq('burn_test_id', req.params.id).eq('slot', slot);
    if (error) throw error;

    if (photo.file_name) {
      const { error: se } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET).remove([photo.file_name]);
      if (se) console.warn('Không xóa được ảnh khỏi Storage:', se.message);
    }
    await supabase.from('burn_tests').update({ updated_at: new Date().toISOString() }).eq('id', req.params.id);
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
