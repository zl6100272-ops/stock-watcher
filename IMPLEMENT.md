Build a Chrome extension for A-share stock real-time monitoring at /tmp/stock-watcher/.

Read the SPEC.md at /tmp/stock-watcher/SPEC.md for full specs.

Create the following files:

### 1. /tmp/stock-watcher/manifest.json
Manifest V3. Permissions: storage, notifications, alarms. Host permissions: https://qt.gtimg.cn/* and https://money.finance.sina.com.cn/*. Service worker: background.js. Content script: content.js + styles.css on <all_urls>. Default popup: popup.html. 48x48 and 128x128 icons as generated SVG/base64.

### 2. /tmp/stock-watcher/background.js
Service worker with these responsibilities:

**Constants**: DEFAULT_WATCHLIST = ['600522','600487','600378','600879','000977','603667','002463','002156','603690','563210']

**Function isTradingHours()**: Returns true Mon-Fri 9:30-11:30 or 13:00-15:00. Otherwise false.

**Function getExchange(code)**: 'sh' if starts with '6', else 'sz'. For 563210 (ETF) try 'sh'.

**Function fetchQuotes()**: 
- Build batch URL: `https://qt.gtimg.cn/q=sh600522,sh600487,...` (prepend correct exchange prefix to each code)
- fetch() with no special headers (no CORS issues)
- Response is GBK encoded. Parse with TextDecoder('gbk') or manual iconv.
- Format: `v_sh600522="1~中天科技~600522~42.19~..."`
- Split by ';' then parse each entry. Fields: parts[1]=name, [2]=code, [3]=price, [4]=yclose, [5]=open, [31]=change, [32]=change%, [33]=high, [34]=low, [36]=volume(lots)
- Store in chrome.storage.local as quote_{code}: {price, change, change_pct, high, low, volume, time}

**Function calcKDJ(klines)**: Standard KDJ(9,3,3). Takes array of {day,open,high,low,close,volume}. Returns array of {date, k, d, j}. Starting K=D=50.

**Function fetchDailyKlines(code)**:
- URL: `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol={EXCHANGE}{CODE}&scale=240&ma=no&datalen=30`
- Fetch JSON. Parse. Returns array.

**Function checkCross(prevK, prevD, currK, currD)**: Returns 'golden' if prevK<=prevD and currK>currD. Returns 'death' if prevK>=prevD and currK<currD. Returns null otherwise.

