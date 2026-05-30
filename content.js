(function () {
  if (window.__stockWatcherInjected) return;
  window.__stockWatcherInjected = true;

  const host = document.createElement('div');
  host.id = 'stock-watcher-host';
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    #sw-dot-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      width: 100vw;
      height: 6px;
      z-index: 2147483647;
      cursor: pointer;
      transition: background-color 0.3s ease;
    }
    #sw-dot-bar:hover { height: 10px; }
    #sw-dot-bar.sw-hidden { display: none; }
    #sw-dot-bar.pulse {
      animation: sw-pulse 1s ease-out;
    }
    @keyframes sw-pulse {
      0% { filter: brightness(2); }
      50% { filter: brightness(3); }
      100% { filter: brightness(1); }
    }
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

  const dotBar = document.createElement('div');
  dotBar.id = 'sw-dot-bar';
  dotBar.className = 'sw-dot-bar';
  dotBar.title = '等待数据';

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
        <span><span id="sw-count"></span> <span id="sw-updown"></span></span>
      </div>
    </div>
    <div id="sw-compact-body"></div>
  `;

  root.append(style, dotBar, panel);

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
  const updown = root.getElementById('sw-updown');
  const compactButton = root.getElementById('sw-compact-btn');
  const refreshButton = root.getElementById('sw-refresh-btn');

  const state = {
    quotes: [],
    kdj: {},
    compact: false,
    mode: 'dot',
    autoTimer: null,
    lastDisplayMode: 'full',
    dragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    priorities: {},
    pendingAlerts: 0,
    peekMode: false,
    prePeekMode: 'dot'
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

  function countMoves(quotes) {
    let ups = 0;
    let downs = 0;
    for (const quote of quotes || []) {
      const changePct = Number(quote.change_pct);
      if (changePct > 0) ups += 1;
      else if (changePct < 0) downs += 1;
    }
    return { ups, downs };
  }

  function updateDotColor(quotes) {
    if (!quotes || quotes.length === 0) {
      dotBar.style.backgroundColor = '#2a7d6f';
      dotBar.title = '等待数据';
      return;
    }
    const weights = { position: 3, key: 2, normal: 1 };
    let weightedScore = 0;
    let weightSum = 0;
    for (const quote of quotes) {
      const p = state.priorities[quote.code] || 'normal';
      const w = weights[p] || 1;
      if (p === 'silent') continue;
      const changePct = Number(quote.change_pct);
      if (changePct > 0) weightedScore += w;
      else if (changePct < 0) weightedScore -= w;
      weightSum += w;
    }
    if (weightSum === 0) {
      dotBar.style.backgroundColor = '#667386';
    } else {
      const avgScore = weightedScore / weightSum;
      if (avgScore > 0.1) dotBar.style.backgroundColor = '#26a69a';
      else if (avgScore < -0.1) dotBar.style.backgroundColor = '#ef5350';
      else dotBar.style.backgroundColor = '#667386';
    }
    const { ups, downs } = countMoves(quotes);
    const alertSuffix = state.pendingAlerts ? ' | ' + state.pendingAlerts + '个预警' : '';
    dotBar.title = quotes.length + '只 - ' + ups + '涨 ' + downs + '跌' + alertSuffix;
  }

  function sortByPriority(quotes, priorities) {
    const order = { position: 0, key: 1, normal: 2, silent: 3 };
    return [...quotes].sort((a, b) => {
      const pa = order[priorities[a.code]] ?? 2;
      const pb = order[priorities[b.code]] ?? 2;
      if (pa !== pb) return pa - pb;
      return (a.name || a.code).localeCompare(b.name || b.code, 'zh');
    });
  }

  function resetAutoTimer() {
    if (state.autoTimer) {
      clearTimeout(state.autoTimer);
      state.autoTimer = null;
    }
    if (state.mode === 'hidden' || state.mode === 'dot') return;

    const timeouts = { full: 12000, compact: 25000 };
    const ms = timeouts[state.mode] || 12000;

    state.autoTimer = setTimeout(() => {
      if (state.mode === 'full') setMode('compact');
      else if (state.mode === 'compact') setMode('dot');
    }, ms);
  }

  function setMode(newMode) {
    state.mode = newMode;

    if (newMode === 'hidden') {
      panel.style.display = 'none';
      dotBar.style.display = '';
      dotBar.classList.add('sw-hidden');
    } else if (newMode === 'dot') {
      dotBar.classList.remove('sw-hidden');
      dotBar.style.display = 'block';
      panel.style.display = 'none';
      updateDotColor(state.quotes);
    } else if (newMode === 'compact') {
      state.compact = true;
      state.lastDisplayMode = 'compact';
      state.pendingAlerts = 0;
      dotBar.classList.remove('sw-hidden');
      dotBar.style.display = 'none';
      panel.style.display = 'flex';
      panel.classList.add('sw-compact');
      compactButton.textContent = '+';
    } else if (newMode === 'full') {
      state.compact = false;
      state.lastDisplayMode = 'full';
      state.pendingAlerts = 0;
      dotBar.classList.remove('sw-hidden');
      dotBar.style.display = 'none';
      panel.style.display = 'flex';
      panel.classList.remove('sw-compact');
      compactButton.textContent = '_';
    }

    resetAutoTimer();
  }

  async function fetchFreshData() {
    const response = await sendMessage({ type: 'REFRESH_NOW' });
    if (response && response.ok) {
      state.priorities = response.data.priorities || state.priorities;
      updatePanel(response.data);
    }
  }

  function togglePanel() {
    if (state.mode === 'hidden') {
      fetchFreshData().then(() => setMode(state.lastDisplayMode || 'full'));
    } else {
      setMode('hidden');
    }
  }

  function updatePanel(payload) {
    if (!payload) return;

    // Build complete stock list: all watchlist codes with or without quote data
    const watchlist = Array.isArray(payload.watchlist) ? payload.watchlist : null;
    const rawQuotes = Array.isArray(payload.quotes) ? payload.quotes : [];
    if (watchlist && watchlist.length > 0) {
      const quoteMap = new Map(rawQuotes.map(q => [q.code, q]));
      state.quotes = watchlist.map(code =>
        quoteMap.get(code) || { code, name: code, price: null, change_pct: null, change: null, high: null, low: null, volume: null, time: null, timestamp: null }
      );
    } else {
      state.quotes = rawQuotes;
    }
    state.priorities = payload.priorities || state.priorities || {};
    state.kdj = payload.kdj || state.kdj || {};
    const sorted = sortByPriority(state.quotes, state.priorities);

    if (!state.quotes.length) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="sw-empty">暂无行情数据</div></td></tr>';
      compactBody.innerHTML = '<div class="sw-empty">暂无行情数据</div>';
      timestamp.textContent = '等待数据';
      count.textContent = '';
      updown.textContent = '';
      updateDotColor(state.quotes);
      return;
    }

    tbody.innerHTML = sorted.map(quote => {
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

    compactBody.innerHTML = sorted.map(quote => {
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

    const last = sorted.reduce((latest, quote) => Math.max(latest, Number(quote.timestamp) || 0), 0);
    const { ups, downs } = countMoves(state.quotes);
    timestamp.textContent = last ? `更新 ${new Date(last).toLocaleTimeString('zh-CN', { hour12: false })}` : '已加载';
    count.textContent = `${state.quotes.length} 只`;
    updown.textContent = ups || downs ? `↑${ups} ↓${downs}` : '';
    updateDotColor(state.quotes);
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
    if (response && response.ok) {
      state.priorities = response.data.priorities || {};
      updatePanel(response.data);
    }
    setMode('dot');
    updateDotColor(state.quotes);
  }

  compactButton.addEventListener('click', event => {
    event.stopPropagation();
    if (state.mode === 'compact') {
      setMode('full');
    } else {
      setMode('compact');
    }
  });

  refreshButton.addEventListener('click', async event => {
    event.stopPropagation();
    refreshButton.disabled = true;
    try {
      const response = await sendMessage({ type: 'REFRESH_NOW' });
      if (response && response.ok) updatePanel(response.data);
    } finally {
      refreshButton.disabled = false;
      resetAutoTimer();
    }
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
    resetAutoTimer();
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
    resetAutoTimer();
  }, true);

  document.addEventListener('mouseup', () => {
    state.dragging = false;
  }, true);

  for (const target of [panel, header]) {
    for (const eventName of ['mousedown', 'mouseup', 'mousemove', 'click', 'keydown']) {
      target.addEventListener(eventName, resetAutoTimer);
    }
  }

  dotBar.addEventListener('click', () => {
    fetchFreshData().then(() => setMode(state.lastDisplayMode || 'full'));
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Alt' && !event.repeat) {
      if (state.mode === 'dot' || state.mode === 'hidden') {
        event.preventDefault();
        state.peekMode = true;
        state.prePeekMode = state.mode;
        fetchFreshData().then(() => setMode('compact'));
      }
    }
    if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'h') {
      togglePanel();
    }
  }, true);

  document.addEventListener('keyup', event => {
    if (event.key === 'Alt' && state.peekMode) {
      state.peekMode = false;
      setMode(state.prePeekMode || 'dot');
    }
  }, true);

  // Hover peek on dot bar: hover shows compact, unhide restores dot
  let hoverPeekTimer = null;
  dotBar.addEventListener('mouseenter', () => {
    if (state.mode === 'dot') {
      state.peekMode = true;
      state.prePeekMode = 'dot';
      fetchFreshData().then(() => setMode('compact'));
    }
  });
  dotBar.addEventListener('mouseleave', () => {
    if (state.peekMode && state.prePeekMode === 'dot') {
      // Delay hiding so user can move mouse to the panel
      clearTimeout(hoverPeekTimer);
      hoverPeekTimer = setTimeout(() => {
        state.peekMode = false;
        setMode('dot');
      }, 500);
    }
  });

  chrome.runtime.onMessage.addListener(message => {
    if (message && message.type === 'QUOTE_UPDATE') updatePanel(message.data);
    if (message && message.type === 'TOGGLE_PANEL') togglePanel();
    if (message && message.type === 'SILENT_ALERT') {
      state.pendingAlerts += 1;
      dotBar.classList.add('pulse');
      setTimeout(() => {
        dotBar.classList.remove('pulse');
        updateDotColor(state.quotes);
      }, 1000);
      updateDotColor(state.quotes);
    }
  });

  setMode('dot');
  loadInitial();
}());
