-- 玩家未付款重點同商品時,resume 回原本的 MyCard 跳轉網址(同一個 AuthCode session),
-- 避免開新單產生第二個可付款的 AuthCode → 防雙分頁/重複建單的重複扣款。
ALTER TABLE "transactions" ADD COLUMN "transaction_url" VARCHAR(1024);
