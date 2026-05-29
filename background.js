const DEFAULT_WATCHLIST = [
  '600522',
  '600487',
  '600378',
  '600879',
  '000977',
  '603667',
  '002463',
  '002156',
  '603690',
  '563210'
];

const DEFAULT_ALERT_SETTINGS = {
  golden: true,
  death: true,
  price: true,
  cooldownMinutes: 30
};

const QUOTE_ALARM = 'refresh-quote';
const KLINE_INTERVAL_MS = 5 * 60 * 1000;
const CHINA_TZ = 'Asia/Shanghai';

let refreshInFlight = false;

function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

function storageSet(data) {
  return chrome.storage.local.set(data);
}

function getChinaDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHINA_TZ,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);

  const out = {};
  for (const part of parts) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  return out;
}

function isTradingHours(date = new Date()) {
  const parts = getChinaDateParts(date);
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;

  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const minutes = hour * 60 + minute;

  return (minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30) ||
    (minutes >= 13 * 60 && minutes <= 15 * 60);
}

function getExchange(code) {
  if (String(code) === '563210') return 'sh';
  return String(code).startsWith('6') ? 'sh' : 'sz';
}

function getQuoteSymbol(code) {
  if (String(code) === '563210') return 'sh563210';
  return `${getExchange(code)}${code}`;
}

function normalizeCode(code) {
  return String(code || '').replace(/\D/g, '').slice(0, 6);
}

