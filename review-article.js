(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('article-data').textContent);
  const cards = [...document.querySelectorAll('.question-card')];
  const navs = [...document.querySelectorAll('[data-question]')];
  const select = document.querySelector('#attempt-select');
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
  function locate(block) {
    if (!block) return;
    const target = document.getElementById(block);
    if (!target) return;
    document.querySelectorAll('.passage-unit.located').forEach(el => el.classList.remove('located'));
    target.classList.add('located');
    if (matchMedia('(max-width:700px)').matches) setPane('passage');
    target.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function setPane(pane) {
    document.body.dataset.mobilePane = pane;
    document.querySelectorAll('[data-pane]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pane === pane)));
  }
  document.querySelectorAll('[data-locate]').forEach(button => button.addEventListener('click', () => locate(button.dataset.locate)));
  navs.forEach(button => button.addEventListener('click', () => {
    onlyWrong = false; refresh();
    const card = document.getElementById(button.dataset.question);
    setPane('questions');
    const blank = document.querySelector('[data-review="' + card.id + '"]');
    (blank || card).scrollIntoView({behavior:'smooth',block:'center'});
    navs.forEach(b => b.setAttribute('aria-current', String(b === button)));
    if (!matchMedia('(max-width:700px)').matches && card.dataset.locate) locate(card.dataset.locate);
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
