# Bybit Mobile Scalping Terminal — Stage 5.24.1

Microfix: corrected closed-position direction in position history and closed-position popup.

Bybit's Closed PnL `side` represents the closing execution side: Sell closes a LONG and Buy closes a SHORT. The UI now inverts that field when displaying the original position direction. Fallback popup data from the live position keeps the original side directly.

No trading, TP/SL, realtime position, or UI mechanics were changed.

## Stage 5.27 — Smooth Mobile Chart
- Upgraded TradingView Lightweight Charts from 4.1.1 to 5.2.1.
- Migrated series creation to the v5 unified `addSeries(...)` API.
- Reduced the main mobile chart viewport to ~280–315px (slightly larger when trade dock is collapsed).
- Increased price/candle repaint cadence to 10 fps while keeping raw WS data unconstrained.
- Order-book calculations reduced to ~2/sec; BW/SW chart geometry and DOM bands limited to ~1/sec.
- BW/SW price-line objects are reused instead of removed/recreated on every order-book update.
- Trading/backend mechanics, authentication, position management, TP/SL and history are unchanged from the 5.24.1 baseline.
