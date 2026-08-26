# Burn Test QC v2.2 — Supabase

Ứng dụng QC xưởng nến: lưu thông tin Burn Test + tối đa 5 ảnh minh chứng.

## Kiến trúc mới

```text
Browser
   ↓
Express / FastAPI-compatible REST style
   ↓
Supabase PostgreSQL
   ├── customers
   ├── purchase_orders
   ├── burn_tests
   └── burn_test_photos
          ↓
Supabase Storage
   └── burn-test-photos/
```

SQLite không còn được dùng khi server chạy bình thường.

## 1. Tạo Supabase

Trong Supabase Dashboard:

1. Tạo một project.
2. Vào **SQL Editor**.
3. Mở `database/schema.sql`.
4. Chạy toàn bộ SQL.

Schema tạo 4 bảng và bucket Storage `burn-test-photos`.

### Log kiểm tra định kỳ (mới)

Nếu bạn đã tạo DB từ trước và muốn thêm tính năng ghi log kiểm tra mỗi 2 giờ,
chạy thêm file `database/burn_test_logs.sql` trong SQL Editor (chỉ cần chạy 1 lần,
dùng `CREATE TABLE IF NOT EXISTS` nên chạy lại không lỗi).

### Xuất báo cáo PDF (mới)

Nút "⬇ Xuất PDF" trong modal chi tiết test sẽ tải file PDF gồm: thông tin test,
bảng log kiểm tra định kỳ, biểu đồ nhiệt độ theo thời gian, và toàn bộ ảnh minh
chứng — dùng để gửi cho khách hàng.

- Cần cài `pdfkit` (đã có trong `package.json`, chỉ cần `npm install`).
- Font `assets/fonts/DejaVuSans.ttf` (+ bản Bold) được bundle sẵn trong project để
  đảm bảo hiển thị đúng tiếng Việt có dấu, không phụ thuộc font cài sẵn trên server.
  **Không xóa thư mục `assets/` khi deploy.**

### Xuất báo cáo Excel (mới)

Nút "⬇ Xuất Excel" cạnh nút Xuất PDF tải file `.xlsx` gồm 2 sheet:
- **Thông tin & Log**: thông tin test + bảng log kiểm tra định kỳ + 3 dòng tổng hợp
  dùng công thức Excel thật (`AVERAGE`, `MAX`, trừ trực tiếp 2 ô) — nếu khách hàng
  sửa số liệu trong log, các dòng tổng hợp này tự tính lại.
- **Ảnh minh chứng**: toàn bộ ảnh test được nhúng trực tiếp vào file Excel.

Cần cài `exceljs` (đã có trong `package.json`, chỉ cần `npm install`).

> Backend dùng `SUPABASE_SERVICE_ROLE_KEY`. Key này chỉ được đặt ở server/.env, tuyệt đối không đưa vào `public/*.html`.

## 2. Cấu hình biến môi trường

Copy:

```bash
.env.example → .env
```

Điền:

```env
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET=burn-test-photos
PORT=3000
```

## 3. Cài package

```bash
npm install
```

## 4. Chuyển dữ liệu SQLite

Chạy:

```bash
node scripts/migrate-to-supabase.js
```

Script giữ nguyên ID của:

- 2 customers
- 3 purchase_orders
- 12 burn_tests
- 18 burn_test_photos

Nếu có thư mục `uploads/` chứa đúng các file ảnh cũ, script sẽ upload chúng lên Supabase Storage.

**Lưu ý:** source package hiện tại không chứa file vật lý trong `uploads/`, chỉ có record ảnh trong SQLite. Vì vậy migration sẽ báo các ảnh bị thiếu và không thể tự tạo lại file ảnh từ database.

Nếu sau này có lại `uploads/`, chỉ cần chạy migration lại hoặc upload bổ sung.

## 5. Chạy app

```bash
npm start
```

Mở:

```text
http://localhost:3000
```

## API giữ nguyên

```text
GET/POST   /api/v1/clients
GET/POST   /api/v1/pos
GET/POST   /api/v1/burn-tests
GET/PUT/DELETE /api/v1/burn-tests/:id
POST       /api/v1/burn-tests/:id/photos
DELETE     /api/v1/burn-tests/:id/photos/:slot
GET        /api/v1/burn-tests/summary
GET/POST   /api/v1/burn-tests/:id/logs
PUT/DELETE /api/v1/burn-tests/:id/logs/:logId
GET        /api/v1/burn-tests/:id/report.pdf
GET        /api/v1/burn-tests/:id/report.xlsx
```

API alias cũ vẫn hoạt động:

```text
/api/v1/po-details
```

Frontend hiện tại không cần đổi endpoint.

## Upload ảnh

Frontend vẫn gửi:

```text
multipart/form-data
file
pic_slot = 1..5 hoặc PIC_1..PIC_5
```

Backend nhận file bằng memory storage rồi upload trực tiếp:

```text
Supabase Storage
└── burn-test-<ID>/
    └── burn-test-<ID>-<timestamp>-<random>.jpg
```

`file_url` được lưu vào `burn_test_photos`.

## Bảo mật

- `SUPABASE_SERVICE_ROLE_KEY` chỉ chạy ở backend.
- Không đưa Service Role Key vào HTML/JavaScript.
- Các bảng bật RLS.
- Bucket ảnh đang để public để giữ nguyên chức năng xem ảnh trực tiếp từ trình duyệt.
- Nếu ảnh QC cần bảo mật, có thể đổi bucket sang private và dùng signed URL.

## Chạy production

Có thể deploy Node/Express lên Render, Railway, Koyeb hoặc VPS.

Các biến bắt buộc:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET
PORT
```
