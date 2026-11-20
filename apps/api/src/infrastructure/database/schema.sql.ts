export const SCHEMA_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY,
    sku VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    original_price_cents INTEGER NOT NULL,
    sale_price_cents INTEGER NOT NULL,
    image_url VARCHAR(512),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_products_sku UNIQUE (sku),
    CONSTRAINT ck_products_original_price_positive CHECK (original_price_cents > 0),
    CONSTRAINT ck_products_sale_price_positive CHECK (sale_price_cents > 0)
  )`,
  `CREATE TABLE IF NOT EXISTS flash_sales (
    id UUID PRIMARY KEY,
    product_id UUID NOT NULL,
    total_stock INTEGER NOT NULL,
    remaining_stock INTEGER NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_flash_sales_product FOREIGN KEY (product_id) REFERENCES products (id),
    CONSTRAINT ck_flash_sales_total_stock_non_negative CHECK (total_stock >= 0),
    CONSTRAINT ck_flash_sales_remaining_stock_bounds
      CHECK (remaining_stock >= 0 AND remaining_stock <= total_stock),
    CONSTRAINT ck_flash_sales_window CHECK (ends_at > starts_at)
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY,
    flash_sale_id UUID NOT NULL,
    product_id UUID NOT NULL,
    user_id VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'CONFIRMED',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT fk_orders_flash_sale FOREIGN KEY (flash_sale_id)
      REFERENCES flash_sales (id) ON DELETE CASCADE,
    CONSTRAINT fk_orders_product FOREIGN KEY (product_id) REFERENCES products (id),
    CONSTRAINT uq_orders_one_per_user UNIQUE (flash_sale_id, user_id)
  )`,
];

export const ACQUIRE_SCHEMA_LOCK_SQL = 'SELECT pg_advisory_xact_lock($1)';
