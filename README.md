# Trading Terminal — Stage 5.10.3 / 5.11.1 Market Watchdog

Mobile Bybit scalping terminal.

## Stage 5.10.3 / 5.11.1
- Realtime market watchdog detects half-open/dead WebSocket subscriptions.
- Direct Bybit WS falls back to Render proxy if no real market ticks arrive quickly.
- Proxy reconnects if its upstream stream becomes stale.
- REST ticker is used only as a lightweight recovery path while realtime is unhealthy.
- First ticker from Render proxy is forwarded immediately instead of waiting for the coalescing interval.
- Dynamic TP/SL and RR continue to update from the freshest recovered price.

Trading remains disabled unless `TRADING_ENABLED=true` is explicitly configured.

Dynamic RR state fix: RR/TP/SL values are now owned by tradeRiskState and are recalculated from livePrice without stale form values overwriting them. Manual edits switch back to manual mode. Realtime market-watchdog logic is preserved unchanged.
