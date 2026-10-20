-- 對帳 sweep 用:追蹤遊戲端鎖是否已「確認解除」
-- null = 終態但 Unlock 尚未確認成功 → sweep 重試;非 null = 已解鎖
ALTER TABLE "orders" ADD COLUMN "game_unlocked_at" TIMESTAMPTZ;

-- 既有「終態」訂單視為已解鎖(過去的 Unlock 假設已成功 / 不值得回頭重試),
-- 避免上線第一輪 sweep 對歷史單全部重打一次 Unlock。
UPDATE "orders"
   SET "game_unlocked_at" = "updated_at"
 WHERE "status" IN ('delivered', 'failed', 'cancelled');

-- sweep 撈「終態 + 未確認解鎖」用
CREATE INDEX "orders_status_game_unlocked_at_idx" ON "orders" ("status", "game_unlocked_at");