**Alarm setup**: On install, create 'refresh-quote' alarm (periodInMinutes: 1/60 = every 1 minute — actually Chrome min is 1min, so use setInterval instead every 3 seconds in the service worker... wait, service workers can't use setInterval reliably. Use chrome.alarms with periodInMinutes: 1 for K-line refresh.

Actually for real-time: Chrome extension can't do sub-minute intervals reliably with alarms (min is 1 min). Use a workaround: chrome.alarms every 1 minute, and within the alarm handler, if isTradingHours(), do a single fetch and then set a setTimeout for the next call (every 3s) - but service worker may be killed. Better approach: use chrome.alarms every 1 minute as the heartbeat, and within that window do a burst of fetches every 3 seconds.

Simpler approach: chrome.alarms with periodInMinutes: 1. On each alarm:
1. If trading hours: fetch quotes, update storage, broadcast to content script via chrome.tabs.query + chrome.tabs.sendMessage
2. Every 5th cycle (5 min): also fetch daily klines + recalc KDJ
3. Check alerts after each quote update

**Message handling**:
- Listen for messages from popup and content script:
  - {type: 'GET_DATA'} → return all stored quotes + KDJ data
  - {type: 'UPDATE_WATCHLIST', codes} → save to storage
  - {type: 'GET_WATCHLIST'} → return watchlist

**Function checkAlerts(quotes, kdjData)**:
- For each stock: if price crosses user-set threshold, send chrome.notifications.create()
- If golden cross detected: send notification "金叉: {name}({code}) K={k} D={d}"
- If death cross detected: send notification "死叉: {name}({code}) K={k} D={d}"
- Use chrome.storage.local to track cooldown (don't repeat same alert within 30 min)

**On install**: Set default watchlist and initial data in storage.

### 3. /tmp/stock-watcher/content.js
Injected into all pages. Creates a floating panel overlay.

**Panel creation**:
- Use shadow DOM to avoid CSS conflicts: `const host = document.createElement('div'); host.id = 'stock-watcher-host'; const root = host.attachShadow({mode: 'closed'}); document.body.appendChild(host);`
- Panel HTML structure inside shadow root:
```
<div id="sw-panel">
  <div id="sw-header">
    <span id="sw-title">📊 自选股</span>
    <span id="sw-compact-btn">_</span>
  </div>
  <div id="sw-body">
    <table id="sw-table">
      <thead><tr><th>代码</th><th>名称</th><th>价格</th><th>涨跌</th><th>K/D/J</th><th>信号</th></tr></thead>
      <tbody id="sw-tbody"></tbody>
    </table>
    <div id="sw-footer">
      <span id="sw-timestamp"></span>
    </div>
  </div>
  <div id="sw-compact-body" style="display:none">
    <!-- compact view: just price + change% per stock -->
  </div>
</div>
```

**Styling**: Inline or via injected <style> in shadow root:
- Position: fixed, bottom: 20px, right: 20px, width: 360px
- Background: rgba(15, 15, 20, 0.92), backdrop-filter: blur(8px)
- Border: 1px solid #333, border-radius: 10px
- Font: monospace, 12px
- Colors: positive=#26a69a, negative=#ef5350, neutral=#ccc
- Header: cursor: grab, padding: 8px, border-bottom: 1px solid #333
- Table: width 100%, border-collapse
- z-index: 2147483647
- Semi-transparent, modern dark theme

**Draggable**: mousedown on header → track mousemove → update panel.style.left/top. On mouseup stop tracking.

**Boss key**: `document.addEventListener('keydown', (e) => { if(e.ctrlKey && e.shiftKey && e.key === 'H') panel.style.display = panel.style.display === 'none' ? 'flex' : 'none'; })`

**Compact toggle**: Click the "_" button toggles between full table and compact view.

**Message listener**: `chrome.runtime.onMessage.addListener((msg) => { if(msg.type === 'QUOTE_UPDATE') updatePanel(msg.data); })`

**updatePanel(quotes)**: Iterate over quotes array, update table rows. For each stock show: code, name, price, change% with color, K/D/J values (from msg.kdj or cached), signal emoji (🟢金叉/🔴死叉/➖).

**Initial state**: Send message to background asking for current data on load.

### 4. /tmp/stock-watcher/popup.html
Settings popup, 380px wide, dark theme.

HTML structure:
```
<div class="popup">
  <h2>📊 Stock Watcher</h2>
  <div class="section">
    <h3>自选股管理</h3>
    <div class="stock-list" id="stock-list"></div>
    <div class="add-stock">
      <input type="text" id="stock-input" placeholder="输入股票代码, 如 600522" maxlength="6">
      <button id="add-btn">添加</button>
    </div>
  </div>
  <div class="section">
    <h3>预警设置</h3>
    <label><input type="checkbox" id="alert-golden" checked> 金叉通知</label>
    <label><input type="checkbox" id="alert-death" checked> 死叉通知</label>
  </div>
  <div class="section">
    <h3>关于</h3>
    <p>数据来源: 腾讯证券 + 新浪财经</p>
    <p>更新频率: 交易时段每5秒</p>
  </div>
</div>
```

CSS inline in <style>: dark theme, inputs styled dark, scrollable stock list with delete buttons.

### 5. /tmp/stock-watcher/popup.js
- On load: fetch watchlist + alert settings from chrome.storage.local
- Render stock list with delete buttons
- Add button: validate code (6 digits), save to storage, send message to background
- Input validation: only allow digits, max 6 chars
- Checkbox change handlers: save to chrome.storage.local

### 6. /tmp/stock-watcher/styles.css - not needed separately, styles are in content.js shadow DOM and popup.html inline

### 7. /tmp/stock-watcher/icons/ - create a simple 128x128 and 48x48 icon
Generate as a simple SVG that looks like a candlestick chart. Save as icon.svg and reference it.
Or use a simple PNG base64 in manifest.

Make sure everything works with Manifest V3 service worker (no DOM access in background.js, use chrome.storage instead of localStorage, use fetch instead of XMLHttpRequest).

Use `const GBK = new TextDecoder('gbk')` for Tencent response decoding.

IMPORTANT: 
- Do NOT use import/export in service worker files (Manifest V3 service workers don't support ES modules by default without "type": "module")
- Do NOT use localStorage in service worker (use chrome.storage.local)
- Chrome.alarms minimum period is 1 minute, so real-time (3s) refresh is NOT possible via alarms alone. Instead: use chrome.alarms every 1 minute as heartbeat + within the alarm handler, use self.setTimeout to chain 3s interval calls. BUT service workers can be terminated after 30s of inactivity. Workaround: Keep alive by chaining fetch+setTimeout within the alarm window, and do a burst of 3-4 fetches (3s apart) within each 1-minute window.

Actually simpler: since Chrome extension can't do true real-time (3s) due to service worker lifecycle, set the quote refresh to every 1 minute (which is Chrome's minimum for alarms). The panel will update once per minute during trading hours. This is a known MV3 limitation.

Build the complete project. Make it production quality.
