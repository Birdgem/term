import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import crypto from 'node:crypto';
import {
  getConfig, getPrivateWsAuth, getWalletBalance, getPublicTicker, getPosition, getOpenOrders, getOrderHistory,
  getInstrument, setLeverage, placeOrder, cancelOrder, cancelAll, setTradingStop, closePosition, closePartialPosition, applyMultiTakeProfits, moveStopToBreakeven, getClosedPnl
} from './bybit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const TERMINAL_ACCESS_TOKEN = String(process.env.TERMINAL_ACCESS_TOKEN || '').trim();
const PROTECTED_PATHS = new Set([
  '/api/config', '/api/ws-auth', '/api/account', '/account', '/api/position', '/position',
  '/api/orders', '/orders', '/api/order-history', '/order-history', '/api/closed-pnl', '/closed-pnl', '/api/leverage', '/api/order',
  '/api/cancel-order', '/api/cancel-all', '/api/trading-stop', '/api/multi-tp', '/api/multi-tp-be',
  '/api/close-partial', '/api/close-position'
]);
const authFailures = new Map();

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function safeTokenEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}

function isAuthorized(req) {
  if (!TERMINAL_ACCESS_TOKEN) return false;
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return safeTokenEqual(match?.[1] || '', TERMINAL_ACCESS_TOKEN);
}

function authGuard(req, res, pathname) {
  if (!PROTECTED_PATHS.has(pathname)) return true;
  if (!TERMINAL_ACCESS_TOKEN) {
    json(res, 503, { ok: false, error: 'Terminal access token is not configured on Render.' });
    return false;
  }
  if (isAuthorized(req)) {
    authFailures.delete(clientIp(req));
    return true;
  }
  const ip = clientIp(req);
  const now = Date.now();
  const prev = authFailures.get(ip) || { count: 0, resetAt: now + 60000 };
  if (now > prev.resetAt) { prev.count = 0; prev.resetAt = now + 60000; }
  prev.count += 1;
  authFailures.set(ip, prev);
  const retryAfter = Math.max(1, Math.ceil((prev.resetAt - now) / 1000));
  if (prev.count > 12) {
    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': String(retryAfter) });
    res.end(JSON.stringify({ ok: false, error: 'Too many authentication attempts. Try again shortly.' }));
    return false;
  }
  res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer' });
  res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
  return false;
}

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

    if (url.pathname === '/health') return json(res, 200, { ok: true, service: 'bybit-scalping-terminal', authConfigured: Boolean(TERMINAL_ACCESS_TOKEN), ...getConfig() });
    if (!authGuard(req, res, url.pathname)) return;
    if (url.pathname === '/api/config') return json(res, 200, { ok: true, ...getConfig() });
    if (url.pathname === '/api/ws-auth') return json(res, 200, { ok: true, ...getPrivateWsAuth() });

    if (url.pathname === '/api/market-ticker') {
      const symbol = url.searchParams.get('symbol') || '';
      if (!symbol) return json(res, 400, { ok: false, error: 'symbol is required' });
      const data = await getPublicTicker(symbol);
      return json(res, 200, { ok: true, result: data.result });
    }

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
    if (url.pathname === '/api/closed-pnl' || url.pathname === '/closed-pnl') {
      const symbol = url.searchParams.get('symbol') || ''; const data = await getClosedPnl(symbol);
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
    if (method === 'POST' && url.pathname === '/api/multi-tp') {
      const body = await readJson(req);
      const data = await applyMultiTakeProfits(body);
      return json(res, 200, { ok: true, result: data });
    }
    if (method === 'POST' && url.pathname === '/api/multi-tp-be') {
      const body = await readJson(req);
      const data = await moveStopToBreakeven(body.symbol, body.positionIdx ?? 0, body.bufferTicks ?? 1);
      return json(res, 200, { ok: true, result: data });
    }
    if (method === 'POST' && url.pathname === '/api/close-partial') {
      const body = await readJson(req); const data = await closePartialPosition(body.symbol, body.positionIdx ?? 0, body.percent ?? 100);
      return json(res, 200, { ok: true, result: data.result });
    }
    if (method === 'POST' && url.pathname === '/api/close-position') {
      const body = await readJson(req); const data = await closePosition(body.symbol, body.positionIdx ?? 0);
      return json(res, 200, { ok: true, result: data.result });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = await fs.readFile(path.join(__dirname, 'index.html'));
      if (String(req.headers['accept-encoding'] || '').includes('gzip')) {
        const gz = gzipSync(html, { level: 6 });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding', 'Cache-Control': 'no-store' });
        return res.end(gz);
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(html);
    }
    return json(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    console.error(error); return json(res, 500, { ok: false, error: errorMessage(error) });
  }
});


// Public market WebSocket fallback. The browser normally connects directly to Bybit.
// This proxy is used only when direct WS is unavailable on the user's network.
const marketWss = new WebSocketServer({ noServer: true });

