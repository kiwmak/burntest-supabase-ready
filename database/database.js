const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'burn-test-photos';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY. Hãy tạo file .env hoặc cấu hình biến môi trường.'
  );
}

// Service Role chỉ được dùng ở backend/server. Tuyệt đối không đưa key này vào public HTML/JS.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function assertOk(result, action = 'Supabase request') {
  if (result.error) {
    const err = new Error(`${action}: ${result.error.message}`);
    err.code = result.error.code;
    err.details = result.error.details;
    err.hint = result.error.hint;
    throw err;
  }
  return result.data;
}

async function query(table, options = {}) {
  const {
    select = '*',
    filters = [],
    order = null,
    single = false,
    maybeSingle = false,
    limit = null
  } = options;

  let q = supabase.from(table).select(select);
  for (const filter of filters) {
    const [method, ...args] = filter;
    q = q[method](...args);
  }
  if (order) {
    for (const o of order) q = q.order(o.column, { ascending: o.ascending !== false });
  }
  if (limit !== null) q = q.limit(limit);
  if (single) return assertOk(await q.single());
  if (maybeSingle) return assertOk(await q.maybeSingle());
  return assertOk(await q);
}

module.exports = {
  supabase,
  query,
  assertOk,
  SUPABASE_URL,
  SUPABASE_STORAGE_BUCKET
};
