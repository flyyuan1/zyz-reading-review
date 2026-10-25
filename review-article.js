(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('article-data').textContent);
  const cards = [...document.querySelectorAll('.question-card')];
  const navs = [...document.querySelectorAll('[data-question]')];
  const select = document.querySelector('#attempt-select');
  const originalText = new Map([...document.querySelectorAll('.evidence-text')].map(el => [el, el.textContent]));
  let onlyWrong = false;
  function refresh() {
    let visible = 0;
    for (const card of cards) {
      const events = data.events[card.dataset.group] || [];
      const event = select.value === 'latest' ? events[events.length - 1] : events.find(e => e.attemptId === select.value);
      const status = event?.status || (events.length ? 'not-in-attempt' : 'unseen');
      card.dataset.status = status;
      card.querySelector('.question-status').textContent = ({correct:'正确',incorrect:'错误',partial:'部分正确',unanswered:'未答','not-in-attempt':'本次未作答',unseen:'未作答'})[status];
      card.querySelector('.personal-answer').innerHTML = event ? event.html : '<p class="no-history">未作答</p>';
      card.querySelector('.answered-at').textContent = event ? event.localTime : '';
      const heading = document.querySelector('[data-heading-review="' + card.id + '"]');
      if (heading) {
        heading.dataset.status = status;
        heading.querySelector('.heading-status').textContent = card.querySelector('.question-status').textContent;
        heading.querySelector('.heading-personal-answer').innerHTML = event ? event.html : '<p class="no-history">未作答</p>';
      }
      card.hidden = onlyWrong && status === 'correct';
      if (!card.hidden) visible++;
      const button = document.querySelector('[data-question="' + card.id + '"]');
      if (button) button.dataset.status = status;
      document.querySelectorAll('[data-review="' + card.id + '"]').forEach(blank => { blank.dataset.status = status; });
    }
    document.querySelectorAll('.task-group').forEach(group => {
      group.hidden = [...group.querySelectorAll('.question-card')].every(card => card.hidden);
    });
    document.querySelector('#empty-wrong').hidden = !onlyWrong || visible !== 0;
    document.querySelector('#wrong-toggle').setAttribute('aria-pressed', String(onlyWrong));
  }
  function locate(block, question) {
    if (!block) return;
    const target = document.getElementById(block);
    if (!target) return;
    document.querySelectorAll('.framework-focused').forEach(el => el.classList.remove('framework-focused'));
    document.querySelectorAll('.passage-unit.located').forEach(el => el.classList.remove('located'));
    document.querySelectorAll('.evidence-text[data-located]').forEach(el => {
      el.textContent = originalText.get(el);
      delete el.dataset.located;
    });
    document.querySelectorAll('.evidence-context-note').forEach(el => el.remove());
    const evidence = data.evidence?.[question];
    const byBlock = new Map();
    for (const span of evidence?.spans || []) {
      if (!byBlock.has(span.block)) byBlock.set(span.block, []);
      byBlock.get(span.block).push(span);
    }
    let firstMark;
    for (const [blockId, ranges] of byBlock) {
      const text = document.getElementById(blockId)?.querySelector('.evidence-text');
      if (!text) continue;
      const source = originalText.get(text);
      const merged = [];
      for (const range of ranges.sort((a, b) => a.start - b.start)) {
        const previous = merged[merged.length - 1];
        if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
        else merged.push({...range});
      }
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      for (const range of merged) {
        if (range.start < 0 || range.end > source.length || range.end <= range.start) continue;
        fragment.append(document.createTextNode(source.slice(cursor, range.start)));
        const mark = document.createElement('mark');
        mark.className = 'evidence-highlight';
        const number = document.createElement('sup');
        number.className = 'evidence-marker';
        number.textContent = evidence.number;
        number.setAttribute('aria-label', '第 ' + evidence.number + ' 题依据');
        mark.append(number, document.createTextNode(source.slice(range.start, range.end)));
        fragment.append(mark);
        firstMark ||= mark;
        cursor = range.end;
      }
      fragment.append(document.createTextNode(source.slice(cursor)));
      text.replaceChildren(fragment);
      text.dataset.located = question;
    }
    if (!firstMark) {
      target.classList.add('located');
      const note = document.createElement('p');
      note.className = 'evidence-context-note';
      note.textContent = evidence?.note ? '此题需核对全文。' + evidence.note : '此题需结合该段整体内容判断。';
      target.prepend(note);
    }
    if (matchMedia('(max-width:700px)').matches) setPane('passage');
    (firstMark || target).scrollIntoView({behavior:'smooth',block:'center'});
  }
  function setPane(pane) {
    document.body.dataset.mobilePane = pane;
    document.querySelectorAll('[data-pane]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pane === pane)));
  }
  document.querySelectorAll('[data-framework-target]').forEach(link => link.addEventListener('click', event => {
    const target = document.getElementById(link.dataset.frameworkTarget);
    if (!target) return;
    event.preventDefault();
    setPane('passage');
    document.querySelectorAll('.framework-focused').forEach(el => el.classList.remove('framework-focused'));
    target.classList.add('framework-focused');
    target.setAttribute('tabindex', '-1');
    target.focus({preventScroll:true});
    target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth',block:'start'});
  }));
  document.querySelectorAll('.locate-button[data-locate]').forEach(button => button.addEventListener('click', () => locate(button.dataset.locate, button.closest('.question-card').id)));
  navs.forEach(button => button.addEventListener('click', () => {
    onlyWrong = false; refresh();
    const card = document.getElementById(button.dataset.question);
    setPane('questions');
    const blank = document.querySelector('[data-review="' + card.id + '"]');
    (blank || card).scrollIntoView({behavior:'smooth',block:'center'});
    navs.forEach(b => b.setAttribute('aria-current', String(b === button)));
    if (!matchMedia('(max-width:700px)').matches && card.dataset.locate) locate(card.dataset.locate, card.id);
  }));
  document.querySelector('#wrong-toggle').addEventListener('click', () => { onlyWrong = !onlyWrong; refresh(); });
  select.addEventListener('change', refresh);
  document.querySelectorAll('.inline-answer').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    onlyWrong = false; refresh();
    document.getElementById(link.dataset.review).scrollIntoView({behavior:'smooth',block:'center'});
  }));
  document.querySelectorAll('[data-pane]').forEach(button => button.addEventListener('click', () => setPane(button.dataset.pane)));
  refresh();
  if (location.hash) {
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target?.classList.contains('question-card')) { setPane('questions'); target.scrollIntoView({block:'start'}); }
  }
})();