function uniqCodes(codes) {
  const seen = new Set();
  const result = [];
  for (const raw of codes || []) {
    const code = normalizeCode(raw);
    if (code.length === 6 && !seen.has(code)) {
      seen.add(code);
      result.push(code);
    }
  }
  return result;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatTime(date = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: CHINA_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

function todayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHINA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

async function getWatchlist() {
  const data = await storageGet({ watchlist: DEFAULT_WATCHLIST });
  const watchlist = uniqCodes(data.watchlist);
  if (watchlist.length === 0) return DEFAULT_WATCHLIST.slice();
  return watchlist;
}

async function fetchQuotes(codes) {
  const watchlist = uniqCodes(codes && codes.length ? codes : await getWatchlist());
  if (watchlist.length === 0) return [];

  const symbols = watchlist.map(getQuoteSymbol).join(',');
  const response = await fetch(`https://qt.gtimg.cn/q=${symbols}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Tencent quote request failed: ${response.status}`);

  const buffer = await response.arrayBuffer();
  const text = new TextDecoder('gbk').decode(buffer);
  const quotes = [];
  const store = {};
  const now = Date.now();
  const time = formatTime(new Date(now));

  for (const entry of text.split(';')) {
    const match = entry.match(/v_[a-z]{2}(\d{6})="([^"]*)"/);
    if (!match) continue;

    const parts = match[2].split('~');
    const code = parts[2] || match[1];
    if (!watchlist.includes(code)) continue;

    const quote = {
      code,
      name: parts[1] || code,
      price: toNumber(parts[3]),
      yclose: toNumber(parts[4]),
      open: toNumber(parts[5]),
      change: toNumber(parts[31]),
      change_pct: toNumber(parts[32]),
      high: toNumber(parts[33]),
      low: toNumber(parts[34]),
      volume: toNumber(parts[36]),
      time,
      timestamp: now
    };

    quotes.push(quote);
    store[`quote_${code}`] = quote;
  }

  if (quotes.length > 0) {
    store.last_quote_refresh = now;
    await storageSet(store);
  }

  return quotes;
}

function calcKDJ(klines) {
  const result = [];
  let k = 50;
  let d = 50;

  for (let i = 0; i < klines.length; i += 1) {
    const start = Math.max(0, i - 8);
    const window = klines.slice(start, i + 1);
    const high = Math.max(...window.map(item => Number(item.high)));
    const low = Math.min(...window.map(item => Number(item.low)));
    const close = Number(klines[i].close);
    const rsv = high === low ? 50 : ((close - low) / (high - low)) * 100;

    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
    const j = 3 * k - 2 * d;

    result.push({
      date: klines[i].day,
      k: round2(k),
      d: round2(d),
      j: round2(j)
    });
  }

  return result;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

async function fetchDailyKlines(code) {
  const symbol = getQuoteSymbol(code);
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=30`;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Sina kline request failed for ${code}: ${response.status}`);

  const text = await response.text();
  const raw = JSON.parse(text);
  if (!Array.isArray(raw)) return [];

  return raw
    .map(item => ({
      day: item.day,
      open: toNumber(item.open),
      high: toNumber(item.high),
      low: toNumber(item.low),
      close: toNumber(item.close),
      volume: toNumber(item.volume)
    }))
    .filter(item => item.day && item.open !== null && item.high !== null && item.low !== null && item.close !== null);
}

function mergeRealtimeKline(klines, quote) {
  if (!quote || quote.price === null || quote.high === null || quote.low === null) return klines;

  const day = todayKey();
  const realtime = {
    day,
    open: quote.open ?? quote.price,
    high: quote.high,
    low: quote.low,
    close: quote.price,
    volume: quote.volume ?? 0
  };

  const copy = klines.slice();
  const last = copy[copy.length - 1];
  if (last && last.day === day) {
    copy[copy.length - 1] = { ...last, ...realtime };
  } else {
    copy.push(realtime);
  }
  return copy.slice(-30);
}

function checkCross(prevK, prevD, currK, currD) {
  if (prevK <= prevD && currK > currD) return 'golden';
  if (prevK >= prevD && currK < currD) return 'death';
  return null;
}

async function refreshKDJ(codes, quotes) {
  const quoteMap = new Map((quotes || []).map(quote => [quote.code, quote]));
  const storedQuotes = await getStoredQuotes(codes);
  for (const quote of storedQuotes) quoteMap.set(quote.code, quoteMap.get(quote.code) || quote);

  const store = {};
  const kdjData = {};

  await Promise.all(codes.map(async code => {
    try {
      const klines = mergeRealtimeKline(await fetchDailyKlines(code), quoteMap.get(code));
      const series = calcKDJ(klines);
      const prev = series[series.length - 2] || null;
      const curr = series[series.length - 1] || null;
      if (!curr) return;

      const cross = prev ? checkCross(prev.k, prev.d, curr.k, curr.d) : null;
      const item = {
        code,
        k: curr.k,
        d: curr.d,
        j: curr.j,
        cross,
        cross_date: curr.date,
        updatedAt: Date.now()
      };
      store[`kdj_${code}`] = item;
      kdjData[code] = item;
    } catch (error) {
      console.warn('[Stock Watcher] KDJ refresh failed', code, error);
    }
  }));

  store.last_kline_refresh = Date.now();
  await storageSet(store);
  return kdjData;
}

async function getStoredQuotes(codes) {
  const keys = codes.map(code => `quote_${code}`);
  const data = await storageGet(keys);
  return codes.map(code => data[`quote_${code}`]).filter(Boolean);
}

async function getStoredKDJ(codes) {
  const keys = codes.map(code => `kdj_${code}`);
  const data = await storageGet(keys);
  const out = {};
  for (const code of codes) {
    if (data[`kdj_${code}`]) out[code] = data[`kdj_${code}`];
  }
  return out;
}

async function getThresholds() {
  const data = await storageGet({ price_alerts: {} });
  return data.price_alerts || {};
}

async function checkAlerts(quotes, kdjData) {
  const data = await storageGet({
    alert_settings: DEFAULT_ALERT_SETTINGS,
    alert_cooldowns: {},
    price_alerts: {}
  });
  const settings = { ...DEFAULT_ALERT_SETTINGS, ...(data.alert_settings || {}) };
  const cooldowns = data.alert_cooldowns || {};
  const thresholds = data.price_alerts || {};
  const now = Date.now();
  const cooldownMs = Math.max(1, Number(settings.cooldownMinutes) || 30) * 60 * 1000;
  const nextCooldowns = { ...cooldowns };

  function canSend(key) {
    return !nextCooldowns[key] || now - nextCooldowns[key] >= cooldownMs;
  }

  function markSent(key) {
    nextCooldowns[key] = now;
  }

  for (const quote of quotes || []) {
    const code = quote.code;
    const name = quote.name || code;

    if (settings.price && thresholds[code] && quote.price !== null) {
      const upper = toNumber(thresholds[code].upper);
      const lower = toNumber(thresholds[code].lower);
      if (upper !== null && quote.price >= upper) {
        const key = `price_upper_${code}_${upper}`;
        if (canSend(key)) {
          notify(key, `价格上穿: ${name}(${code})`, `当前 ${quote.price} >= ${upper}`);
          markSent(key);
        }
      }
      if (lower !== null && quote.price <= lower) {
        const key = `price_lower_${code}_${lower}`;
        if (canSend(key)) {
          notify(key, `价格下穿: ${name}(${code})`, `当前 ${quote.price} <= ${lower}`);
          markSent(key);
        }
      }
    }

    const kdj = kdjData && kdjData[code];
    if (!kdj || !kdj.cross) continue;

    if (kdj.cross === 'golden' && settings.golden) {
      const key = `golden_${code}_${kdj.cross_date}`;
      if (canSend(key)) {
        notify(key, `金叉: ${name}(${code})`, `K=${kdj.k} D=${kdj.d} J=${kdj.j}`);
        markSent(key);
      }
    }

    if (kdj.cross === 'death' && settings.death) {
      const key = `death_${code}_${kdj.cross_date}`;
      if (canSend(key)) {
        notify(key, `死叉: ${name}(${code})`, `K=${kdj.k} D=${kdj.d} J=${kdj.j}`);
        markSent(key);
      }
    }
  }

  await storageSet({ alert_cooldowns: nextCooldowns });
}

function notify(id, title, message) {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 2
  });
}

