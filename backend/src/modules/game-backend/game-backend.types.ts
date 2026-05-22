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

/** 遊戲端回傳的單筆 limitation(攤平 args 後其中一個 element) */
export interface RawStoreItemLimitation {
  storeID: string;
  itemID: string;
  limitation: StoreLimitationInfo;
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
