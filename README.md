# Trading Terminal Stage 5.31.5 — Smooth Price

Base: Stage 5.31.4 Patterns 10 Visible.

Realtime price fix:
- The chart is updated from the Bybit kline stream only.
- Ticker `lastPrice` is used for the live quote/trading UI and no longer mutates the chart candle.
- `markPrice` is stored separately as `liveMarkPrice`.
- This removes the visible jump caused by alternating ticker lastPrice and kline close updates.
- Pattern Center / 10-candle chart pattern behavior, Volume Anomaly V, S/R, indicators and trading mechanics are otherwise unchanged.
