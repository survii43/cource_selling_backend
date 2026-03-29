CREATE TABLE IF NOT EXISTS course_assets (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  course_id BIGINT NOT NULL,
  kind ENUM('preview', 'full') NOT NULL,
  asset_type ENUM('video', 'pdf', 'book') NOT NULL,
  storage_key VARCHAR(1024) NOT NULL,
  mime VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_course_kind (course_id, kind)
);

CREATE TABLE IF NOT EXISTS entitlements (
  user_id BIGINT NOT NULL,
  course_id BIGINT NOT NULL,
  order_id BIGINT NULL,
  granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, course_id)
);
