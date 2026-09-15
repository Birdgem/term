import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig, getWalletBalance, getPosition } from './bybit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      return json(res, 200, { ok: true, service: 'bybit-scalping-terminal', ...getConfig() });
    }

    if (url.pathname === '/api/account' || url.pathname === '/account') {
      const data = await getWalletBalance();
      return json(res, 200, { ok: true, result: data.result });
    }

    if (url.pathname === '/api/position' || url.pathname === '/position') {
      const symbol = url.searchParams.get('symbol') || '';
      const data = await getPosition(symbol);
      return json(res, 200, { ok: true, result: data.result });
    }

    if (url.pathname === '/api/config') {
      return json(res, 200, { ok: true, ...getConfig() });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = await fs.readFile(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }

    return json(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    console.error(error);
    return json(res, 500, { ok: false, error: errorMessage(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Trading terminal listening on http://${HOST}:${PORT}`);
  console.log(`Bybit endpoint: ${getConfig().baseUrl}`);
  console.log(`Testnet: ${getConfig().testnet}`);
});
