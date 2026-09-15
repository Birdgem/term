# Bybit Scalping Terminal — Stage 2.5

Render Web Service for a Bybit Global Unified account.

## Current read-only API

- `GET /health` — service/config check
- `GET /api/account` — Unified wallet balance
- `GET /api/position` — all USDT linear positions
- `GET /api/position?symbol=BTCUSDT` — one symbol position
- `GET /api/orders` — current/open linear orders
- `GET /api/orders?symbol=BTCUSDT` — current orders for one symbol
- `GET /api/order-history` — last 50 linear orders
- `GET /api/order-history?symbol=BTCUSDT` — last 50 orders for one symbol

No order creation, cancellation, TP/SL or other trading action is enabled in this stage.

## Render environment variables

- `BYBIT_API_KEY`
- `BYBIT_API_SECRET`
- `BYBIT_TESTNET=false`
- `BYBIT_BASE_URL=https://api.bybit.com`

The API secret is used only on the Render server and is never placed in `index.html`.
