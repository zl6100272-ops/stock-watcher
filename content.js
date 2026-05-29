(function () {
  if (window.__stockWatcherInjected) return;
  window.__stockWatcherInjected = true;

  const host = document.createElement('div');
  host.id = 'stock-watcher-host';
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    #sw-panel {
      position: fixed;
      right: 20px;
      bottom: 20px;
      width: min(380px, calc(100vw - 32px));
      max-height: min(520px, calc(100vh - 32px));
      display: flex;
      flex-direction: column;
      z-index: 2147483647;
      overflow: hidden;
      color: #e8edf2;
      background: rgba(15, 18, 24, 0.92);
      border: 1px solid rgba(120, 132, 148, 0.34);
      border-radius: 10px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.36);
      backdrop-filter: blur(8px);
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      letter-spacing: 0;
    }
    #sw-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 10px;
      border-bottom: 1px solid rgba(120, 132, 148, 0.25);
      cursor: grab;
      user-select: none;
    }
    #sw-header:active { cursor: grabbing; }
    #sw-title { font-weight: 700; color: #f4f7fb; }
    #sw-actions { display: flex; align-items: center; gap: 6px; }
    .sw-icon-btn {
      width: 24px;
      height: 24px;
      display: inline-grid;
      place-items: center;
      border: 1px solid rgba(120, 132, 148, 0.28);
      border-radius: 6px;
      color: #d7dde6;
      background: rgba(255, 255, 255, 0.06);
      cursor: pointer;
      font: inherit;
      padding: 0;
    }
    .sw-icon-btn:hover { background: rgba(255, 255, 255, 0.12); }
    #sw-body { overflow: auto; }
    #sw-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      padding: 7px 6px;
      border-bottom: 1px solid rgba(120, 132, 148, 0.16);
      text-align: right;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align: left; }
    th {
      position: sticky;
      top: 0;
      z-index: 1;
      color: #9ea9b8;
      background: rgba(15, 18, 24, 0.96);
      font-weight: 600;
    }
    #sw-table th:nth-child(1) { width: 52px; }
    #sw-table th:nth-child(2) { width: 68px; }
    #sw-table th:nth-child(3) { width: 58px; }
    #sw-table th:nth-child(4) { width: 58px; }
    #sw-table th:nth-child(5) { width: 74px; }
    #sw-table th:nth-child(6) { width: 58px; }
    .sw-pos { color: #26a69a; }
    .sw-neg { color: #ef5350; }
    .sw-neutral { color: #c8d0da; }
    .sw-signal {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 44px;
      padding: 2px 4px;
      border-radius: 5px;
      background: rgba(255, 255, 255, 0.06);
      font-size: 11px;
    }
    #sw-footer {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      padding: 7px 10px;
      color: #9ea9b8;
      border-top: 1px solid rgba(120, 132, 148, 0.2);
    }
    #sw-compact-body {
      display: none;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
      padding: 8px;
      overflow: auto;
    }
    .sw-chip {
      min-width: 0;
      padding: 7px;
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(120, 132, 148, 0.18);
    }
    .sw-chip-top, .sw-chip-bottom {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      min-width: 0;
    }
    .sw-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sw-muted { color: #9ea9b8; }
    .sw-empty {
      padding: 18px 10px;
      text-align: center;
      color: #9ea9b8;
    }
    #sw-panel.sw-compact #sw-body { display: none; }
    #sw-panel.sw-compact #sw-compact-body { display: grid; }
    @media (max-width: 480px) {
      #sw-panel {
        right: 8px;
        bottom: 8px;
        width: calc(100vw - 16px);
      }
      th, td { padding: 6px 4px; font-size: 11px; }
    }
  `;

  const panel = document.createElement('div');
  panel.id = 'sw-panel';
  panel.innerHTML = `
    <div id="sw-header">
      <span id="sw-title">Stock Watcher</span>
      <div id="sw-actions">
        <button class="sw-icon-btn" id="sw-refresh-btn" type="button" title="刷新">R</button>
        <button class="sw-icon-btn" id="sw-compact-btn" type="button" title="紧凑模式">_</button>
      </div>
    </div>
    <div id="sw-body">
      <table id="sw-table">
        <thead>
          <tr><th>代码</th><th>名称</th><th>价格</th><th>涨跌</th><th>K/D/J</th><th>信号</th></tr>
        </thead>
        <tbody id="sw-tbody"></tbody>
      </table>
      <div id="sw-footer">
        <span id="sw-timestamp">等待数据</span>
        <span id="sw-count"></span>
      </div>
    </div>
    <div id="sw-compact-body"></div>
  `;

  root.append(style, panel);

  function appendHost() {
    if (document.body) {
      document.body.appendChild(host);
    } else {
      document.documentElement.appendChild(host);
    }
  }

  appendHost();

  const header = root.getElementById('sw-header');
  const tbody = root.getElementById('sw-tbody');
  const compactBody = root.getElementById('sw-compact-body');
  const timestamp = root.getElementById('sw-timestamp');
  const count = root.getElementById('sw-count');
  const compactButton = root.getElementById('sw-compact-btn');
  const refreshButton = root.getElementById('sw-refresh-btn');

  const state = {
    quotes: [],
    kdj: {},
    compact: false,
    dragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0
  };

  function num(value, digits) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '--';
    return n.toFixed(digits);
  }

  function pct(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '--';
    return `${n.toFixed(2)}%`;
  }

  function trendClass(value) {
    const n = Number(value);
    if (n > 0) return 'sw-pos';
    if (n < 0) return 'sw-neg';
    return 'sw-neutral';
  }

  function signalText(cross) {
    if (cross === 'golden') return '<span class="sw-signal sw-pos">金叉</span>';
    if (cross === 'death') return '<span class="sw-signal sw-neg">死叉</span>';
    return '<span class="sw-signal sw-muted">--</span>';
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

  function updatePanel(payload) {
    if (!payload) return;
    state.quotes = Array.isArray(payload.quotes) ? payload.quotes : state.quotes;
    state.kdj = payload.kdj || state.kdj || {};

    if (!state.quotes.length) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="sw-empty">暂无行情数据</div></td></tr>';
      compactBody.innerHTML = '<div class="sw-empty">暂无行情数据</div>';
      timestamp.textContent = '等待数据';
      count.textContent = '';
      return;
    }

    tbody.innerHTML = state.quotes.map(quote => {
      const kdj = state.kdj[quote.code] || {};
      const cls = trendClass(quote.change_pct);
      return `
        <tr>
          <td title="${escapeHtml(quote.code)}">${escapeHtml(quote.code)}</td>
          <td title="${escapeHtml(quote.name)}">${escapeHtml(quote.name)}</td>
          <td>${num(quote.price, 2)}</td>
          <td class="${cls}">${pct(quote.change_pct)}</td>
          <td title="K ${num(kdj.k, 2)} / D ${num(kdj.d, 2)} / J ${num(kdj.j, 2)}">${num(kdj.k, 1)}/${num(kdj.d, 1)}/${num(kdj.j, 1)}</td>
          <td>${signalText(kdj.cross)}</td>
        </tr>
      `;
    }).join('');

    compactBody.innerHTML = state.quotes.map(quote => {
      const cls = trendClass(quote.change_pct);
      return `
        <div class="sw-chip">
          <div class="sw-chip-top">
            <span class="sw-name" title="${escapeHtml(quote.name)}">${escapeHtml(quote.name || quote.code)}</span>
            <span class="sw-muted">${escapeHtml(quote.code)}</span>
          </div>
          <div class="sw-chip-bottom">
            <span>${num(quote.price, 2)}</span>
            <span class="${cls}">${pct(quote.change_pct)}</span>
          </div>
        </div>
      `;
    }).join('');

    const last = state.quotes.reduce((latest, quote) => Math.max(latest, Number(quote.timestamp) || 0), 0);
    timestamp.textContent = last ? `更新 ${new Date(last).toLocaleTimeString('zh-CN', { hour12: false })}` : '已加载';
    count.textContent = `${state.quotes.length} 只`;
  }

  function sendMessage(message) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(message, response => resolve(response));
      } catch (error) {
        resolve({ ok: false, error: error.message });
      }
    });
  }

  async function loadInitial() {
    const response = await sendMessage({ type: 'GET_DATA' });
    if (response && response.ok) updatePanel(response.data);
  }

  compactButton.addEventListener('click', event => {
    event.stopPropagation();
    state.compact = !state.compact;
    panel.classList.toggle('sw-compact', state.compact);
    compactButton.textContent = state.compact ? '+' : '_';
  });

  refreshButton.addEventListener('click', async event => {
    event.stopPropagation();
    refreshButton.disabled = true;
    const response = await sendMessage({ type: 'REFRESH_NOW' });
    if (response && response.ok) updatePanel(response.data);
    refreshButton.disabled = false;
  });

  header.addEventListener('mousedown', event => {
    if (event.target.closest('button')) return;
    const rect = panel.getBoundingClientRect();
    state.dragging = true;
    state.dragOffsetX = event.clientX - rect.left;
    state.dragOffsetY = event.clientY - rect.top;
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    event.preventDefault();
  });

  document.addEventListener('mousemove', event => {
    if (!state.dragging) return;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const left = Math.min(Math.max(0, event.clientX - state.dragOffsetX), window.innerWidth - width);
    const top = Math.min(Math.max(0, event.clientY - state.dragOffsetY), window.innerHeight - height);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }, true);

  document.addEventListener('mouseup', () => {
    state.dragging = false;
  }, true);

  document.addEventListener('keydown', event => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'h') {
      panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    }
  }, true);

  chrome.runtime.onMessage.addListener(message => {
    if (message && message.type === 'QUOTE_UPDATE') updatePanel(message.data);
  });

  loadInitial();
}());
