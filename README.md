# Bybit Scalping Terminal — Stage 5.13 Mobile Scalper

Render Web Service for Bybit Global Unified account.

Stage 5.13 focuses on mobile trading ergonomics without changing the working realtime/trading architecture:
- compact two-line mobile trade header
- POS / ORD / CLOSE controls no longer compete with the symbol/status area
- bounded mobile trade dock with internal scrolling
- quick-risk / AUTO S/R / Multi-TP controls use a dedicated horizontal scroll row
- Multi-TP inputs remain touch-friendly
- chart gets more usable space while the dock stays predictable
- realtime price and trading logic are preserved

Trading remains guarded by `TRADING_ENABLED=false` until explicitly enabled.
