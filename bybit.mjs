import crypto from 'node:crypto';

const USE_TESTNET = String(process.env.BYBIT_TESTNET || 'false').toLowerCase() === 'true';
const BASE_URL = process.env.BYBIT_BASE_URL || (USE_TESTNET ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com');
const API_KEY = process.env.BYBIT_API_KEY || '';
const API_SECRET = process.env.BYBIT_API_SECRET || '';
const RECV_WINDOW = process.env.BYBIT_RECV_WINDOW || '5000';

function assertCredentials() {
  if (!API_KEY || !API_SECRET) throw new Error('BYBIT_API_KEY / BYBIT_API_SECRET are not configured');
}

function sign(timestamp, payload) {
  const raw = `${timestamp}${API_KEY}${RECV_WINDOW}${payload}`;
  return crypto.createHmac('sha256', API_SECRET).update(raw).digest('hex');
}

async function request(method, path, params = {}) {
  assertCredentials();
  const timestamp = Date.now().toString();
  let url = `${BASE_URL}${path}`;
  let payload = '';
  const headers = {
    'X-BAPI-API-KEY': API_KEY,
    'X-BAPI-TIMESTAMP': timestamp,
    'X-BAPI-RECV-WINDOW': RECV_WINDOW,
    'X-BAPI-SIGN-TYPE': '2'
  };

  if (method === 'GET') {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
    }
    payload = qs.toString();
    if (payload) url += `?${payload}`;
  } else {
    payload = JSON.stringify(params);
    headers['Content-Type'] = 'application/json';
  }

  headers['X-BAPI-SIGN'] = sign(timestamp, payload);
  const response = await fetch(url, { method, headers, body: method === 'GET' ? undefined : payload });
  const text = await response.text();

  let data;
  try { data = JSON.parse(text); } catch { data = null; }

  if (!response.ok) {
    throw new Error(`Bybit HTTP ${response.status}: ${text.slice(0, 1000)}`);
  }
  if (!data || data.retCode !== 0) {
    throw new Error(`Bybit API ${data?.retCode ?? 'unknown'}: ${data?.retMsg ?? text}`);
  }
  return data;
}

export function getConfig() {
  return {
    testnet: USE_TESTNET,
    baseUrl: BASE_URL,
    configured: Boolean(API_KEY && API_SECRET)
  };
}

export async function getWalletBalance() {
  return request('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' });
}

export async function getPosition(symbol = '') {
  const params = { category: 'linear' };
  if (symbol) params.symbol = symbol.toUpperCase();
  else params.settleCoin = 'USDT';
  return request('GET', '/v5/position/list', params);
}
