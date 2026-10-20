-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "client_ip" INET,
ADD COLUMN     "client_user_agent" VARCHAR(500),
ADD COLUMN     "fb_capi_sent_at" TIMESTAMPTZ,
ADD COLUMN     "fbc" VARCHAR(200),
ADD COLUMN     "fbp" VARCHAR(200);
