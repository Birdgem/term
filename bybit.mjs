import crypto from 'node:crypto';

const USE_TESTNET = String(process.env.BYBIT_TESTNET || 'false').toLowerCase() === 'true';
const BASE_URL = process.env.BYBIT_BASE_URL || (USE_TESTNET ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com');
const API_KEY = process.env.BYBIT_API_KEY || '';
const API_SECRET = process.env.BYBIT_API_SECRET || '';
const RECV_WINDOW = process.env.BYBIT_RECV_WINDOW || '5000';
const TRADING_ENABLED = String(process.env.TRADING_ENABLED || 'false').toLowerCase() === 'true';

function assertCredentials() {
  if (!API_KEY || !API_SECRET) throw new Error('BYBIT_API_KEY / BYBIT_API_SECRET are not configured');
}

function assertTradingEnabled() {
  if (!TRADING_ENABLED) throw new Error('Trading is disabled. Set TRADING_ENABLED=true on Render to enable live order actions.');
}

function sign(timestamp, payload) {
  const raw = `${timestamp}${API_KEY}${RECV_WINDOW}${payload}`;
  return crypto.createHmac('sha256', API_SECRET).update(raw).digest('hex');
}

async function request(method, path, params = {}, auth = true) {
  if (auth) assertCredentials();
  const timestamp = Date.now().toString();
  let url = `${BASE_URL}${path}`;
  let payload = '';
  const headers = { 'Content-Type': 'application/json' };

  if (auth) {
    headers['X-BAPI-API-KEY'] = API_KEY;
    headers['X-BAPI-TIMESTAMP'] = timestamp;
    headers['X-BAPI-RECV-WINDOW'] = RECV_WINDOW;
    headers['X-BAPI-SIGN-TYPE'] = '2';
  }

  if (method === 'GET') {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
    }
    payload = qs.toString();
    if (payload) url += `?${payload}`;
  } else {
    payload = JSON.stringify(params);
  }

  if (auth) headers['X-BAPI-SIGN'] = sign(timestamp, payload);

  const response = await fetch(url, { method, headers, body: method === 'GET' ? undefined : payload });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }

  if (!response.ok) throw new Error(`Bybit HTTP ${response.status}: ${text.slice(0, 1000)}`);
  if (!data || data.retCode !== 0) throw new Error(`Bybit API ${data?.retCode ?? 'unknown'}: ${data?.retMsg ?? text}`);
  return data;
}

export function getPrivateWsAuth() {
  assertCredentials();
  const expires = Date.now() + 10000;
  const signature = crypto.createHmac('sha256', API_SECRET)
    .update(`GET/realtime${expires}`)
    .digest('hex');
  return { apiKey: API_KEY, expires, signature, url: USE_TESTNET ? 'wss://stream-testnet.bybit.com/v5/private' : 'wss://stream.bybit.com/v5/private' };
}

export function getConfig() {
  return { testnet: USE_TESTNET, baseUrl: BASE_URL, configured: Boolean(API_KEY && API_SECRET), tradingEnabled: TRADING_ENABLED };
}

export async function getWalletBalance() {
  return request('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' });
}

export async function getPosition(symbol = '') {
  const params = { category: 'linear' };
  if (symbol) params.symbol = symbol.toUpperCase(); else params.settleCoin = 'USDT';
  return request('GET', '/v5/position/list', params);
}

export async function getOpenOrders(symbol = '') {
  const params = { category: 'linear', openOnly: 0 };
  if (symbol) params.symbol = symbol.toUpperCase(); else params.settleCoin = 'USDT';
  return request('GET', '/v5/order/realtime', params);
}

export async function getOrderHistory(symbol = '') {
  const params = { category: 'linear', limit: 50 };
  if (symbol) params.symbol = symbol.toUpperCase(); else params.settleCoin = 'USDT';
  return request('GET', '/v5/order/history', params);
}

export async function getInstrument(symbol = '') {
  const params = { category: 'linear' };
  if (symbol) params.symbol = symbol.toUpperCase();
  return request('GET', '/v5/market/instruments-info', params, false);
}

