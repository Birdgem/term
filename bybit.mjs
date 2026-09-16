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


export async function getPublicTicker(symbol = '') {
  const params = { category: 'linear' };
  if (symbol) params.symbol = symbol.toUpperCase();
  return request('GET', '/v5/market/tickers', params, false);
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
  if (!symbol || !/^\d+(?:\.\d+)?$/.test(lev) || Number(lev) <= 0) throw new Error('Invalid symbol or leverage');
  try {
    return await request('POST', '/v5/position/set-leverage', { category: 'linear', symbol: symbol.toUpperCase(), buyLeverage: lev, sellLeverage: lev });
  } catch (error) {
    // Bybit 110043 means the requested leverage is already set. Treat it as a no-op,
    // so opening the order can continue instead of showing a false fatal error.
    if (String(error?.message || '').includes('Bybit API 110043')) {
      return { retCode: 0, retMsg: 'leverage already set', result: {} };
    }
    throw error;
  }
}

export async function placeOrder(order) {
  assertTradingEnabled();
  const allowed = ['category','symbol','side','orderType','qty','price','timeInForce','positionIdx','reduceOnly','closeOnTrigger','orderLinkId','takeProfit','stopLoss','tpTriggerBy','slTriggerBy','tpslMode','tpOrderType','slOrderType','tpLimitPrice','slLimitPrice','triggerPrice','triggerDirection','triggerBy'];
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

export async function setTradingStop({ symbol, takeProfit, stopLoss, trailingStop, tpTriggerBy, slTriggerBy, activePrice, positionIdx = 0, limitTpSl = true }) {
  assertTradingEnabled();
  const sym = String(symbol || '').toUpperCase();
  const params = { category: 'linear', symbol: sym, positionIdx };
  const hasTp = takeProfit !== undefined && takeProfit !== null && takeProfit !== '' && String(takeProfit) !== '0';
  const hasSl = stopLoss !== undefined && stopLoss !== null && stopLoss !== '' && String(stopLoss) !== '0';
  const hasTs = trailingStop !== undefined && trailingStop !== null && trailingStop !== '';

  // Clearing TP/SL or setting trailing stop keeps the legacy Full/Market-compatible path.
  // For an actual TP/SL value, use Bybit Partial + Limit so the trigger does not turn into a Market close.
  if (hasTp || hasSl) {
    const posData = await getPosition(sym);
    const pos = (posData?.result?.list || []).find(p => Number(p.positionIdx) === Number(positionIdx) && Number(p.size) > 0);
    if (!pos) throw new Error(`No open position for ${sym} positionIdx=${positionIdx}`);
    const size = String(pos.size);
    params.tpslMode = 'Partial';
    params.tpSize = size;
    params.slSize = size;
    if (hasTp) {
      params.takeProfit = String(takeProfit);
      params.tpOrderType = limitTpSl === false ? 'Market' : 'Limit';
      params.tpLimitPrice = String(takeProfit);
    }
    if (hasSl) {
      params.stopLoss = String(stopLoss);
      params.slOrderType = limitTpSl === false ? 'Market' : 'Limit';
      params.slLimitPrice = String(stopLoss);
    }
  } else {
    if (takeProfit !== undefined && takeProfit !== null && takeProfit !== '') params.takeProfit = String(takeProfit);
    if (stopLoss !== undefined && stopLoss !== null && stopLoss !== '') params.stopLoss = String(stopLoss);
  }
  if (hasTs) params.trailingStop = String(trailingStop);
  if (tpTriggerBy) params.tpTriggerBy = tpTriggerBy;
  if (slTriggerBy) params.slTriggerBy = slTriggerBy;
  if (activePrice !== undefined && activePrice !== null && activePrice !== '') params.activePrice = String(activePrice);
  if (!params.takeProfit && !params.stopLoss && !params.trailingStop) throw new Error('At least one of takeProfit, stopLoss or trailingStop is required');
  return request('POST', '/v5/position/trading-stop', params);
}

export async function closePartialPosition(symbol, positionIdx = 0, percent = 100) {
  assertTradingEnabled();
  const pct = Number(percent);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new Error('percent must be between 0 and 100');
  const data = await getPosition(symbol);
  const list = data?.result?.list || [];
  const pos = list.find(p => Number(p.positionIdx) === Number(positionIdx) && Number(p.size) > 0);
  if (!pos) throw new Error(`No open position for ${String(symbol).toUpperCase()} positionIdx=${positionIdx}`);
  const rawQty = Number(pos.size) * pct / 100;
  let step = Number(pos.qtyStep || 0);
  let minQty = Number(pos.minOrderQty || 0);
  if (!(step > 0)) {
    const inst = await getInstrument(symbol);
    const f = inst?.result?.list?.[0]?.lotSizeFilter || {};
    step = Number(f.qtyStep || 0);
    minQty = Number(f.minOrderQty || minQty || 0);
  }
  const qty = step > 0 ? Math.floor((rawQty + 1e-12) / step) * step : rawQty;
  if (!(qty > 0) || (minQty > 0 && qty < minQty)) throw new Error('Partial close is below the instrument minimum qty/step');
  const side = pos.side === 'Buy' ? 'Sell' : 'Buy';
  return placeOrder({ symbol, side, orderType: 'Market', qty: String(qty), positionIdx, reduceOnly: true, closeOnTrigger: true });
}


export async function applyMultiTakeProfits({ symbol, positionIdx = 0, levels = [], allocations = [40, 35, 25], stopLoss = '' }) {
  assertTradingEnabled();
  const sym = String(symbol || '').toUpperCase();
  const posData = await getPosition(sym);
  const pos = (posData?.result?.list || []).find(p => Number(p.positionIdx) === Number(positionIdx) && Number(p.size) > 0);
  if (!pos) throw new Error(`No open position for ${sym} positionIdx=${positionIdx}`);
  if (!Array.isArray(levels) || levels.length < 1) throw new Error('At least one TP level is required');
  const alloc = allocations.slice(0, levels.length).map(Number);
  if (alloc.some(v => !Number.isFinite(v) || v <= 0) || alloc.reduce((a,b) => a+b, 0) > 100.0001) throw new Error('Invalid TP allocations');

  const inst = await getInstrument(sym);
  const lot = inst?.result?.list?.[0]?.lotSizeFilter || {};
  const step = Number(lot.qtyStep || 0);
  const minQty = Number(lot.minOrderQty || 0);
  const tick = Number(inst?.result?.list?.[0]?.priceFilter?.tickSize || 0);
  const normalize = (q) => {
    const n = step > 0 ? Math.floor((Number(q) + 1e-12) / step) * step : Number(q);
    return n;
  };
  const cleanLevels = levels.map(Number).filter(v => Number.isFinite(v) && v > 0);
  if (!cleanLevels.length) throw new Error('Invalid TP prices');
  const mark = Number(pos.markPrice || pos.avgPrice || 0);
  const isLong = pos.side === 'Buy';
  const ordered = cleanLevels.slice().sort((a,b) => isLong ? a-b : b-a);
  for (const price of ordered) {
    if ((isLong && !(price > mark)) || (!isLong && !(price < mark))) throw new Error('TP levels must be on the profit side of the current price');
    if (tick > 0 && Math.abs(price / tick - Math.round(price / tick)) > 1e-7) throw new Error('TP price does not match tickSize');
  }

  const open = await getOpenOrders(sym);
  const old = open?.result?.list || [];
  for (const o of old) {
    if (String(o.orderLinkId || '').startsWith('MTP_')) {
      try { await cancelOrder(sym, o.orderId, o.orderLinkId); } catch (_) {}
    }
  }

  const closeSide = isLong ? 'Sell' : 'Buy';
  const orders = [];
  for (let i = 0; i < ordered.length; i++) {
    const qty = normalize(Number(pos.size) * Number(alloc[i] ?? alloc[alloc.length - 1]) / 100);
    if (!(qty > 0) || (minQty > 0 && qty < minQty)) throw new Error(`TP${i+1} size is below instrument minimum qty`);
    const link = `MTP_${i+1}_${Date.now().toString(36)}`;
    const data = await placeOrder({
      symbol: sym, side: closeSide, orderType: 'Limit', qty: String(qty), price: String(ordered[i]), timeInForce: 'GTC', positionIdx,
      reduceOnly: true, closeOnTrigger: true, triggerPrice: String(ordered[i]),
      triggerDirection: isLong ? 1 : 2, triggerBy: 'MarkPrice', orderLinkId: link
    });
    orders.push({ level: i + 1, price: ordered[i], qty, allocation: Number(alloc[i] ?? 0), orderId: data?.result?.orderId || '', orderLinkId: link });
  }

  if (stopLoss !== undefined && stopLoss !== null && stopLoss !== '') {
    await setTradingStop({ symbol: sym, positionIdx, stopLoss: String(stopLoss), slTriggerBy: 'MarkPrice' });
  }
  return { orders, stopLoss: stopLoss || '' };
}

export async function moveStopToBreakeven(symbol, positionIdx = 0, bufferTicks = 1) {
  assertTradingEnabled();
  const sym = String(symbol || '').toUpperCase();
  const data = await getPosition(sym);
  const pos = (data?.result?.list || []).find(p => Number(p.positionIdx) === Number(positionIdx) && Number(p.size) > 0);
  if (!pos) throw new Error(`No open position for ${sym} positionIdx=${positionIdx}`);
  const inst = await getInstrument(sym);
  const tick = Number(inst?.result?.list?.[0]?.priceFilter?.tickSize || 0);
  const buffer = Math.max(0, Number(bufferTicks) || 0) * tick;
  const avg = Number(pos.avgPrice || 0);
  if (!(avg > 0)) throw new Error('Position entry price is unavailable');
  const slRaw = pos.side === 'Buy' ? avg + buffer : avg - buffer;
  const sl = tick > 0 ? Math.round(slRaw / tick) * tick : slRaw;
  await setTradingStop({ symbol: sym, positionIdx, stopLoss: String(sl), slTriggerBy: 'MarkPrice' });
  return { stopLoss: sl };
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
