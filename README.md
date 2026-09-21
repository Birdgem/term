# Trading Terminal Stage 5.31.2 — Pattern Center Clean

Base: Stage 5.31.1 Pattern Center FIX.

## Pattern architecture
- Pattern detection scans the latest 100 candles for the Pattern Center.
- Candle patterns and structural patterns accumulate occurrences across that window.
- Pattern Center shows one latest occurrence per pattern type, with occurrence count, candle index/time, direction and description.
- Chart markers show only the latest occurrence per pattern type, capped at 7 pattern markers.
- Pattern chart markers have no long text labels; they use compact arrows/circles/squares to keep the mobile chart readable.
- Volume anomaly `V` markers remain separate and are not included in the 7-pattern cap.
- Tapping a Pattern Center item attempts to center the Lightweight Charts time scale on that pattern candle.

## Unchanged
- Trading mechanics
- S/R logic
- Volume anomaly detection
- EMA/RSI/MACD
- Existing controls and trade UI

JavaScript syntax checked with Node.js `--check`.
