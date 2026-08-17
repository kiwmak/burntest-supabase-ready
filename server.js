process.removeAllListeners('warning');
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
require('./database/database');

const clientsRouter = require('./routes/clients');
const posRouter = require('./routes/pos');
const burnTestsRouter = require('./routes/burnTests');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
// Images are now served by Supabase Storage. Keep this route only for backward compatibility.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api', (_req, res) => res.json({
  message: 'Burn Test QC API - Supabase',
  database: 'Supabase PostgreSQL',
  storage: process.env.SUPABASE_STORAGE_BUCKET || 'burn-test-photos',
  endpoints: {
    customers: '/api/v1/clients',
    purchase_orders: '/api/v1/pos',
    burn_tests: '/api/v1/burn-tests',
    summary: '/api/v1/burn-tests/summary',
    photos: 'POST /api/v1/burn-tests/:id/photos'
  }
}));

app.use('/api/v1/clients', clientsRouter);
app.use('/api/v1/pos', posRouter);
app.use('/api/v1/burn-tests', burnTestsRouter);
app.use('/api/v1/po-details', burnTestsRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.statusCode || 500;
  res.status(status).json({ error: err.message || 'Lỗi máy chủ' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`✔ Burn Test QC đang chạy tại http://localhost:${PORT}`));
}
module.exports = app;
