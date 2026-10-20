-- Soft delete columns for products and categories
-- 跟 status=inactive「下架」分開:下架可重新上架、保留在列表;刪除等於從列表移除
-- Category 刪除時,application layer 會把底下 products.category_id 設 null(歸到「未分類」)
ALTER TABLE "products"
  ADD COLUMN "deleted_at" TIMESTAMPTZ;

ALTER TABLE "categories"
  ADD COLUMN "deleted_at" TIMESTAMPTZ;

CREATE INDEX "products_deleted_at_idx" ON "products"("deleted_at");
CREATE INDEX "categories_deleted_at_idx" ON "categories"("deleted_at");
