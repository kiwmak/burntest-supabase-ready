const express = require('express');
const { supabase } = require('../database/database');
const router = express.Router();

function legacy(row) {
  if (!row) return row;
  return {
    ...row,
    product_id: row.id,
    product_code: row.product_code,
    name: row.name,
    description: row.description,
    diameter_mm: row.diameter_mm,
    height_mm: row.height_mm,
    fragrance: row.fragrance,
    color: row.color,
    wick: row.wick
  };
}

// GET /api/v1/products - Danh sách tất cả sản phẩm
router.get('/', async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('product_code');
    if (error) throw error;
    res.json(data.map(legacy));
  } catch (err) { next(err); }
});

// GET /api/v1/products/:id - Chi tiết một sản phẩm
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
    res.json(legacy(data));
  } catch (err) { next(err); }
});

// POST /api/v1/products - Tạo mới sản phẩm
router.post('/', async (req, res, next) => {
  const productCode = String(req.body.product_code ?? '').trim();
  const name = String(req.body.name ?? '').trim();
  
  if (!productCode) return res.status(400).json({ error: 'Mã sản phẩm là bắt buộc' });
  if (!name) return res.status(400).json({ error: 'Tên sản phẩm là bắt buộc' });
  
  try {
    const insertData = {
      product_code: productCode,
      name: name,
      description: req.body.description?.trim() || null,
      diameter_mm: req.body.diameter_mm ? parseFloat(req.body.diameter_mm) : null,
      height_mm: req.body.height_mm ? parseFloat(req.body.height_mm) : null,
      fragrance: req.body.fragrance?.trim() || null,
      color: req.body.color?.trim() || null,
      wick: req.body.wick?.trim() || null
    };
    
    const { data, error } = await supabase
      .from('products')
      .insert(insertData)
      .select('*')
      .single();
      
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Mã sản phẩm đã tồn tại' });
      throw error;
    }
    res.status(201).json(legacy(data));
  } catch (err) { next(err); }
});

// PUT /api/v1/products/:id - Cập nhật sản phẩm
router.put('/:id', async (req, res, next) => {
  try {
    const { data: existing, error: e1 } = await supabase
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
      
    if (e1) throw e1;
    if (!existing) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });

    const updateData = {
      product_code: req.body.product_code !== undefined ? String(req.body.product_code).trim() : existing.product_code,
      name: req.body.name !== undefined ? String(req.body.name).trim() : existing.name,
      description: req.body.description !== undefined ? String(req.body.description).trim() : existing.description,
      diameter_mm: req.body.diameter_mm !== undefined ? (req.body.diameter_mm ? parseFloat(req.body.diameter_mm) : null) : existing.diameter_mm,
      height_mm: req.body.height_mm !== undefined ? (req.body.height_mm ? parseFloat(req.body.height_mm) : null) : existing.height_mm,
      fragrance: req.body.fragrance !== undefined ? String(req.body.fragrance).trim() : existing.fragrance,
      color: req.body.color !== undefined ? String(req.body.color).trim() : existing.color,
      wick: req.body.wick !== undefined ? String(req.body.wick).trim() : existing.wick,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', req.params.id)
      .select('*')
      .single();
      
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Mã sản phẩm đã tồn tại' });
      throw error;
    }
    res.json(legacy(data));
  } catch (err) { next(err); }
});

// DELETE /api/v1/products/:id - Xóa sản phẩm
router.delete('/:id', async (req, res, next) => {
  try {
    // Kiểm tra xem sản phẩm có đang được sử dụng trong burn_tests không
    const { count } = await supabase
      .from('burn_tests')
      .select('*', { count: 'exact', head: true })
      .eq('product_code', req.params.id);
      
    if (count > 0) {
      return res.status(409).json({ error: 'Không thể xóa sản phẩm đang có dữ liệu test' });
    }
    
    const { error } = await supabase.from('products').delete().eq('id', req.params.id);
    if (error) throw error;
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
