const express = require('express');
const { supabase, assertOk } = require('../database/database');
const router = express.Router();

function legacy(row) {
  if (!row) return row;
  return {
    ...row,
    Cus_id: row.id,
    Cus_Name: row.name
  };
}

router.get('/', async (_req, res, next) => {
  try {
    const { data, error } = await supabase.from('customers').select('id,name,created_at').order('name');
    if (error) throw error;
    res.json(data.map(legacy));
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('customers').select('id,name,created_at').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
    res.json(legacy(data));
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  const name = String(req.body.name ?? req.body.cus_name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Tên khách hàng là bắt buộc' });
  try {
    const { data, error } = await supabase.from('customers').insert({ name }).select('id,name,created_at').single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Khách hàng đã tồn tại' });
      throw error;
    }
    res.status(201).json(legacy(data));
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { data: existing, error: e1 } = await supabase.from('customers').select('*').eq('id', req.params.id).maybeSingle();
    if (e1) throw e1;
    if (!existing) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });

    const name = String(req.body.name ?? req.body.cus_name ?? existing.name).trim();
    if (!name) return res.status(400).json({ error: 'Tên khách hàng không được để trống' });

    const { data, error } = await supabase.from('customers').update({ name }).eq('id', req.params.id).select('id,name,created_at').single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Khách hàng đã tồn tại' });
      throw error;
    }
    res.json(legacy(data));
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await supabase.from('customers').delete().eq('id', req.params.id);
    if (error) {
      if (error.code === '23503') return res.status(409).json({ error: 'Không thể xóa khách hàng đang có PO/test' });
      throw error;
    }
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
