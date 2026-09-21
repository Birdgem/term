



        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        bybit: {
                            bg: '#0d1117',
                            card: '#161b22',
                            panel: '#181a20',
                            border: '#21262d',
                            hover: '#2a313c',
                            yellow: '#f7a600',
                            green: '#0ecb81',
                            red: '#f6465d',
                            text: '#f0f6fc',
                            muted: '#8b949e'
                        }
                    }
                }
            }
        }
    

        // Terminal access protection: the Render token is sent only as an Authorization header.
        // It is never placed into URLs, query strings, or the HTML source.
        const TERMINAL_AUTH_STORAGE = 'terminal.accessToken.v1';
        let terminalAccessToken = '';
        try { terminalAccessToken = localStorage.getItem(TERMINAL_AUTH_STORAGE) || ''; } catch {}
        let terminalAuthWaiter = null;

        function terminalApiUrl(input) {
            try { return new URL(typeof input === 'string' ? input : input?.url || '', location.href); } catch { return null; }
        }

        const nativeTerminalFetch = window.fetch.bind(window);
        window.fetch = async function(input, init = {}) {
            const u = terminalApiUrl(input);
            const sameOriginApi = u && u.origin === location.origin && u.pathname.startsWith('/api/');
            let nextInit = init;
            if (sameOriginApi && terminalAccessToken) {
                const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
                headers.set('Authorization', `Bearer ${terminalAccessToken}`);
                nextInit = { ...init, headers };
            }
            const response = await nativeTerminalFetch(input, nextInit);
            if (sameOriginApi && (response.status === 401 || response.status === 429)) {
                if (response.status === 401) {
                    terminalAccessToken = '';
                    try { localStorage.removeItem(TERMINAL_AUTH_STORAGE); } catch {}
                    showTerminalAuth('Токен не принят Render. Проверь его и попробуй ещё раз.');
                } else {
                    showTerminalAuth('Слишком много попыток авторизации. Подожди немного и повтори.');
                }
            } else if (sameOriginApi && response.status === 503) {
                showTerminalAuth('На Render ещё не задан TERMINAL_ACCESS_TOKEN. Добавь его в Environment Variables и перезапусти сервис.');
            }
            return response;
        };

        function showTerminalAuth(message = '') {
            const modal = document.getElementById('terminalAuthModal');
            const input = document.getElementById('terminalAuthToken');
            const status = document.getElementById('terminalAuthStatus');
            if (!modal) return;
            modal.classList.remove('hidden');
            if (status) status.textContent = message;
            if (input) { input.value = terminalAccessToken || ''; setTimeout(() => input.focus(), 40); }
        }

        function updateTerminalAuthUi() {
            const btn = document.getElementById('terminalLockBtn');
            if (!btn) return;
            btn.classList.toggle('auth-ok', !!terminalAccessToken);
            btn.title = terminalAccessToken ? 'Токен сохранён · нажми для смены' : 'Настроить доступ к терминалу';
        }

        function saveTerminalAuthToken(value) {
            const token = String(value || '').trim();
            if (token.length < 16) throw new Error('Токен слишком короткий. Используй длинную случайную строку.');
            terminalAccessToken = token;
            try { localStorage.setItem(TERMINAL_AUTH_STORAGE, token); } catch {}
            updateTerminalAuthUi();
        }

        async function ensureTerminalAuth() {
            updateTerminalAuthUi();
            if (!terminalAccessToken) {
                showTerminalAuth();
                await new Promise(resolve => { terminalAuthWaiter = resolve; });
            }
            try {
                const r = await fetch('/api/config', { cache:'no-store' });
                if (r.ok) return true;
                if (r.status === 401) {
                    terminalAccessToken = '';
                    try { localStorage.removeItem(TERMINAL_AUTH_STORAGE); } catch {}
                    showTerminalAuth('Токен не принят Render.');
                    await new Promise(resolve => { terminalAuthWaiter = resolve; });
                    return ensureTerminalAuth();
                }
                if (r.status === 503) {
                    showTerminalAuth('Render не настроен: добавь TERMINAL_ACCESS_TOKEN в Environment Variables.');
                }
            } catch (e) {
                showTerminalAuth('Не удалось проверить доступ к терминалу: ' + e.message);
            }
            return !!terminalAccessToken;
        }

        let currentSymbol = 'BTCUSDT';
        let currentInterval = '240';
        let allTickers = [];
        let currentSortMode = 'volume';
        let pricePrecision = 2;

        let dominanceData = {
            ratio: '1.0x',
            dominant: 'buy',
            labelText: '1.0x Покупатели',
            buyPct: 50.0,
            sellPct: 50.0,
            bidsUSD: 0,
            asksUSD: 0,
            longShortRatio: 1.0
        };

        let orderbookPollTimer = null;
        let livePrice = 0;
        let live24hChange = 0;
        let liveOrderbook = { bids: new Map(), asks: new Map() };
        let marketWs = null;
        let marketWsPingInterval = null;
        let marketWsReconnectTimer = null;
        let marketWsWatchdogTimer = null;
        let lastMarketTickAt = 0;
        let marketWsOpenedAt = 0;

        // Real-time input can be much faster than a phone screen needs.
        // Keep receiving the feed, but throttle expensive UI work.
        const RT = {
            priceMs: 100,       // 10 UI price updates/sec without repainting every tick
            orderbookMs: 500,   // 2 orderbook recalculations/sec
            wallDrawMs: 1000,   // BW/SW chart geometry at 1 Hz
            overlaysMs: 2500,   // S/R + pattern recalculation every 2.5 sec
            indicatorsMs: 2500, // RSI/MACD every 2.5 sec
            lastPricePaint: 0,
            lastOrderbookPaint: 0,
            lastWallsDraw: 0,
            lastOverlaysPaint: 0,
            lastIndicatorsPaint: 0,
            pendingOrderbook: false,
            pendingWallsDraw: false,
            pendingKline: null,
            pendingPrice: 0,
            pendingPct: null,
            overlayDirty: true,
            indicatorDirty: true,
            raf: 0
        };

        let chart = null;
        let volumeChart = null;
        let rsiChart = null;
        let macdChart = null;

        let candleSeries = null;
        let positionLevelLines = { entry: null, tp: null, sl: null };
        let previewRiskLines = { tp: null, sl: null, tp1: null, tp2: null, tp3: null };
        let volumeSeries = null;
        let ema20Series = null;
        let ema50Series = null;
        let ema200Series = null;

        let rsiSeries = null;
        let rsi70Series = null;
        let rsi50Series = null;
        let rsi30Series = null;

        let macdLineSeries = null;
        let candleMarkers = null;
        let macdSignalSeries = null;
        let macdHistogramSeries = null;
        let srPriceLines = [];
        let orderbookPriceLines = [];
        let rawCandles = [];
        let detectedWalls = [];

        let ws = null;
        let wsPingInterval = null;

        const settings = {
            showVolume: true,
            showOrderbook: true,
            showSR: true,
            showPatterns: true,
            showEMA: true,
            showRSI: true,
            showMACD: true
        };

        window.addEventListener('DOMContentLoaded', async () => {
            lucide.createIcons();
            document.getElementById('terminalLockBtn')?.addEventListener('click', () => showTerminalAuth());
            document.getElementById('terminalAuthClear')?.addEventListener('click', () => {
                terminalAccessToken = '';
                try { localStorage.removeItem(TERMINAL_AUTH_STORAGE); } catch {}
                updateTerminalAuthUi();
                const input = document.getElementById('terminalAuthToken'); if (input) input.value = '';
                const status = document.getElementById('terminalAuthStatus'); if (status) status.textContent = 'Сохранённый токен удалён.';
                setTimeout(() => document.getElementById('terminalAuthToken')?.focus(), 40);
            });
            document.getElementById('terminalAuthSave')?.addEventListener('click', async () => {
                const input = document.getElementById('terminalAuthToken');
                const status = document.getElementById('terminalAuthStatus');
                try {
                    saveTerminalAuthToken(input?.value || '');
                    if (status) status.textContent = 'Проверяю токен…';
                    const r = await fetch('/api/config', { cache:'no-store' });
                    if (!r.ok) throw new Error(r.status === 401 ? 'Токен не принят Render.' : (r.status === 503 ? 'На Render не задан TERMINAL_ACCESS_TOKEN.' : `HTTP ${r.status}`));
                    document.getElementById('terminalAuthModal')?.classList.add('hidden');
                    if (status) status.textContent = '';
                    if (terminalAuthWaiter) { const resolve = terminalAuthWaiter; terminalAuthWaiter = null; resolve(); }
                } catch (e) {
                    terminalAccessToken = '';
                    try { localStorage.removeItem(TERMINAL_AUTH_STORAGE); } catch {}
                    updateTerminalAuthUi();
                    if (status) status.textContent = e.message;
                }
            });
            document.getElementById('terminalAuthToken')?.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('terminalAuthSave')?.click(); });
            await ensureTerminalAuth();
            initChart();
            bindEvents();
            bindTradingUI();
            updateIndicatorVisibility();
            fetchBybitTickers();
            fetchData();

            const resizeObserver = new ResizeObserver(() => {
                resizeAllCharts();
            });
            const chartsArea = document.getElementById('chartsArea');
            if (chartsArea) resizeObserver.observe(chartsArea);

            window.addEventListener('resize', () => {
                resizeAllCharts();
            });
        });

        function decimalPlaces(value) {
            const n = Number(value);
            if (!Number.isFinite(n) || n <= 0) return 0;
            const str = String(value).toLowerCase();
            if (str.includes('e-')) {
                const [mantissa, expPart] = str.split('e-');
                const exp = Number(expPart) || 0;
                const decimals = (mantissa.split('.')[1] || '').length;
                return exp + decimals;
            }
            return Math.max(0, (str.split('.')[1] || '').length);
        }

        function getTickPricePrecision() {
            const tick = Number(tradeState?.instrument?.priceFilter?.tickSize || 0);
            return tick > 0 ? decimalPlaces(tick) : 0;
        }

        function getAdaptivePricePrecision(price) {
            const val = Math.abs(Number(price));
            let fallback = 2;
            if (val < 0.0000001) fallback = 10;
            else if (val < 0.000001) fallback = 9;
            else if (val < 0.00001) fallback = 8;
            else if (val < 0.0001) fallback = 7;
            else if (val < 0.001) fallback = 6;
            else if (val < 0.01) fallback = 6;
            else if (val < 0.1) fallback = 5;
            else if (val < 1) fallback = 4;
            else if (val < 10) fallback = 3;
            return Math.max(fallback, getTickPricePrecision());
        }

        function formatPrice(price, customPrecision = null) {
            if (price === undefined || price === null || isNaN(price)) return '0.00';
            const val = parseFloat(price);
            const p = customPrecision !== null ? customPrecision : Math.max(pricePrecision, getAdaptivePricePrecision(val));
            return val.toFixed(Math.min(12, p));
        }

        function formatVolumeUSD(volume) {
            const val = parseFloat(volume);
            if (isNaN(val) || val === 0) return '$0';
            if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
            if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
            if (val >= 1e3) return `$${(val / 1e3).toFixed(0)}K`;
            return `$${val.toFixed(0)}`;
        }

        function getPrecisionForPrice(price) {
            return getAdaptivePricePrecision(price);
        }

        function createChartOptions(container, showTimeScale = false) {
            return {
                width: container.clientWidth,
                height: Math.max(60, container.clientHeight),
                layout: {
                    attributionLogo: true,
                    background: { type: 'solid', color: '#0d1117' },
                    textColor: '#8b949e',
                    fontSize: 9,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                },
                grid: {
                    vertLines: { color: 'rgba(33, 38, 45, 0.6)' },
                    horzLines: { color: 'rgba(33, 38, 45, 0.6)' },
                },
                crosshair: {
                    mode: LightweightCharts.CrosshairMode.Normal,
                    vertLine: {
                        color: '#f7a600',
                        width: 1,
                        style: LightweightCharts.LineStyle.Dashed,
                        labelBackgroundColor: '#161b22',
                    },
                    horzLine: {
                        color: '#f7a600',
                        width: 1,
                        style: LightweightCharts.LineStyle.Dashed,
                        labelBackgroundColor: '#161b22',
                    },
                },
                rightPriceScale: {
                    borderColor: '#21262d',
                    autoScale: true,
                    alignLabels: true,
                },
                timeScale: {
                    borderColor: '#21262d',
                    timeVisible: showTimeScale,
                    secondsVisible: false,
                    visible: showTimeScale,
                    barSpacing: window.innerWidth < 768 ? 13.0 : 7.0,
                    minBarSpacing: window.innerWidth < 768 ? 8.5 : 2.5,
                    maxBarSpacing: window.innerWidth < 768 ? 20 : 16,
                    rightOffset: 3,
                },
                handleScale: true,
                handleScroll: true,
            };
        }

        function removePriceLineSafe(ref) {
            if (!ref || !candleSeries) return;
            try { candleSeries.removePriceLine(ref); } catch (e) {}
        }

        function addTradePriceLine(price, title, color, lineStyle, lineWidth = 1) {
            const n = Number(price);
            if (!candleSeries || !Number.isFinite(n) || n <= 0) return null;
            try {
                return candleSeries.createPriceLine({ price: n, color, lineWidth, lineStyle, axisLabelVisible: true, title });
            } catch (e) { return null; }
        }

        function syncTradeChartLevels() {
            if (!candleSeries) return;
            Object.values(positionLevelLines).forEach(removePriceLineSafe);
            Object.values(previewRiskLines).forEach(removePriceLineSafe);
            positionLevelLines = { entry: null, tp: null, sl: null };
            previewRiskLines = { tp: null, sl: null, tp1: null, tp2: null, tp3: null };

            const pos = tradeState?.position;
            if (pos && Number(pos.size) > 0) {
                const isLong = pos.side === 'Buy';
                const side = isLong ? 'LONG' : 'SHORT';
                positionLevelLines.entry = addTradePriceLine(pos.avgPrice, `ENTRY ${side}`, isLong ? '#0ecb81' : '#f6465d', LightweightCharts.LineStyle.Solid, 2);
                if (Number(pos.takeProfit) > 0) positionLevelLines.tp = addTradePriceLine(pos.takeProfit, 'TP', '#0ecb81', LightweightCharts.LineStyle.Dashed, 1);
                if (Number(pos.stopLoss) > 0) positionLevelLines.sl = addTradePriceLine(pos.stopLoss, 'SL', '#f6465d', LightweightCharts.LineStyle.Dashed, 1);
                return;
            }

            const e = tradeEls('mobile');
            const tp = Number(e?.tp?.value || 0);
            const sl = Number(e?.sl?.value || 0);
            if (tp > 0 && !multiTpState.enabled) previewRiskLines.tp = addTradePriceLine(tp, 'TP PREVIEW', '#0ecb81', LightweightCharts.LineStyle.Dotted, 1);
            if (sl > 0) previewRiskLines.sl = addTradePriceLine(sl, 'SL PREVIEW', '#f6465d', LightweightCharts.LineStyle.Dotted, 1);
            if (multiTpState.enabled) {
                [1,2,3].forEach(i => { const v=Number(multiTpState.levels[i-1]||0); if(v>0) previewRiskLines['tp'+i]=addTradePriceLine(v, 'TP'+i+' PREVIEW', '#0ecb81', LightweightCharts.LineStyle.Dotted, i===1?2:1); });
            }
        }

        function initChart() {
            const priceContainer = document.getElementById('priceChartContainer');
            const volumeContainer = document.getElementById('volumeChartContainer');
            const rsiContainer = document.getElementById('rsiChartContainer');
            const macdContainer = document.getElementById('macdChartContainer');

            chart = LightweightCharts.createChart(priceContainer, createChartOptions(priceContainer, false));
            volumeChart = LightweightCharts.createChart(volumeContainer, createChartOptions(volumeContainer, false));
            rsiChart = LightweightCharts.createChart(rsiContainer, createChartOptions(rsiContainer, false));
            macdChart = LightweightCharts.createChart(macdContainer, createChartOptions(macdContainer, true));

            candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
                upColor: '#0ecb81',
                downColor: '#f6465d',
                borderDownColor: '#f6465d',
                borderUpColor: '#0ecb81',
                wickDownColor: '#f6465d',
                wickUpColor: '#0ecb81',
                borderVisible: true,
                wickVisible: true,
                priceLineVisible: true,
                priceFormat: {
                    type: 'custom',
                    minMove: 0.00000001,
                    formatter: (price) => formatPrice(price)
                }
            });

            // Lightweight Charts v5 moved series markers to a dedicated plugin.
            candleMarkers = LightweightCharts.createSeriesMarkers(candleSeries, []);

            ema20Series = chart.addSeries(LightweightCharts.LineSeries, { color: '#f7a600', lineWidth: 1.4, title: 'EMA 20', lastValueVisible: false, priceLineVisible: false });
            ema50Series = chart.addSeries(LightweightCharts.LineSeries, { color: '#29b6f6', lineWidth: 1.4, title: 'EMA 50', lastValueVisible: false, priceLineVisible: false });
            ema200Series = chart.addSeries(LightweightCharts.LineSeries, { color: '#ab47bc', lineWidth: 1.6, title: 'EMA 200', lastValueVisible: false, priceLineVisible: false });
            syncTradeChartLevels();

            volumeSeries = volumeChart.addSeries(LightweightCharts.HistogramSeries, {
                priceFormat: { type: 'volume' },
                priceScaleId: 'volume',
                base: 0,
            });
            volumeChart.priceScale('volume').applyOptions({
                scaleMargins: { top: 0.15, bottom: 0.05 }
            });

            rsiSeries = rsiChart.addSeries(LightweightCharts.LineSeries, {
                color: '#f7a600',
                lineWidth: 2,
                title: 'RSI 14',
                priceFormat: { type: 'price', precision: 1, minMove: 0.1 }
            });
            rsi70Series = rsiChart.addSeries(LightweightCharts.LineSeries, {
                color: 'rgba(246, 70, 93, 0.55)',
                lineWidth: 1,
                lineStyle: LightweightCharts.LineStyle.Dashed,
                title: '70'
            });
            rsi50Series = rsiChart.addSeries(LightweightCharts.LineSeries, {
                color: 'rgba(139, 148, 158, 0.35)',
                lineWidth: 1,
                lineStyle: LightweightCharts.LineStyle.Dotted,
                title: '50'
            });
            rsi30Series = rsiChart.addSeries(LightweightCharts.LineSeries, {
                color: 'rgba(14, 203, 129, 0.55)',
                lineWidth: 1,
                lineStyle: LightweightCharts.LineStyle.Dashed,
                title: '30'
            });
            rsiChart.priceScale('right').applyOptions({
                autoScale: false,
                scaleMargins: { top: 0.08, bottom: 0.08 }
            });

            macdHistogramSeries = macdChart.addSeries(LightweightCharts.HistogramSeries, {
                priceFormat: { type: 'price', precision: 6, minMove: 0.000001 },
                priceScaleId: 'macd',
            });
            macdLineSeries = macdChart.addSeries(LightweightCharts.LineSeries, {
                color: '#29b6f6',
                lineWidth: 1.5,
                title: 'MACD'
            });
            macdSignalSeries = macdChart.addSeries(LightweightCharts.LineSeries, {
                color: '#f7a600',
                lineWidth: 1.5,
                title: 'Signal'
            });

            const charts = [chart, volumeChart, rsiChart, macdChart];
            charts.forEach(sourceChart => {
                sourceChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
                    if (!range) return;
                    charts.forEach(targetChart => {
                        if (targetChart !== sourceChart) {
                            targetChart.timeScale().setVisibleLogicalRange(range);
                        }
                    });
                });
            });

            chart.subscribeCrosshairMove(param => {
                const mini = document.getElementById('mobileOhlcMini');
                if (!param.time || param.point === undefined || param.point.x < 0 || param.point.y < 0) {
                    if (mini) mini.classList.add('hidden');
                    if (rawCandles.length > 0) updateOHLCTooltip(rawCandles[rawCandles.length - 1]);
                    return;
                }
                if (mini && window.innerWidth < 768) mini.classList.remove('hidden');
                const candle = param.seriesData.get(candleSeries);
                const volume = param.time ? rawCandles.find(c => c.time === param.time) : null;
                if (candle) {
                    updateOHLCTooltip({
                        open: candle.open,
                        high: candle.high,
                        low: candle.low,
                        close: candle.close,
                        volume: volume ? volume.volume : 0
                    });
                }
            });
        }

        function clearAllSeriesAndLines() {
            if (srPriceLines && srPriceLines.length > 0) {
                srPriceLines.forEach(line => {
                    try { candleSeries.removePriceLine(line); } catch(e){}
                });
                srPriceLines = [];
            }

            if (orderbookPriceLines && orderbookPriceLines.length > 0) {
                orderbookPriceLines.forEach(line => {
                    try { candleSeries.removePriceLine(line); } catch(e){}
                });
                orderbookPriceLines = [];
            }

            rawCandles = [];
            detectedWalls = [];

            if (candleSeries) {
                candleSeries.setData([]);
                if (candleMarkers) candleMarkers.setMarkers([]);
            }
            if (volumeSeries) volumeSeries.setData([]);
            if (ema20Series) ema20Series.setData([]);
            if (ema50Series) ema50Series.setData([]);
            if (ema200Series) ema200Series.setData([]);
            if (rsiSeries) rsiSeries.setData([]);
            if (rsi70Series) rsi70Series.setData([]);
            if (rsi50Series) rsi50Series.setData([]);
            if (rsi30Series) rsi30Series.setData([]);
            if (macdLineSeries) macdLineSeries.setData([]);
            if (macdSignalSeries) macdSignalSeries.setData([]);
            if (macdHistogramSeries) macdHistogramSeries.setData([]);

            if (chart) chart.priceScale('right').applyOptions({ autoScale: true });
            if (volumeChart) volumeChart.priceScale('volume').applyOptions({ autoScale: true });
            if (rsiChart) rsiChart.priceScale('right').applyOptions({ autoScale: true });
            if (macdChart) macdChart.priceScale('macd').applyOptions({ autoScale: true });
        }

        function resizeAllCharts() {
            const map = [
                [chart, 'priceChartContainer'],
                [volumeChart, 'volumeChartContainer'],
                [rsiChart, 'rsiChartContainer'],
                [macdChart, 'macdChartContainer']
            ];
            map.forEach(([instance, id]) => {
                const container = document.getElementById(id);
                if (instance && container) {
                    const rect = container.getBoundingClientRect();
                    instance.applyOptions({
                        width: Math.max(1, Math.floor(rect.width)),
                        height: Math.max(50, Math.floor(rect.height))
                    });
                }
            });
            drawOrderBookWalls();
        }

        function updateOHLCTooltip(c) {
            const mini = document.getElementById('mobileOhlcMini');
            if (mini && c) {
                const set = (id, value) => { const el = document.getElementById(id); if (el) el.innerText = value; };
                set('mobileO', formatPrice(c.open));
                set('mobileH', formatPrice(c.high));
                set('mobileL', formatPrice(c.low));
                set('mobileC', formatPrice(c.close));
                set('mobileV', formatVolumeUSD(c.volume || 0));
            }

            if (!c) return;
            document.getElementById('ohlcOpen').innerText = formatPrice(c.open);
            document.getElementById('ohlcHigh').innerText = formatPrice(c.high);
            document.getElementById('ohlcLow').innerText = formatPrice(c.low);
            document.getElementById('ohlcClose').innerText = formatPrice(c.close);
            document.getElementById('ohlcVol').innerText = c.volume ? c.volume.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0.00';
        }

        async function fetchBybitTickers() {
            try {
                const res = await fetch('https://api.bybit.com/v5/market/tickers?category=linear');
                const json = await res.json();

                if (json.retCode === 0 && json.result && json.result.list) {
                    allTickers = json.result.list
                        .filter(i => i.symbol.endsWith('USDT'))
                        .map(i => ({
                            symbol: i.symbol,
                            price: parseFloat(i.lastPrice || 0),
                            change24h: parseFloat(i.price24hPcnt || 0) * 100,
                            turnover24h: parseFloat(i.turnover24h || 0)
                        }));

                    renderSymbolDropdownList();
                }
            } catch (e) {
                console.error("Failed to fetch Bybit tickers:", e);
                allTickers = [
                    { symbol: 'BTCUSDT', price: 68000, change24h: 1.5, turnover24h: 5000000000 },
                    { symbol: 'ETHUSDT', price: 3500, change24h: -0.8, turnover24h: 2000000000 },
                    { symbol: 'SOLUSDT', price: 150, change24h: 4.2, turnover24h: 1200000000 }
                ];
                renderSymbolDropdownList();
            }
        }

        function renderSymbolDropdownList() {
            const container = document.getElementById('symbolList');
            const searchInput = document.getElementById('symbolSearchInput');
            const term = searchInput ? searchInput.value.toUpperCase().trim() : '';

            let list = [...allTickers];

            if (term) {
                list = list.filter(t => t.symbol.includes(term));
            }

            if (currentSortMode === 'volume') {
                list.sort((a, b) => b.turnover24h - a.turnover24h);
            } else if (currentSortMode === 'gainers') {
                list.sort((a, b) => b.change24h - a.change24h);
            } else if (currentSortMode === 'losers') {
                list.sort((a, b) => a.change24h - b.change24h);
            } else if (currentSortMode === 'alphabet') {
                list.sort((a, b) => a.symbol.localeCompare(b.symbol));
            }

            if (!list.length) {
                container.innerHTML = `<div class="text-bybit-muted italic text-center py-6 text-xs">Токены не найдены</div>`;
                return;
            }

            container.innerHTML = list.map(t => {
                const isSelected = t.symbol === currentSymbol;
                const isPositive = t.change24h >= 0;
                const changeClass = isPositive ? 'text-bybit-green bg-bybit-green/10 border-bybit-green/20' : 'text-bybit-red bg-bybit-red/10 border-bybit-red/20';

                return `
                    <div data-symbol="${t.symbol}" class="symbol-item px-2.5 py-1.5 hover:bg-bybit-hover cursor-pointer rounded-lg text-white flex items-center justify-between transition-colors ${isSelected ? 'bg-bybit-hover border border-bybit-yellow/30' : ''}">
                        <div class="flex flex-col">
                            <span class="font-bold text-xs ${isSelected ? 'text-bybit-yellow' : 'text-white'}">${t.symbol}</span>
                            <span class="text-[10px] text-bybit-muted font-mono">${formatVolumeUSD(t.turnover24h)}</span>
                        </div>
                        <div class="flex items-center space-x-2 text-right">
                            <div class="flex flex-col items-end">
                                <span class="font-mono text-xs font-semibold text-white">${formatPrice(t.price)}</span>
                                <span class="text-[9px] px-1 py-0.2 rounded font-mono font-bold border ${changeClass}">
                                    ${isPositive ? '+' : ''}${t.change24h.toFixed(2)}%
                                </span>
                            </div>
                            ${isSelected ? '<i data-lucide="check" class="w-3.5 h-3.5 text-bybit-yellow"></i>' : ''}
                        </div>
                    </div>
                `;
            }).join('');

            lucide.createIcons();

            container.querySelectorAll('.symbol-item').forEach(el => {
                el.addEventListener('click', () => {
                    const selected = el.dataset.symbol;
                    if (selected !== currentSymbol) {
                        currentSymbol = selected;
                        document.getElementById('currentSymbolLabel').innerText = currentSymbol;
                        document.getElementById('currentSymbolText').innerText = currentSymbol;
                        
                        closeSymbolDropdown();
                        fetchData();
                    } else {
                        closeSymbolDropdown();
                    }
                });
            });
        }

        function closeSymbolDropdown() {
            const dropdownMenu = document.getElementById('symbolDropdownMenu');
            if (dropdownMenu) {
                dropdownMenu.classList.add('opacity-0', 'scale-95');
                setTimeout(() => dropdownMenu.classList.add('hidden'), 150);
            }
        }

        function openSymbolDropdown() {
            const dropdownMenu = document.getElementById('symbolDropdownMenu');
            const searchInput = document.getElementById('symbolSearchInput');
            if (dropdownMenu) {
                dropdownMenu.classList.remove('hidden');
                setTimeout(() => {
                    dropdownMenu.classList.remove('opacity-0', 'scale-95');
                    if (searchInput) searchInput.focus();
                }, 10);
            }
        }

        function closeDominanceDropdown() {
            const domMenu = document.getElementById('dominanceDropdownMenu');
            if (domMenu) {
                domMenu.classList.add('opacity-0', 'scale-95');
                setTimeout(() => domMenu.classList.add('hidden'), 150);
            }
        }

        function openDominanceDropdown() {
            const domMenu = document.getElementById('dominanceDropdownMenu');
            if (domMenu) {
                domMenu.classList.remove('hidden');
                setTimeout(() => domMenu.classList.remove('opacity-0', 'scale-95'), 10);
            }
        }

        function bindEvents() {
            const dropdownBtn = document.getElementById('symbolDropdownBtn');
            const dropdownMenu = document.getElementById('symbolDropdownMenu');
            const searchInput = document.getElementById('symbolSearchInput');

            dropdownBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeDominanceDropdown();
                if (dropdownMenu.classList.contains('hidden')) {
                    openSymbolDropdown();
                } else {
                    closeSymbolDropdown();
                }
            });

            const domBtn = document.getElementById('dominanceDropdownBtn');
            const domMenu = document.getElementById('dominanceDropdownMenu');

            domBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeSymbolDropdown();
                if (domMenu.classList.contains('hidden')) {
                    openDominanceDropdown();
                } else {
                    closeDominanceDropdown();
                }
            });

            document.addEventListener('click', (e) => {
                if (!document.getElementById('symbolDropdownContainer').contains(e.target)) {
                    closeSymbolDropdown();
                }
                if (!document.getElementById('dominanceDropdownContainer').contains(e.target)) {
                    closeDominanceDropdown();
                }
            });

            if (searchInput) {
                searchInput.addEventListener('input', () => {
                    renderSymbolDropdownList();
                });
            }

            const filterGroup = document.getElementById('symbolSortFilterGroup');
            if (filterGroup) {
                filterGroup.addEventListener('click', (e) => {
                    const btn = e.target.closest('button');
                    if (!btn) return;

                    filterGroup.querySelectorAll('button').forEach(b => {
                        b.className = "px-2 py-1 rounded font-medium text-bybit-muted hover:text-white shrink-0";
                    });
                    btn.className = "px-2 py-1 rounded font-bold text-bybit-yellow bg-bybit-card border border-bybit-border shrink-0";

                    currentSortMode = btn.dataset.sort;
                    renderSymbolDropdownList();
                });
            }

            const intervalGroup = document.getElementById('intervalGroup');
            intervalGroup.addEventListener('click', (e) => {
                const btn = e.target.closest('button');
                if (!btn) return;

                intervalGroup.querySelectorAll('button').forEach(b => {
                    b.className = "px-2 py-0.5 text-[10px] rounded font-medium text-bybit-muted hover:text-white transition-colors";
                });
                btn.className = "px-2 py-0.5 text-[10px] rounded font-bold text-bybit-yellow bg-bybit-card border border-bybit-yellow/30 shadow-sm";

                currentInterval = btn.dataset.interval;
                document.getElementById('intervalText').innerText = btn.innerText;
                if (typeof syncMobileTimeframeButtons === 'function') syncMobileTimeframeButtons();
                fetchData();
            });

            document.getElementById('toggleVolume').addEventListener('change', (e) => {
                settings.showVolume = e.target.checked;
                updateIndicatorVisibility();
            });

            document.getElementById('toggleOrderbook').addEventListener('change', (e) => {
                settings.showOrderbook = e.target.checked;
                drawOrderBookWalls();
                renderOrderbookWallsPanel();
            });

            document.getElementById('toggleSR').addEventListener('change', (e) => {
                settings.showSR = e.target.checked;
                updateOverlays();
            });

            document.getElementById('togglePatterns').addEventListener('change', (e) => {
                settings.showPatterns = e.target.checked;
                updateOverlays();
            });

            document.getElementById('toggleEMA').addEventListener('change', (e) => {
                settings.showEMA = e.target.checked;
                updateOverlays();
            });

            document.getElementById('toggleRSI').addEventListener('change', (e) => {
                settings.showRSI = e.target.checked;
                updateIndicatorVisibility();
            });

            document.getElementById('toggleMACD').addEventListener('change', (e) => {
                settings.showMACD = e.target.checked;
                updateIndicatorVisibility();
            });

            const resetChartView = () => {
                try {
                    const visibleBars = window.innerWidth < 768 ? 52 : 110;
                    const from = Math.max(0, rawCandles.length - visibleBars);
                    chart.timeScale().setVisibleLogicalRange({ from, to: rawCandles.length + 2 });
                    chart.priceScale('right').applyOptions({ autoScale: true });
                    syncAllChartRanges();
                } catch (e) {}
            };
            document.getElementById('resetChartViewBtn')?.addEventListener('click', resetChartView);
            document.getElementById('resetChartViewBtnTop')?.addEventListener('click', resetChartView);

            const doManualRefresh = async (iconId) => {
                const icon = document.getElementById(iconId);
                if (icon) icon.classList.add('animate-spin');
                try {
                    await fetchBybitTickers();
                    await fetchData();
                    connectWebSocket('auto');
                } finally {
                    setTimeout(() => { if (icon) icon.classList.remove('animate-spin'); }, 500);
                }
            };

            // ===== Stage 5.14: mobile chart timeframe + app shell =====
            function syncMobileTimeframeButtons() {
                document.querySelectorAll('[data-mobile-interval]').forEach(btn => {
                    btn.classList.toggle('active', String(btn.dataset.mobileInterval) === String(currentInterval));
                });
                const desktopGroup = document.getElementById('intervalGroup');
                if (desktopGroup) desktopGroup.querySelectorAll('button').forEach(btn => {
                    const active = String(btn.dataset.interval) === String(currentInterval);
                    btn.className = active
                        ? 'px-2 py-0.5 text-[10px] rounded font-bold text-bybit-yellow bg-bybit-card border border-bybit-yellow/30 shadow-sm'
                        : 'px-2 py-0.5 text-[10px] rounded font-medium text-bybit-muted hover:text-white transition-colors';
                });
            }
            document.querySelectorAll('[data-mobile-interval]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const interval = btn.dataset.mobileInterval;
                    const desktopBtn = document.querySelector(`#intervalGroup [data-interval="${interval}"]`);
                    if (desktopBtn) desktopBtn.click();
                    else {
                        currentInterval = interval;
                        syncMobileTimeframeButtons();
                        reconnectMarketWS();
                        loadCandles();
                    }
                });
            });
            syncMobileTimeframeButtons();

            function isStandaloneApp() {
                return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || window.navigator.standalone === true;
            }
            function updateAppModeUi() {
                document.body.classList.toggle('pwa-standalone', isStandaloneApp());
                const fs = !!document.fullscreenElement;
                document.body.classList.toggle('is-fullscreen', fs);
                const btn = document.getElementById('fullscreenBtn');
                const mobileBtn = document.getElementById('mobileFullscreenBtn');
                [btn, mobileBtn].forEach(b => { if (b) b.classList.toggle('fullscreen-active', fs); });
            }
            async function toggleTerminalFullscreen() {
                try {
                    if (document.fullscreenElement) await document.exitFullscreen();
                    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
                    else {
                        setTradeStatus?.('Для полного режима установи терминал как приложение', 'muted');
                    }
                } catch (e) {
                    console.warn('Fullscreen unavailable:', e);
                    try { setTradeStatus?.('Полный экран: установи терминал как приложение', 'muted'); } catch {}
                }
                updateAppModeUi();
            }
            document.getElementById('fullscreenBtn')?.addEventListener('click', toggleTerminalFullscreen);
            document.getElementById('mobileFullscreenBtn')?.addEventListener('click', toggleTerminalFullscreen);
            document.getElementById('mobileVolumeBtn')?.addEventListener('click', () => {
                const el = document.getElementById('toggleVolume');
                if (el) { el.checked = !el.checked; el.dispatchEvent(new Event('change', {bubbles:true})); }
                document.getElementById('mobileVolumeBtn')?.classList.toggle('chart-toggle-active', !!el?.checked);
            });
            document.getElementById('mobileOrderbookBtn')?.addEventListener('click', () => {
                const el = document.getElementById('toggleOrderbook');
                if (el) { el.checked = !el.checked; el.dispatchEvent(new Event('change', {bubbles:true})); }
                document.getElementById('mobileOrderbookBtn')?.classList.toggle('chart-toggle-active', !!el?.checked);
            });
            document.getElementById('mobileAutoChartBtn')?.addEventListener('click', () => resetChartView());
            function setMobileScalpMode(enabled) {
                document.body.classList.toggle('mobile-scalp-mode', !!enabled);
                const btn = document.getElementById('mobileScalpModeBtn');
                if (btn) btn.classList.toggle('sc-mode-active', !!enabled);
                localStorage.setItem('mobileScalpMode', enabled ? '1' : '0');
                if (enabled) {
                    document.getElementById('mobileTradeDock')?.classList.remove('collapsed');
                    try { resetChartView(); } catch (_) {}
                }
            }
            const savedScalpMode = localStorage.getItem('mobileScalpMode') === '1';
            document.getElementById('mobileScalpModeBtn')?.addEventListener('click', () => setMobileScalpMode(!document.body.classList.contains('mobile-scalp-mode')));
            document.getElementById('mobileScalpLongBtn')?.addEventListener('click', () => document.getElementById('mobileLongBtn')?.click());
            document.getElementById('mobileScalpShortBtn')?.addEventListener('click', () => document.getElementById('mobileShortBtn')?.click());
            document.getElementById('mobileScalpExpandBtn')?.addEventListener('click', () => {
                setMobileScalpMode(false);
                document.getElementById('mobileTradeDock')?.classList.remove('collapsed');
                document.querySelector('#mobileTradeDock .mobile-trade-body')?.scrollIntoView({behavior:'smooth', block:'nearest'});
            });
            if (savedScalpMode) setMobileScalpMode(true);
            document.getElementById('mobileRsiBtn')?.addEventListener('click', () => {
                const el = document.getElementById('toggleRSI');
                if (el) { el.checked = !el.checked; el.dispatchEvent(new Event('change', {bubbles:true})); }
                document.getElementById('mobileRsiBtn')?.classList.toggle('chart-toggle-active', !!el?.checked);
            });
            document.getElementById('mobileMacdBtn')?.addEventListener('click', () => {
                const el = document.getElementById('toggleMACD');
                if (el) { el.checked = !el.checked; el.dispatchEvent(new Event('change', {bubbles:true})); }
                document.getElementById('mobileMacdBtn')?.classList.toggle('chart-toggle-active', !!el?.checked);
            });
            document.addEventListener('fullscreenchange', updateAppModeUi);
            updateAppModeUi();

            let deferredInstallPrompt = null;
            window.addEventListener('beforeinstallprompt', (event) => {
                event.preventDefault();
                deferredInstallPrompt = event;
                const installBtn = document.getElementById('installAppBtn');
                if (installBtn && !isStandaloneApp()) installBtn.style.display = 'flex';
            });
            document.getElementById('installAppBtn')?.addEventListener('click', async () => {
                if (!deferredInstallPrompt) return;
                deferredInstallPrompt.prompt();
                try { await deferredInstallPrompt.userChoice; } catch {}
                deferredInstallPrompt = null;
                document.getElementById('installAppBtn').style.display = 'none';
            });
            window.addEventListener('appinstalled', () => {
                deferredInstallPrompt = null;
                const installBtn = document.getElementById('installAppBtn');
                if (installBtn) installBtn.style.display = 'none';
                updateAppModeUi();
            });
            if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(err => console.warn('SW:', err)));
            }

            document.getElementById('refreshBtn').addEventListener('click', () => doManualRefresh('refreshIcon'));
            document.getElementById('mobileRefreshBtn')?.addEventListener('click', () => doManualRefresh('mobileRefreshIcon'));


            const mobileDrawer = document.getElementById('mobileAnalyticsDrawer');
            const openAnalytics = () => mobileDrawer.classList.remove('hidden');
            document.getElementById('openMobileAnalyticsBtn')?.addEventListener('click', openAnalytics);
            document.getElementById('mobileAnalyticsActionBtn')?.addEventListener('click', openAnalytics);
            document.getElementById('closeMobileAnalyticsBtn').addEventListener('click', () => mobileDrawer.classList.add('hidden'));
            mobileDrawer.addEventListener('click', (e) => {
                if (e.target === mobileDrawer) mobileDrawer.classList.add('hidden');
            });

            const helpModal = document.getElementById('helpModal');
            document.getElementById('openHelpBtn').addEventListener('click', () => helpModal.classList.remove('hidden'));
            document.getElementById('closeHelpBtn').addEventListener('click', () => helpModal.classList.add('hidden'));
            document.getElementById('closeHelpModalBtn').addEventListener('click', () => helpModal.classList.add('hidden'));
        }


        // ===== Stage 4 Trading UI =====
        const tradeState = { instrument: null, tradingEnabled: false, position: null, busy: false, positionBusy: false };
        let positionHistoryCache = [];
        let positionClosePopupTimer = null;
        let latestSrZones = [];
        const tradeRiskState = {
            side: 'Buy',
            mode: 'manual', // manual | rr | tp | sl
            tpPct: null,
            slPct: null,
            rrRatio: null,
            rrRiskPct: 0.5,
            entryPrice: 0,
            tpPrice: 0,
            slPrice: 0,
            internalUpdate: false
        };
        const multiTpState = { enabled: false, levels: [0,0,0], allocations: [40,35,25], beAuto: false, beMoved: false, applying: false };
        let privateWs = null;
        let privateWsPingTimer = null;
        let privateWsReconnectTimer = null;
        let privateWsToken = null;
        let privateWsConnected = false;

        function tradeEls(prefix) {
            return {
                margin: document.getElementById(prefix + 'Margin'),
                leverage: document.getElementById(prefix + 'Leverage'),
                orderType: document.getElementById(prefix + 'OrderType'),
                limitPrice: document.getElementById(prefix + 'LimitPrice'),
                limitWrap: document.getElementById(prefix + 'LimitWrap'),
                tp: document.getElementById(prefix + 'TP'),
                sl: document.getElementById(prefix + 'SL'),
                long: document.getElementById(prefix + 'LongBtn'),
                short: document.getElementById(prefix + 'ShortBtn'),
                close: document.getElementById(prefix + 'CloseBtn'),
                position: document.getElementById(prefix + 'PositionCard'),
                status: document.getElementById(prefix + 'TradeStatus'),
                mode: document.getElementById(prefix + 'TradeMode')
            };
        }

        function setTradeStatus(text, tone='muted') {
            ['desktop','mobile'].forEach(p => {
                const e = tradeEls(p); if (!e.status) return;
                e.status.textContent = text || '';
                e.status.className = 'trade-status text-[10px] font-mono ' + (tone === 'error' ? 'text-bybit-red' : tone === 'ok' ? 'text-bybit-green' : 'text-bybit-muted');
            });
        }

        function normalizeQty(qty) {
            const step = Number(tradeState.instrument?.lotSizeFilter?.qtyStep || 0);
            const min = Number(tradeState.instrument?.lotSizeFilter?.minOrderQty || 0);
            if (!step) return String(qty);
            const n = Math.floor(Number(qty) / step) * step;
            const decimals = Math.max(0, (String(step).split('.')[1] || '').length);
            if (n < min) return '';
            return n.toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
        }

        function normalizePrice(price) {
            const tick = Number(tradeState.instrument?.priceFilter?.tickSize || 0);
            if (!tick || !price) return String(price);
            const n = Math.round(Number(price) / tick) * tick;
            const decimals = Math.max(0, (String(tick).split('.')[1] || '').length);
            return n.toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
        }

        function syncTradeInputs(sourcePrefix) {
            const a = tradeEls(sourcePrefix);
            const b = tradeEls(sourcePrefix === 'mobile' ? 'desktop' : 'mobile');
            if (!a.margin || !b.margin) return;
            b.margin.value = a.margin.value;
            b.leverage.value = sourcePrefix === 'mobile' ? String(a.leverage.value).replace('x','') : a.leverage.value;
            b.orderType.value = a.orderType.value;
            if (a.limitPrice) b.limitPrice.value = a.limitPrice.value;
            // TP/SL are controlled by tradeRiskState. Never copy stale zeroes into the
            // active side while a dynamic mode is running.
            if (tradeRiskState.mode === 'manual') {
                b.tp.value = a.tp.value;
                b.sl.value = a.sl.value;
            } else {
                b.tp.value = tradeRiskState.tpPrice ? String(tradeRiskState.tpPrice) : '';
                b.sl.value = tradeRiskState.slPrice ? String(tradeRiskState.slPrice) : '';
            }
            updateLimitVisibility();
            updateTradePreview();
        }

        function updateLimitVisibility() {
            ['desktop','mobile'].forEach(p => {
                const e = tradeEls(p); if (!e.orderType || !e.limitWrap) return;
                const show = e.orderType.value === 'Limit';
                e.limitWrap.classList.toggle('hidden', !show);
            });
        }

        function renderPosition(pos) {
            const previous = tradeState.position;
            const hadPrevious = !!(previous && Number(previous.size) > 0);
            const has = !!(pos && Number(pos.size) > 0);
            tradeState.position = pos;

            // Once a real position appears, stop treating the entry form as a live
            // TP/SL calculator. Actual TP/SL attached to the position remain on the
            // chart; fresh preview levels are cleared so the chart stays clean.
            if (has && !hadPrevious) {
                tradeRiskState.mode = 'manual';
                tradeRiskState.tpPct = null;
                tradeRiskState.slPct = null;
                tradeRiskState.rrRatio = null;
                tradeRiskState.entryPrice = 0;
                tradeRiskState.tpPrice = 0;
                tradeRiskState.slPrice = 0;
                multiTpState.enabled = false;
                multiTpState.levels = [0, 0, 0];
                const mtp = document.getElementById('mobileMultiTpToggle');
                if (mtp) mtp.classList.remove('text-bybit-green','bg-bybit-green/10');
                ['mobileTP1','mobileTP2','mobileTP3'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
                syncTradeChartLevels();
                // New position: jump straight to the position manager.
                requestAnimationFrame(() => openMobileTool('position'));
            }

            const empty = document.getElementById('mobilePositionEmpty');
            if (empty) empty.classList.toggle('hidden', has);
            if (has) {
                const pnl = Number(pos.unrealisedPnl || 0);
                const mark = Number(pos.markPrice || livePrice || 0);
                const avg = Number(pos.avgPrice || 0);
                const notional = Number(pos.positionValue || (mark * Number(pos.size || 0)) || 0);
                const leverage = Number(pos.leverage || 0);
                const margin = Number(pos.positionIM || (notional && leverage ? notional / leverage : 0) || 0);
                const liq = Number(pos.liqPrice || 0);
                const realized = Number(pos.curRealisedPnl || pos.cumRealisedPnl || 0);
                const roi = margin > 0 ? (pnl / margin * 100) : 0;
                const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
                set('mobilePositionPnl', `${pnl >= 0 ? '+' : ''}${pnl.toFixed(3)} USDT`);
                const pnlEl = document.getElementById('mobilePositionPnl');
                if (pnlEl) pnlEl.className = 'text-[10px] font-black font-mono ' + (pnl >= 0 ? 'text-bybit-green' : 'text-bybit-red');
                set('mobilePosSize', `${pos.side === 'Buy' ? 'LONG' : 'SHORT'} ${pos.size}`);
                set('mobilePosAvg', formatPrice(avg));
                set('mobilePosMark', formatPrice(mark));
                set('mobilePosTp', Number(pos.takeProfit || 0) ? formatPrice(pos.takeProfit) : '—');
                set('mobilePosSl', Number(pos.stopLoss || 0) ? formatPrice(pos.stopLoss) : '—');
                set('mobilePosTs', Number(pos.trailingStop || 0) ? formatPrice(pos.trailingStop) : '—');
                set('mobilePosValue', notional > 0 ? `${formatVolumeUSD(notional)}` : '—');
                set('mobilePosLeverage', leverage > 0 ? `${leverage}x` : '—');
                set('mobilePosLiq', liq > 0 ? formatPrice(liq) : '—');
                set('mobilePosRealized', `${realized >= 0 ? '+' : ''}${realized.toFixed(3)}`);
                set('mobilePosMargin', margin > 0 ? `${margin.toFixed(3)} USDT` : '—');
                set('mobilePosRoi', `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`);
                const tpIn = document.getElementById('mobilePosTPInput');
                const slIn = document.getElementById('mobilePosSLInput');
                if (tpIn && document.activeElement !== tpIn) tpIn.value = Number(pos.takeProfit || 0) ? formatPrice(pos.takeProfit) : '';
                if (slIn && document.activeElement !== slIn) slIn.value = Number(pos.stopLoss || 0) ? formatPrice(pos.stopLoss) : '';
            }
            let text = 'Нет позиции';
            let html = '<span class="text-bybit-muted">Нет позиции</span>';
            if (has) {
                const pnl = Number(pos.unrealisedPnl || 0);
                const cls = pnl >= 0 ? 'position-positive' : 'position-negative';
                const sideLabel = pos.side === 'Buy' ? 'LONG' : 'SHORT';
                const sideCls = pos.side === 'Buy' ? 'text-bybit-green' : 'text-bybit-red';
                const mark = Number(pos.markPrice || livePrice || 0);
                const tp = Number(pos.takeProfit || 0);
                const sl = Number(pos.stopLoss || 0);
                text = `${sideLabel} ${pos.size} @ ${formatPrice(pos.avgPrice)} · ${pnl >= 0 ? '+' : ''}${pnl.toFixed(3)} USDT`;
                html = `<span class="side ${sideCls}">${sideLabel}</span><span class="meta">${pos.size} @ ${formatPrice(pos.avgPrice)} · Mark ${formatPrice(mark)}${tp ? ` · TP ${formatPrice(tp)}` : ''}${sl ? ` · SL ${formatPrice(sl)}` : ''}</span><span class="pnl ${cls}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(3)} USDT</span>`;
            }
            ['desktop','mobile'].forEach(p => {
                const e=tradeEls(p);
                if(e.position) {
                    if (p === 'mobile') e.position.innerHTML = html;
                    else e.position.innerHTML = text;
                }
            });
            const closeBtn = document.getElementById('mobileCloseBtn');
            if (closeBtn) closeBtn.disabled = !has || tradeState.busy || !tradeState.tradingEnabled;
            if (hadPrevious && !has && String(previous?.symbol || currentSymbol).toUpperCase() === currentSymbol.toUpperCase()) scheduleClosedPositionPopup(previous);
            syncTradeChartLevels();
            updateTradePreview();
        }

        function updatePositionLive(price) {
            const pos = tradeState.position;
            if (!pos || Number(pos.size) <= 0 || !(price > 0)) return;
            const avg = Number(pos.avgPrice || 0);
            const size = Number(pos.size || 0);
            const pnl = pos.side === 'Buy' ? (price - avg) * size : (avg - price) * size;
            const notional = price * size;
            const leverage = Number(pos.leverage || 0);
            const margin = Number(pos.positionIM || (notional && leverage ? notional / leverage : 0) || 0);
            const roi = margin > 0 ? pnl / margin * 100 : 0;
            const set=(id,v)=>{const el=document.getElementById(id); if(el) el.textContent=v;};
            set('mobilePosMark', formatPrice(price));
            set('mobilePositionPnl', `${pnl>=0?'+':''}${pnl.toFixed(3)} USDT`);
            set('mobilePosValue', formatVolumeUSD(notional));
            set('mobilePosRoi', `${roi>=0?'+':''}${roi.toFixed(1)}%`);
            const pnlEl=document.getElementById('mobilePositionPnl');
            if(pnlEl) pnlEl.className='text-[10px] font-black font-mono '+(pnl>=0?'text-bybit-green':'text-bybit-red');
        }

        async function scheduleClosedPositionPopup(previous) {
            if (positionClosePopupTimer) clearTimeout(positionClosePopupTimer);
            positionClosePopupTimer = setTimeout(async () => {
                try {
                    const r = await fetch(`/api/closed-pnl?symbol=${encodeURIComponent(currentSymbol)}`, {cache:'no-store'});
                    const j = await r.json();
                    const rows = j.result?.list || [];
                    if (rows.length) showClosedPositionPopup(rows[0], previous);
                    await refreshPositionHistory();
                } catch (e) {
                    showClosedPositionPopup({symbol:currentSymbol, side:previous?.side, qty:previous?.size, avgEntryPrice:previous?.avgPrice, avgExitPrice:previous?.markPrice || livePrice, closedPnl:previous?.unrealisedPnl || 0}, previous);
                }
            }, 450);
        }

        function getClosedPositionSide(row, previous) {
            // Bybit closed-PnL `side` is the side of the closing execution.
            // Closing a LONG is a Sell; closing a SHORT is a Buy.
            if (previous?.side === 'Buy' || previous?.side === 'Sell') return previous.side;
            if (row?.side === 'Buy') return 'Sell';
            if (row?.side === 'Sell') return 'Buy';
            return '';
        }

        function showClosedPositionPopup(row, previous) {
            const modal=document.getElementById('positionClosedModal'); if(!modal) return;
            const pnl=Number(row?.closedPnl || 0);
            const fees=Number(row?.openFee || 0)+Number(row?.closeFee || 0);
            const positionSide = getClosedPositionSide(row, previous);
            const set=(id,v)=>{const e=document.getElementById(id); if(e)e.textContent=v;};
            set('closedModalTitle', `${currentSymbol} ${positionSide==='Buy'?'LONG':positionSide==='Sell'?'SHORT':'—'}`);
            set('closedModalPnl', `${pnl>=0?'+':''}${pnl.toFixed(4)} USDT`);
            set('closedModalQty', row?.closedSize || row?.qty || previous?.size || '—');
            set('closedModalEntry', Number(row?.avgEntryPrice || previous?.avgPrice || 0) ? formatPrice(row.avgEntryPrice || previous.avgPrice) : '—');
            set('closedModalExit', Number(row?.avgExitPrice || 0) ? formatPrice(row.avgExitPrice) : '—');
            set('closedModalFees', fees ? `${fees.toFixed(4)} USDT` : '—');
            const pnlEl=document.getElementById('closedModalPnl'); if(pnlEl) pnlEl.style.color=pnl>=0?'#0ecb81':'#f6465d';
            modal.classList.remove('hidden');
        }

        async function refreshPositionHistory() {
            const list=document.getElementById('mobilePositionHistoryList'); if(!list) return;
            try {
                const r=await fetch(`/api/closed-pnl?symbol=${encodeURIComponent(currentSymbol)}`,{cache:'no-store'});
                const j=await r.json(); if(!r.ok||!j.ok) throw new Error(j.error||'Ошибка истории');
                const rows=j.result?.list||[]; positionHistoryCache=rows;
                if(!rows.length){list.innerHTML='<div class="mobile-order-empty">История пуста</div>';return;}
                list.innerHTML=rows.slice(0,10).map(x=>{
                    const pnl=Number(x.closedPnl||0), win=pnl>=0;
                    // Closed-PnL `side` is the closing order side, so invert it
                    // to show the actual direction of the position that was closed.
                    const positionSide=x.side==='Sell'?'LONG':x.side==='Buy'?'SHORT':'—';
                    const sideClass=positionSide==='LONG'?'text-bybit-green':positionSide==='SHORT'?'text-bybit-red':'text-bybit-muted';
                    const t=x.updatedTime?new Date(Number(x.updatedTime)).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
                    return `<div class="position-history-row ${win?'win':'loss'}"><div><span class="k">ПОЗИЦИЯ</span><span class="v ${sideClass}">${positionSide} ${x.closedSize||x.qty||''}</span></div><div><span class="k">ENTRY → EXIT</span><span class="v">${Number(x.avgEntryPrice||0)?formatPrice(x.avgEntryPrice):'—'} → ${Number(x.avgExitPrice||0)?formatPrice(x.avgExitPrice):'—'}</span></div><div><span class="k">PNL · ВРЕМЯ</span><span class="v ${win?'text-bybit-green':'text-bybit-red'}">${pnl>=0?'+':''}${pnl.toFixed(3)} · ${t}</span></div></div>`;
                }).join('');
            } catch(e){ list.innerHTML=`<div class="mobile-order-empty">Ошибка: ${e.message}</div>`; }
        }
        function previewPrice() {
            const e = tradeEls('mobile');
            const type = e.orderType?.value || 'Market';
            const live = Number(livePrice || 0);
            const limit = Number(e.limitPrice?.value || 0);
            // Market preview must always follow the realtime price. For the rare frame
            // where livePrice is not populated yet, use the visible price as a last-resort
            // local fallback so dynamic TP/SL never stays at zero.
            if (type === 'Limit') return limit > 0 ? limit : live;
            if (live > 0) return live;
            const visible = Number(String(document.getElementById('lastPrice')?.textContent || '').replace(/[^0-9.]/g, ''));
            return visible > 0 ? visible : 0;
        }

        function previewQty() {
            const e = tradeEls('mobile');
            const margin = Number(e.margin?.value || 0);
            const leverage = Number(String(e.leverage?.value || '').replace('x',''));
            const price = previewPrice();
            if (!(margin > 0 && leverage > 0 && price > 0)) return 0;
            return Number(normalizeQty((margin * leverage) / price)) || 0;
        }

        function setPreviewSide(side) {
            tradeRiskState.side = side === 'Sell' ? 'Sell' : 'Buy';
            window.__previewSide = tradeRiskState.side;
            const longBtn = document.getElementById('mobilePreviewLong');
            const shortBtn = document.getElementById('mobilePreviewShort');
            if (longBtn) longBtn.className = 'trade-quick ' + (tradeRiskState.side === 'Buy' ? 'border-bybit-green/50 text-bybit-green bg-bybit-green/10' : '');
            if (shortBtn) shortBtn.className = 'trade-quick ' + (tradeRiskState.side === 'Sell' ? 'border-bybit-red/50 text-bybit-red bg-bybit-red/10' : '');
            updateTradePreview();
        }

        function calculateLinkedRisk(price) {
            if (!(price > 0)) return { tp: 0, sl: 0 };
            if (tradeRiskState.rrRatio !== null && tradeRiskState.mode === 'rr') {
                const riskPct = Math.max(0.01, Number(tradeRiskState.rrRiskPct) || 0.5);
                const rewardPct = riskPct * Number(tradeRiskState.rrRatio);
                const risk = price * riskPct / 100;
                const reward = price * rewardPct / 100;
                return tradeRiskState.side === 'Buy'
                    ? { tp: price + reward, sl: price - risk }
                    : { tp: price - reward, sl: price + risk };
            }
            let tp = tradeRiskState.tpPrice || 0;
            let sl = tradeRiskState.slPrice || 0;
            if (tradeRiskState.mode === 'tp' && tradeRiskState.tpPct !== null) {
                const pct = Number(tradeRiskState.tpPct) / 100;
                tp = tradeRiskState.side === 'Buy' ? price * (1 + pct) : price * (1 - pct);
            }
            if (tradeRiskState.mode === 'sl' && tradeRiskState.slPct !== null) {
                const pct = Number(tradeRiskState.slPct) / 100;
                sl = tradeRiskState.side === 'Buy' ? price * (1 - pct) : price * (1 + pct);
            }
            return { tp, sl };
        }

        function updateLinkedRiskPrices() {
            // No dynamic TP/SL calculations while a live position is open.
            if (tradeState.position && Number(tradeState.position.size) > 0) return;
            const e = tradeEls('mobile');
            const price = previewPrice();
            if (!e.tp || !e.sl || !(price > 0) || tradeRiskState.mode === 'manual') return;

            const levels = calculateLinkedRisk(price);
            // Keep the calculation state independent from the DOM. The inputs are only a
            // rendering target; no later sync operation is allowed to turn dynamic levels
            // back into zero.
            tradeRiskState.entryPrice = price;
            if (!multiTpState.enabled) tradeRiskState.tpPrice = levels.tp > 0 ? Number(normalizePrice(levels.tp)) : 0;
            tradeRiskState.slPrice = levels.sl > 0 ? Number(normalizePrice(levels.sl)) : 0;

            tradeRiskState.internalUpdate = true;
            try {
                e.tp.value = tradeRiskState.tpPrice > 0 ? String(tradeRiskState.tpPrice) : '';
                e.sl.value = tradeRiskState.slPrice > 0 ? String(tradeRiskState.slPrice) : '';
                const d = tradeEls('desktop');
                if (d.tp) d.tp.value = e.tp.value;
                if (d.sl) d.sl.value = e.sl.value;
            } finally {
                tradeRiskState.internalUpdate = false;
            }

            const stateEl = document.getElementById('mobileRiskLinkState');
            if (stateEl) {
                const parts = [];
                if (tradeRiskState.mode === 'rr' && tradeRiskState.rrRatio !== null) parts.push(`RR 1:${Number(tradeRiskState.rrRatio).toFixed(2)} · риск ${Number(tradeRiskState.rrRiskPct).toFixed(2)}%`);
                else if (tradeRiskState.mode === 'tp' && tradeRiskState.tpPct !== null) parts.push(`TP ${Number(tradeRiskState.tpPct)}%`);
                else if (tradeRiskState.mode === 'sl' && tradeRiskState.slPct !== null) parts.push(`SL ${Number(tradeRiskState.slPct)}%`);
                else if (tradeRiskState.mode === 'sr') parts.push('AUTO S/R');
                stateEl.textContent = parts.length ? `Динамически: ${parts.join(' · ')}` : 'TP/SL вручную';
                stateEl.className = 'text-[8px] ml-1 truncate ' + (parts.length ? 'text-bybit-yellow' : 'text-bybit-muted');
            }
        }

        function renderDynamicRiskNow() {
            // Dedicated reactive path for realtime ticks. Do not depend on any chart redraw
            // or heavy analytics cycle.
            if (tradeState.position && Number(tradeState.position.size) > 0) return;
            if (tradeRiskState.mode === 'manual') return;
            updateLinkedRiskPrices();
            updateRiskRewardDisplay(
                previewPrice(),
                Number(tradeRiskState.tpPrice || 0),
                Number(tradeRiskState.slPrice || 0),
                previewQty(),
                tradeRiskState.side
            );
        }

        let dynamicRiskTimer = null;
        function ensureDynamicRiskTicker() {
            if (dynamicRiskTimer) return;
            dynamicRiskTimer = setInterval(() => {
                if (tradeRiskState.mode === 'manual') return;
                renderDynamicRiskNow();
            }, 250);
        }

        function updateRiskRewardDisplay(price, tp, sl, qty, side) {
            const el = document.getElementById('mobileRiskRR');
            if (!el) return;
            const p = Number(price), t = Number(tp), s = Number(sl), q = Number(qty);
            const validLong = side === 'Buy' && t > p && s > 0 && s < p;
            const validShort = side === 'Sell' && t > 0 && t < p && s > p;
            if (!(p > 0 && ((validLong) || (validShort)))) {
                el.textContent = 'RR —';
                el.className = 'text-[8px] text-bybit-muted font-black shrink-0';
                return;
            }
            const reward = side === 'Buy' ? (t - p) : (p - t);
            const risk = side === 'Buy' ? (p - s) : (s - p);
            const rr = reward / risk;
            const rewardPnl = q > 0 ? reward * q : 0;
            const riskPnl = q > 0 ? risk * q : 0;
            el.textContent = `RR 1:${rr.toFixed(2)}`;
            el.title = `Reward ${rewardPnl ? '+' + rewardPnl.toFixed(3) + ' USDT' : formatPrice(reward)} · Risk ${riskPnl ? riskPnl.toFixed(3) + ' USDT' : formatPrice(risk)}`;
            el.className = 'text-[8px] font-black shrink-0 ' + (rr >= 2 ? 'text-bybit-green' : rr >= 1.5 ? 'text-bybit-yellow' : 'text-bybit-red');
        }

        function setMultiTpUi(enabled) {
            multiTpState.enabled = Boolean(enabled);
            if (!enabled) multiTpState.beMoved = false;
            const wrap = document.getElementById('mobileMultiTpWrap');
            const btn = document.getElementById('mobileMultiTpToggle');
            const state = document.getElementById('mobileMultiTpState');
            wrap?.classList.toggle('hidden', !multiTpState.enabled);
            if (btn) btn.className = 'trade-quick border-bybit-green/30 ' + (multiTpState.enabled ? 'text-bybit-green bg-bybit-green/10' : '');
            if (state) state.textContent = multiTpState.enabled ? `3 TP · ${multiTpState.allocations.join('/')}` : '3 TP OFF';
            syncTradeChartLevels();
            updateTradePreview();
        }

        function setMultiTpLevels(levels) {
            const vals = levels.map(v => Number(v || 0));
            if (vals.some(v => !(v > 0))) return false;
            multiTpState.levels = vals;
            ['mobileTP1','mobileTP2','mobileTP3'].forEach((id,i) => { const el=document.getElementById(id); if(el) el.value=String(vals[i]); });
            setMultiTpUi(true);
            return true;
        }

        function autoMultiTp() {
            const price = previewPrice();
            if (!(price > 0) || !Array.isArray(latestSrZones)) { setTradeStatus('AUTO 3TP: уровни ещё не рассчитаны','muted'); return; }
            const tick = Number(tradeState.instrument?.priceFilter?.tickSize || 0);
            const buffer = Math.max(tick * 2, price * 0.00015);
            const inside = (level, dir) => {
                const raw = dir === 'down' ? Number(level) - buffer : Number(level) + buffer;
                if (!tick) return raw;
                const units = dir === 'down' ? Math.floor(raw/tick+1e-10) : Math.ceil(raw/tick-1e-10);
                return Number((units*tick).toFixed(12));
            };
            let levels=[];
            if (tradeRiskState.side === 'Buy') {
                const rs=latestSrZones.filter(z=>z.type==='resistance'&&Number(z.avgPrice)>price).sort((a,b)=>Number(a.avgPrice)-Number(b.avgPrice));
                levels=rs.slice(0,3).map(z=>inside(z.avgPrice,'down')).filter(v=>v>price);
            } else {
                const ss=latestSrZones.filter(z=>z.type==='support'&&Number(z.avgPrice)<price).sort((a,b)=>Number(b.avgPrice)-Number(a.avgPrice));
                levels=ss.slice(0,3).map(z=>inside(z.avgPrice,'up')).filter(v=>v<price);
            }
            const unique=[]; for(const v of levels){ if(!unique.length || Math.abs(v-unique[unique.length-1]) > Math.max(tick,price*1e-8)) unique.push(v); }
            if(unique.length<3){ setTradeStatus('AUTO 3TP: нужно минимум 3 уровня S/R','muted'); return; }
            setMultiTpLevels(unique.slice(0,3));
            const side=tradeRiskState.side;
            // Keep the existing S/R stop if present; otherwise calculate it from the nearest opposite zone.
            const currentSl = Number(tradeRiskState.slPrice || document.getElementById('mobileSL')?.value || 0);
            if (!(currentSl>0)) {
                const opp = side==='Buy' ? latestSrZones.filter(z=>z.type==='support'&&Number(z.avgPrice)<price).sort((a,b)=>Number(b.avgPrice)-Number(a.avgPrice))[0] : latestSrZones.filter(z=>z.type==='resistance'&&Number(z.avgPrice)>price).sort((a,b)=>Number(a.avgPrice)-Number(b.avgPrice))[0];
                if(opp){ const sl=side==='Buy'?inside(opp.avgPrice,'down'):inside(opp.avgPrice,'up'); tradeRiskState.mode='sr'; tradeRiskState.slPrice=sl; tradeRiskState.tpPrice=unique[0]; }
            }
            syncTradeChartLevels(); updateTradePreview();
            setTradeStatus(`AUTO 3TP: ${formatPrice(unique[0])} · ${formatPrice(unique[1])} · ${formatPrice(unique[2])}`,'muted');
        }

        async function waitForOpenPosition(attempts=4, delayMs=350) {
            for (let i=0; i<attempts; i++) {
                await refreshPosition();
                if (tradeState.position && Number(tradeState.position.size) > 0) return tradeState.position;
                await new Promise(r=>setTimeout(r, delayMs));
            }
            return tradeState.position;
        }

        async function applyMultiTpToPosition(pos = tradeState.position) {
            if (!tradeState.tradingEnabled || !pos || multiTpState.applying) return;
            const levels = multiTpState.levels.map(Number);
            if (levels.some(v => !(v > 0))) return setTradeStatus('3 TP: сначала задай уровни','error');
            const sl = Number(document.getElementById('mobileSL')?.value || tradeRiskState.slPrice || 0);
            multiTpState.applying=true;
            try {
                const r=await fetch('/api/multi-tp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:currentSymbol,positionIdx:Number(pos.positionIdx||0),levels,allocations:multiTpState.allocations,stopLoss:sl>0?normalizePrice(sl):''})});
                const j=await r.json(); if(!r.ok||!j.ok) throw new Error(j.error||'Ошибка Multi-TP');
                setTradeStatus(`3 TP установлены · ${multiTpState.allocations.join('/')}%`,'ok');
                await refreshPosition(); await refreshMobileOrders();
            } catch(err){ setTradeStatus(err.message,'error'); }
            finally{ multiTpState.applying=false; }
        }

        async function moveStopToBE() {
            if (!tradeState.tradingEnabled || !tradeState.position) return;
            try {
                const r=await fetch('/api/multi-tp-be',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:currentSymbol,positionIdx:Number(tradeState.position.positionIdx||0),bufferTicks:1})});
                const j=await r.json(); if(!r.ok||!j.ok) throw new Error(j.error||'Ошибка BE');
                multiTpState.beMoved=true; setTradeStatus(`BE AUTO: SL ${formatPrice(j.result.stopLoss)}`,'ok'); await refreshPosition();
            } catch(err){ setTradeStatus(err.message,'error'); }
        }

        function setAutoSRPreset() {
            const price = previewPrice();
            const side = tradeRiskState.side;
            if (!(price > 0) || !Array.isArray(latestSrZones) || !latestSrZones.length) {
                setTradeStatus('AUTO S/R: уровни ещё не рассчитаны', 'muted');
                return;
            }
            const resistances = latestSrZones.filter(z => z.type === 'resistance' && Number(z.avgPrice) > price).sort((a,b) => Number(a.avgPrice) - Number(b.avgPrice));
            const supports = latestSrZones.filter(z => z.type === 'support' && Number(z.avgPrice) < price).sort((a,b) => Number(b.avgPrice) - Number(a.avgPrice));
            if (!resistances.length || !supports.length) {
                setTradeStatus('AUTO S/R: недостаточно уровней вокруг цены', 'muted');
                return;
            }
            const resistance = Number(resistances[0].avgPrice);
            const support = Number(supports[0].avgPrice);
            const tick = Number(tradeState.instrument?.priceFilter?.tickSize || 0);
            // Scalping rule: TP must sit INSIDE the S/R level, never on or beyond it.
            // Use a small tick-aware offset so the order has room before the liquidity zone.
            const levelBuffer = Math.max(tick * 2, price * 0.00015);
            const normalizeInside = (value, direction) => {
                const raw = Number(normalizePrice(value));
                const step = tick > 0 ? tick : 0;
                if (!(raw > 0)) return 0;
                if (step > 0) {
                    const units = direction === 'down' ? Math.floor(raw / step + 1e-10) : Math.ceil(raw / step - 1e-10);
                    return Number((units * step).toFixed(12));
                }
                return raw;
            };
            let tp, sl;
            if (side === 'Buy') {
                // LONG: take profit before resistance; stop below support.
                tp = normalizeInside(resistance - levelBuffer, 'down');
                sl = normalizeInside(support - levelBuffer, 'down');
                // Guarantee at least one tick of clearance from resistance/current price.
                if (tick > 0) {
                    tp = Math.min(tp, normalizeInside(resistance - tick, 'down'));
                    tp = Math.max(tp, normalizeInside(price + tick, 'up'));
                }
            } else {
                // SHORT: take profit before support; stop above resistance.
                tp = normalizeInside(support + levelBuffer, 'up');
                sl = normalizeInside(resistance + levelBuffer, 'up');
                // Guarantee at least one tick of clearance from support/current price.
                if (tick > 0) {
                    tp = Math.max(tp, normalizeInside(support + tick, 'up'));
                    tp = Math.min(tp, normalizeInside(price - tick, 'down'));
                }
            }
            const valid = side === 'Buy'
                ? (tp > price && tp < resistance && sl < price && sl < support)
                : (tp < price && tp > support && sl > price && sl > resistance);
            if (!valid) {
                setTradeStatus('AUTO S/R: уровни слишком близко к текущей цене', 'muted');
                return;
            }
            tradeRiskState.mode = 'sr';
            tradeRiskState.rrRatio = null;
            tradeRiskState.tpPct = null;
            tradeRiskState.slPct = null;
            tradeRiskState.entryPrice = price;
            tradeRiskState.tpPrice = tp;
            tradeRiskState.slPrice = sl;
            ensureDynamicRiskTicker();
            renderDynamicRiskNow();
            updateTradePreview();
            setTradeStatus(`AUTO S/R: TP ${formatPrice(tp)} · SL ${formatPrice(sl)}`, 'muted');
        }

        function setRiskRewardPreset(ratio) {
            const price = previewPrice();
            const r = Number(ratio);
            if (!(price > 0 && r > 0)) return;
            const e = tradeEls('mobile');
            const oldTp = Number(e.tp?.value || 0);
            const oldSl = Number(e.sl?.value || 0);
            const side = tradeRiskState.side;
            const hasTp = side === 'Buy' ? oldTp > price : oldTp > 0 && oldTp < price;
            const hasSl = side === 'Buy' ? oldSl > 0 && oldSl < price : oldSl > price;
            if (hasSl) tradeRiskState.rrRiskPct = Math.abs(price - oldSl) / price * 100;
            else if (hasTp) tradeRiskState.rrRiskPct = (Math.abs(oldTp - price) / price * 100) / r;
            else tradeRiskState.rrRiskPct = 0.5;
            tradeRiskState.mode = 'rr';
            tradeRiskState.rrRatio = r;
            tradeRiskState.tpPct = null;
            tradeRiskState.slPct = null;
            ensureDynamicRiskTicker();
            renderDynamicRiskNow();
            updateTradePreview();
        }

        function updateTradePreview() {
            const e = tradeEls('mobile');
            if (!e.margin) return;
            // While a position is open, the position manager owns risk. Do not keep
            // recalculating the entry form's TP/SL preview in the background.
            if (tradeState.position && Number(tradeState.position.size) > 0) {
                updatePositionLive(livePrice || Number(tradeState.position.markPrice || 0));
                return;
            }
            if (tradeRiskState.mode !== 'manual') updateLinkedRiskPrices();
            const qty = previewQty();
            const price = previewPrice();
            const notional = qty * price;
            const tp = tradeRiskState.mode === 'manual' ? Number(e.tp?.value || 0) : Number(tradeRiskState.tpPrice || e.tp?.value || 0);
            const sl = tradeRiskState.mode === 'manual' ? Number(e.sl?.value || 0) : Number(tradeRiskState.slPrice || e.sl?.value || 0);
            const side = tradeRiskState.side;
            const tpPnl = qty && tp ? (side === 'Buy' ? (tp-price) : (price-tp)) * qty : 0;
            const slPnl = qty && sl ? (side === 'Buy' ? (sl-price) : (price-sl)) * qty : 0;
            const set = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
            set('mobilePreviewQty', qty ? String(qty) : '—');
            set('mobilePreviewNotional', notional ? `${formatVolumeUSD(notional)}` : '—');
            set('mobilePreviewTpPnl', tp ? `${tpPnl >= 0 ? '+' : ''}${tpPnl.toFixed(3)} USDT` : '—');
            set('mobilePreviewSlPnl', sl ? `${slPnl >= 0 ? '+' : ''}${slPnl.toFixed(3)} USDT` : '—');
            if (tradeState.position) { const m=document.getElementById('mobilePosMark'); if(m) m.textContent=formatPrice(livePrice || tradeState.position.markPrice || 0); }
            const tpEl=document.getElementById('mobilePreviewTpPnl'), slEl=document.getElementById('mobilePreviewSlPnl');
            if(tpEl) tpEl.className='v '+(tpPnl>=0?'text-bybit-green':'text-bybit-red');
            if(slEl) slEl.className='v '+(slPnl>=0?'text-bybit-green':'text-bybit-red');
            updateRiskRewardDisplay(price, tp, sl, qty, side);
            syncTradeChartLevels();
        }

        function fillRiskPreset(percent, field) {
            const price = previewPrice();
            if (!price) return;
            const pct = Math.abs(Number(percent));
            tradeRiskState.rrRatio = null;
            tradeRiskState.tpPct = field === 'tp' ? pct : null;
            tradeRiskState.slPct = field === 'sl' ? pct : null;
            tradeRiskState.mode = field === 'tp' ? 'tp' : 'sl';
            ensureDynamicRiskTicker();
            renderDynamicRiskNow();
            updateTradePreview();
        }

        function formatBalance(value) {
            const n = Number(value);
            if (!Number.isFinite(n)) return '—';
            if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(2) + 'M';
            if (Math.abs(n) >= 1000) return (n / 1000).toFixed(2) + 'K';
            if (Math.abs(n) >= 100) return n.toFixed(2);
            if (Math.abs(n) >= 1) return n.toFixed(2);
            return n.toFixed(4);
        }

        async function loadBalance() {
            try {
                const r = await fetch('/api/account', {cache:'no-store'});
                if (!r.ok) throw new Error('HTTP ' + r.status);
                const j = await r.json();
                const account = j.result?.list?.[0] || {};
                const usdt = (account.coin || []).find(c => String(c.coin || '').toUpperCase() === 'USDT');
                const equity = Number(account.totalEquity);
                const wallet = Number(account.totalWalletBalance);
                const coinWallet = Number(usdt?.walletBalance);
                const value = Number.isFinite(equity) && equity > 0 ? equity : (Number.isFinite(wallet) && wallet > 0 ? wallet : coinWallet);
                const text = Number.isFinite(value) ? `BAL ${formatBalance(value)} USDT` : 'BAL —';
                ['desktopBalance','mobileBalance'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = text;
                });
            } catch (err) {
                console.warn('Balance refresh failed:', err);
            }
        }

        async function loadTradeConfig() {
            multiTpState.beMoved = false;
            try {
                const [cfgRes, instRes] = await Promise.all([
                    fetch('/api/config', {cache:'no-store'}),
                    fetch(`/api/instrument?symbol=${encodeURIComponent(currentSymbol)}`, {cache:'no-store'})
                ]);
                const cfg = await cfgRes.json(); const inst = await instRes.json();
                tradeState.tradingEnabled = Boolean(cfg.tradingEnabled);
                tradeState.instrument = inst.result?.list?.[0] || null;
                const instrumentTickPrecision = getTickPricePrecision();
                if (instrumentTickPrecision > 0) pricePrecision = Math.max(pricePrecision, instrumentTickPrecision);
                if (candleSeries && instrumentTickPrecision > 0) {
                    candleSeries.applyOptions({
                        priceFormat: { type: 'custom', minMove: Number(tradeState.instrument?.priceFilter?.tickSize || 1 / Math.pow(10, pricePrecision)), formatter: (p) => formatPrice(p) }
                    });
                }
                const mode = tradeState.tradingEnabled ? 'LIVE ON' : 'LIVE OFF';
                ['desktop','mobile'].forEach(p => { const e=tradeEls(p); if(e.mode){e.mode.textContent=mode; e.mode.className='text-[9px] font-mono border rounded px-1.5 py-0.5 '+(tradeState.tradingEnabled?'text-bybit-green border-bybit-green/30':'text-bybit-muted border-bybit-border'); } });
                setTradeButtonsDisabled(!tradeState.tradingEnabled);
                if (!tradeState.tradingEnabled) setTradeStatus('Торговля отключена: TRADING_ENABLED=false', 'muted');
            } catch (err) { setTradeStatus('Ошибка торгового конфига: ' + err.message, 'error'); }
        }

        function setTradeButtonsDisabled(disabled) {
            ['desktop','mobile'].forEach(p => ['long','short'].forEach(k => { const e=tradeEls(p)[k]; if(e) e.disabled=disabled || tradeState.busy; }));
            ['desktop','mobile'].forEach(p => { const e=tradeEls(p).close; if(e) e.disabled=disabled || tradeState.busy || !(tradeState.position && Number(tradeState.position.size) > 0); });
        }

        async function refreshPosition() {
            // One initial/safety REST read only. Live updates come from Bybit private WS.
            try {
                const r = await fetch(`/api/position?symbol=${encodeURIComponent(currentSymbol)}`, {cache:'no-store'});
                const j = await r.json();
                const list = j.result?.list || [];
                const pos = list.find(x => Number(x.size) > 0) || null;
                renderPosition(pos);
            } catch (err) {
                console.warn('Initial position refresh failed:', err);
            }
        }

        async function connectPrivateWebSocket() {
            if (privateWsReconnectTimer) { clearTimeout(privateWsReconnectTimer); privateWsReconnectTimer = null; }
            if (privateWsPingTimer) { clearInterval(privateWsPingTimer); privateWsPingTimer = null; }
            if (privateWs) { try { privateWs.close(); } catch(e) {} }
            privateWs = null;
            privateWsConnected = false;

            try {
                const r = await fetch('/api/ws-auth', {cache:'no-store'});
                const auth = await r.json();
                if (!r.ok || !auth.ok) throw new Error(auth.error || 'Private WS auth failed');
                privateWsToken = auth;
                privateWs = new WebSocket(auth.url);

                privateWs.onopen = () => {
                    privateWs.send(JSON.stringify({op:'auth', args:[auth.apiKey, auth.expires, auth.signature]}));
                    privateWsPingTimer = setInterval(() => {
                        if (privateWs && privateWs.readyState === WebSocket.OPEN) privateWs.send(JSON.stringify({op:'ping'}));
                    }, 15000);
                };

                privateWs.onmessage = (event) => {
                    let msg; try { msg = JSON.parse(event.data); } catch { return; }
                    if (msg.op === 'auth' && (msg.success === true || msg.retCode === 0)) {
                        privateWsConnected = true;
                        privateWs.send(JSON.stringify({op:'subscribe', args:['position.linear','order.linear','execution.linear']}));
                        return;
                    }
                    if (msg.topic === 'position.linear' && Array.isArray(msg.data)) {
                        const rows = msg.data.filter(x => String(x.symbol || '').toUpperCase() === currentSymbol.toUpperCase());
                        const pos = rows.find(x => Number(x.size) > 0) || null;
                        renderPosition(pos);
                        return;
                    }
                    if (msg.topic === 'execution.linear' || msg.topic === 'order.linear') {
                        const rows = Array.isArray(msg.data) ? msg.data : [];
                        const relevant = rows.filter(x => String(x.symbol || '').toUpperCase() === currentSymbol.toUpperCase());
                        if (relevant.some(x => String(x.orderLinkId || '').startsWith('MTP_1_') && (String(x.orderStatus || '') === 'Filled' || String(x.execType || '') === 'Trade'))) {
                            if (multiTpState.beAuto && !multiTpState.beMoved) moveStopToBE();
                        }
                        if (relevant.length) {
                            refreshPosition();
                            if (!document.getElementById('mobileOrdersView')?.classList.contains('hidden')) refreshMobileOrders();
                        }
                    }
                };

                privateWs.onerror = () => { privateWsConnected = false; };
                privateWs.onclose = () => {
                    privateWsConnected = false;
                    if (privateWsPingTimer) { clearInterval(privateWsPingTimer); privateWsPingTimer = null; }
                    privateWs = null;
                    privateWsReconnectTimer = setTimeout(() => connectPrivateWebSocket(), 3000);
                };
            } catch (err) {
                privateWsConnected = false;
                privateWsReconnectTimer = setTimeout(() => connectPrivateWebSocket(), 5000);
                console.warn('Private WS unavailable:', err);
            }
        }

        async function partialClosePosition(percent) {
            if (!tradeState.tradingEnabled || tradeState.positionBusy || !tradeState.position) return;
            const pct = Number(percent);
            if (!pct) return;
            if (!confirm(`Закрыть ${pct}% позиции ${currentSymbol}?`)) return;
            tradeState.positionBusy = true;
            try {
                const r = await fetch('/api/close-partial', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({symbol:currentSymbol, positionIdx:Number(tradeState.position.positionIdx||0), percent:pct})});
                const j = await r.json();
                if (!r.ok || !j.ok) throw new Error(j.error || 'Ошибка частичного закрытия');
                setTradeStatus(`Закрытие ${pct}% отправлено`, 'ok');
                await new Promise(resolve=>setTimeout(resolve,400));
                await refreshPosition();
            } catch (err) { setTradeStatus(err.message, 'error'); }
            finally { tradeState.positionBusy = false; }
        }

        async function applyPositionRisk() {
            if (!tradeState.tradingEnabled || tradeState.positionBusy || !tradeState.position) return;
            const tp = document.getElementById('mobilePosTPInput')?.value || '';
            const sl = document.getElementById('mobilePosSLInput')?.value || '';
            if (!tp && !sl) return setTradeStatus('Укажи TP или SL', 'error');
            tradeState.positionBusy = true;
            try {
                const currentTp = Number(tradeState.position.takeProfit || 0) ? normalizePrice(tradeState.position.takeProfit) : undefined;
                const currentSl = Number(tradeState.position.stopLoss || 0) ? normalizePrice(tradeState.position.stopLoss) : undefined;
                const body = {symbol:currentSymbol, positionIdx:Number(tradeState.position.positionIdx||0), takeProfit:tp ? normalizePrice(tp) : currentTp, stopLoss:sl ? normalizePrice(sl) : currentSl, tpTriggerBy:'MarkPrice', slTriggerBy:'MarkPrice'};
                const r=await fetch('/api/trading-stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
                const j=await r.json(); if(!r.ok||!j.ok) throw new Error(j.error||'Ошибка TP/SL');
                setTradeStatus('TP/SL позиции обновлены','ok');
                await new Promise(resolve=>setTimeout(resolve,300)); await refreshPosition();
            } catch(err){setTradeStatus(err.message,'error');}
            finally{tradeState.positionBusy=false;}
        }

        async function clearPositionRisk() {
            if (!tradeState.tradingEnabled || tradeState.positionBusy || !tradeState.position) return;
            tradeState.positionBusy = true;
            try {
                const r=await fetch('/api/trading-stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:currentSymbol, positionIdx:Number(tradeState.position.positionIdx||0), takeProfit:'0', stopLoss:'0'})});
                const j=await r.json(); if(!r.ok||!j.ok) throw new Error(j.error||'Ошибка сброса TP/SL');
                setTradeStatus('TP/SL сброшены','ok'); await refreshPosition();
            } catch(err){setTradeStatus(err.message,'error');}
            finally{tradeState.positionBusy=false;}
        }

        async function setPositionTrailing(percent) {
            if (!tradeState.tradingEnabled || tradeState.positionBusy || !tradeState.position) return;
            const mark=Number(tradeState.position.markPrice || livePrice || 0);
            const pct=Number(percent);
            if (!(mark>0 && pct>0)) return;
            tradeState.positionBusy=true;
            try {
                const distance=normalizePrice(mark*pct/100);
                const r=await fetch('/api/trading-stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:currentSymbol,positionIdx:Number(tradeState.position.positionIdx||0),trailingStop:distance})});
                const j=await r.json(); if(!r.ok||!j.ok) throw new Error(j.error||'Ошибка trailing stop');
                setTradeStatus(`Trailing stop ${pct}% установлен`,'ok'); await refreshPosition();
            } catch(err){setTradeStatus(err.message,'error');}
            finally{tradeState.positionBusy=false;}
        }

        async function clearPositionTrailing() {
            if (!tradeState.tradingEnabled || tradeState.positionBusy || !tradeState.position) return;
            tradeState.positionBusy=true;
            try {
                const r=await fetch('/api/trading-stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:currentSymbol,positionIdx:Number(tradeState.position.positionIdx||0),trailingStop:'0'})});
                const j=await r.json(); if(!r.ok||!j.ok) throw new Error(j.error||'Ошибка отключения trailing');
                setTradeStatus('Trailing stop отключён','ok'); await refreshPosition();
            } catch(err){setTradeStatus(err.message,'error');}
            finally{tradeState.positionBusy=false;}
        }

        async function executeTrade(side) {
            if (!tradeState.tradingEnabled || tradeState.busy) return;
            const e = tradeEls('mobile');
            syncTradeInputs('mobile');
            const margin = Number(e.margin.value);
            const leverage = Number(String(e.leverage.value).replace('x',''));
            const orderType = e.orderType.value;
            const price = orderType === 'Limit' ? Number(e.limitPrice.value) : Number(livePrice || 0);
            if (!margin || margin <= 0 || !leverage || leverage <= 0 || !price) return setTradeStatus('Проверь маржу, плечо и цену', 'error');
            const qty = normalizeQty((margin * leverage) / price);
            if (!qty) return setTradeStatus('Размер ниже минимального или не соответствует шагу qty', 'error');
            if (orderType === 'Limit' && !Number(e.limitPrice.value)) return setTradeStatus('Для Limit нужна цена', 'error');
            const multiActive = multiTpState.enabled && multiTpState.levels.every(v => Number(v) > 0);
            const tp = multiActive ? '' : (e.tp.value ? normalizePrice(e.tp.value) : '');
            const sl = e.sl.value ? normalizePrice(e.sl.value) : '';
            tradeState.busy = true; setTradeButtonsDisabled(true); setTradeStatus(`Отправляю ${side === 'Buy' ? 'LONG' : 'SHORT'} ${qty} ${currentSymbol}...`);
            try {
                await fetch('/api/leverage', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({symbol:currentSymbol, leverage})}).then(async r=>{const j=await r.json(); if(!r.ok||!j.ok) throw new Error(j.error||'Ошибка плеча');});
                const body = { symbol: currentSymbol, side, orderType, qty };
                if (orderType === 'Limit') { body.price = normalizePrice(e.limitPrice.value); body.timeInForce = 'GTC'; }
                // Attach single-level TP/SL directly to the entry order. This removes the
                // dangerous gap between a Market fill and a second REST call that creates protection.
                // Bybit supports Limit TP/SL for linear futures only with tpslMode=Partial.
                if (!multiActive && (tp || sl)) {
                    body.tpslMode = 'Partial';
                    body.tpTriggerBy = 'MarkPrice';
                    body.slTriggerBy = 'MarkPrice';
                    if (tp) { body.takeProfit = tp; body.tpOrderType = 'Limit'; body.tpLimitPrice = tp; }
                    if (sl) { body.stopLoss = sl; body.slOrderType = 'Limit'; body.slLimitPrice = sl; }
                }
                const r = await fetch('/api/order', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
                const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || 'Ошибка открытия ордера');
                setTradeStatus(`Ордер принят: ${j.result?.orderId || 'OK'}`, 'ok');
                await new Promise(resolve=>setTimeout(resolve,700));
                await refreshPosition();
                if (multiActive) {
                    const pr = await waitForOpenPosition(4, 300);
                    if (pr) await applyMultiTpToPosition(pr);
                    else if (orderType === 'Limit') setTradeStatus('Limit принят. После открытия нажми 3 TP → APPLY.', 'ok');
                    else setTradeStatus('Ордер принят, позиция ещё не появилась.', 'error');
                } else if (tp || sl) {
                    setTradeStatus(orderType === 'Limit'
                        ? 'Limit принят · TP/SL Limit привязан к ордеру'
                        : 'Позиция открыта · TP/SL Limit уже защищает позицию', 'ok');
                }
            } catch(err) { setTradeStatus(err.message, 'error'); }
            finally { tradeState.busy=false; setTradeButtonsDisabled(!tradeState.tradingEnabled); await refreshPosition(); }
        }

        async function closeTrade() {
            if (!tradeState.tradingEnabled || tradeState.busy) return;
            if (!tradeState.position) return setTradeStatus('Открытой позиции нет');
            if (!confirm(`Закрыть ${currentSymbol} ${tradeState.position.side === 'Buy' ? 'LONG' : 'SHORT'}?`)) return;
            tradeState.busy=true; setTradeButtonsDisabled(true); setTradeStatus('Закрываю позицию...');
            try {
                const r=await fetch('/api/close-position',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:currentSymbol,positionIdx:Number(tradeState.position.positionIdx||0)})});
                const j=await r.json(); if(!r.ok||!j.ok) throw new Error(j.error||'Ошибка закрытия');
                setTradeStatus('Команда на закрытие отправлена', 'ok'); await new Promise(resolve=>setTimeout(resolve,500)); await refreshPosition();
            } catch(err){setTradeStatus(err.message,'error');}
            finally{tradeState.busy=false;setTradeButtonsDisabled(!tradeState.tradingEnabled);}
        }

        function orderTypeLabel(o) {
            const t = String(o.orderType || '').toUpperCase();
            if (t.includes('LIMIT')) return 'LIMIT';
            if (t.includes('MARKET')) return 'MARKET';
            return t || 'ORDER';
        }
        function orderStatusClass(o) {
            const st = String(o.orderStatus || o.stopOrderType || '').toLowerCase();
            if (st.includes('filled')) return 'text-bybit-green';
            if (st.includes('cancel')) return 'text-bybit-muted';
            return o.side === 'Buy' ? 'text-bybit-green' : 'text-bybit-red';
        }
        function renderMobileOrders(rows) {
            const list = document.getElementById('mobileOrdersList');
            if (!list) return;
            if (!rows.length) { list.innerHTML = '<div class="mobile-order-empty">Нет активных ордеров</div>'; return; }
            list.innerHTML = rows.map(o => {
                const side = o.side === 'Buy' ? 'LONG' : 'SHORT';
                const price = Number(o.price || 0) ? formatPrice(o.price) : (o.triggerPrice ? formatPrice(o.triggerPrice) : '—');
                const qty = o.qty || '—';
                const kind = o.stopOrderType ? String(o.stopOrderType) : orderTypeLabel(o);
                const status = o.orderStatus || 'New';
                return `<div class="mobile-order-row"><div class="mobile-order-main"><div class="mobile-order-title"><span class="${o.side==='Buy'?'text-bybit-green':'text-bybit-red'}">${side}</span><span class="text-white">${kind}</span><span class="${orderStatusClass(o)}">${status}</span></div><div class="mobile-order-meta">${qty} · ${price}${o.triggerDirection ? ` · trigger ${o.triggerDirection}` : ''}</div></div><button class="mobile-order-cancel" data-cancel-order="${o.orderId || ''}">CANCEL</button></div>`;
            }).join('');
            list.querySelectorAll('[data-cancel-order]').forEach(btn => btn.addEventListener('click', () => cancelMobileOrder(btn.dataset.cancelOrder)));
        }
        function renderMobileOrderHistory(rows) {
            const list = document.getElementById('mobileOrderHistoryList');
            if (!list) return;
            if (!rows.length) { list.innerHTML = '<div class="mobile-order-empty">История пуста</div>'; return; }
            list.innerHTML = rows.slice(0,8).map(o => {
                const side = o.side === 'Buy' ? 'L' : 'S';
                const status = o.orderStatus || '—';
                const price = Number(o.avgPrice || o.price || 0) ? formatPrice(o.avgPrice || o.price) : '—';
                return `<div class="mobile-order-row"><div class="mobile-order-main"><div class="mobile-order-title"><span class="${o.side==='Buy'?'text-bybit-green':'text-bybit-red'}">${side}</span><span class="text-white">${orderTypeLabel(o)}</span><span class="${orderStatusClass(o)}">${status}</span></div><div class="mobile-order-meta">${o.qty || '—'} · ${price}</div></div><div class="text-[9px] text-bybit-muted font-mono">${o.reduceOnly ? 'REDUCE' : ''}</div></div>`;
            }).join('');
        }
        async function refreshMobileOrders() {
            try {
                const [a,b] = await Promise.all([
                    fetch(`/api/orders?symbol=${encodeURIComponent(currentSymbol)}`, {cache:'no-store'}),
                    fetch(`/api/order-history?symbol=${encodeURIComponent(currentSymbol)}`, {cache:'no-store'})
                ]);
                const aj = await a.json(), bj = await b.json();
                if (!a.ok || !aj.ok) throw new Error(aj.error || 'Ошибка активных ордеров');
                renderMobileOrders(aj.result?.list || []);
                renderMobileOrderHistory(bj.result?.list || []);
            } catch (err) {
                const list=document.getElementById('mobileOrdersList'); if(list) list.innerHTML=`<div class="mobile-order-empty">Ошибка: ${err.message}</div>`;
            }
        }
        async function cancelMobileOrder(orderId) {
            if (!orderId || !confirm('Отменить этот ордер?')) return;
            try {
                const r=await fetch('/api/cancel-order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:currentSymbol,orderId})});
                const j=await r.json(); if(!r.ok||!j.ok) throw new Error(j.error||'Ошибка отмены');
                setTradeStatus('Ордер отменён','ok'); await new Promise(resolve=>setTimeout(resolve,250)); await refreshMobileOrders();
            } catch(err){ setTradeStatus(err.message,'error'); }
        }
        async function cancelAllMobileOrders() {
            if (!confirm(`Отменить все активные ордера ${currentSymbol}?`)) return;
            try {
                const r=await fetch('/api/cancel-all',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:currentSymbol})});
                const j=await r.json(); if(!r.ok||!j.ok) throw new Error(j.error||'Ошибка Cancel All');
                setTradeStatus('Все активные ордера отменены','ok'); await new Promise(resolve=>setTimeout(resolve,250)); await refreshMobileOrders();
            } catch(err){ setTradeStatus(err.message,'error'); }
        }
        function openMobileTool(view) {
            const drawer=document.getElementById('mobileToolDrawer'); if(!drawer) return;
            const pos=document.getElementById('mobilePositionView'), ord=document.getElementById('mobileOrdersView');
            const pt=document.getElementById('mobileToolPositionTab'), ot=document.getElementById('mobileToolOrdersTab');
            const isPos=view==='position';
            drawer.classList.remove('hidden'); pos?.classList.toggle('hidden',!isPos); ord?.classList.toggle('hidden',isPos);
            pt?.classList.toggle('active',isPos); ot?.classList.toggle('active',!isPos);
            if (!isPos) refreshMobileOrders();
            if (isPos) { refreshPosition(); refreshPositionHistory(); }
            requestAnimationFrame(()=>resizeAllCharts());
        }
        function closeMobileTool() { const d=document.getElementById('mobileToolDrawer'); if(d) d.classList.add('hidden'); requestAnimationFrame(()=>resizeAllCharts()); }

        function bindTradingUI() {
            document.getElementById('positionClosedModal')?.addEventListener('click', e => { if (e.target.id === 'positionClosedModal') e.currentTarget.classList.add('hidden'); });
            document.getElementById('closedModalHistoryBtn')?.addEventListener('click', () => { document.getElementById('positionClosedModal')?.classList.add('hidden'); openMobileTool('position'); });
            document.getElementById('mobileRefreshPositionHistory')?.addEventListener('click', refreshPositionHistory);
            document.getElementById('mobilePositionHistoryToggle')?.addEventListener('click', () => {
                const list = document.getElementById('mobilePositionHistoryList');
                const chevron = document.getElementById('mobilePositionHistoryChevron');
                if (!list) return;
                const open = list.classList.toggle('hidden') === false;
                if (chevron) chevron.textContent = open ? '▾' : '▸';
                if (open) refreshPositionHistory();
            });
            const d=tradeEls('desktop'), m=tradeEls('mobile');
            [d,m].forEach((e,i)=>{
                if(!e.margin) return;
                e.orderType.addEventListener('change',()=>{updateLimitVisibility(); syncTradeInputs(i===0?'desktop':'mobile');});
                [e.margin,e.leverage,e.limitPrice].forEach(x=>x?.addEventListener('input',()=>syncTradeInputs(i===0?'desktop':'mobile')));
                e.tp?.addEventListener('input',()=>{
                    if (!tradeRiskState.internalUpdate && i === 1) {
                        tradeRiskState.mode = 'manual';
                        tradeRiskState.tpPct = null; tradeRiskState.slPct = null; tradeRiskState.rrRatio = null;
                        tradeRiskState.tpPrice = Number(e.tp.value || 0);
                        tradeRiskState.entryPrice = previewPrice();
                    }
                    syncTradeInputs(i===0?'desktop':'mobile');
                });
                e.sl?.addEventListener('input',()=>{
                    if (!tradeRiskState.internalUpdate && i === 1) {
                        tradeRiskState.mode = 'manual';
                        tradeRiskState.tpPct = null; tradeRiskState.slPct = null; tradeRiskState.rrRatio = null;
                        tradeRiskState.slPrice = Number(e.sl.value || 0);
                        tradeRiskState.entryPrice = previewPrice();
                    }
                    syncTradeInputs(i===0?'desktop':'mobile');
                });
                e.long.addEventListener('click',()=>{ setPreviewSide('Buy'); updateTradePreview(); executeTrade('Buy'); });
                e.short.addEventListener('click',()=>{ setPreviewSide('Sell'); updateTradePreview(); executeTrade('Sell'); });
                e.close.addEventListener('click',closeTrade);
            });

            document.querySelectorAll('[data-margin-preset]').forEach(btn=>btn.addEventListener('click',()=>{
                m.margin.value=btn.dataset.marginPreset; syncTradeInputs('mobile');
            }));
            document.querySelectorAll('[data-leverage-preset]').forEach(btn=>btn.addEventListener('click',()=>{
                m.leverage.value=btn.dataset.leveragePreset+'x'; syncTradeInputs('mobile');
            }));
            document.querySelectorAll('[data-risk]').forEach(btn=>btn.addEventListener('click',()=>{
                const v=Number(btn.dataset.risk);
                fillRiskPreset(v, v >= 0 ? 'tp' : 'sl');
            }));
            document.querySelectorAll('[data-rr]').forEach(btn=>btn.addEventListener('click',()=>setRiskRewardPreset(Number(btn.dataset.rr))));
            document.getElementById('mobileAutoSR')?.addEventListener('click', setAutoSRPreset);
            document.getElementById('mobilePreviewLong')?.addEventListener('click',()=>setPreviewSide('Buy'));
            document.getElementById('mobilePreviewShort')?.addEventListener('click',()=>setPreviewSide('Sell'));
            document.getElementById('mobileMultiTpToggle')?.addEventListener('click',()=>setMultiTpUi(!multiTpState.enabled));
            document.getElementById('mobileAuto3Tp')?.addEventListener('click',autoMultiTp);
            document.getElementById('mobileApplyMultiTp')?.addEventListener('click',()=>applyMultiTpToPosition());
            document.getElementById('mobileAutoBE')?.addEventListener('click',()=>{ multiTpState.beAuto=!multiTpState.beAuto; const b=document.getElementById('mobileAutoBE'); if(b) b.className='trade-quick '+(multiTpState.beAuto?'text-bybit-green bg-bybit-green/10':''); if(multiTpState.beAuto) setTradeStatus('BE AUTO включён: после TP1 → Entry','muted'); });
            ['mobileTP1','mobileTP2','mobileTP3'].forEach((id,i)=>document.getElementById(id)?.addEventListener('input',()=>{ multiTpState.levels[i]=Number(document.getElementById(id).value||0); syncTradeChartLevels(); }));

            document.getElementById('mobilePositionTabBtn')?.addEventListener('click',()=>openMobileTool('position'));
            document.getElementById('mobileOrdersTabBtn')?.addEventListener('click',()=>openMobileTool('orders'));
            document.getElementById('mobileToolPositionTab')?.addEventListener('click',()=>openMobileTool('position'));
            document.getElementById('mobileToolOrdersTab')?.addEventListener('click',()=>openMobileTool('orders'));
            document.getElementById('mobileToolClose')?.addEventListener('click',closeMobileTool);
            document.getElementById('mobileCancelAllOrders')?.addEventListener('click',cancelAllMobileOrders);
            document.querySelectorAll('[data-partial-close]').forEach(btn => btn.addEventListener('click', () => partialClosePosition(Number(btn.dataset.partialClose))));
            document.getElementById('mobileApplyPositionRisk')?.addEventListener('click', applyPositionRisk);
            document.getElementById('mobileCancelPositionRisk')?.addEventListener('click', clearPositionRisk);
            ['mobilePosTPInput','mobilePosSLInput'].forEach(id => document.getElementById(id)?.addEventListener('input', syncTradeChartLevels));
            document.getElementById('mobileTrailingPreset')?.addEventListener('click', () => setPositionTrailing(0.5));
            document.getElementById('mobileCancelTrailing')?.addEventListener('click', clearPositionTrailing);

            const mobileTradeDock = document.getElementById('mobileTradeDock');
            const mobileTradeToggleBtn = document.getElementById('mobileTradeToggleBtn');
            const savedCollapsed = localStorage.getItem('terminal.mobileTradeCollapsed') !== '0';
            const setMobileTradeCollapsed = (collapsed) => {
                if (!mobileTradeDock) return;
                mobileTradeDock.classList.toggle('collapsed', collapsed);
                document.body.classList.toggle('mobile-trade-collapsed', collapsed);
                localStorage.setItem('terminal.mobileTradeCollapsed', collapsed ? '1' : '0');
                requestAnimationFrame(() => resizeAllCharts());
            };
            if (mobileTradeToggleBtn) mobileTradeToggleBtn.addEventListener('click', () => setMobileTradeCollapsed(!mobileTradeDock.classList.contains('collapsed')));
            if (window.innerWidth < 768) setMobileTradeCollapsed(savedCollapsed);

            updateLimitVisibility(); loadTradeConfig(); loadBalance(); refreshPosition(); setPreviewSide('Buy'); ensureDynamicRiskTicker(); renderDynamicRiskNow(); updateTradePreview();
            connectPrivateWebSocket();
            setInterval(fetchLongShortRatio, 15000);
            setInterval(fetchBybitTickers, 30000);
            setInterval(loadTradeConfig, 300000);
            setInterval(loadBalance, 30000);
        }

        function setupOrderbookAutoRefresh() {
            if (orderbookPollTimer) clearInterval(orderbookPollTimer);
            // Market depth is now pushed through the Bybit public WebSocket.
            // Keep a lightweight REST fallback every 15s in case the socket is delayed.
            orderbookPollTimer = setInterval(async () => {
                if (!marketWs || marketWs.readyState !== WebSocket.OPEN) {
                    await fetchOrderBookWalls();
                    drawOrderBookWalls();
                    renderOrderbookWallsPanel();
                }
            }, 30000);
        }

        async function fetchData() {
            const symbolAtLoad = currentSymbol;
            const intervalAtLoad = currentInterval;
            try {
                const icon = document.getElementById('refreshIcon');

                // The instrument metadata (tickSize/qtyStep) is symbol-specific.
                // Without refreshing it on a symbol switch, a low-priced shitcoin could
                // inherit BTC/ETH precision and normalize 0.18... to something like 0.2.
                // That was the reason dynamic TP/SL looked broken on some coins.
                if (String(tradeState.instrument?.symbol || '').toUpperCase() !== symbolAtLoad.toUpperCase()) {
                    await loadTradeConfig();
                }
                if (icon) icon.classList.add('animate-spin');

                if (orderbookPollTimer) clearInterval(orderbookPollTimer);
                clearAllSeriesAndLines();

                // IMPORTANT: market realtime must not wait for the heavy candle/overlay REST load.
                // Start the public WS immediately, so price and dynamic TP/SL can move even if
                // the initial REST request is slow on a mobile network.
                connectWebSocket();

                // Get the current ticker in parallel with candles. This gives the trading panel
                // a fresh price as early as possible instead of waiting for 200 candles.
                fetchFreshTicker(symbolAtLoad);

                const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbolAtLoad}&interval=${intervalAtLoad}&limit=200`;
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 8000);
                let response;
                try {
                    response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
                } finally {
                    clearTimeout(timeout);
                }
                const json = await response.json();

                if (json.retCode !== 0 || !json.result.list) {
                    throw new Error('Failed to fetch candles from Bybit REST API');
                }

                const list = json.result.list.reverse();

                rawCandles = list.map(item => ({
                    time: Math.floor(parseInt(item[0], 10) / 1000),
                    open: parseFloat(item[1]),
                    high: parseFloat(item[2]),
                    low: parseFloat(item[3]),
                    close: parseFloat(item[4]),
                    volume: parseFloat(item[5])
                }));

                if (rawCandles.length > 0) {
                    const lastCandle = rawCandles[rawCandles.length - 1];
                    const firstCandle = rawCandles[0];
                    const change = ((lastCandle.close - firstCandle.close) / firstCandle.close) * 100;

                    pricePrecision = Math.max(getPrecisionForPrice(lastCandle.close), getTickPricePrecision());
                    const tickSize = Number(tradeState?.instrument?.priceFilter?.tickSize || 0);
                    const minMoveVal = tickSize > 0 ? tickSize : 1 / Math.pow(10, pricePrecision);

                    candleSeries.applyOptions({
                        priceFormat: {
                            type: 'custom',
                            minMove: minMoveVal,
                            formatter: (p) => formatPrice(p)
                        }
                    });

                    // Candle history is a baseline only. If the realtime ticker already
                    // arrived, keep that fresher price instead of rolling the UI backwards.
                    if (!(livePrice > 0)) livePrice = lastCandle.close;
                    const displayPrice = livePrice > 0 ? livePrice : lastCandle.close;
                    document.getElementById('lastPrice').innerText = formatPrice(displayPrice);
                    updateTradePreview();
                    
                    const changeStr = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
                    const changeEl = document.getElementById('priceChange');
                    changeEl.innerText = changeStr;
                    changeEl.className = `font-mono font-bold ${change >= 0 ? 'text-bybit-green' : 'text-bybit-red'}`;

                    const headerChangeEl = document.getElementById('headerSymbolChange');
                    if (headerChangeEl) {
                        headerChangeEl.innerText = changeStr;
                        headerChangeEl.className = `text-[9px] font-mono font-bold ${change >= 0 ? 'text-bybit-green' : 'text-bybit-red'}`;
                    }

                    updateOHLCTooltip(lastCandle);
                }

                candleSeries.setData(rawCandles);
                setVolumeData(rawCandles);

                // Do not squeeze all 200 candles into a phone screen. Bybit-style view
                // keeps a useful recent window with readable candle bodies.
                requestAnimationFrame(() => {
                    try {
                        const visibleBars = window.innerWidth < 768 ? 52 : 110;
                        const from = Math.max(0, rawCandles.length - visibleBars);
                        chart.timeScale().setVisibleLogicalRange({
                            from,
                            to: rawCandles.length + 2
                        });
                    } catch (e) {
                        try { chart.timeScale().fitContent(); } catch (_) {}
                    }
                });

                await fetchOrderBookWalls();
                fetchLongShortRatio();
                RT.overlayDirty = false;
                RT.indicatorDirty = false;
                updateOverlays();
                renderScalpScore();
                updateIndicators();

                chart.priceScale('right').applyOptions({ autoScale: true });
                syncAllChartRanges();
                updateIndicatorVisibility();

                // WS was started at the beginning of fetchData. Keep private WS here because
                // it is authenticated and independent from public market data.
                connectPrivateWebSocket();
                setupOrderbookAutoRefresh();

            } catch (err) {
                console.error("Error fetching candle data:", err);
            } finally {
                const icon = document.getElementById('refreshIcon');
                if (icon) setTimeout(() => icon.classList.remove('animate-spin'), 400);
            }
        }

        async function fetchFreshTicker(symbol) {
            const sym = String(symbol || currentSymbol).toUpperCase();
            if (!sym) return;
            const direct = `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${encodeURIComponent(sym)}`;
            const render = `/api/market-ticker?symbol=${encodeURIComponent(sym)}`;
            const get = async (url) => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 2500);
                try {
                    const r = await fetch(url, { cache: 'no-store', signal: controller.signal });
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    const j = await r.json();
                    const t = j?.result?.list?.[0] || j?.result?.result?.list?.[0] || j?.result?.list?.[0];
                    const price = Number(t?.lastPrice || t?.markPrice || t?.indexPrice);
                    const pct = t?.price24hPcnt !== undefined ? Number(t.price24hPcnt) * 100 : null;
                    if (!(price > 0)) throw new Error('ticker price missing');
                    return { price, pct };
                } finally { clearTimeout(timer); }
            };
            // Direct phone -> Bybit first; Render is a fast fallback if direct REST is blocked.
            for (const url of [direct, render]) {
                if (sym !== currentSymbol) return;
                try {
                    const t = await get(url);
                    if (sym !== currentSymbol) return;
                    updateLivePrice(t.price, t.pct);
                    return;
                } catch (e) {
                    console.debug('Fresh ticker attempt failed:', e?.message || e);
                }
            }
        }

        async function fetchLongShortRatio() {
            try {
                const url = `https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${currentSymbol}&period=1h&limit=1`;
                const res = await fetch(url);
                const json = await res.json();

                if (json.retCode === 0 && json.result && json.result.list && json.result.list.length > 0) {
                    const item = json.result.list[0];
                    const buyRatio = parseFloat(item.buyRatio || 0.5);
                    const sellRatio = parseFloat(item.sellRatio || 0.5);
                    dominanceData.longShortRatio = (buyRatio / (sellRatio || 1)).toFixed(2);
                    updateDominanceUI();
                }
            } catch (e) {
                console.warn("Could not fetch long/short account ratio:", e);
            }
        }

        function processLiveOrderbook(force = false) {
            const now = performance.now();
            if (!force && now - RT.lastOrderbookPaint < RT.orderbookMs) {
                RT.pendingOrderbook = true;
                scheduleRealtimePaint();
                return;
            }
            RT.lastOrderbookPaint = now;
            RT.pendingOrderbook = false;
            const bids = [...liveOrderbook.bids.entries()].map(([price, size]) => [price, size]).filter(x => x[1] > 0);
            const asks = [...liveOrderbook.asks.entries()].map(([price, size]) => [price, size]).filter(x => x[1] > 0);
            if (!bids.length && !asks.length) return;

            const currentPrice = livePrice || (rawCandles.length ? rawCandles[rawCandles.length - 1].close : 0);
            if (!currentPrice) return;

            let totalBidsUSD = 0;
            let totalAsksUSD = 0;
            bids.forEach(b => { totalBidsUSD += Number(b[0]) * Number(b[1]); });
            asks.forEach(a => { totalAsksUSD += Number(a[0]) * Number(a[1]); });
            computeDominanceRatio(totalBidsUSD, totalAsksUSD);

            const MIN_WALL_USD = 15000;
            const processOrders = (orders, type) => {
                const items = orders.map(o => {
                    const price = Number(o[0]);
                    const size = Number(o[1]);
                    return { price, size, usdValue: price * size, type };
                }).filter(x => x.usdValue >= MIN_WALL_USD);
                const threshold = currentPrice * 0.003;
                const clusters = [];
                items.forEach(item => {
                    let found = false;
                    for (const c of clusters) {
                        if (Math.abs(c.price - item.price) <= threshold) {
                            c.usdValue += item.usdValue;
                            c.size += item.size;
                            found = true;
                            break;
                        }
                    }
                    if (!found) clusters.push({ ...item });
                });
                clusters.sort((a,b) => b.usdValue - a.usdValue);
                return clusters.slice(0,3);
            };
            detectedWalls = [...processOrders(asks, 'sell'), ...processOrders(bids, 'buy')].sort((a,b)=>b.usdValue-a.usdValue).slice(0,6);
            RT.pendingWallsDraw = true;
            if (force || now - (RT.lastWallsDraw || 0) >= RT.wallDrawMs) {
                RT.pendingWallsDraw = false;
                RT.lastWallsDraw = now;
                drawOrderBookWalls();
                renderOrderbookWallsPanel();
            }
        }

        async function fetchOrderBookWalls() {
            try {
                const url = `https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${currentSymbol}&limit=200`;
                const res = await fetch(url, { cache: 'no-store' });
                const json = await res.json();
                if (json.retCode === 0 && json.result) {
                    liveOrderbook.bids.clear();
                    liveOrderbook.asks.clear();
                    (json.result.b || []).forEach(x => liveOrderbook.bids.set(Number(x[0]), Number(x[1])));
                    (json.result.a || []).forEach(x => liveOrderbook.asks.set(Number(x[0]), Number(x[1])));
                    processLiveOrderbook();
                }
            } catch (e) {
                console.error('Failed to fetch orderbook:', e);
            }
        }

        function computeDominanceRatio(bidsUSD, asksUSD) {
            dominanceData.bidsUSD = bidsUSD;
            dominanceData.asksUSD = asksUSD;

            const total = bidsUSD + asksUSD;
            if (total === 0) return;

            const buyPct = (bidsUSD / total) * 100;
            const sellPct = (asksUSD / total) * 100;

            dominanceData.buyPct = buyPct.toFixed(1);
            dominanceData.sellPct = sellPct.toFixed(1);

            if (bidsUSD >= asksUSD) {
                const ratio = (bidsUSD / (asksUSD || 1)).toFixed(1);
                dominanceData.ratio = `${ratio}x`;
                dominanceData.dominant = 'buy';
                dominanceData.labelText = `🟢 ${ratio}x Покупатели`;
            } else {
                const ratio = (asksUSD / (bidsUSD || 1)).toFixed(1);
                dominanceData.ratio = `${ratio}x`;
                dominanceData.dominant = 'sell';
                dominanceData.labelText = `🔴 ${ratio}x Продавцы`;
            }

            updateDominanceUI();
        }

        function updateDominanceUI() {
            const isBuy = dominanceData.dominant === 'buy';

            const badgeDot = document.getElementById('domBadgeDot');
            const badgeText = document.getElementById('domBadgeText');

            if (badgeDot && badgeText) {
                badgeDot.className = `w-2 h-2 rounded-full animate-pulse ${isBuy ? 'bg-bybit-green' : 'bg-bybit-red'}`;
                badgeText.className = `text-xs font-bold ${isBuy ? 'text-bybit-green' : 'text-bybit-red'}`;
                badgeText.innerText = dominanceData.labelText;
            }

            const ratioBadge = document.getElementById('domRatioBadge');
            const bigCard = document.getElementById('domBigCard');
            const buyPctText = document.getElementById('domBuyPctText');
            const sellPctText = document.getElementById('domSellPctText');
            const buyBar = document.getElementById('domBuyBar');
            const sellBar = document.getElementById('domSellBar');

            const bidsUSD = document.getElementById('domBidsUSD');
            const asksUSD = document.getElementById('domAsksUSD');
            const longShort = document.getElementById('domLongShortRatio');
            const summaryNote = document.getElementById('domSummaryNote');

            if (ratioBadge) {
                ratioBadge.innerText = dominanceData.labelText;
                ratioBadge.className = `text-xs px-2 py-0.5 rounded-full font-bold font-mono border ${isBuy ? 'bg-bybit-green/10 text-bybit-green border-bybit-green/30' : 'bg-bybit-red/10 text-bybit-red border-bybit-red/30'}`;
            }

            if (bigCard) {
                bigCard.className = `p-3 rounded-xl bg-bybit-bg border space-y-2 mb-3 ${isBuy ? 'border-bybit-green/30' : 'border-bybit-red/30'}`;
            }

            if (buyPctText) buyPctText.innerText = `${dominanceData.buyPct}% Buy`;
            if (sellPctText) sellPctText.innerText = `${dominanceData.sellPct}% Sell`;

            if (buyBar) buyBar.style.width = `${dominanceData.buyPct}%`;
            if (sellBar) sellBar.style.width = `${dominanceData.sellPct}%`;

            if (bidsUSD) bidsUSD.innerText = formatVolumeUSD(dominanceData.bidsUSD);
            if (asksUSD) asksUSD.innerText = formatVolumeUSD(dominanceData.asksUSD);
            if (longShort) longShort.innerText = dominanceData.longShortRatio;

            if (summaryNote) {
                if (isBuy) {
                    summaryNote.className = "mt-2.5 p-2 rounded-lg bg-bybit-green/10 border border-bybit-green/20 text-[10px] text-bybit-green leading-tight";
                    summaryNote.innerText = `🟢 Покупатели контролируют ${dominanceData.buyPct}% ликвидности в стакане (${dominanceData.ratio}). Преобладание объемов на покупку.`;
                } else {
                    summaryNote.className = "mt-2.5 p-2 rounded-lg bg-bybit-red/10 border border-bybit-red/20 text-[10px] text-bybit-red leading-tight";
                    summaryNote.innerText = `🔴 Продавцы контролируют ${dominanceData.sellPct}% ликвидности в стакане (${dominanceData.ratio}). Давление со стороны продаж.`;
                }
            }

            const sideDomRatio = document.getElementById('sideDomRatio');
            const sideDomBuyBar = document.getElementById('sideDomBuyBar');
            const sideDomSellBar = document.getElementById('sideDomSellBar');

            if (sideDomRatio) {
                sideDomRatio.innerText = dominanceData.labelText;
                sideDomRatio.className = `font-bold ${isBuy ? 'text-bybit-green' : 'text-bybit-red'}`;
            }
            if (sideDomBuyBar) sideDomBuyBar.style.width = `${dominanceData.buyPct}%`;
            if (sideDomSellBar) sideDomSellBar.style.width = `${dominanceData.sellPct}%`;

            const mobileDomRatio = document.getElementById('mobileDomRatio');
            const mobileDomBuyBar = document.getElementById('mobileDomBuyBar');
            const mobileDomSellBar = document.getElementById('mobileDomSellBar');

            if (mobileDomRatio) {
                mobileDomRatio.innerText = dominanceData.labelText;
                mobileDomRatio.className = `font-bold ${isBuy ? 'text-bybit-green' : 'text-bybit-red'}`;
            }
            if (mobileDomBuyBar) mobileDomBuyBar.style.width = `${dominanceData.buyPct}%`;
            if (mobileDomSellBar) mobileDomSellBar.style.width = `${dominanceData.sellPct}%`;

            const tradeBuyBar = document.getElementById('mobileTradeBuyBar');
            const tradeSellBar = document.getElementById('mobileTradeSellBar');
            const tradeStrength = document.getElementById('mobileTradeStrengthValue');
            if (tradeBuyBar) tradeBuyBar.style.width = `${dominanceData.buyPct}%`;
            if (tradeSellBar) tradeSellBar.style.width = `${dominanceData.sellPct}%`;
            if (tradeStrength) {
                tradeStrength.innerText = dominanceData.labelText;
                tradeStrength.className = `mobile-strength-value ${isBuy ? 'text-bybit-green' : 'text-bybit-red'}`;
            }
        }

        function drawOrderBookWalls() {
            const overlay = document.getElementById('orderbookWallBandOverlay');
            const visible = !!settings.showOrderbook && Array.isArray(detectedWalls) && detectedWalls.length > 0;

            // Keep chart price-line objects alive between paints. Recreating them on every
            // order-book packet caused visible micro-jitter on mobile even when CPU load was low.
            if (!visible) {
                orderbookPriceLines.forEach(line => { try { candleSeries.removePriceLine(line); } catch(e){} });
                orderbookPriceLines = [];
                if (overlay) overlay.innerHTML = '';
                return;
            }

            const needed = detectedWalls.slice(0, 6);
            const oldLines = orderbookPriceLines.slice();
            const nextLines = [];
            const nextKeys = new Set();

            needed.forEach(wall => {
                const isBuy = wall.type === 'buy';
                const usd = Number(wall.usdValue) || 0;
                const key = `${isBuy ? 'B' : 'S'}:${Number(wall.price).toFixed(12)}`;
                nextKeys.add(key);
                let entry = oldLines.find(x => x.__wallKey === key);
                if (!entry) {
                    try {
                        entry = candleSeries.createPriceLine({
                            price: Number(wall.price),
                            color: isBuy ? 'rgba(14,203,129,.40)' : 'rgba(246,70,93,.40)',
                            lineWidth: 1,
                            lineStyle: LightweightCharts.LineStyle.Solid,
                            axisLabelVisible: false,
                            title: ''
                        });
                        entry.__wallKey = key;
                    } catch (e) { entry = null; }
                } else {
                    try {
                        entry.applyOptions({
                            price: Number(wall.price),
                            color: isBuy ? 'rgba(14,203,129,.40)' : 'rgba(246,70,93,.40)'
                        });
                    } catch (e) {}
                }
                if (entry) nextLines.push(entry);
            });

            oldLines.forEach(line => {
                if (!line || nextLines.includes(line)) return;
                try { candleSeries.removePriceLine(line); } catch(e){}
            });
            orderbookPriceLines = nextLines;

            if (!overlay || !candleSeries?.priceToCoordinate) return;
            // One small DOM rebuild per second is intentional; it is far cheaper than
            // rebuilding bands on every 300–500 ms order-book update.
            overlay.innerHTML = '';
            const fragment = document.createDocumentFragment();
            needed.forEach(wall => {
                const isBuy = wall.type === 'buy';
                const usd = Number(wall.usdValue) || 0;
                const strength = Math.min(1, Math.max(0, (usd - 15000) / 10000));
                const y = candleSeries.priceToCoordinate(Number(wall.price));
                if (y == null || !Number.isFinite(y)) return;
                const band = document.createElement('div');
                band.className = 'wall-band';
                band.style.top = `${y}px`;
                band.style.height = `${8 + Math.round(strength * 10)}px`;
                const alpha = (0.07 + strength * 0.15).toFixed(2);
                const rgb = isBuy ? '14,203,129' : '246,70,93';
                band.style.background = `rgba(${rgb},${alpha})`;
                band.style.borderColor = `rgba(${rgb},${(0.16 + strength * 0.24).toFixed(2)})`;
                band.title = `${isBuy ? 'BW' : 'SW'} ${formatVolumeUSD(usd)}`;
                fragment.appendChild(band);
            });
            overlay.appendChild(fragment);
        }

        function renderOrderbookWallsPanel() {
            const containerDesktop = document.getElementById('orderbookWallsList');
            const containerMobile = document.getElementById('mobileOrderbookWallsList');

            if (!detectedWalls || detectedWalls.length === 0) {
                const emptyHtml = `<div class="text-bybit-muted italic text-center py-1">Плотности не обнаружены</div>`;
                if (containerDesktop) containerDesktop.innerHTML = emptyHtml;
                if (containerMobile) containerMobile.innerHTML = emptyHtml;
                return;
            }

            const currentPrice = rawCandles.length > 0 ? rawCandles[rawCandles.length - 1].close : 0;
            const maxUsd = Math.max(...detectedWalls.map(w => w.usdValue));

            const html = detectedWalls.map(w => {
                const isBuy = w.type === 'buy';
                const distPct = currentPrice ? (((w.price - currentPrice) / currentPrice) * 100).toFixed(2) : 0;
                const fillPct = Math.min(100, Math.max(10, (w.usdValue / maxUsd) * 100));

                return `
                    <div class="p-2 rounded-lg bg-bybit-bg border border-bybit-border space-y-1 relative overflow-hidden">
                        <div class="absolute left-0 top-0 bottom-0 ${isBuy ? 'bg-bybit-green/10' : 'bg-bybit-red/10'} pointer-events-none" style="width: ${fillPct}%;"></div>
                        <div class="flex items-center justify-between relative z-10">
                            <div class="flex items-center space-x-1.5">
                                <span class="w-2 h-2 rounded-full ${isBuy ? 'bg-bybit-green' : 'bg-bybit-red'}"></span>
                                <span class="font-bold text-white">$${formatPrice(w.price)}</span>
                            </div>
                            <span class="font-bold text-xs ${isBuy ? 'text-bybit-green' : 'text-bybit-red'}">${formatVolumeUSD(w.usdValue)}</span>
                        </div>
                        <div class="flex items-center justify-between text-[10px] text-bybit-muted relative z-10 font-mono">
                            <span>${isBuy ? 'BW (Плотность Покупки)' : 'SW (Плотность Продажи)'}</span>
                            <span class="${parseFloat(distPct) >= 0 ? 'text-bybit-green' : 'text-bybit-red'}">${distPct >= 0 ? '+' : ''}${distPct}%</span>
                        </div>
                    </div>
                `;
            }).join('');

            if (containerDesktop) containerDesktop.innerHTML = html;
            if (containerMobile) containerMobile.innerHTML = html;
        }

        function scheduleRealtimePaint() {
            if (RT.raf) return;
            RT.raf = requestAnimationFrame(() => {
                RT.raf = 0;
                const now = performance.now();
                if (now - RT.lastPricePaint >= RT.priceMs && (RT.pendingPrice || RT.pendingKline)) {
                    if (RT.pendingPrice) {
                        updateLivePrice(RT.pendingPrice, RT.pendingPct);
                        RT.pendingPrice = 0;
                        RT.pendingPct = null;
                    }
                    const k = RT.pendingKline;
                    RT.pendingKline = null;
                    RT.lastPricePaint = now;
                    if (k) {
                        candleSeries?.update(k);
                        volumeSeries?.update({ time:k.time, value:k.volume, color:k.close >= k.open ? 'rgba(14,203,129,.55)' : 'rgba(246,70,93,.55)' });
                        updateOHLCTooltip(k);
                    }
                }
                if (RT.pendingOrderbook && now - RT.lastOrderbookPaint >= RT.orderbookMs) {
                    processLiveOrderbook(true);
                }
                if (RT.pendingWallsDraw && now - (RT.lastWallsDraw || 0) >= RT.wallDrawMs) {
                    RT.pendingWallsDraw = false;
                    RT.lastWallsDraw = now;
                    drawOrderBookWalls();
                    renderOrderbookWallsPanel();
                }
                if (rawCandles.length && RT.overlayDirty && now - RT.lastOverlaysPaint >= RT.overlaysMs) {
                    RT.lastOverlaysPaint = now;
                    RT.overlayDirty = false;
                    updateOverlays();
                    renderScalpScore();
                }
                if (rawCandles.length && RT.indicatorDirty && now - RT.lastIndicatorsPaint >= RT.indicatorsMs) {
                    RT.lastIndicatorsPaint = now;
                    RT.indicatorDirty = false;
                    updateIndicators();
                }
                if (RT.pendingPrice || RT.pendingKline || RT.pendingOrderbook || RT.pendingWallsDraw || (rawCandles.length && ((RT.overlayDirty && now-RT.lastOverlaysPaint >= RT.overlaysMs) || (RT.indicatorDirty && now-RT.lastIndicatorsPaint >= RT.indicatorsMs)))) {
                    scheduleRealtimePaint();
                }
            });
        }

        function updateLivePriceThrottled(price, changePct = null, force = false) {
            const n = Number(price);
            if (!Number.isFinite(n) || n <= 0) return;
            RT.pendingPrice = n;
            if (changePct !== null && Number.isFinite(Number(changePct))) RT.pendingPct = Number(changePct);
            const now = performance.now();
            if (force || now - RT.lastPricePaint >= RT.priceMs) {
                updateLivePrice(RT.pendingPrice, RT.pendingPct);
                RT.pendingPrice = 0;
                RT.pendingPct = null;
                RT.lastPricePaint = now;
            }
            scheduleRealtimePaint();
        }

        function updateLivePrice(price, changePct = null) {
            if (!Number.isFinite(price) || price <= 0) return;
            livePrice = price;
            updatePositionLive(price);
            document.getElementById('lastPrice').innerText = formatPrice(price);
            renderDynamicRiskNow();
            updateTradePreview();
            if (changePct !== null && Number.isFinite(changePct)) {
                live24hChange = changePct;
                const changeStr = `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`;
                const changeEl = document.getElementById('priceChange');
                if (changeEl) {
                    changeEl.innerText = changeStr;
                    changeEl.className = `font-mono font-bold ${changePct >= 0 ? 'text-bybit-green' : 'text-bybit-red'}`;
                }
                const headerChangeEl = document.getElementById('headerSymbolChange');
                if (headerChangeEl) {
                    headerChangeEl.innerText = changeStr;
                    headerChangeEl.className = `text-[9px] font-mono font-bold ${changePct >= 0 ? 'text-bybit-green' : 'text-bybit-red'}`;
                }
            }
        }

        function applyOrderbookSnapshot(data) {
            liveOrderbook.bids.clear();
            liveOrderbook.asks.clear();
            (data?.b || []).forEach(x => liveOrderbook.bids.set(Number(x[0]), Number(x[1])));
            (data?.a || []).forEach(x => liveOrderbook.asks.set(Number(x[0]), Number(x[1])));
            processLiveOrderbook();
        }

        function applyOrderbookDelta(data) {
            const apply = (map, rows) => {
                (rows || []).forEach(x => {
                    const price = Number(x[0]);
                    const size = Number(x[1]);
                    if (!price) return;
                    if (size === 0) map.delete(price);
                    else map.set(price, size);
                });
            };
            apply(liveOrderbook.bids, data?.b);
            apply(liveOrderbook.asks, data?.a);
            // Keep memory bounded even if the exchange sends a lot of levels.
            if (liveOrderbook.bids.size > 250) liveOrderbook.bids = new Map([...liveOrderbook.bids.entries()].sort((a,b)=>b[0]-a[0]).slice(0,200));
            if (liveOrderbook.asks.size > 250) liveOrderbook.asks = new Map([...liveOrderbook.asks.entries()].sort((a,b)=>a[0]-b[0]).slice(0,200));
            processLiveOrderbook();
        }

        let wsMode = 'DIRECT';
        let wsAttempt = 0;
        let wsFallbackTimer = null;
        let wsReconnectTimer = null;

        function setWsStatus(mode, text, state='muted') {
            const dot = document.getElementById('wsStatusDot');
            const label = document.getElementById('wsStatusText');
            if (!dot || !label) return;
            const cls = state === 'live' ? 'bg-bybit-green' : state === 'error' ? 'bg-bybit-red' : 'bg-bybit-muted';
            dot.className = `w-2 h-2 rounded-full ${cls}${state === 'connecting' ? ' animate-ping' : ''}`;
            label.innerText = `WS: ${text}`;
        }

        function clearMarketWsTimers() {
            if (marketWsReconnectTimer) { clearTimeout(marketWsReconnectTimer); marketWsReconnectTimer = null; }
            if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
            if (wsFallbackTimer) { clearTimeout(wsFallbackTimer); wsFallbackTimer = null; }
            if (marketWsPingInterval) { clearInterval(marketWsPingInterval); marketWsPingInterval = null; }
            if (marketWsWatchdogTimer) { clearInterval(marketWsWatchdogTimer); marketWsWatchdogTimer = null; }
        }

        function closeMarketWs() {
            clearMarketWsTimers();
            if (marketWs) {
                marketWs.__intentionalClose = true;
                try { marketWs.close(); } catch(e) {}
                marketWs = null;
            }
        }

        function connectWebSocket(forceMode = 'auto') {
            clearMarketWsTimers();
            if (marketWs) {
                marketWs.__intentionalClose = true;
                try { marketWs.close(); } catch(e) {}
                marketWs = null;
            }

            const activeSymbolAtConnect = currentSymbol;
            const activeIntervalAtConnect = currentInterval;
            liveOrderbook = { bids: new Map(), asks: new Map() };
            wsMode = forceMode === 'proxy' ? 'PROXY' : 'DIRECT';
            wsAttempt += 1;
            const attempt = wsAttempt;
            lastMarketTickAt = 0;
            marketWsOpenedAt = 0;
            setWsStatus(wsMode, 'ПОДКЛЮЧЕНИЕ', 'connecting');

            let url;
            if (wsMode === 'PROXY') {
                const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
                url = `${protocol}//${location.host}/ws/market?symbol=${encodeURIComponent(activeSymbolAtConnect)}&interval=${encodeURIComponent(activeIntervalAtConnect)}`;
            } else {
                url = 'wss://stream.bybit.com/v5/public/linear';
            }

            let opened = false;
            try { marketWs = new WebSocket(url); } catch (e) {
                handleWsFailure(e);
                return;
            }

            function handleWsFailure(error) {
                console.warn('Market WS failed:', error?.message || error);
                if (attempt !== wsAttempt || activeSymbolAtConnect !== currentSymbol || activeIntervalAtConnect !== currentInterval) return;
                if (wsMode === 'DIRECT') {
                    setWsStatus('PROXY', 'PROXY', 'connecting');
                    wsFallbackTimer = setTimeout(() => connectWebSocket('proxy'), 250);
                } else {
                    setWsStatus('PROXY', 'ОШИБКА', 'error');
                    wsReconnectTimer = setTimeout(() => connectWebSocket('proxy'), Math.min(10000, 2000 + wsAttempt * 500));
                }
            }

            marketWs.onopen = () => {
                opened = true;
                if (attempt !== wsAttempt) return;
                setWsStatus(wsMode, wsMode === 'DIRECT' ? 'DIRECT' : 'PROXY', 'live');
                if (wsMode === 'DIRECT') {
                    marketWs.send(JSON.stringify({
                        op: 'subscribe',
                        args: [
                            `kline.${activeIntervalAtConnect}.${activeSymbolAtConnect}`,
                            `tickers.${activeSymbolAtConnect}`,
                            `orderbook.50.${activeSymbolAtConnect}`
                        ]
                    }));
                }
                marketWsPingInterval = setInterval(() => {
                    if (marketWs && marketWs.readyState === WebSocket.OPEN) marketWs.send(JSON.stringify({op:'ping'}));
                }, 15000);

                // A socket can report OPEN while the subscription is effectively dead.
                // Do not let that half-open state freeze the price for minutes: require a
                // real market tick shortly after connect and recover automatically.
                marketWsWatchdogTimer = setInterval(() => {
                    if (attempt !== wsAttempt || activeSymbolAtConnect !== currentSymbol || activeIntervalAtConnect !== currentInterval) return;
                    if (!marketWs || marketWs.readyState !== WebSocket.OPEN) return;
                    const now = Date.now();
                    const age = lastMarketTickAt ? now - lastMarketTickAt : now - marketWsOpenedAt;
                    const staleLimit = wsMode === 'DIRECT' ? 4500 : 6000;
                    if (age > staleLimit) {
                        console.warn('Market WS watchdog: stale stream, recovering', wsMode, age);
                        try { marketWs.__intentionalClose = true; marketWs.close(); } catch(e) {}
                        if (wsMode === 'DIRECT') connectWebSocket('proxy');
                        else connectWebSocket('proxy');
                        return;
                    }
                    // REST is only a recovery path while realtime is unhealthy. It keeps the
                    // trading panel/RR alive even during a socket reconnect.
                    if (age > 2500) fetchFreshTicker(activeSymbolAtConnect).catch(() => {});
                }, 1000);
            };

            // Direct WS gets a short grace period. If the network blocks it, switch to Render proxy.
            if (wsMode === 'DIRECT') {
                wsFallbackTimer = setTimeout(() => {
                    if (!opened && attempt === wsAttempt) {
                        try { marketWs.__intentionalClose = true; marketWs.close(); } catch(e) {}
                        connectWebSocket('proxy');
                    }
                }, 4500);
            }

            marketWs.onmessage = (event) => {
                let msg;
                try { msg = JSON.parse(event.data); } catch { return; }
                if (msg.type === 'proxy_status') return;
                if (!msg.topic || !msg.data) return;
                if (!msg.topic.includes(activeSymbolAtConnect)) return;

                if (msg.topic.startsWith('tickers.')) {
                    lastMarketTickAt = Date.now();
                    const t = Array.isArray(msg.data) ? msg.data[0] : msg.data;
                    const price = Number(t?.lastPrice || t?.markPrice || t?.indexPrice);
                    const pct = t?.price24hPcnt !== undefined ? Number(t.price24hPcnt) * 100 : null;
                    if (price) {
                        updateLivePriceThrottled(price, pct);
                        if (rawCandles.length) {
                            const lc = rawCandles[rawCandles.length-1];
                            const liveCandle = {...lc, close: price, high: Math.max(lc.high, price), low: Math.min(lc.low, price)};
                            rawCandles[rawCandles.length-1] = liveCandle;
                            RT.overlayDirty = true;
                            RT.indicatorDirty = true;
                            RT.pendingKline = liveCandle;
                            scheduleRealtimePaint();
                        }
                    }
                    return;
                }

                if (msg.topic.startsWith('orderbook.')) {
                    if (msg.type === 'snapshot') applyOrderbookSnapshot(msg.data);
                    else applyOrderbookDelta(msg.data);
                    return;
                }

                if (msg.topic.startsWith('kline.')) {
                    lastMarketTickAt = Date.now();
                    const k = Array.isArray(msg.data) ? msg.data[0] : null;
                    if (!k) return;
                    const liveCandle = {
                        time: Number(k.start) / 1000,
                        open: Number(k.open), high: Number(k.high), low: Number(k.low),
                        close: Number(k.close), volume: Number(k.volume)
                    };
                    if (rawCandles.length > 0) {
                        const lastIndex = rawCandles.length - 1;
                        if (rawCandles[lastIndex].time === liveCandle.time) rawCandles[lastIndex] = liveCandle;
                        else rawCandles.push(liveCandle);
                        RT.overlayDirty = true;
                        RT.indicatorDirty = true;
                    }
                    RT.pendingKline = liveCandle;
                    updateLivePriceThrottled(liveCandle.close, null, true);
                    scheduleRealtimePaint();
                }
            };

            marketWs.onerror = (e) => handleWsFailure(e);
            marketWs.onclose = () => {
                if (attempt !== wsAttempt) return;
                clearMarketWsTimers();
                if (activeSymbolAtConnect !== currentSymbol || activeIntervalAtConnect !== currentInterval) return;
                if (wsMode === 'DIRECT') {
                    setWsStatus('PROXY', 'PROXY', 'connecting');
                    wsReconnectTimer = setTimeout(() => connectWebSocket('proxy'), 250);
                } else {
                    setWsStatus('PROXY', 'ПЕРЕПОДКЛЮЧЕНИЕ', 'connecting');
                    wsReconnectTimer = setTimeout(() => connectWebSocket('proxy'), 3000);
                }
            };
        }

        function updateOverlays() {
            if (!rawCandles || rawCandles.length === 0) return;

            if (settings.showEMA) {
                ema20Series.setData(calculateEMA(rawCandles, 20));
                ema50Series.setData(calculateEMA(rawCandles, 50));
                ema200Series.setData(calculateEMA(rawCandles, 200));
            } else {
                ema20Series.setData([]);
                ema50Series.setData([]);
                ema200Series.setData([]);
            }

            srPriceLines.forEach(line => {
                try { candleSeries.removePriceLine(line); } catch(e){}
            });
            srPriceLines = [];

            let srZones = [];
            if (settings.showSR) {
                srZones = findSupportResistance(rawCandles);
                drawSRLines(srZones);
            }
            latestSrZones = srZones.slice();
            renderSRPanel(srZones);

            let markers = [];
            let patternsList = [];

            if (settings.showPatterns) {
                const analysis = detectAdvancedPatterns(rawCandles, srZones);
                markers = analysis.markers;
                patternsList = analysis.patterns;
            }

            if (candleMarkers) candleMarkers.setMarkers(markers);
            renderPatternPanel(patternsList);

            updateIndicators();
        }

        function setVolumeData(candles) {
            volumeSeries.setData(candles.map(c => ({
                time: c.time,
                value: c.volume,
                color: c.close >= c.open
                    ? 'rgba(14, 203, 129, 0.55)'
                    : 'rgba(246, 70, 93, 0.55)'
            })));
        }

        function calculateRSI(candles, period = 14) {
            if (!candles || candles.length <= period) return [];

            const result = [];
            let gains = 0;
            let losses = 0;

            for (let i = 1; i <= period; i++) {
                const change = candles[i].close - candles[i - 1].close;
                if (change >= 0) gains += change;
                else losses -= change;
            }

            let avgGain = gains / period;
            let avgLoss = losses / period;

            const firstRs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
            const firstRsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + firstRs));
            result.push({ time: candles[period].time, value: firstRsi });

            for (let i = period + 1; i < candles.length; i++) {
                const change = candles[i].close - candles[i - 1].close;
                const gain = Math.max(change, 0);
                const loss = Math.max(-change, 0);

                avgGain = ((avgGain * (period - 1)) + gain) / period;
                avgLoss = ((avgLoss * (period - 1)) + loss) / period;

                const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
                const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));
                result.push({ time: candles[i].time, value: rsi });
            }

            return result;
        }

        function calculateEMAValues(candles, period) {
            if (!candles || candles.length < period) return [];

            const result = [];
            const k = 2 / (period + 1);
            let ema = candles.slice(0, period).reduce((sum, c) => sum + c.close, 0) / period;

            result.push({ time: candles[period - 1].time, value: ema });

            for (let i = period; i < candles.length; i++) {
                ema = candles[i].close * k + ema * (1 - k);
                result.push({ time: candles[i].time, value: ema });
            }

            return result;
        }

        function calculateMACD(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
            if (!candles || candles.length < slowPeriod + signalPeriod) {
                return { macd: [], signal: [], histogram: [] };
            }

            const fast = calculateEMAValues(candles, fastPeriod);
            const slow = calculateEMAValues(candles, slowPeriod);

            const slowMap = new Map(slow.map(x => [x.time, x.value]));
            const macd = [];

            fast.forEach(item => {
                const slowValue = slowMap.get(item.time);
                if (slowValue !== undefined) {
                    macd.push({
                        time: item.time,
                        value: item.value - slowValue
                    });
                }
            });

            if (macd.length < signalPeriod) {
                return { macd, signal: [], histogram: [] };
            }

            const signal = [];
            const k = 2 / (signalPeriod + 1);
            let signalValue = macd.slice(0, signalPeriod)
                .reduce((sum, item) => sum + item.value, 0) / signalPeriod;

            signal.push({
                time: macd[signalPeriod - 1].time,
                value: signalValue
            });

            for (let i = signalPeriod; i < macd.length; i++) {
                signalValue = macd[i].value * k + signalValue * (1 - k);
                signal.push({
                    time: macd[i].time,
                    value: signalValue
                });
            }

            const signalMap = new Map(signal.map(x => [x.time, x.value]));
            const histogram = macd
                .filter(item => signalMap.has(item.time))
                .map(item => ({
                    time: item.time,
                    value: item.value - signalMap.get(item.time),
                    color: item.value - signalMap.get(item.time) >= 0
                        ? 'rgba(14, 203, 129, 0.65)'
                        : 'rgba(246, 70, 93, 0.65)'
                }));

            return { macd, signal, histogram };
        }

        function updateIndicators() {
            if (!rawCandles || rawCandles.length === 0) return;

            const rsi = calculateRSI(rawCandles, 14);
            rsiSeries.setData(rsi);

            if (rsi.length) {
                const times = rsi.map(x => x.time);
                rsi70Series.setData(times.map(time => ({ time, value: 70 })));
                rsi50Series.setData(times.map(time => ({ time, value: 50 })));
                rsi30Series.setData(times.map(time => ({ time, value: 30 })));
            } else {
                rsi70Series.setData([]);
                rsi50Series.setData([]);
                rsi30Series.setData([]);
            }

            const macd = calculateMACD(rawCandles, 12, 26, 9);
            macdLineSeries.setData(macd.macd);
            macdSignalSeries.setData(macd.signal);
            macdHistogramSeries.setData(macd.histogram);

            rsiChart.priceScale('right').applyOptions({
                autoScale: false,
                minValue: 0,
                maxValue: 100
            });
        }

        function clampNumber(v, min, max) { return Math.max(min, Math.min(max, v)); }

        function calculateScalpScore(candles) {
            if (!candles || candles.length < 35) return null;
            const n = candles.length;
            const last = candles[n - 1];
            const prev = candles[n - 2];
            const c5 = candles[Math.max(0, n - 6)];
            const c10 = candles[Math.max(0, n - 11)];

            const emaFast = calculateEMA(candles, 7);
            const emaSlow = calculateEMA(candles, 25);
            const emaFastLast = emaFast.length ? emaFast[emaFast.length - 1].value : last.close;
            const emaSlowLast = emaSlow.length ? emaSlow[emaSlow.length - 1].value : last.close;
            const emaFastPrev = emaFast.length > 2 ? emaFast[emaFast.length - 3].value : emaFastLast;
            const emaSlowPrev = emaSlow.length > 2 ? emaSlow[emaSlow.length - 3].value : emaSlowLast;

            let score = 50;
            const parts = [];

            // Trend: alignment + slope. Keep this deliberately capped so one indicator cannot dominate.
            const trendGap = (emaFastLast - emaSlowLast) / (last.close || 1) * 100;
            const trendSlope = ((emaFastLast - emaFastPrev) / (last.close || 1)) * 100;
            if (trendGap > 0.08) { score += 14; parts.push('bullTrend'); }
            else if (trendGap < -0.08) { score -= 14; parts.push('bearTrend'); }
            if (trendSlope > 0.015) score += 6;
            else if (trendSlope < -0.015) score -= 6;

            // Short-term momentum.
            const mom5 = (last.close - c5.close) / (c5.close || 1) * 100;
            const mom10 = (last.close - c10.close) / (c10.close || 1) * 100;
            const mom = mom5 * 0.7 + mom10 * 0.3;
            if (mom > 0.18) score += 10;
            else if (mom > 0.06) score += 5;
            else if (mom < -0.18) score -= 10;
            else if (mom < -0.06) score -= 5;

            // RSI: avoid blindly buying extreme overbought or shorting extreme oversold.
            const rsiArr = calculateRSI(candles, 14);
            const rsi = rsiArr.length ? rsiArr[rsiArr.length - 1].value : 50;
            if (rsi >= 52 && rsi <= 68) score += 7;
            else if (rsi > 68) score -= 4;
            else if (rsi >= 32 && rsi < 48) score -= 7;
            else if (rsi < 32) score += 4;

            // MACD histogram direction.
            const macd = calculateMACD(candles, 12, 26, 9);
            const hist = macd.histogram.length ? macd.histogram[macd.histogram.length - 1].value : 0;
            const histPrev = macd.histogram.length > 2 ? macd.histogram[macd.histogram.length - 3].value : hist;
            const histScale = Math.max(Math.abs(last.close) * 0.00005, 1e-12);
            if (hist > histPrev + histScale) score += 6;
            else if (hist < histPrev - histScale) score -= 6;

            // Relative volume.
            const recentVol = candles.slice(-5).reduce((a, c) => a + Number(c.volume || 0), 0) / 5;
            const baseVol = candles.slice(-25, -5).reduce((a, c) => a + Number(c.volume || 0), 0) / 20 || recentVol;
            const volRatio = baseVol ? recentVol / baseVol : 1;
            if (volRatio >= 1.5) score += mom >= 0 ? 5 : -5;
            else if (volRatio < 0.65) score += 0;

            // Live orderbook pressure.
            const dom = Number(dominanceData.buyPct || 50);
            if (dom >= 60) score += 8;
            else if (dom <= 40) score -= 8;

            score = Math.round(clampNumber(score, 0, 100));
            let bias = 'WAIT';
            if (score >= 78) bias = 'STRONG LONG';
            else if (score >= 63) bias = 'LONG';
            else if (score <= 22) bias = 'STRONG SHORT';
            else if (score <= 37) bias = 'SHORT';

            const trend = trendGap > 0.08 ? 'BULL' : trendGap < -0.08 ? 'BEAR' : 'FLAT';
            const momentum = mom > 0.08 ? 'UP' : mom < -0.08 ? 'DOWN' : 'FLAT';
            const volumeState = volRatio >= 1.5 ? 'HIGH' : volRatio <= 0.65 ? 'LOW' : 'NORMAL';
            return { score, bias, trend, momentum, volumeState, rsi, volRatio, mom };
        }

        function renderScalpScore() {
            const score = calculateScalpScore(rawCandles);
            if (!score) return;
            lastScalpScore = score;
            const value = document.getElementById('scalpScoreValue');
            const bias = document.getElementById('scalpScoreBias');
            const fill = document.getElementById('scalpScoreFill');
            const trend = document.getElementById('scalpTrend');
            const momentum = document.getElementById('scalpMomentum');
            const volume = document.getElementById('scalpVolumeState');
            if (value) value.innerText = score.score;
            if (bias) bias.innerText = score.bias;
            if (fill) fill.style.width = `${score.score}%`;
            if (trend) trend.innerText = score.trend;
            if (momentum) momentum.innerText = score.momentum;
            if (volume) volume.innerText = score.volumeState;

            const cls = score.score >= 63 ? 'text-bybit-green' : score.score <= 37 ? 'text-bybit-red' : 'text-bybit-yellow';
            [value, bias, fill].forEach(el => {
                if (!el) return;
                el.classList.remove('text-bybit-green','text-bybit-red','text-bybit-yellow');
                if (el === fill) return;
                el.classList.add(cls);
            });
            if (fill) fill.className = `scalp-score-fill ${score.score >= 63 ? 'bg-bybit-green' : score.score <= 37 ? 'bg-bybit-red' : 'bg-bybit-yellow'}`;

            const priceInfoCard = document.getElementById('priceInfoScalpScore');
            const priceInfoValue = document.getElementById('priceInfoScalpScoreValue');
            const priceInfoBias = document.getElementById('priceInfoScalpScoreBias');
            if (priceInfoValue) priceInfoValue.innerText = score.score;
            if (priceInfoBias) priceInfoBias.innerText = score.bias;
            if (priceInfoCard) {
                priceInfoCard.classList.remove('score-long','score-short','score-wait');
                priceInfoCard.classList.add(score.score >= 63 ? 'score-long' : score.score <= 37 ? 'score-short' : 'score-wait');
            }
            [priceInfoValue, priceInfoBias].forEach(el => {
                if (!el) return;
                el.classList.remove('text-bybit-green','text-bybit-red','text-bybit-yellow');
                el.classList.add(cls);
            });

            const mobileCard = document.getElementById('mobileScalpScore');
            const mobileValue = document.getElementById('mobileScalpScoreValue');
            const mobileBias = document.getElementById('mobileScalpScoreBias');
            if (mobileValue) mobileValue.innerText = score.score;
            if (mobileBias) mobileBias.innerText = score.bias;
            if (mobileCard) {
                mobileCard.classList.remove('score-long','score-short','score-wait');
                mobileCard.classList.add(score.score >= 63 ? 'score-long' : score.score <= 37 ? 'score-short' : 'score-wait');
            }
            [mobileValue, mobileBias].forEach(el => {
                if (!el) return;
                el.classList.remove('text-bybit-green','text-bybit-red','text-bybit-yellow');
                el.classList.add(cls);
            });
        }


        function updateIndicatorVisibility() {
            const volumeVisible = settings.showVolume;
            const rsiVisible = settings.showRSI;
            const macdVisible = settings.showMACD;

            const volumePanel = document.getElementById('volumeChartContainer');
            const rsiPanel = document.getElementById('rsiChartContainer');
            const macdPanel = document.getElementById('macdChartContainer');

            volumePanel.classList.toggle('is-hidden', !volumeVisible);
            rsiPanel.classList.toggle('is-hidden', !rsiVisible);
            macdPanel.classList.toggle('is-hidden', !macdVisible);

            if (volumeSeries) volumeSeries.applyOptions({ visible: volumeVisible });
            [rsiSeries, rsi70Series, rsi50Series, rsi30Series].forEach(series => {
                if (series) series.applyOptions({ visible: rsiVisible });
            });
            [macdLineSeries, macdSignalSeries, macdHistogramSeries].forEach(series => {
                if (series) series.applyOptions({ visible: macdVisible });
            });

            const pricePanel = document.getElementById('priceChartContainer');
            const isMobile = window.innerWidth < 768;
            if (!volumeVisible && !rsiVisible && !macdVisible) {
                pricePanel.style.height = isMobile ? '248px' : '650px';
            } else {
                pricePanel.style.height = isMobile ? '238px' : '520px';
            }

            requestAnimationFrame(() => {
                resizeAllCharts();
                syncAllChartRanges();
            });
        }

        function syncAllChartRanges() {
            if (!chart) return;
            const range = chart.timeScale().getVisibleLogicalRange();
            if (!range) return;

            [volumeChart, rsiChart, macdChart].forEach(other => {
                if (other) {
                    try {
                        other.timeScale().setVisibleLogicalRange(range);
                    } catch (e) {}
                }
            });
        }

        function calculateEMA(candles, period) {
            const result = [];
            const k = 2 / (period + 1);
            let ema = candles[0].close;

            for (let i = 0; i < candles.length; i++) {
                const close = candles[i].close;
                if (i < period) {
                    ema = (ema * i + close) / (i + 1);
                } else {
                    ema = close * k + ema * (1 - k);
                }
                if (i >= period - 1) {
                    result.push({ time: candles[i].time, value: ema });
                }
            }
            return result;
        }

        function findSupportResistance(candles, pivotWindow = 5) {
            const highs = [];
            const lows = [];

            for (let i = pivotWindow; i < candles.length - pivotWindow; i++) {
                let isHigh = true;
                let isLow = true;

                for (let j = 1; j <= pivotWindow; j++) {
                    if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
                    if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
                }

                if (isHigh) highs.push(candles[i].high);
                if (isLow) lows.push(candles[i].low);
            }

            const currentPrice = candles[candles.length - 1].close;
            const threshold = currentPrice * 0.015;

            const clusterLevels = (levels, type) => {
                const clusters = [];
                levels.forEach(price => {
                    let found = false;
                    for (let c of clusters) {
                        if (Math.abs(c.avgPrice - price) <= threshold) {
                            c.prices.push(price);
                            c.avgPrice = c.prices.reduce((a, b) => a + b, 0) / c.prices.length;
                            c.count++;
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        clusters.push({ avgPrice: price, prices: [price], count: 1, type });
                    }
                });
                return clusters;
            };

            const resClusters = clusterLevels(highs, 'resistance').sort((a, b) => b.count - a.count);
            const supClusters = clusterLevels(lows, 'support').sort((a, b) => b.count - a.count);

            const resistances = resClusters.filter(c => c.avgPrice > currentPrice).slice(0, 3);
            const supports = supClusters.filter(c => c.avgPrice < currentPrice).slice(0, 3);

            return [...resistances, ...supports];
        }

        function drawSRLines(zones) {
            zones.forEach(zone => {
                const isRes = zone.type === 'resistance';
                const line = candleSeries.createPriceLine({
                    price: zone.avgPrice,
                    color: isRes ? 'rgba(246, 70, 93, 0.8)' : 'rgba(14, 203, 129, 0.8)',
                    lineWidth: 1,
                    lineStyle: LightweightCharts.LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: `${isRes ? 'Сопротивление' : 'Поддержка'} (${zone.count}x)`,
                });
                srPriceLines.push(line);
            });
        }

        function detectAdvancedPatterns(candles, srZones) {
            const markers = [];
            const patterns = [];
            const n = candles.length;
            if (n < 30) return { markers, patterns };

            const last = candles[n - 1];

            const swingLows = [];
            const swingHighs = [];
            for (let i = 3; i < n - 3; i++) {
                if (candles[i].low < candles[i-1].low && candles[i].low < candles[i-2].low &&
                    candles[i].low < candles[i+1].low && candles[i].low < candles[i+2].low) {
                    swingLows.push({ index: i, price: candles[i].low, time: candles[i].time });
                }
                if (candles[i].high > candles[i-1].high && candles[i].high > candles[i-2].high &&
                    candles[i].high > candles[i+1].high && candles[i].high > candles[i+2].high) {
                    swingHighs.push({ index: i, price: candles[i].high, time: candles[i].time });
                }
            }

            if (swingLows.length >= 3) {
                const l1 = swingLows[swingLows.length - 3];
                const l2 = swingLows[swingLows.length - 2];
                const l3 = swingLows[swingLows.length - 1];

                if (Math.abs(l1.price - l2.price) / l1.price < 0.015 && Math.abs(l2.price - l3.price) / l2.price < 0.015) {
                    markers.push({ time: l3.time, position: 'belowBar', color: '#0ecb81', shape: 'arrowUp', text: 'Тройное Дно' });
                    patterns.push({ name: 'Тройное Дно (Triple Bottom)', type: 'bullish', desc: `Три дна около $${formatPrice(l3.price)}. Сильный бычий разворот.` });
                }
            } else if (swingLows.length >= 2) {
                const l1 = swingLows[swingLows.length - 2];
                const l2 = swingLows[swingLows.length - 1];
                if (Math.abs(l1.price - l2.price) / l1.price < 0.015 && (l2.index - l1.index) > 4) {
                    markers.push({ time: l2.time, position: 'belowBar', color: '#0ecb81', shape: 'arrowUp', text: 'Двойное Дно' });
                    patterns.push({ name: 'Двойное Дно (Double Bottom)', type: 'bullish', desc: `Двойное дно у $${formatPrice(l2.price)}. Разворот вверх.` });
                }
            }

            if (swingHighs.length >= 2) {
                const h1 = swingHighs[swingHighs.length - 2];
                const h2 = swingHighs[swingHighs.length - 1];
                if (Math.abs(h1.price - h2.price) / h1.price < 0.015 && (h2.index - h1.index) > 4) {
                    markers.push({ time: h2.time, position: 'aboveBar', color: '#f6465d', shape: 'arrowDown', text: 'Двойная Вершина' });
                    patterns.push({ name: 'Двойная Вершина (Double Top)', type: 'bearish', desc: `Два пика у $${formatPrice(h2.price)}. Сигнал падения.` });
                }
            }

            if (swingHighs.length >= 3) {
                const s1 = swingHighs[swingHighs.length - 3];
                const head = swingHighs[swingHighs.length - 2];
                const s2 = swingHighs[swingHighs.length - 1];

                if (head.price > s1.price && head.price > s2.price && Math.abs(s1.price - s2.price) / s1.price < 0.02) {
                    markers.push({ time: head.time, position: 'aboveBar', color: '#f6465d', shape: 'square', text: 'Голова и Плечи' });
                    patterns.push({ name: 'Голова и Плечи (Head & Shoulders)', type: 'bearish', desc: `Классический паттерн ГиП с вершиной $${formatPrice(head.price)}.` });
                }
            }

            if (swingLows.length >= 3) {
                const s1 = swingLows[swingLows.length - 3];
                const head = swingLows[swingLows.length - 2];
                const s2 = swingLows[swingLows.length - 1];

                if (head.price < s1.price && head.price < s2.price && Math.abs(s1.price - s2.price) / s1.price < 0.02) {
                    markers.push({ time: head.time, position: 'belowBar', color: '#0ecb81', shape: 'square', text: 'Перевернутая ГиП' });
                    patterns.push({ name: 'Перевернутая ГиП (Inv. H&S)', type: 'bullish', desc: `Бычий паттерн с локальным дном $${formatPrice(head.price)}.` });
                }
            }

            const body = Math.abs(last.close - last.open);
            const upperWick = last.high - Math.max(last.open, last.close);
            const lowerWick = Math.min(last.open, last.close) - last.low;

            if (lowerWick > body * 2 && upperWick < body * 0.8) {
                markers.push({ time: last.time, position: 'belowBar', color: '#0ecb81', shape: 'circle', text: 'Молот' });
                patterns.push({ name: 'Бычий Молот / Pin Bar', type: 'bullish', desc: 'Длинная нижняя тень. Резкий откуп цены снизу.' });
            }

            if (upperWick > body * 2 && lowerWick < body * 0.8) {
                markers.push({ time: last.time, position: 'aboveBar', color: '#f6465d', shape: 'circle', text: 'Падающая Звезда' });
                patterns.push({ name: 'Падающая Звезда (Shooting Star)', type: 'bearish', desc: 'Верхнее отвержение цены. Давление продавцов.' });
            }

            return { markers, patterns };
        }

        function renderSRPanel(zones) {
            const containerDesktop = document.getElementById('srList');
            const containerMobile = document.getElementById('mobileSrList');

            if (!zones || zones.length === 0) {
                const emptyHtml = `<div class="text-bybit-muted italic text-center py-1">Уровни не найдены</div>`;
                if (containerDesktop) containerDesktop.innerHTML = emptyHtml;
                if (containerMobile) containerMobile.innerHTML = emptyHtml;
                return;
            }

            const html = zones.map(z => {
                const isRes = z.type === 'resistance';
                return `
                    <div class="flex items-center justify-between p-2 rounded-lg bg-bybit-bg border border-bybit-border">
                        <div class="flex items-center space-x-2">
                            <span class="w-2 h-2 rounded-full ${isRes ? 'bg-bybit-red' : 'bg-bybit-green'}"></span>
                            <span class="text-white">${isRes ? 'Сопротивление' : 'Поддержка'}</span>
                        </div>
                        <div class="text-right">
                            <div class="font-bold ${isRes ? 'text-bybit-red' : 'text-bybit-green'}">$${formatPrice(z.avgPrice)}</div>
                            <div class="text-[10px] text-bybit-muted">${z.count} касаний</div>
                        </div>
                    </div>
                `;
            }).join('');

            if (containerDesktop) containerDesktop.innerHTML = html;
            if (containerMobile) containerMobile.innerHTML = html;
        }

        function renderPatternPanel(patterns) {
            const containerDesktop = document.getElementById('patternList');
            const containerMobile = document.getElementById('mobilePatternList');

            const countBadgeDesktop = document.getElementById('patternCount');
            const countBadgeMobile = document.getElementById('mobilePatternCount');
            const countBadgeHeader = document.getElementById('mobilePatternBadge');

            const count = patterns ? patterns.length : 0;

            if (countBadgeDesktop) countBadgeDesktop.innerText = count;
            if (countBadgeMobile) countBadgeMobile.innerText = count;
            if (countBadgeHeader) countBadgeHeader.innerText = count;

            if (!patterns || patterns.length === 0) {
                const emptyHtml = `<div class="text-bybit-muted italic text-center py-4">Паттерны не обнаружены</div>`;
                if (containerDesktop) containerDesktop.innerHTML = emptyHtml;
                if (containerMobile) containerMobile.innerHTML = emptyHtml;
                return;
            }

            const html = patterns.map(p => {
                const isBull = p.type === 'bullish';
                return `
                    <div class="p-2.5 rounded-xl bg-bybit-bg border border-bybit-border space-y-1 hover:border-bybit-yellow/40 transition-colors">
                        <div class="flex items-center justify-between">
                            <span class="font-bold text-white text-xs">${p.name}</span>
                            <span class="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold ${isBull ? 'bg-bybit-green/10 text-bybit-green border border-bybit-green/20' : 'bg-bybit-red/10 text-bybit-red border border-bybit-red/20'}">
                                ${isBull ? 'BULLISH' : 'BEARISH'}
                            </span>
                        </div>
                        <p class="text-[11px] text-bybit-muted leading-relaxed">${p.desc}</p>
                    </div>
                `;
            }).join('');

            if (containerDesktop) containerDesktop.innerHTML = html;
            if (containerMobile) containerMobile.innerHTML = html;
        }
    