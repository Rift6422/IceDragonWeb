-- CreateEnum
CREATE TYPE "direct_topup_status" AS ENUM ('pending_verify', 'verify_failed', 'verify_ok', 'topup_processing', 'delivered', 'duplicate', 'failed');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "callback_kind" ADD VALUE 'b_auth_result';
ALTER TYPE "callback_kind" ADD VALUE 'b_account_verify';
ALTER TYPE "callback_kind" ADD VALUE 'b_topup_result';

-- CreateTable
CREATE TABLE "direct_topup_attempts" (
    "id" UUID NOT NULL,
    "mycard_id" VARCHAR(32) NOT NULL,
    "mycard_project_no" VARCHAR(32),
    "mycard_type" VARCHAR(16),
    "trade_seq" VARCHAR(50),
    "user_id" UUID,
    "submitted_uid" CHAR(16),
    "amount" DECIMAL(12,2),
    "currency" VARCHAR(8),
    "card_point" INTEGER,
    "status" "direct_topup_status" NOT NULL,
    "vresult" INTEGER,
    "sresult" INTEGER,
    "smessage" VARCHAR(500),
    "verify_token" VARCHAR(64),
    "verify_token_expire" TIMESTAMPTZ,
    "auth_request_raw" JSONB,
    "verify_request_raw" JSONB,
    "topup_request_raw" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "verified_at" TIMESTAMPTZ,
    "topup_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,

    CONSTRAINT "direct_topup_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "direct_topup_attempts_mycard_id_key" ON "direct_topup_attempts"("mycard_id");

-- CreateIndex
CREATE UNIQUE INDEX "direct_topup_attempts_trade_seq_key" ON "direct_topup_attempts"("trade_seq");

-- CreateIndex
CREATE UNIQUE INDEX "direct_topup_attempts_verify_token_key" ON "direct_topup_attempts"("verify_token");

-- CreateIndex
CREATE INDEX "direct_topup_attempts_user_id_created_at_idx" ON "direct_topup_attempts"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "direct_topup_attempts_status_created_at_idx" ON "direct_topup_attempts"("status", "created_at");

-- AddForeignKey
ALTER TABLE "direct_topup_attempts" ADD CONSTRAINT "direct_topup_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
