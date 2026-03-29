CREATE TABLE IF NOT EXISTS carts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user (user_id)
);

CREATE TABLE IF NOT EXISTS cart_lines (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  cart_id BIGINT NOT NULL,
  course_id BIGINT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  price_snapshot_cents INT NOT NULL,
  UNIQUE KEY uniq_cart_course (cart_id, course_id),
  FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  status ENUM('pending_payment', 'paid', 'cancelled', 'fulfilled') NOT NULL DEFAULT 'pending_payment',
  payment_ref VARCHAR(255) NULL,
  shipping_line1 VARCHAR(500) NOT NULL,
  shipping_line2 VARCHAR(500) NULL,
  shipping_city VARCHAR(255) NOT NULL,
  shipping_region VARCHAR(255) NULL,
  shipping_postal VARCHAR(64) NOT NULL,
  shipping_country CHAR(2) NOT NULL,
  shipping_lat DECIMAL(10, 7) NULL,
  shipping_lng DECIMAL(10, 7) NULL,
  total_cents INT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user (user_id),
  KEY idx_status (status)
);

CREATE TABLE IF NOT EXISTS order_lines (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT NOT NULL,
  course_id BIGINT NOT NULL,
  quantity INT NOT NULL,
  unit_price_cents INT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
