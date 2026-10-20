/**
 * 遊戲端 Azure Function 回傳格式。
 *
 * 遊戲端統一包裝:`{ success, args }`,其中 `args` 是 JSON-string(double-encoded)。
 * Client 端需 `JSON.parse(response.args)` 才能拿到真正的 payload。
 */
export interface GameBackendEnvelope {
  success: boolean;
  args: string;
  errorMessage?: string;
  /** 部分 endpoint 用 `error` 而非 `errorMessage`,例 lock/unlock API */
  error?: string;
  /**
   * getneworderavailable 專用(2026-05-30 遊戲端確認的契約):
   *   success:true + available:true  → 無鎖,可購
   *   success:true + available:false → 鎖定中
   *   success:false                  → 遊戲端訂單系統異常
   */
  available?: boolean;
}

/**
 * 對應遊戲端 C# `DatePeriod` enum:
 *   0 = Day, 1 = Week, 2 = Month, 3 = Year, 4 = AllTime
 */
export enum DatePeriod {
  Day = 0,
  Week = 1,
  Month = 2,
  Year = 3,
  AllTime = 4,
}

export interface StoreLimitationInfo {
  LimitPeriod: DatePeriod;
  MaxQuantity: number;
  LeftQuantity: number;
  ResetLimitDate: string | null;
}

/** 我們對外的精簡型別(snake_case 對齊既有 API 風格) */
export interface ItemLimitation {
  store_id: string;
  item_id: string;
  limit_period: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR' | 'ALL_TIME';
  max_quantity: number;
  left_quantity: number;
  /** ISO 8601 UTC,或 null(AllTime / 無重置) */
  reset_at: string | null;
}

export function mapPeriod(p: DatePeriod): ItemLimitation['limit_period'] {
  switch (p) {
    case DatePeriod.Day: return 'DAY';
    case DatePeriod.Week: return 'WEEK';
    case DatePeriod.Month: return 'MONTH';
    case DatePeriod.Year: return 'YEAR';
    case DatePeriod.AllTime: return 'ALL_TIME';
    default: return 'ALL_TIME';
  }
}

// ============================================================
// /api/getstoreitems(v2,2026-05-25 起)
//
// 比 /api/getstorelimitations 多三件事:
//   1. 一次帶多個 storeId(array)→ 一次 RTT 查全部 store
//   2. 列出全部商品(連沒限購的也回 limitation=null)→ 對得起 storefront 全部資料
//   3. 多回 `canDouble`(該品項是否支援加倍)
//
// 回傳 envelope 同樣是 { success, args: "<JSON-string>" },
// args 解開後是 { ownPremiums: string[], storeItems: { [storeId]: RawStoreItem[] } }
// ============================================================

export interface RawStoreItem {
  storeId: string;
  itemId: string;
  /** null = 無限購 */
  limitation: StoreLimitationInfo | null;
  /** 該商品本身是否支援加倍(後台設定) */
  canDouble: boolean;
}

export interface GetStoreItemsArgs {
  /** 玩家已擁有的高級道具(目前用途待確認,暫存) */
  ownPremiums: string[];
  /** { storeId: RawStoreItem[] } */
  storeItems: Record<string, RawStoreItem[]>;
}

/** 我們對外的精簡型別 — 同 ItemLimitation 但多一個 can_double 欄位 */
export interface StoreItem {
  store_id: string;
  item_id: string;
  /** 無限購時為 null */
  limitation: ItemLimitation | null;
  /** 該品項是否支援加倍(後台設定) */
  can_double: boolean;
}

