# Bybit Scalper Terminal — Stage 5.19

Mobile-first dedicated Scalp Mode with terminal access protection.

## Security

- Render remains a public Web Service, but private account/trading API routes now require `Authorization: Bearer <TERMINAL_ACCESS_TOKEN>`.
- `BYBIT_API_KEY` and `BYBIT_API_SECRET` stay only in Render Environment Variables.
- `/api/ws-auth` is protected because it returns the signed private Bybit WebSocket authorization payload.
- Public market data endpoints remain available for ticker/instrument data and the market WebSocket fallback.
- Trading is still controlled separately by `TRADING_ENABLED` in `bybit.mjs`; this patch does not enable live trading by itself.

## Render setup

Add this Environment Variable to the existing Render service:

- `TERMINAL_ACCESS_TOKEN` = a long random secret string (at least 32 characters recommended).

Keep these existing variables:

- `BYBIT_TESTNET=false`
- `BYBIT_BASE_URL=https://api.bybit.com`
- `BYBIT_API_KEY=...`
- `BYBIT_API_SECRET=...`

After saving the variable, redeploy/restart the service. On first launch the terminal asks for the same token and stores it locally on the phone.

If the token is compromised, rotate `TERMINAL_ACCESS_TOKEN` in Render and enter the new value in the terminal.

## Trading

`TRADING_ENABLED=false` remains the safe default. Only enable it when you deliberately want live order actions.

Existing realtime feeds, Multi-TP, AUTO S/R, position manager, Scalp Mode, and mobile UI are preserved.
