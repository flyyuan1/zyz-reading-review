/* Pair sentences after the evidence renderer has installed marks and links. */
(() => {
  'use strict';
  const data = document.getElementById('sentence-pairs');
  if (!data) return;
  const pairs = JSON.parse(data.textContent);
  const pane = document.querySelector('.passage-pane');
  if (!pane) return;
  const groups = new Map();
  let active = null;

  function wrap(container, ranges, keyPrefix) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement.closest('.evidence-marker')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let offset = 0;
    for (const node of nodes) {
      const end = offset + node.length;
      const fragment = document.createDocumentFragment();
      let cursor = offset;
      ranges.forEach(([start, stop], index) => {
        const a = Math.max(start, offset), b = Math.min(stop, end);
        if (a >= b) return;
        if (a > cursor) fragment.append(document.createTextNode(node.data.slice(cursor-offset, a-offset)));
        const span = document.createElement('span');
        const key = keyPrefix + index;
        span.className = 'sentence-pair';
        span.dataset.sentencePair = key;
        span.textContent = node.data.slice(a-offset, b-offset);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(span);
        fragment.append(span);
        cursor = b;
      });
      if (cursor < end) fragment.append(document.createTextNode(node.data.slice(cursor-offset)));
      node.replaceWith(fragment);
      offset = end;
    }
  }

  for (const [id, ranges] of Object.entries(pairs)) {
    const unit = document.getElementById(id);
    const en = unit?.querySelector('.evidence-text');
    const zh = unit?.querySelector('.paragraph-zh');
    if (!en || !zh) continue;
    wrap(en, ranges.map(range => range.slice(0, 2)), id + ':');
    wrap(zh, ranges.map(range => range.slice(2, 4)), id + ':');
  }

  function activate(key) {
    if (key === active) return;
    for (const span of groups.get(active) || []) span.classList.remove('sentence-hovered');
    active = key;
    for (const span of groups.get(active) || []) span.classList.add('sentence-hovered');
  }
  pane.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    activate(event.target.closest('.sentence-pair')?.dataset.sentencePair || null);
  });
  pane.addEventListener('pointerout', event => {
    activate(event.relatedTarget instanceof Element && pane.contains(event.relatedTarget)
      ? event.relatedTarget.closest('.sentence-pair')?.dataset.sentencePair || null : null);
  });
  window.addEventListener('blur', () => activate(null));
  document.addEventListener('visibilitychange', () => { if (document.hidden) activate(null); });
})();
