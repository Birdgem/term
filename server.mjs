import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getConfig, getPrivateWsAuth, getWalletBalance, getPosition, getOpenOrders, getOrderHistory,
  getInstrument, setLeverage, placeOrder, cancelOrder, cancelAll, setTradingStop, closePosition
} from './bybit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  try { return JSON.parse(body); } catch { throw new Error('Invalid JSON body'); }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const method = req.method || 'GET';

    if (url.pathname === '/health') return json(res, 200, { ok: true, service: 'bybit-scalping-terminal', ...getConfig() });
    if (url.pathname === '/api/config') return json(res, 200, { ok: true, ...getConfig() });
    if (url.pathname === '/api/ws-auth') return json(res, 200, { ok: true, ...getPrivateWsAuth() });

    if (url.pathname === '/api/account' || url.pathname === '/account') {
      const data = await getWalletBalance(); return json(res, 200, { ok: true, result: data.result });
    }
    if (url.pathname === '/api/position' || url.pathname === '/position') {
      const symbol = url.searchParams.get('symbol') || ''; const data = await getPosition(symbol);
      return json(res, 200, { ok: true, result: data.result });
    }
    if (url.pathname === '/api/orders' || url.pathname === '/orders') {
      const symbol = url.searchParams.get('symbol') || ''; const data = await getOpenOrders(symbol);
      return json(res, 200, { ok: true, result: data.result });
    }
    if (url.pathname === '/api/order-history' || url.pathname === '/order-history') {
      const symbol = url.searchParams.get('symbol') || ''; const data = await getOrderHistory(symbol);
      return json(res, 200, { ok: true, result: data.result });
    }
    if (url.pathname === '/api/instrument' || url.pathname === '/instrument') {
      const symbol = url.searchParams.get('symbol') || ''; if (!symbol) return json(res, 400, { ok: false, error: 'symbol is required' });
      const data = await getInstrument(symbol); return json(res, 200, { ok: true, result: data.result });
    }

    if (method === 'POST' && url.pathname === '/api/leverage') {
      const body = await readJson(req); const data = await setLeverage(body.symbol, body.leverage);
      return json(res, 200, { ok: true, result: data.result });
    }
    if (method === 'POST' && url.pathname === '/api/order') {
      const body = await readJson(req); const data = await placeOrder(body);
      return json(res, 200, { ok: true, result: data.result });
    }
    if (method === 'POST' && url.pathname === '/api/cancel-order') {
      const body = await readJson(req); const data = await cancelOrder(body.symbol, body.orderId, body.orderLinkId);
      return json(res, 200, { ok: true, result: data.result });
    }
    if (method === 'POST' && url.pathname === '/api/cancel-all') {
      const body = await readJson(req); const data = await cancelAll(body.symbol || '');
      return json(res, 200, { ok: true, result: data.result });
    }
    if (method === 'POST' && url.pathname === '/api/trading-stop') {
      const body = await readJson(req); const data = await setTradingStop(body);
      return json(res, 200, { ok: true, result: data.result });
    }
    if (method === 'POST' && url.pathname === '/api/close-position') {
      const body = await readJson(req); const data = await closePosition(body.symbol, body.positionIdx ?? 0);
      return json(res, 200, { ok: true, result: data.result });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = await fs.readFile(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(html);
    }
    return json(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    console.error(error); return json(res, 500, { ok: false, error: errorMessage(error) });
  }
});
server.listen(PORT, HOST, () => {
  console.log(`Trading terminal listening on http://${HOST}:${PORT}`);
  console.log(`Bybit endpoint: ${getConfig().baseUrl}`);
  console.log(`Testnet: ${getConfig().testnet}`);
  console.log(`Trading enabled: ${getConfig().tradingEnabled}`);
});
