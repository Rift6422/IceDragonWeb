-- CreateEnum
CREATE TYPE "product_status" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('pending', 'authed', 'paid', 'confirmed', 'delivered', 'delivery_failed', 'cancelled', 'failed');

-- CreateEnum
CREATE TYPE "callback_direction" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "callback_kind" AS ENUM ('auth_global', 'trade_query', 'payment_confirm', 'pay_item_query', 'sdk_trade_query', 'trade_result', 'supplement', 'diff_report', 'topup_records');

-- CreateEnum
CREATE TYPE "ledger_source" AS ENUM ('order', 'admin', 'system', 'refund');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('pending', 'success', 'failed');

-- CreateEnum
CREATE TYPE "admin_role" AS ENUM ('super_admin', 'cs', 'finance');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "uid" CHAR(16) NOT NULL,
    "email" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "google_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_ip" INET,
    "last_login_at" TIMESTAMPTZ,
    "last_login_ip" INET,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "mycard_item_code" TEXT,
    "name_display" VARCHAR(100) NOT NULL,
    "name_internal" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'TWD',
    "effects" JSONB NOT NULL,
    "status" "product_status" NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "fac_trade_seq" VARCHAR(50) NOT NULL,
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_snapshot" JSONB NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'pending',
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "authed_at" TIMESTAMPTZ,
    "paid_at" TIMESTAMPTZ,
    "confirmed_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" "order_status",
    "to_status" "order_status" NOT NULL,
    "reason" TEXT,
    "triggered_by" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "order_id" UUID NOT NULL,
    "auth_code" VARCHAR(512),
    "trade_seq" TEXT,
    "mycard_trade_no" TEXT,
    "payment_type" TEXT,
    "mycard_type" TEXT,
    "pay_result" INTEGER,
    "promo_code" TEXT,
    "serial_id" TEXT,
    "auth_raw_response" JSONB,
    "result_raw_body" JSONB,
    "confirm_raw_response" JSONB,
    "paid_at" TIMESTAMPTZ,
    "confirmed_at" TIMESTAMPTZ,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("order_id")
);

-- CreateTable
CREATE TABLE "callback_logs" (
    "id" UUID NOT NULL,
    "direction" "callback_direction" NOT NULL,
    "kind" "callback_kind" NOT NULL,
    "order_id" UUID,
    "http_method" VARCHAR(10) NOT NULL,
    "url" TEXT NOT NULL,
    "request_headers" JSONB,
    "request_body" TEXT,
    "response_status" INTEGER,
    "response_body" TEXT,
    "source_ip" INET,
    "user_agent" TEXT,
    "hash_valid" BOOLEAN,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "callback_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_currency" (
    "user_id" UUID NOT NULL,
    "currency_code" TEXT NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inventory_currency_pkey" PRIMARY KEY ("user_id","currency_code")
);

-- CreateTable
CREATE TABLE "inventory_ledger" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "source_type" "ledger_source" NOT NULL,
    "source_id" UUID,
    "effect" JSONB NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_attempts" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "delivery_status" NOT NULL,
    "request_payload" JSONB,
    "response_status" INTEGER,
    "response_body" TEXT,
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "admin_role" NOT NULL DEFAULT 'cs',
    "totp_secret" TEXT,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ,
    "last_login_ip" INET,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "payload" JSONB,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_uid_key" ON "users"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE INDEX "products_status_sort_order_idx" ON "products"("status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "orders_fac_trade_seq_key" ON "orders"("fac_trade_seq");

-- CreateIndex
CREATE INDEX "orders_user_id_status_idx" ON "orders"("user_id", "status");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at" DESC);

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_auth_code_key" ON "transactions"("auth_code");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_mycard_trade_no_key" ON "transactions"("mycard_trade_no");

-- CreateIndex
CREATE INDEX "callback_logs_kind_created_at_idx" ON "callback_logs"("kind", "created_at");

-- CreateIndex
CREATE INDEX "callback_logs_order_id_idx" ON "callback_logs"("order_id");

-- CreateIndex
CREATE INDEX "callback_logs_direction_created_at_idx" ON "callback_logs"("direction", "created_at");

-- CreateIndex
CREATE INDEX "inventory_ledger_user_id_created_at_idx" ON "inventory_ledger"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_ledger_source_type_source_id_idx" ON "inventory_ledger"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "delivery_attempts_order_id_idx" ON "delivery_attempts"("order_id");

-- CreateIndex
CREATE INDEX "delivery_attempts_status_created_at_idx" ON "delivery_attempts"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_attempts_order_id_attempt_number_key" ON "delivery_attempts"("order_id", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "admin_audit_logs_admin_id_created_at_idx" ON "admin_audit_logs"("admin_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_audit_logs_action_created_at_idx" ON "admin_audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "admin_audit_logs_target_type_target_id_idx" ON "admin_audit_logs"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "callback_logs" ADD CONSTRAINT "callback_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_currency" ADD CONSTRAINT "inventory_currency_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
