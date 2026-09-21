# Trading Terminal Stage 5.31.4 — Patterns 10 Visible

Base: Stage 5.31.3.

Fix:
- The 10-candle chart filter is now applied inside `detectAdvancedPatterns()` itself.
- Pattern Center still receives the full 100-candle history.
- Chart markers are only the latest pattern instance per type found in the last 10 candles.
- Maximum 7 pattern markers.
- Markers use short readable labels (IB, BE, DB, etc.) instead of long pattern names.
- Markers are sorted chronologically before being sent to Lightweight Charts.
- Volume anomaly V markers remain separate.
