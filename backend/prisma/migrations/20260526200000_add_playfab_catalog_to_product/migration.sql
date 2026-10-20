-- AlterTable: per-product PlayFab CatalogVersion (fallback to env GAME_BACKEND_CATALOG)
ALTER TABLE "products" ADD COLUMN "playfab_catalog" TEXT;
