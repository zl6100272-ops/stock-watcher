const DEFAULT_ALERT_SETTINGS = {
  golden: true,
  death: true,
  price: true,
  cooldownMinutes: 30
};

const PRIORITY_LABELS = { position: '仓', key: '关', normal: '普', silent: '静' };
const PRIORITY_CYCLE = ['position', 'key', 'normal', 'silent'];

const els = {
  list: document.getElementById('stock-list'),
  input: document.getElementById('stock-input'),
  add: document.getElementById('add-btn'),
  refresh: document.getElementById('refresh-btn'),
  golden: document.getElementById('alert-golden'),
  death: document.getElementById('alert-death'),
  price: document.getElementById('alert-price'),
  status: document.getElementById('status')
};

const state = {
  watchlist: [],
  quotes: {},
  priceAlerts: {},
  alertSettings: { ...DEFAULT_ALERT_SETTINGS },
  priorities: {}
};

function sendMessage(message) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(message, response => resolve(response));
  });
}

function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

function storageSet(data) {
  return chrome.storage.local.set(data);
}

function setStatus(message, type) {
  els.status.textContent = message || '';
  els.status.className = `status ${type || ''}`;
  if (message) {
    window.setTimeout(() => {
      if (els.status.textContent === message) setStatus('');
    }, 2600);
  }
}

function cleanCode(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function render() {
  els.golden.checked = Boolean(state.alertSettings.golden);
  els.death.checked = Boolean(state.alertSettings.death);
  els.price.checked = Boolean(state.alertSettings.price);

  if (!state.watchlist.length) {
    els.list.innerHTML = '<div class="empty">暂无自选股</div>';
    return;
  }

  els.list.innerHTML = state.watchlist.map(code => {
    const quote = state.quotes[code] || {};
    const alerts = state.priceAlerts[code] || {};
    const priority = state.priorities[code] || 'normal';
    const priorityLabel = PRIORITY_LABELS[priority] || '普';
    return `
      <div class="stock-row" data-code="${escapeHtml(code)}">
        <button class="priority-btn pri-${priority}" data-priority-action="cycle" title="${priority}">${priorityLabel}</button>
        <div class="code">${escapeHtml(code)}</div>
        <div class="name" title="${escapeHtml(quote.name || '')}">${escapeHtml(quote.name || '--')}</div>
        <input type="number" class="upper-input" placeholder="上限" value="${escapeHtml(alerts.upper ?? '')}" title="价格上限">
        <input type="number" class="lower-input" placeholder="下限" value="${escapeHtml(alerts.lower ?? '')}" title="价格下限">
        <button class="danger icon-btn delete-btn" type="button" title="删除">x</button>
      </div>
    `;
  }).join('');
}

async function load() {
  const response = await sendMessage({ type: 'GET_DATA' });
  const stored = await storageGet({
    price_alerts: {},
    alert_settings: DEFAULT_ALERT_SETTINGS,
    priorities: {}
  });
  state.priorities = stored.priorities || {};

  if (response && response.ok) {
    const data = response.data;
    state.watchlist = data.watchlist || [];
    state.quotes = Object.fromEntries((data.quotes || []).map(quote => [quote.code, quote]));
    state.priorities = data.priorities || {};
  }

  state.priceAlerts = stored.price_alerts || {};
  state.alertSettings = { ...DEFAULT_ALERT_SETTINGS, ...(stored.alert_settings || {}) };
  render();
}

async function saveWatchlist() {
  const response = await sendMessage({ type: 'UPDATE_WATCHLIST', codes: state.watchlist });
  if (!response || !response.ok) throw new Error(response && response.error ? response.error : '保存自选股失败');
  state.watchlist = response.watchlist || state.watchlist;
}

async function saveAlertSettings() {
  state.alertSettings = {
    ...state.alertSettings,
    golden: els.golden.checked,
    death: els.death.checked,
    price: els.price.checked
  };
  await storageSet({ alert_settings: state.alertSettings });
}

async function savePriceAlerts() {
  await storageSet({ price_alerts: state.priceAlerts });
}

async function savePriorities() {
  const response = await sendMessage({ type: 'UPDATE_PRIORITIES', priorities: state.priorities });
  if (!response || !response.ok) throw new Error('保存优先级失败');
}

els.input.addEventListener('input', () => {
  els.input.value = cleanCode(els.input.value);
});

els.input.addEventListener('keydown', event => {
  if (event.key === 'Enter') els.add.click();
});

els.add.addEventListener('click', async () => {
  const code = cleanCode(els.input.value);
  if (code.length !== 6) {
    setStatus('请输入 6 位股票代码', 'error');
    return;
  }
  if (state.watchlist.includes(code)) {
    setStatus('该股票已在自选股中', 'error');
    return;
  }

  state.watchlist.push(code);
  els.input.value = '';
  render();

  try {
    await saveWatchlist();
    setStatus('已添加', 'ok');
    window.setTimeout(load, 600);
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

els.list.addEventListener('click', async event => {
  const row = event.target.closest('.stock-row');
  if (!row) return;
  const code = row.dataset.code;

  if (event.target.dataset.priorityAction === 'cycle') {
    const current = state.priorities[code] || 'normal';
    const idx = PRIORITY_CYCLE.indexOf(current);
    const next = PRIORITY_CYCLE[(idx + 1) % PRIORITY_CYCLE.length];
    state.priorities[code] = next;
    render();
    try {
      await savePriorities();
      setStatus('优先级: ' + (PRIORITY_LABELS[next] || next), 'ok');
    } catch (error) {
      setStatus(error.message, 'error');
    }
    return;
  }

  if (event.target.classList.contains('delete-btn')) {
    state.watchlist = state.watchlist.filter(item => item !== code);
    delete state.priceAlerts[code];
    render();
    try {
      await Promise.all([saveWatchlist(), savePriceAlerts()]);
      setStatus('已删除', 'ok');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  }
});

els.list.addEventListener('change', async event => {
  const row = event.target.closest('.stock-row');
  if (!row) return;

  const code = row.dataset.code;
  const upper = row.querySelector('.upper-input').value;
  const lower = row.querySelector('.lower-input').value;
  const next = {};

  if (upper !== '') next.upper = Number(upper);
  if (lower !== '') next.lower = Number(lower);

  if (Object.keys(next).length) {
    state.priceAlerts[code] = next;
  } else {
    delete state.priceAlerts[code];
  }

  await savePriceAlerts();
  setStatus('预警价格已保存', 'ok');
});

for (const checkbox of [els.golden, els.death, els.price]) {
  checkbox.addEventListener('change', async () => {
    await saveAlertSettings();
    setStatus('通知设置已保存', 'ok');
  });
}

els.refresh.addEventListener('click', async () => {
  els.refresh.disabled = true;
  setStatus('正在刷新');
  const response = await sendMessage({ type: 'REFRESH_NOW' });
  els.refresh.disabled = false;
  if (response && response.ok) {
    await load();
    setStatus('已刷新', 'ok');
  } else {
    setStatus(response && response.error ? response.error : '刷新失败', 'error');
  }
});

load().catch(error => setStatus(error.message, 'error'));
