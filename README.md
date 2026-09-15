# Bybit Scalping Terminal — Render Stage 3

Stage 3 adds the server-side trading layer for Bybit Global Mainnet while keeping the API secret on Render.

## Current architecture
Phone → Render Web Service → Bybit Global API

## Environment variables
Required:
- `BYBIT_API_KEY`
- `BYBIT_API_SECRET`
- `BYBIT_TESTNET=false`
- `BYBIT_BASE_URL=https://api.bybit.com`

Trading safety switch:
- `TRADING_ENABLED=false` by default.
- Set `TRADING_ENABLED=true` only when you are ready to allow live order actions from the terminal.

Optional:
- `BYBIT_RECV_WINDOW=5000`

## Read-only endpoints
- `GET /health`
- `GET /api/config`
- `GET /api/account`
- `GET /api/position`
- `GET /api/position?symbol=BTCUSDT`
- `GET /api/orders`
- `GET /api/orders?symbol=BTCUSDT`
- `GET /api/order-history`
- `GET /api/order-history?symbol=BTCUSDT`
- `GET /api/instrument?symbol=BTCUSDT`

## Trading endpoints
All trading endpoints require `TRADING_ENABLED=true` and are server-side signed.

- `POST /api/leverage` — `{ "symbol":"BTCUSDT", "leverage":"5" }`
- `POST /api/order` — create Linear USDT perpetual Market/Limit order
- `POST /api/cancel-order` — cancel by `orderId` or `orderLinkId`
- `POST /api/cancel-all` — cancel all linear orders, optionally for one symbol
- `POST /api/trading-stop` — set TP/SL/trailing stop on an open position
- `POST /api/close-position` — market close an existing position using reduce-only

The backend validates the basic order fields and forces `category=linear`. Instrument metadata is available so the next UI stage can normalize tick/quantity steps before sending orders.

## Important
This stage exposes live trading capability but does not yet wire the controls into the existing 2110-line HTML UI. The next stage should add the order/position panel to the terminal and use the instrument metadata for quantity/price normalization.


## Stage 4 — Trading UI + Mobile
- Desktop trade bar and mobile fixed trading dock.
- Long / Short / Close controls.
- Margin + leverage sizing with instrument qty step/min qty.
- Market / Limit order selection.
- Optional TP/SL after position appears.
- Live position/PnL refresh every 3 seconds.
- Trading controls remain disabled while `TRADING_ENABLED=false`.
- Mobile layout is touch-first and avoids horizontal scrolling.


## Stage 4 Realtime
- Bybit public WebSocket for live ticker, candles and order book.
- Order-book walls and Buy/Sell dominance update from live depth.
- Position state is refreshed from the Render backend every 1 second.
- Long/Short account ratio refreshes every 5 seconds.
- Symbol ticker list refreshes every 10 seconds.
- REST remains as a fallback when the market WebSocket is unavailable.
- TRADING_ENABLED remains the safety switch for live order execution.