export async function setLeverage(symbol, leverage) {
  assertTradingEnabled();
  const lev = String(leverage);
  if (!symbol || !/^\\d+(?:\\.\\d+)?$/.test(lev) || Number(lev) <= 0) throw new Error('Invalid symbol or leverage');
  return request('POST', '/v5/position/set-leverage', { category: 'linear', symbol: symbol.toUpperCase(), buyLeverage: lev, sellLeverage: lev });
}

export async function placeOrder(order) {
  assertTradingEnabled();
  const allowed = ['category','symbol','side','orderType','qty','price','timeInForce','positionIdx','reduceOnly','closeOnTrigger','orderLinkId','takeProfit','stopLoss','tpTriggerBy','slTriggerBy','tpslMode','tpOrderType','slOrderType'];
  const params = {};
  for (const key of allowed) if (order[key] !== undefined && order[key] !== null && order[key] !== '') params[key] = order[key];
  params.category = 'linear';
  params.symbol = String(params.symbol || '').toUpperCase();
  if (!['Buy','Sell'].includes(params.side)) throw new Error('side must be Buy or Sell');
  if (!['Market','Limit'].includes(params.orderType)) throw new Error('orderType must be Market or Limit');
  if (!params.qty || Number(params.qty) <= 0) throw new Error('qty must be greater than 0');
  if (params.orderType === 'Limit' && (!params.price || Number(params.price) <= 0)) throw new Error('Limit order requires price');
  if (params.orderType === 'Market') delete params.price;
  if (!params.timeInForce) params.timeInForce = params.orderType === 'Market' ? 'IOC' : 'GTC';
  return request('POST', '/v5/order/create', params);
}

export async function cancelOrder(symbol, orderId = '', orderLinkId = '') {
  assertTradingEnabled();
  const params = { category: 'linear', symbol: String(symbol || '').toUpperCase() };
  if (orderId) params.orderId = orderId;
  if (orderLinkId) params.orderLinkId = orderLinkId;
  if (!params.orderId && !params.orderLinkId) throw new Error('orderId or orderLinkId is required');
  return request('POST', '/v5/order/cancel', params);
}

export async function cancelAll(symbol = '') {
  assertTradingEnabled();
  const params = { category: 'linear', settleCoin: 'USDT' };
  if (symbol) { delete params.settleCoin; params.symbol = symbol.toUpperCase(); }
  return request('POST', '/v5/order/cancel-all', params);
}

export async function setTradingStop({ symbol, takeProfit, stopLoss, trailingStop, tpTriggerBy, slTriggerBy, activePrice, positionIdx = 0 }) {
  assertTradingEnabled();
  const params = { category: 'linear', symbol: String(symbol || '').toUpperCase(), positionIdx };
  if (takeProfit !== undefined && takeProfit !== null && takeProfit !== '') params.takeProfit = String(takeProfit);
  if (stopLoss !== undefined && stopLoss !== null && stopLoss !== '') params.stopLoss = String(stopLoss);
  if (trailingStop !== undefined && trailingStop !== null && trailingStop !== '') params.trailingStop = String(trailingStop);
  if (tpTriggerBy) params.tpTriggerBy = tpTriggerBy;
  if (slTriggerBy) params.slTriggerBy = slTriggerBy;
  if (activePrice !== undefined && activePrice !== null && activePrice !== '') params.activePrice = String(activePrice);
  if (!params.takeProfit && !params.stopLoss && !params.trailingStop) throw new Error('At least one of takeProfit, stopLoss or trailingStop is required');
  return request('POST', '/v5/position/trading-stop', params);
}

export async function closePosition(symbol, positionIdx = 0) {
  assertTradingEnabled();
  const data = await getPosition(symbol);
  const list = data?.result?.list || [];
  const pos = list.find(p => Number(p.positionIdx) === Number(positionIdx) && Number(p.size) > 0);
  if (!pos) throw new Error(`No open position for ${String(symbol).toUpperCase()} positionIdx=${positionIdx}`);
  const side = pos.side === 'Buy' ? 'Sell' : 'Buy';
  return placeOrder({ symbol, side, orderType: 'Market', qty: pos.size, positionIdx, reduceOnly: true, closeOnTrigger: true });
}
