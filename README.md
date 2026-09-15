# Bybit Scalping Terminal — Render

This version keeps the existing `index.html` unchanged and adds a same-origin Node.js backend for Bybit Global API access.

## Render settings

- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

## Environment variables

- `BYBIT_API_KEY` = your Bybit Global API key
- `BYBIT_API_SECRET` = your Bybit Global API secret
- `BYBIT_TESTNET` = `false`
- `BYBIT_BASE_URL` = `https://api.bybit.com`

Do not put the API secret into `index.html` or client-side JavaScript.

## Test URLs after deploy

- `/health`
- `/api/account`
- `/api/position?symbol=BTCUSDT`
