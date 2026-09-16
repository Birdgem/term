# Bybit Scalping Terminal — Stage 5.21.1

Hotfix for Bybit error 10001: `tpLimitPrice is required when tpOrderType is limit`.

The order proxy now preserves `tpLimitPrice` and `slLimitPrice` when forwarding entry orders to Bybit. This allows Limit TP/SL attached to Market/Limit entries to reach the Bybit API correctly.

Based on Stage 5.21 Limit TP/SL. No UI changes and no change to trading enable guard.


## Stage 5.22
- Live position manager: mark/PnL/ROI/notional refresh with realtime price.
- Added detailed position fields, closed-position history, and close popup.
- Added protected `/api/closed-pnl` backed by Bybit `/v5/position/closed-pnl`.
- Orderbook walls now require at least $15k, with thin labels/lines and translucent chart bands; $15k-$25k+ controls intensity.
