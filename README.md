# Trading Terminal — Stage 5.4 Mobile Scalper

Based on Stage 5.3.

## Stage 5.4
- Mobile trading dock redesigned for compact scalping workflow.
- Quick margin presets: 2 / 5 / 10 / 20 USDT.
- Quick leverage presets: 3x / 5x / 10x / 20x.
- Live trade preview: calculated order quantity, notional, estimated TP PnL and SL PnL.
- Quick TP/SL presets based on current price and selected LONG/SHORT direction.
- Mobile position display shows side, size, average price, mark price and unrealized PnL.
- CLOSE is disabled when there is no open position.
- Preview updates from the live price without sending orders.
- Existing TRADING_ENABLED safety guard remains unchanged.
- Instrument tickSize/qtyStep remain the source of truth for order normalization.
- Mobile dock gets enough bottom safe area so controls do not cover the chart.

## Important
Trading remains controlled by `TRADING_ENABLED` on Render. The client does not enable live trading by itself.