function safeSymbol(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 30);
}
function safeInterval(value) {
  const allowed = new Set(['1','3','5','15','30','60','120','240','360','720','D','W','M']);
  const v = String(value || '1');
  return allowed.has(v) ? v : '1';
}

marketWss.on('connection', (client, request, ctx) => {
  const symbol = safeSymbol(ctx.symbol);
  const interval = safeInterval(ctx.interval);
  if (!symbol) { client.close(1008, 'symbol required'); return; }

  const upstream = new WebSocket('wss://stream.bybit.com/v5/public/linear');
  let pingTimer = null;
  let flushTimer = null;
  let closed = false;
  let latestTicker = null;
  let bookBids = new Map();
  let bookAsks = new Map();
  let bookDirty = false;
  let bookUpdateId = 0;

  const sendBookSnapshot = () => {
    if (!bookDirty || client.readyState !== WebSocket.OPEN) return;
    const bids = [...bookBids.entries()].sort((a,b)=>b[0]-a[0]).slice(0,50).map(([p,s])=>[String(p),String(s)]);
    const asks = [...bookAsks.entries()].sort((a,b)=>a[0]-b[0]).slice(0,50).map(([p,s])=>[String(p),String(s)]);
    client.send(JSON.stringify({topic:`orderbook.50.${symbol}`, type:'snapshot', ts:Date.now(), data:{s:symbol,b:bids,a:asks,u:bookUpdateId}}));
    bookDirty = false;
  };

  const shutdown = () => {
    if (closed) return;
    closed = true;
    if (pingTimer) clearInterval(pingTimer);
    if (flushTimer) clearInterval(flushTimer);
    try { upstream.close(); } catch {}
    try { if (client.readyState === WebSocket.OPEN) client.close(); } catch {}
  };

  upstream.on('open', () => {
    if (client.readyState !== WebSocket.OPEN) return shutdown();
    client.send(JSON.stringify({ type: 'proxy_status', status: 'connected' }));
    upstream.send(JSON.stringify({
      op: 'subscribe',
      args: [
        `kline.${interval}.${symbol}`,
        `tickers.${symbol}`,
        `orderbook.200.${symbol}`
      ]
    }));
    pingTimer = setInterval(() => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ op: 'ping' }));
    }, 20000);
    // Coalesce the very fast Bybit orderbook/ticker stream before sending it to the phone.
    // The phone still receives price/depth updates several times per second, but Render
    // does not have to forward every ~20ms orderbook delta.
    flushTimer = setInterval(() => {
      if (client.readyState !== WebSocket.OPEN) return;
      if (latestTicker) { client.send(latestTicker); latestTicker = null; }
      sendBookSnapshot();
    }, 200);
  });

  upstream.on('message', data => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg.topic || !msg.data) return;
    if (msg.topic === `tickers.${symbol}`) {
      // First ticker goes to the phone immediately; subsequent ticks are coalesced.
      // This removes the initial 200ms batching delay without increasing steady-state load.
      if (client.readyState === WebSocket.OPEN && !latestTicker) client.send(data.toString());
      latestTicker = data.toString();
      return;
    }
    if (msg.topic === `orderbook.200.${symbol}`) {
      if (msg.type === 'snapshot') {
        bookBids = new Map((msg.data?.b || []).map(x=>[Number(x[0]),Number(x[1])]));
        bookAsks = new Map((msg.data?.a || []).map(x=>[Number(x[0]),Number(x[1])]));
      } else {
        for (const x of (msg.data?.b || [])) { const p=Number(x[0]), q=Number(x[1]); if(!p) continue; if(q===0) bookBids.delete(p); else bookBids.set(p,q); }
        for (const x of (msg.data?.a || [])) { const p=Number(x[0]), q=Number(x[1]); if(!p) continue; if(q===0) bookAsks.delete(p); else bookAsks.set(p,q); }
      }
      bookUpdateId = Number(msg.data?.u || bookUpdateId || 0);
      bookDirty = true;
      return;
    }
    // Kline messages are naturally sparse; forward them immediately.
    if (msg.topic === `kline.${interval}.${symbol}` && client.readyState === WebSocket.OPEN) {
      client.send(data.toString());
    }
  });

  upstream.on('error', err => {
    console.error('Market WS proxy upstream error:', err?.message || err);
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'proxy_status', status: 'error' }));
  });

  upstream.on('close', () => shutdown());
  client.on('close', shutdown);
  client.on('error', shutdown);
});

server.on('upgrade', (request, socket, head) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws/market') {
      socket.destroy();
      return;
    }
    marketWss.handleUpgrade(request, socket, head, ws => {
      marketWss.emit('connection', ws, request, {
        symbol: url.searchParams.get('symbol'),
        interval: url.searchParams.get('interval')
      });
    });
  } catch {
    socket.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Trading terminal listening on http://${HOST}:${PORT}`);
  console.log(`Bybit endpoint: ${getConfig().baseUrl}`);
  console.log(`Testnet: ${getConfig().testnet}`);
  console.log(`Trading enabled: ${getConfig().tradingEnabled}`);
});
