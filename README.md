# Bybit Scalping Terminal — Stage 5.12 Multi-TP

Mobile-first Bybit Global Unified terminal.

## Stage 5.12
- Multi-TP: TP1/TP2/TP3 with 40/35/25% position distribution.
- AUTO 3TP selects up to three S/R levels and places targets inside the levels for scalping.
- Full-position SL remains separate and automatically follows the remaining position size.
- BE AUTO moves the stop to breakeven after TP1 is filled.
- Conditional reduce-only TP orders use the instrument tickSize/qtyStep.
- Existing realtime price, dynamic RR/TP/SL, AUTO S/R, SCORE, POS and ORD flows are preserved.
- Trading remains disabled unless `TRADING_ENABLED=true` is explicitly enabled on Render.

## Deploy
Deploy the ZIP as the existing Render Web Service. Keep the same environment variables.
