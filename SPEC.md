# Stock Watcher - Chrome Extension

Chrome extension for real-time A-share stock monitoring. Floating panel overlays all pages,
displays watchlist prices, KDJ indicators, and sends desktop notifications on golden/death cross.

## Features

1. **Floating Panel**: Semi-transparent overlay, draggable, stays on top of all browser tabs.
   - Shows watchlist stocks: code, name, price, change%, K/D/J values, cross status
   - Auto-refresh every 3 seconds during trading hours (9:30-11:30, 13:00-15:00 weekdays)
   - Auto-pause during market closure
   - Collapsible to compact mode
   - `Ctrl+Shift+H` to toggle visibility (boss key)

2. **Real-time Data**: Fetches from Tencent `qt.gtimg.cn` API directly — no server needed.
   - Batch query multiple stocks in one request
   - Parse: price, change, high/low, volume

3. **KDJ(9,3,3) Calculation**: Done locally in the extension's service worker.
   - Fetches daily K-line from Sina HTTP API
   - Calculates K, D, J values locally
   - Detects golden cross (K crosses above D) and death cross (K crosses below D)

4. **Desktop Notifications**: Chrome Notification API.
   - Golden cross alert
   - Death cross alert  
   - Price threshold alert (user-configurable)
   - Configurable cooldown (default: don't repeat same alert within 30 min)

5. **Settings Popup** (click extension icon):
   - Edit watchlist (add/remove stock codes)
   - Set price alerts per stock
   - Toggle notification types
   - Dark/Light theme toggle

## Technical Architecture

### manifest.json (Manifest V3)

```json
{
  "manifest_version": 3,
  "name": "Stock Watcher",
  "version": "1.0.0",
  "permissions": ["storage", "notifications", "alarms"],
  "host_permissions": ["https://qt.gtimg.cn/*", "https://money.finance.sina.com.cn/*"],
  "background": { "service_worker": "background.js" },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "css": ["styles.css"],
    "run_at": "document_end"
  }],
  "action": { "default_popup": "popup.html", "default_icon": { ... } },
  "icons": { ... }
}
```

### background.js (Service Worker)

Responsibilities:
- On `chrome.runtime.onInstalled`: initialize default watchlist + K-line cache
- On `chrome.alarms.onAlarm` (every 60s for K-line, every 3s for quote): 
  - `fetchQuote()`: `GET https://qt.gtimg.cn/q=sh600522,sh600487,sh600378,sh000001,sz399001`
    - Response is GBK-encoded, pipe-delimited format
    - Parse each stock's fields: name(1), code(2), price(3), yesterday_close(4), open(5), volume(36), high(33), low(34), change(31), change_pct(32)
    - Push parsed data to content script via `chrome.tabs.sendMessage(tabId, {type: 'QUOTE_UPDATE', data: quotes})`
  - `fetchDailyKlines()`: For each stock, fetch daily bars from Sina. Cache in `chrome.storage.local`
    - URL: `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=sh{CODE}&scale=240&ma=no&datalen=30`
    - Parse JSON: [{day, open, high, low, close, volume}, ...]
    - Append today's real-time data from Tencent quote to make KDJ real-time
  - `calcKDJ(data)`: Standard KDJ(9,3,3) calculation
    - RSV = (C - Ln) / (Hn - Ln) * 100 (n=9)
    - K = 2/3*prev_K + 1/3*RSV
    - D = 2/3*prev_D + 1/3*K
    - J = 3*K - 2*D
    - Detect golden cross (K crosses above D) and death cross (K crosses below D)
    - Cache K/D/J values in chrome.storage.local
  - `checkAlerts()`: Compare current prices/KDJ against user-set thresholds
    - If alert triggers and cooldown expired → `chrome.notifications.create()`
- Listen for messages from popup (config changes) and content script (panel ready)

### content.js

- Creates a floating panel div injected into every page (using shadow DOM to avoid CSS conflicts)
- Listens for messages from background.js via `chrome.runtime.onMessage`
- Updates panel DOM on each QUOTE_UPDATE message
- Draggable via mousedown/mousemove/mouseup on panel header
- Ctrl+Shift+H keyboard listener to toggle panel visibility
- Panel has: header (drag handle), stock list table, compact/collapse toggle, last-update timestamp

### styles.css

- Dark theme (matching terminal/developer aesthetic)
- Semi-transparent background (rgba with backdrop-filter blur)
- Green for positive changes, red for negative
- Golden cross badge: 🟢, death cross badge: 🔴
- Fixed position bottom-right, 300px wide
- Compact mode: only show price + change%, no KDJ table
- z-index: 2147483647 (max)

### popup.html / popup.js

- Full watchlist management (add/remove codes)
- Per-stock price alert configuration
- Notification settings (enable/disable each type)
- Theme toggle
- Open as a 350x450 dialog

## Data Format

### Tencent Quote Response (GBK)

```
v_sh600522="1~中天科技~600522~42.19~40.52~41.00~...
```
Fields: 1=name, 2=code, 3=current_price, 4=yesterday_close, 5=open, 31=change_amount, 32=change_percent, 33=high, 34=low, 36=volume(lots)

### Sina Daily K-line

```json
[{"day":"2026-05-29","open":"41.00","high":"43.60","low":"38.85","close":"42.19","volume":"385229968"}]
```

Volume is in shares (股), not lots (手).

### KDJ Cache (chrome.storage.local)

```json
{
  "kdj_600522": {"k": 33.75, "d": 37.74, "j": 25.76, "cross": "death", "cross_date": "2026-05-29"},
  "quote_600522": {"price": 42.19, "change": 1.67, "change_pct": "4.12%", "high": 43.60, "low": 38.85, "volume": 3852300, "time": "15:40:00"}
}
```

## Trading Hours Detection

```javascript
function isTradingHours() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes(), d = now.getDay();
  if (d === 0 || d === 6) return false;  // weekend
  // Morning: 9:30 - 11:30
  if ((h === 9 && m >= 30) || (h >= 10 && h < 11) || (h === 11 && m <= 30)) return true;
  // Afternoon: 13:00 - 15:00
  if (h >= 13 && h < 15) return true;
  if (h === 15 && m === 0) return true;
  return false;
}
```

## Default Watchlist

- 600522 中天科技
- 600487 亨通光电
- 600378 昊华科技
- 600879 航天电子
- 000977 浪潮信息
- 603667 五洲新春
- 002463 沪电股份
- 002156 通富微电
- 603690 至纯科技
- 563210 机器人ETF
