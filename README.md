# Trading Terminal Stage 5.31.2 — Pattern Center Clean

Base: Stage 5.31.1 Pattern Center FIX.

Changes:
- Pattern Center keeps all detections from the last 100 candles.
- One latest instance per pattern type is used for chart labels.
- Chart label set is capped at 7 visible pattern labels.
- Pattern Center rows show name, direction, candle/time, description, and occurrence count.
- Clicking a Pattern Center row calls the existing candle-focus hook when available.
- Trading logic, S/R, Volume Anomaly, indicators and trade controls are not intentionally changed.

Next integration point:
- If the existing chart renderer exposes its pattern-label drawing function, feed it
  `getPatternChartLabels(patterns)` so only the clean set is drawn.