async function collectData() {
  const watchlist = await getWatchlist();
  const [quotes, kdj, thresholds, settings] = await Promise.all([
    getStoredQuotes(watchlist),
    getStoredKDJ(watchlist),
    getThresholds(),
    storageGet({ alert_settings: DEFAULT_ALERT_SETTINGS })
  ]);

  return {
    watchlist,
    quotes,
    kdj,
    price_alerts: thresholds,
    alert_settings: { ...DEFAULT_ALERT_SETTINGS, ...(settings.alert_settings || {}) }
  };
}

async function broadcastUpdate(quotes, kdj) {
  const data = await collectData();
  if (quotes && quotes.length) data.quotes = quotes;
  if (kdj) data.kdj = { ...data.kdj, ...kdj };

  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map(tab => {
    if (!tab.id) return Promise.resolve();
    return chrome.tabs.sendMessage(tab.id, { type: 'QUOTE_UPDATE', data }).catch(() => {});
  }));
}

async function refreshAll(options = {}) {
  if (refreshInFlight) return;
  refreshInFlight = true;

  try {
    const codes = await getWatchlist();
    const shouldFetchQuotes = options.force || isTradingHours();
    let quotes = await getStoredQuotes(codes);

    if (shouldFetchQuotes) {
      try {
        quotes = await fetchQuotes(codes);
      } catch (error) {
        console.warn('[Stock Watcher] Quote refresh failed', error);
      }
    }

    const state = await storageGet({ last_kline_refresh: 0 });
    const shouldFetchKDJ = options.force || Date.now() - Number(state.last_kline_refresh || 0) >= KLINE_INTERVAL_MS;
    let kdj = await getStoredKDJ(codes);

    if (shouldFetchKDJ) {
      kdj = { ...kdj, ...(await refreshKDJ(codes, quotes)) };
    }

    await checkAlerts(quotes, kdj);
    await broadcastUpdate(quotes, kdj);
  } finally {
    refreshInFlight = false;
  }
}

async function initialize() {
  const data = await storageGet({
    watchlist: null,
    alert_settings: null,
    price_alerts: null
  });

  const initial = {};
  if (!Array.isArray(data.watchlist) || data.watchlist.length === 0) initial.watchlist = DEFAULT_WATCHLIST;
  if (!data.alert_settings) initial.alert_settings = DEFAULT_ALERT_SETTINGS;
  if (!data.price_alerts) initial.price_alerts = {};
  if (Object.keys(initial).length > 0) await storageSet(initial);

  await chrome.alarms.create(QUOTE_ALARM, { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => {
  initialize().then(() => refreshAll({ force: true })).catch(error => {
    console.warn('[Stock Watcher] Install initialization failed', error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  initialize().then(() => refreshAll({ force: true })).catch(error => {
    console.warn('[Stock Watcher] Startup initialization failed', error);
  });
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === QUOTE_ALARM) {
    refreshAll().catch(error => console.warn('[Stock Watcher] Alarm refresh failed', error));
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || !message.type) {
      sendResponse({ ok: false, error: 'Unknown message' });
      return;
    }

    if (message.type === 'GET_DATA') {
      sendResponse({ ok: true, data: await collectData() });
      return;
    }

    if (message.type === 'GET_WATCHLIST') {
      sendResponse({ ok: true, watchlist: await getWatchlist() });
      return;
    }

    if (message.type === 'UPDATE_WATCHLIST') {
      const watchlist = uniqCodes(message.codes);
      await storageSet({ watchlist });
      refreshAll({ force: true }).catch(error => console.warn('[Stock Watcher] Refresh after watchlist update failed', error));
      sendResponse({ ok: true, watchlist });
      return;
    }

    if (message.type === 'REFRESH_NOW') {
      await refreshAll({ force: true });
      sendResponse({ ok: true, data: await collectData() });
      return;
    }

    sendResponse({ ok: false, error: `Unsupported message type: ${message.type}` });
  })().catch(error => {
    console.warn('[Stock Watcher] Message handler failed', error);
    sendResponse({ ok: false, error: error.message || String(error) });
  });

  return true;
});

initialize().catch(error => console.warn('[Stock Watcher] Initialization failed', error));
