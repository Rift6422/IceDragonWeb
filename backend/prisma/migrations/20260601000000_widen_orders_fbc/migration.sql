-- 放寬 orders.fbc 長度:FB 新版 fbclid(`_aem_` 格式)衍生的 fbc 可達 200+ 字元
-- 舊的 VARCHAR(200) 會讓「從 FB 貼文點進來(?fbclid=...)」的訂單建不起來
-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "fbc" SET DATA TYPE VARCHAR(512);
