from pathlib import Path
p=Path('/mnt/data/stage58/index.html')
s=p.read_text()

# CSS additions
needle='''            #priceChartContainer .tv-lightweight-charts { touch-action: pan-x pan-y; }\n'''
insert='''            #priceChartContainer .tv-lightweight-charts { touch-action: pan-x pan-y; }\n            #scalpScoreOverlay { top: 8px; right: 8px; left: auto; }\n            .scalp-score-card { min-width: 146px; }\n            .scalp-score-bar { height: 4px; border-radius: 999px; overflow: hidden; background:#21262d; }\n            .scalp-score-fill { height:100%; width:50%; transition:width .25s ease; }\n            .chart-quick-btn { min-width:30px; height:28px; padding:0 7px; border:1px solid #30363d; background:#0d1117; color:#8b949e; border-radius:7px; font:700 9px ui-monospace,monospace; }\n            .chart-quick-btn.active { color:#f7a600; border-color:rgba(247,166,0,.45); background:rgba(247,166,0,.08); }\n'''
s=s.replace(needle,insert)

# Chart toolbar additions
needle='''                <button id="resetChartViewBtn" class="px-2 py-1 rounded-md bg-bybit-bg border border-bybit-border text-bybit-muted active:scale-95">AUTO</button>\n'''
insert='''                <div class="flex items-center gap-1">\n                    <button class="chart-quick-btn active" data-bars="40">40</button>\n                    <button class="chart-quick-btn" data-bars="70">70</button>\n                    <button class="chart-quick-btn" data-bars="110">110</button>\n                    <button id="resetChartViewBtn" class="chart-quick-btn">AUTO</button>\n                </div>\n'''
s=s.replace(needle,insert)

# Overlay after mobile OHLC
needle='''            <div id="mobileOhlcMini" class="md:hidden absolute top-11 left-2 z-20 hidden items-center gap-1.5 bg-bybit-card/92 backdrop-blur-md border border-bybit-border/80 px-2 py-1 rounded-md text-[9px] font-mono shadow-xl">\n                <span>O <b id="mobileO">0</b></span><span>H <b id="mobileH">0</b></span><span>L <b id="mobileL">0</b></span><span>C <b id="mobileC">0</b></span><span>V <b id="mobileV">0</b></span>\n            </div>\n'''
insert=needle+'''            <div id="scalpScoreOverlay" class="absolute z-20 bg-bybit-card/92 backdrop-blur-md border border-bybit-border/80 rounded-lg px-2.5 py-2 shadow-xl scalp-score-card">\n                <div class="flex items-center justify-between gap-3">\n                    <div>\n                        <div class="text-[8px] text-bybit-muted font-bold font-mono">SCALP SCORE</div>\n                        <div class="flex items-baseline gap-1.5">\n                            <span id="scalpScoreValue" class="text-lg font-black font-mono text-bybit-yellow">50</span>\n                            <span id="scalpScoreBias" class="text-[9px] font-black font-mono text-bybit-muted">WAIT</span>\n                        </div>\n                    </div>\n                    <div class="text-right text-[8px] font-mono leading-3">\n                        <div><span class="text-bybit-muted">TREND </span><b id="scalpTrend">FLAT</b></div>\n                        <div><span class="text-bybit-muted">MOM </span><b id="scalpMomentum">FLAT</b></div>\n                        <div><span class="text-bybit-muted">VOL </span><b id="scalpVolumeState">NORMAL</b></div>\n                    </div>\n                </div>\n                <div class="scalp-score-bar mt-1.5"><div id="scalpScoreFill" class="scalp-score-fill"></div></div>\n            </div>\n'''
s=s.replace(needle,insert)

# Add variable
needle='''        let detectedWalls = [];\n'''
s=s.replace(needle, needle+'''        let selectedChartBars = window.innerWidth < 768 ? 52 : 110;\n        let lastScalpScore = null;\n''')

# Add functions before updateOverlays
needle='''        function updateOverlays() {\n'''
func=r'''        function clampNumber(v, min, max) { return Math.max(min, Math.min(max, v)); }

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
        }

        function applyChartBars(count, button) {
            selectedChartBars = Number(count) || 70;
            document.querySelectorAll('.chart-quick-btn[data-bars]').forEach(b => b.classList.toggle('active', b === button));
            if (!chart || !rawCandles.length) return;
            const from = Math.max(0, rawCandles.length - selectedChartBars);
            chart.timeScale().setVisibleLogicalRange({ from, to: rawCandles.length + 2 });
            syncAllChartRanges();
        }

        function updateOverlays() {
'''
s=s.replace(needle,func)

# Add score call in updateOverlays after renderPatternPanel
needle='''            candleSeries.setMarkers(markers);\n            renderPatternPanel(patternsList);\n\n            updateIndicators();\n'''
rep='''            candleSeries.setMarkers(markers);\n            renderPatternPanel(patternsList);\n            renderScalpScore();\n\n            updateIndicators();\n'''
s=s.replace(needle,rep)

# Event binding for bars before reset listener
needle='''            document.getElementById('resetChartViewBtn')?.addEventListener('click', () => {\n'''
rep='''            document.querySelectorAll('.chart-quick-btn[data-bars]').forEach(btn => {\n                btn.addEventListener('click', () => applyChartBars(btn.dataset.bars, btn));\n            });\n\n            document.getElementById('resetChartViewBtn')?.addEventListener('click', () => {\n'''
s=s.replace(needle,rep)

# Modify reset to selected count
s=s.replace("const visibleBars = window.innerWidth < 768 ? 52 : 110;", "const visibleBars = selectedChartBars || (window.innerWidth < 768 ? 52 : 110);")

# Ensure initial score after data fetch by updateOverlays existing call; no change needed.

p.write_text(s)
