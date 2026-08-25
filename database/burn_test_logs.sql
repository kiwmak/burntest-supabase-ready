-- ============================================================
-- Bảng log kiểm tra định kỳ trong lúc đốt (VD: mỗi 2 giờ 1 lần)
-- Chạy trong Supabase SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS burn_test_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  burn_test_id BIGINT NOT NULL REFERENCES burn_tests(id) ON DELETE CASCADE,
  time_label TEXT NOT NULL,           -- Thời gian, VD: "2H", "4H"
  wick_status TEXT NOT NULL,          -- Trạng thái bấc (text tự do)
  flame_status TEXT NOT NULL,         -- Trạng thái ngọn lửa (text tự do)
  wick_height_mm NUMERIC NOT NULL,    -- Chiều cao bấc (mm)
  vessel_condition TEXT NOT NULL,     -- Tình trạng bể đốt (text tự do)
  temperature_c NUMERIC NOT NULL,     -- Nhiệt độ (°C)
  note TEXT,                          -- Ghi chú thêm (không bắt buộc)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_burn_test_logs_test_id ON burn_test_logs(burn_test_id);

ALTER TABLE burn_test_logs ENABLE ROW LEVEL SECURITY;

-- Backend dùng SUPABASE_SERVICE_ROLE_KEY nên mặc định đã bypass RLS,
-- nhưng vẫn bật RLS + policy tường minh để đồng bộ với các bảng khác trong hệ thống.
DROP POLICY IF EXISTS "Service role full access" ON burn_test_logs;
CREATE POLICY "Service role full access" ON burn_test_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
