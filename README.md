# Trading Terminal — Stage 5.10.4 Dynamic Risk Follow

Based on Stage 5.10.3 / 5.11.1.

## Fix
- Dynamic TP/SL/RR is rendered from a dedicated local state.
- Dynamic levels recalculate from the current realtime price every 250 ms while dynamic mode is active.
- Realtime price transport is not changed.
- Market preview uses livePrice directly, with a visible-price fallback only if livePrice has not populated yet.
- RR/TP/SL presets force an immediate render and no longer depend on DOM input events.
- Manual TP/SL input switches to manual mode and records the current entry reference.

Trading remains disabled unless explicitly enabled via TRADING_ENABLED.
