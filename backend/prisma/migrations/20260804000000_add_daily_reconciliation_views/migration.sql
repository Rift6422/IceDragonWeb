-- 每日對帳 view — 全部用「台灣日界 (UTC+8)」,對齊 MyCard 差異比對。
--
-- 背景:orders.confirmed_at 存的是 UTC (timestamptz)。直接用日期比對會有 8 小時位移
--       (台灣 00:00–08:00 成交的單被歸到前一天)。這裡統一 AT TIME ZONE 'Asia/Taipei'
--       把 UTC 轉成台灣牆鐘時間後再取日期,對帳日界才會跟智冠一致。
--
-- 用法:
--   -- 某台灣日的成功單明細
--   SELECT * FROM v_delivered_orders_tw WHERE tw_date = '2026-08-01' ORDER BY confirmed_at_tw;
--   -- 每日彙總(對帳總表)
--   SELECT * FROM v_daily_reconciliation ORDER BY tw_date DESC;

-- 逐筆:所有 DELIVERED 單 + 台灣時間欄位
CREATE OR REPLACE VIEW v_delivered_orders_tw AS
SELECT
  o.id                                              AS order_id,
  o.fac_trade_seq,
  u.uid,
  o.amount,
  o.currency,
  t.mycard_trade_no,
  t.trade_seq,
  t.payment_type,
  p.code                                            AS product_code,
  p.name_display                                    AS product_name,
  o.confirmed_at                                    AS confirmed_at_utc,
  (o.confirmed_at AT TIME ZONE 'Asia/Taipei')       AS confirmed_at_tw,
  (o.confirmed_at AT TIME ZONE 'Asia/Taipei')::date AS tw_date
FROM orders o
JOIN users u             ON u.id = o.user_id
LEFT JOIN products p     ON p.id = o.product_id
LEFT JOIN transactions t ON t.order_id = o.id
WHERE o.status = 'delivered';

-- 彙總:每台灣日 + 幣別的筆數與金額
CREATE OR REPLACE VIEW v_daily_reconciliation AS
SELECT
  tw_date,
  currency,
  count(*)             AS order_count,
  sum(amount)          AS total_amount,
  min(confirmed_at_tw) AS first_at_tw,
  max(confirmed_at_tw) AS last_at_tw
FROM v_delivered_orders_tw
GROUP BY tw_date, currency;
