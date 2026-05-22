-- AlterTable
ALTER TABLE "products" ADD COLUMN     "playfab_item_id" TEXT,
ADD COLUMN     "playfab_store_id" TEXT;

-- CreateIndex
CREATE INDEX "products_playfab_item_id_idx" ON "products"("playfab_item_id");
