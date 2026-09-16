# Bybit Scalping Terminal — Stage 5.21.1

Hotfix for Bybit error 10001: `tpLimitPrice is required when tpOrderType is limit`.

The order proxy now preserves `tpLimitPrice` and `slLimitPrice` when forwarding entry orders to Bybit. This allows Limit TP/SL attached to Market/Limit entries to reach the Bybit API correctly.

Based on Stage 5.21 Limit TP/SL. No UI changes and no change to trading enable guard.
