const express = require('express');
const { supabase } = require('../database/database');
const router = express.Router();

async function getPO(id) {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('id,customer_id,po_number,created_at,customers(id,name)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { count, error: countError } = await supabase
    .from('burn_tests').select('id', { count: 'exact', head: true }).eq('purchase_order_id', id);
  if (countError) throw countError;
  return {
    ...data,
    PO_Id: data.id,
    Cus_id: data.customer_id,
    PO_Name: data.po_number,
    customer_name: data.customers?.name || null,
    Cus_Name: data.customers?.name || null,
    test_count: count || 0
  };
}

async function listPOs(filters = {}) {
  let q = supabase.from('purchase_orders')
    .select('id,customer_id,po_number,created_at,customers(id,name)');
  if (filters.customer_id || filters.cus_id) q = q.eq('customer_id', filters.customer_id || filters.cus_id);
  const { data, error } = await q.order('po_number');
  if (error) throw error;
  if (!data.length) return [];

  const ids = data.map(x => x.id);
  const { data: tests, error: te } = await supabase
    .from('burn_tests').select('purchase_order_id').in('purchase_order_id', ids);
  if (te) throw te;
  const counts = {};
  for (const t of tests || []) counts[t.purchase_order_id] = (counts[t.purchase_order_id] || 0) + 1;

  return data.map(x => ({
    ...x,
    PO_Id: x.id,
    Cus_id: x.customer_id,
    PO_Name: x.po_number,
    customer_name: x.customers?.name || null,
    Cus_Name: x.customers?.name || null,
    test_count: counts[x.id] || 0
  }));
}

router.get('/', async (req, res, next) => {
  try { res.json(await listPOs(req.query)); } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await getPO(req.params.id);
    if (!row) return res.status(404).json({ error: 'Không tìm thấy PO' });
    res.json(row);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  const customerId = Number(req.body.customer_id ?? req.body.cus_id);
  const poNumber = String(req.body.po_number ?? req.body.po_name ?? '').trim();
  if (!customerId || !poNumber) return res.status(400).json({ error: 'customer_id và po_number là bắt buộc' });
  try {
    const { data: customer, error: ce } = await supabase.from('customers').select('id').eq('id', customerId).maybeSingle();
    if (ce) throw ce;
    if (!customer) return res.status(400).json({ error: 'Khách hàng không tồn tại' });

    const { data, error } = await supabase.from('purchase_orders')
      .insert({ customer_id: customerId, po_number: poNumber })
      .select('id').single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'PO này đã tồn tại với khách hàng đã chọn' });
      throw error;
    }
    res.status(201).json(await getPO(data.id));
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { data: existing, error: ee } = await supabase.from('purchase_orders').select('*').eq('id', req.params.id).maybeSingle();
    if (ee) throw ee;
    if (!existing) return res.status(404).json({ error: 'Không tìm thấy PO' });

    const customerId = Number(req.body.customer_id ?? req.body.cus_id ?? existing.customer_id);
    const poNumber = String(req.body.po_number ?? req.body.po_name ?? existing.po_number).trim();

    const { data: customer, error: ce } = await supabase.from('customers').select('id').eq('id', customerId).maybeSingle();
    if (ce) throw ce;
    if (!customer) return res.status(400).json({ error: 'Khách hàng không tồn tại' });

    const { error } = await supabase.from('purchase_orders')
      .update({ customer_id: customerId, po_number: poNumber }).eq('id', req.params.id);
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'PO này đã tồn tại với khách hàng đã chọn' });
      throw error;
    }
    res.json(await getPO(req.params.id));
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await supabase.from('purchase_orders').delete().eq('id', req.params.id);
    if (error) {
      if (error.code === '23503') return res.status(409).json({ error: 'Không thể xóa PO đang có dữ liệu test' });
      throw error;
    }
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
