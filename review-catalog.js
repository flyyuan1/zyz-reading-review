(() => {
  'use strict';
  const data = JSON.parse(document.querySelector('#catalog-data').textContent);
  const cards = new Map([...document.querySelectorAll('.passage-card')].map(el => [el.dataset.id, el]));
  const list = document.querySelector('#passage-list');
  const fields = ['search', 'type', 'state', 'sort'];
  let selected = {position: [], frequency: [], difficulty: []};
  const storageKey = 'zyz-review-catalog-v2';
  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}'); } catch (_) {}
  fields.forEach(name => { if (saved[name] !== undefined) document.getElementById(name).value = saved[name]; });
  for (const name of Object.keys(selected)) selected[name] = saved[name] || [];
  let view = saved.view === 'list' ? 'list' : 'cards';

  function update() {
    const values = Object.fromEntries(fields.map(name => [name, document.getElementById(name).value]));
    const query = values.search.toLocaleLowerCase().replace(/[’‘]/g, "'").trim();
    const matches = data.filter(p => {
      const title = (p.title + ' ' + p.titleZh + ' ' + (p.searchAliases || '')).toLocaleLowerCase().replace(/[’‘]/g, "'");
      return (!query || title.includes(query)) && (!values.type || p.questionTypes.includes(values.type)) &&
        (!values.state || (values.state === 'attempted' ? p.attemptedGroups > 0 : values.state === 'wrong' ? p.wrongGroups > 0 : p.status === values.state)) &&
        (!selected.position.length || selected.position.includes(String(p.position))) &&
        (!selected.frequency.length || selected.frequency.includes(p.frequency)) &&
        (!selected.difficulty.length || selected.difficulty.includes(p.difficultyLabel));
    });
    matches.sort((a, b) => values.sort === 'title' ? a.title.localeCompare(b.title) :
      values.sort === 'wrong' ? b.wrongGroups - a.wrongGroups || a.position - b.position || a.title.localeCompare(b.title) :
      a.position - b.position || a.title.localeCompare(b.title));
    for (const card of cards.values()) card.hidden = true;
    for (const p of matches) { const card = cards.get(p.id); card.hidden = false; list.append(card); }
    document.getElementById('result-count').textContent = matches.length + ' 篇文章';
    document.getElementById('empty-state').hidden = matches.length !== 0;
    list.classList.toggle('list-view', view === 'list');
    document.querySelectorAll('[data-filter]').forEach(button => {
      const active = selected[button.dataset.filter].includes(button.dataset.value);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
    try { sessionStorage.setItem(storageKey, JSON.stringify({...values, ...selected, view})); } catch (_) {}
  }
  for (const name of fields) document.getElementById(name).addEventListener(name === 'search' ? 'input' : 'change', update);
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    const values = selected[button.dataset.filter], value = button.dataset.value;
    selected[button.dataset.filter] = values.includes(value) ? values.filter(v => v !== value) : [...values, value];
    update();
  }));
  document.querySelectorAll('[data-clear]').forEach(button => button.addEventListener('click', () => {
    fields.forEach(name => document.getElementById(name).value = name === 'sort' ? 'default' : '');
    selected = {position: [], frequency: [], difficulty: []}; update();
  }));
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { view = button.dataset.view; update(); }));
  update();
  function updateStudyStats() {
    if (!window.ReadingStudyStore || !window.ReadingStudyCore) return;
    const stored = ReadingStudyStore.list();
    const summary = ReadingStudyCore.summary(data.map(p=>({id:p.id,marks:p.questionCount,version:p.testVersion})),stored.attempts);
    const progress = document.getElementById('catalog-study-progress');
    if(progress)progress.textContent = '自测满分 '+summary.passed+' / '+data.length;
    for(const state of summary.states) {
      const card=cards.get(state.article.id);
      let badge=card.querySelector('.self-test-badge');
      if(!state.latest){if(badge)badge.remove();continue;}
      if(!badge){badge=document.createElement('span');badge.className='badge self-test-badge';card.querySelector('.card-badges').append(badge);}
      badge.textContent='上次自测 '+state.latest.earned+'/'+state.latest.total+(state.latest.assisted?' · 使用翻译':'');
      badge.dataset.passed=String(state.passed);
    }
  }
  addEventListener('storage',updateStudyStats);addEventListener('reading-study-updated',updateStudyStats);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateStudyStats();});
  updateStudyStats();
})();
