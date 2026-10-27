(() => {
  'use strict';
  // Remove the access key before initialization or any asynchronous work.
  let incoming = null;
  if (location.hash.startsWith('#sync=')) {
    try { incoming = decodeURIComponent(location.hash.slice(6)); } catch (_) { incoming = ''; }
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { location.hash = ''; }
  }
  const scriptURL = document.currentScript && document.currentScript.src;
  const baseURL = new URL('./', scriptURL || location.href);
  const planURL = new URL('复习计划.html', baseURL);
  function init() {
    if (!window.ReadingSyncClient || document.getElementById('reading-sync-status')) return;
    const make = (tag, text, className) => {
      const el = document.createElement(tag);
      if (text !== undefined) el.textContent = text;
      if (className) el.className = className;
      return el;
    };
    const compact = make('aside', undefined, 'reading-sync-compact');
    compact.id = 'reading-sync-status';
    compact.setAttribute('aria-label', '设备同步');
    const compactText = make('span');
    compactText.setAttribute('role', 'status');
    compactText.setAttribute('aria-live', 'polite');
    const compactLink = make('a', '同步设置');
    compactLink.href = planURL.href + '#cloud-sync';
    compact.append(compactText, compactLink);
    const hero = document.querySelector('.study-hero');
    const isPlan = !!(document.getElementById('study-data') && hero);
    const compactHost = document.querySelector('.study-header, .catalog-header, .test-header, .review-header, header');
    if (compactHost) compactHost.insertAdjacentElement('afterend', compact);
    else document.body.prepend(compact);

    let panel, statusText, message, codeInput, form, createButton, joinButton;
    let syncButton, codeButton, linkButton, disconnectButton, fallback, fallbackText, closeButton;
    let state = { status: 'disconnected', connected: false }, client;
    let busy = false, syncing = false, queued = false, generation = 0;
    let timer = null, failures = 0, ready = false;
    if (isPlan) {
      panel = make('section', undefined, 'reading-sync-panel');
      panel.id = 'cloud-sync'; panel.setAttribute('aria-labelledby', 'cloud-sync-title');
      const heading = make('h2', '手机与电脑同步'); heading.id = 'cloud-sync-title';
      const intro = make('p', '配对一次，自动合并两端已有成绩。已交卷的成绩、作答记录、原站历史和明确保存的计划设置会在本机加密后同步；未交卷草稿仍留在当前设备。');
      statusText = make('p', undefined, 'reading-sync-detail');
      statusText.setAttribute('role', 'status'); statusText.setAttribute('aria-live', 'polite');
      const actions = make('div', undefined, 'reading-sync-actions');
      const button = (label, action) => {
        const el = make('button', label); el.type = 'button'; el.addEventListener('click', action); actions.append(el); return el;
      };
      createButton = button('启用同步', () => connect('create'));
      syncButton = button('立即同步', () => requestSync(true));
      codeButton = button('复制配对码', () => copySecret(false));
      linkButton = button('复制配对链接', () => copySecret(true));
      disconnectButton = button('断开本机', disconnect);
      disconnectButton.className = 'reading-sync-secondary';
      form = make('form', undefined, 'reading-sync-pair');
      const label = make('label', '已有配对码或配对链接'); label.htmlFor = 'cloud-sync-code';
      codeInput = make('input'); codeInput.id = 'cloud-sync-code'; codeInput.type = 'password';
      codeInput.autocomplete = 'off'; codeInput.spellcheck = false; codeInput.autocapitalize = 'off';
      codeInput.placeholder = '粘贴自己的配对码或链接';
      codeInput.setAttribute('aria-describedby', 'cloud-sync-security');
      joinButton = make('button', '已有配对码'); joinButton.type = 'submit';
      const pairRow = make('div', undefined, 'reading-sync-pair-row'); pairRow.append(codeInput, joinButton);
      form.append(label, pairRow); form.addEventListener('submit', event => { event.preventDefault(); connect('join'); });
      message = make('p', '', 'reading-sync-message'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite'); message.hidden = true;
      const security = make('p', '配对码是访问钥匙，只分享给自己的设备。请妥善保存；清理浏览器数据后，需要它重新连接。断开本机只移除连接，不删除本机或云端历史。', 'reading-sync-security');
      security.id = 'cloud-sync-security';
      fallback = make('div', undefined, 'reading-sync-fallback'); fallback.hidden = true;
      const fallbackLabel = make('label', '未能访问剪贴板，请选中下方内容手动复制'); fallbackLabel.htmlFor = 'cloud-sync-copy';
      fallbackText = make('textarea'); fallbackText.id = 'cloud-sync-copy'; fallbackText.readOnly = true; fallbackText.rows = 3;
      closeButton = make('button', '隐藏配对内容'); closeButton.type = 'button'; closeButton.addEventListener('click', clearSecret);
      fallback.append(fallbackLabel, fallbackText, closeButton);
      panel.append(heading, intro, statusText, actions, form, message, fallback, security);
      hero.insertAdjacentElement('afterend', panel);
      if (incoming !== null) {
        codeInput.value = incoming;
        showMessage('已收到配对信息。请点击“已有配对码”连接；现有连接不会自动替换。');
        incoming = null;
      }
      codeInput.addEventListener('input', () => { joinButton.textContent = state.connected ? '连接此配对码（替换本机连接）' : '已有配对码'; });
    }
    function showMessage(text) { if (message) { message.textContent = text; message.hidden = !text; } }
    function clearSecret() { if (fallback) { fallbackText.value = ''; fallback.hidden = true; } }
    function statusLabel() {
      if (!state.connected) return '未连接';
      if (navigator.onLine === false || state.status === 'offline') return '离线，待同步';
      const count = Array.isArray(state.conflicts) ? state.conflicts.length : Number(state.conflicts) || 0;
      if (state.status === 'syncing' || syncing) return '同步中…';
      if (state.status === 'error') return '同步失败，将自动重试';
      if (state.status === 'conflict' || count) return '存在冲突' + (count ? '（' + count + ' 条）' : '') + '，已保留可靠记录';
      return state.status === 'synced' ? '已同步' : '等待同步';
    }
    function render() {
      compactText.textContent = statusLabel();
      compact.dataset.state = navigator.onLine === false && state.connected ? 'offline' : state.status;
      if (!panel) return;
      let detail = statusLabel();
      if (state.lastSyncedAt) {
        const date = new Date(state.lastSyncedAt);
        if (Number.isFinite(date.getTime())) detail += ' · 上次成功：' + date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
      }
      statusText.textContent = detail;
      createButton.hidden = !!state.connected;
      [syncButton, codeButton, linkButton, disconnectButton].forEach(el => { el.hidden = !state.connected; });
      [createButton, syncButton, codeButton, linkButton, joinButton].forEach(el => { el.disabled = busy || syncing; });
      codeInput.disabled = busy;
      joinButton.textContent = state.connected ? '连接此配对码（替换本机连接）' : '已有配对码';
    }
    function cancelTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
    function schedule(delay) {
      cancelTimer();
      if (!ready || !state.connected || document.hidden || navigator.onLine === false) return;
      timer = setTimeout(() => { timer = null; requestSync(false); }, delay);
    }
    function nextDelay() { return failures ? Math.min(300000, 5000 * Math.pow(2, Math.min(failures - 1, 6))) : 30000; }
    async function requestSync(manual) {
      if (!state.connected) return;
      if (busy || syncing) { queued = true; return; }
      if (navigator.onLine === false) { render(); return; }
      cancelTimer(); syncing = true; const ticket = generation; render();
      try {
        await client.sync();
        if (ticket !== generation) return;
        state = client.getState();
        if (state.status === 'error' || state.status === 'offline') failures++;
        else { failures = 0; if (manual) showMessage('同步检查完成。'); }
      } catch (_) {
        if (ticket !== generation) return;
        failures++; state = Object.assign({}, state, { status: navigator.onLine === false ? 'offline' : 'error' });
        if (manual) showMessage(navigator.onLine === false ? '当前离线，成绩仍保存在本机。联网后会继续同步。' : '暂时无法同步，成绩仍保存在本机。请稍后重试。');
      } finally {
        if (ticket === generation) {
          syncing = false; render();
          const delay = queued && !failures ? 500 : nextDelay(); queued = false; schedule(delay);
        }
      }
    }
    function parseCode(value) {
      const text = value.trim();
      if (/^ZYZ1-[A-Za-z0-9_-]{43}$/.test(text)) return text;
      try {
        const url = new URL(text);
        const canonical = url.origin === 'https://flyyuan1.github.io' && decodeURI(url.pathname) === '/zyz-reading-review/复习计划.html';
        const samePage = url.origin === planURL.origin && decodeURI(url.pathname) === decodeURI(planURL.pathname);
        if (!canonical && !samePage) return null;
        const candidate = decodeURIComponent(url.hash.slice(6));
        return url.hash.startsWith('#sync=') && /^ZYZ1-[A-Za-z0-9_-]{43}$/.test(candidate) ? candidate : null;
      } catch (_) { return null; }
    }
    async function connect(kind) {
      if (busy || syncing) return;
      const code = kind === 'join' ? parseCode(codeInput.value) : null;
      if (kind === 'join' && !code) { showMessage('配对信息格式不正确，请粘贴完整的配对码或本站配对链接。'); codeInput.focus(); return; }
      if (kind === 'create' && state.connected) return;
      clearSecret(); showMessage(''); cancelTimer(); busy = true; const ticket = generation; render();
      try {
        await (kind === 'create' ? client.createSpace() : client.join(code));
        if (ticket !== generation) return;
        state = client.getState(); failures = state.status === 'error' || state.status === 'offline' ? 1 : 0;
        codeInput.value = '';
        showMessage(state.status === 'error' || state.status === 'offline' ? '配对已保存在本机，同步尚未完成；联网后会自动重试。' : '已连接。另一台设备可使用“复制配对链接”完成配对。');
      } catch (_) {
        if (ticket !== generation) return;
        state = client.getState(); if (state.connected) failures++;
        showMessage(navigator.onLine === false ? '当前离线，暂时无法完成配对。请联网后重试。' : '未能完成配对，请检查配对码或网络后重试。本机历史已保留。');
      } finally {
        if (ticket === generation) { busy = false; render(); const delay = queued && !failures ? 500 : nextDelay(); queued = false; schedule(delay); }
      }
    }
    async function copySecret(asLink) {
      if (busy || syncing) return;
      let secret;
      try {
        secret = client.getCode();
        if (!secret) return;
        if (asLink) {
          const target = location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? new URL(planURL) : new URL('https://flyyuan1.github.io/zyz-reading-review/复习计划.html');
          target.hash = 'sync=' + secret; secret = target.href;
        }
        const ticket = generation;
        try {
          await navigator.clipboard.writeText(secret);
          if (ticket === generation) { clearSecret(); showMessage('已复制。请只发送给自己的设备，并妥善保存。'); }
        } catch (_) {
          if (ticket === generation) { fallbackText.value = secret; fallback.hidden = false; fallbackText.focus(); fallbackText.select(); showMessage('请手动复制，完成后隐藏配对内容。'); }
        }
      } catch (_) { showMessage('暂时无法读取配对信息，请重试。'); }
    }
    function disconnect() {
      cancelTimer(); generation++; queued = false; busy = false; syncing = false; failures = 0;
      clearSecret(); if (codeInput) codeInput.value = '';
      try { client.disconnect(); } catch (_) { showMessage('未能移除本机连接，请重试。'); state = client.getState(); render(); return; }
      state = client.getState(); showMessage('本机已断开同步，已有成绩和云端历史均保留。'); render();
    }
    function createClient() {
      // The engine invalidates its own stale runs; the UI generation guards action messages.
      client = window.ReadingSyncClient.create({ autoSyncEvents: false, onState: value => { state = value; render(); } });
      state = client.getState(); render();
    }
    try { createClient(); } catch (_) { showMessage('此浏览器暂时无法启用同步，请检查安全连接和浏览器存储设置。'); compactText.textContent = '同步暂不可用'; return; }
    ready = true;
    addEventListener('reading-study-updated', event => {
      if (event.detail && event.detail.source === 'sync') return;
      if (syncing || busy) { queued = true; return; }
      schedule(failures ? nextDelay() : 700);
    });
    addEventListener('online', () => { failures = 0; requestSync(false); });
    addEventListener('offline', () => { cancelTimer(); render(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelTimer(); clearSecret(); } else requestSync(false); });
    addEventListener('storage', event => {
      // Ignore cursor/ack writes so two open tabs cannot trigger each other forever.
      if (event.key && event.key !== 'zyz-reading-sync-connection-v1' && event.key !== 'zyz-reading-plan-v1' && !event.key.startsWith('zyz-reading-attempt-v1:') && !event.key.startsWith('zyz-reading-source-attempt-v1:')) return;
      if ((!event.key || event.key === 'zyz-reading-sync-connection-v1') && typeof client.reloadConnection === 'function') {
        try {
          cancelTimer(); generation++; busy = false; syncing = false; queued = false; failures = 0;
          clearSecret(); if (codeInput) codeInput.value = '';
          client.reloadConnection(); state = client.getState(); render();
        } catch (_) { showMessage('另一标签页的连接已更改，请刷新本页以更新同步连接。'); return; }
      }
      if (!busy && !syncing) schedule(failures ? nextDelay() : 700);
    });
    addEventListener('pagehide', () => { cancelTimer(); clearSecret(); });
    addEventListener('pageshow', event => { if (event.persisted) requestSync(false); });
    schedule(100);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
