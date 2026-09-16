# Bybit Mobile Scalping Terminal — Stage 5.24.1

Microfix: corrected closed-position direction in position history and closed-position popup.

Bybit's Closed PnL `side` represents the closing execution side: Sell closes a LONG and Buy closes a SHORT. The UI now inverts that field when displaying the original position direction. Fallback popup data from the live position keeps the original side directly.

No trading, TP/SL, realtime position, or UI mechanics were changed.
