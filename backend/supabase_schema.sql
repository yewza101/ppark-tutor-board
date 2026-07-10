-- สร้างตารางผู้ใช้
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'student')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- สร้างตารางกระดานวาดภาพ
CREATE TABLE boards (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  canvas_data TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- เพิ่มบัญชี Admin ตั้งต้น (รหัสผ่าน: admin123)
-- (หมายเหตุ: hash สร้างด้วย bcrypt)
INSERT INTO users (username, password_hash, role) 
VALUES ('admin', '$2b$10$SOdATb8QhsmyDVQxq7rFte2mrH5yR5.Qz0y2jO2eYg1U.0kX6F5Wq', 'admin');
