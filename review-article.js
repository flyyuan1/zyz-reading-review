(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('article-data').textContent);
  const cards = [...document.querySelectorAll('.question-card')];
  const navs = [...document.querySelectorAll('[data-question]')];
  const select = document.querySelector('#attempt-select');
  const originalText = new Map([...document.querySelectorAll('.evidence-text')].map(el => [el, el.textContent]));
  const FRAMEWORK_FLASH_MS = 3000;
  let frameworkFlashTimer;
  const evidenceTargets = new Map();
  function clearFrameworkFlash() {
    clearTimeout(frameworkFlashTimer);
    document.querySelectorAll('.passage-unit.framework-focused').forEach(el => el.classList.remove('framework-focused'));
    document.querySelectorAll('.paragraph-en.framework-flash').forEach(el => el.classList.remove('framework-flash'));
  }
  function flashFrameworkParagraph(target) {
    clearFrameworkFlash();
    const english = target.querySelector('.paragraph-en');
    if (!english) return;
    // Commit the removal so repeated activation restarts the CSS deadline too.
    void english.offsetWidth;
    english.classList.add('framework-flash');
    frameworkFlashTimer = setTimeout(() => english.classList.remove('framework-flash'), FRAMEWORK_FLASH_MS);
  }
  function renderPersistentEvidence() {
    const byBlock = new Map();
    for (const [question, evidence] of Object.entries(data.evidence || {})) {
      for (const span of evidence.spans || []) {
        if (!byBlock.has(span.block)) byBlock.set(span.block, []);
        byBlock.get(span.block).push({...span, question, number: evidence.number});
      }
    }
    for (const [block, ranges] of byBlock) {
      const text = document.getElementById(block)?.querySelector('.evidence-text');
      if (!text) continue;
      const source = originalText.get(text);
      const valid = ranges.filter(range => range.start >= 0 && range.end <= source.length && range.end > range.start);
      const points = [...new Set([0, source.length, ...valid.flatMap(range => [range.start, range.end])])].sort((a, b) => a - b);
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < points.length - 1; i++) {
        const start = points[i], end = points[i + 1];
        const active = valid.filter(range => range.start <= start && range.end >= end);
        const starting = valid.filter(range => range.start === start);
        if (starting.length) {
          const questions = [...new Map(starting.map(range => [range.question, range.number]))];
          const marker = document.createElement('sup');
          marker.className = 'evidence-marker';
          questions.forEach(([question, number], index) => {
            if (index) marker.append(document.createTextNode('、'));
            const link = document.createElement('a');
            link.className = 'evidence-question-link';
            link.href = '#' + question;
            link.dataset.evidenceQuestion = question;
            link.textContent = number;
            link.setAttribute('aria-label', '跳到第 ' + number + ' 题');
            link.addEventListener('click', event => {
              event.preventDefault();
              showEvidenceQuestion(question);
            });
            marker.append(link);
          });
          fragment.append(marker);
        }
        if (!active.length) {
          fragment.append(document.createTextNode(source.slice(start, end)));
          continue;
        }
        const mark = document.createElement('mark');
        mark.className = 'evidence-highlight';
        mark.dataset.evidenceQuestions = [...new Set(active.map(range => range.question))].join(' ');
        mark.textContent = source.slice(start, end);
        for (const range of active) if (!evidenceTargets.has(range.question)) evidenceTargets.set(range.question, mark);
        fragment.append(mark);
      }
      text.replaceChildren(fragment);
    }
  }
  let onlyWrong = new URLSearchParams(location.search).get('wrong')==='1';
  const baselineEvents=Object.fromEntries(Object.entries(data.events).map(([id,events])=>[id,[...events]]));
  const importedOptions=new Set();
  const localDate=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  function readableAnswers(values,fallback) {
    const index=window.ReadingSourceBackupIndex;
    const flat=values.flatMap(v=>Array.isArray(v)?v:[v]).filter(v=>typeof v==='string'&&v.trim());
    if(!flat.length)return '<p class="no-history">'+escape(fallback||'未作答')+'</p>';
    return flat.map(value=>{
      const en=index?.options?.[value]||value,zh=index?.optionsZh?.[value]||index?.answerGlosses?.[value.trim().toLocaleLowerCase()];
      return '<p class="answer-en">'+escape(en)+'</p>'+(zh?'<p class="answer-zh">'+escape(zh)+'</p>':'');
    }).join('');
  }
  function refreshRecords() {
    if(!window.ReadingStudyStore||!window.ReadingSourceBackupIndex||!data.passageId)return;
    const passage=ReadingSourceBackupIndex.passages.find(p=>p.id===data.passageId);if(!passage)return;
    data.events=Object.fromEntries(Object.entries(baselineEvents).map(([id,events])=>[id,[...events]]));
    const choices=new Map(),add=(sourceId,event,label)=>{
      const events=data.events[sourceId]||=[];
      if(!events.some(e=>e.attemptId===event.attemptId)){events.push(event);events.sort((a,b)=>a.submittedAt.localeCompare(b.submittedAt));choices.set(event.attemptId,{label,date:event.submittedAt});}
    };
    for(const attempt of ReadingStudyStore.listSources().attempts.filter(a=>a.passageId===data.passageId))for(const group of attempt.groups){
      add(group.sourceId,{attemptId:attempt.sourceId,submittedAt:attempt.submittedAt,status:group.status,
        html:readableAnswers(group.answers.map(a=>a.value),'原备份未保存个人答案'),localTime:'原站 · '+localDate.format(new Date(attempt.submittedAt))},'原站导入 · '+localDate.format(new Date(attempt.submittedAt))+(attempt.fullCoverage?'':' · 部分题组'));
    }
    for(const attempt of ReadingStudyStore.list().attempts.filter(a=>a.passageId===data.passageId&&a.version===data.testVersion)){
      const grades=new Map(attempt.outcomes.map(g=>[g.id,g]));
      for(const group of passage.groups){
        const grade=grades.get(group.id);if(!grade)continue;
        const values=group.evaluation==='unordered-membership'?(attempt.snapshot.sets[group.id]||[]):group.testResponses.map(id=>attempt.snapshot.responses[id]);
        const filled=values.some(v=>typeof v==='string'&&v.trim());
        const status=grade.earned===grade.total?'correct':grade.earned>0?'partial':filled?'incorrect':'unanswered';
        add(group.sourceId,{attemptId:'self:'+attempt.id,submittedAt:attempt.submittedAt,status,html:readableAnswers(values),localTime:'自测 · '+localDate.format(new Date(attempt.submittedAt))},'自测 · '+localDate.format(new Date(attempt.submittedAt))+' · '+attempt.earned+'/'+attempt.total);
      }
    }
    const selected=select.value;
    for(const option of [...select.options])if(importedOptions.has(option.value))option.remove();
    importedOptions.clear();
    const fragment=document.createDocumentFragment();
    for(const [id,choice] of [...choices].sort((a,b)=>b[1].date.localeCompare(a[1].date)))if(![...select.options].some(o=>o.value===id)){
      const option=document.createElement('option');option.value=id;option.textContent=choice.label;fragment.append(option);importedOptions.add(id);
    }
    select.options[0].after(fragment);select.value=[...select.options].some(o=>o.value===selected)?selected:'latest';
  }
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
    clearFrameworkFlash();
    document.querySelectorAll('.passage-unit.located').forEach(el => el.classList.remove('located'));
    document.querySelectorAll('.evidence-context-note').forEach(el => el.remove());
    const evidence = data.evidence?.[question];
    const firstMark = evidenceTargets.get(question);
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
  function showEvidenceQuestion(question) {
    const card = document.getElementById(question);
    if (!card) return;
    // The requested question may currently be hidden by the wrong-answer filter.
    onlyWrong = false;
    refresh();
    setPane('questions');
    card.setAttribute('tabindex', '-1');
    card.focus({preventScroll:true});
    card.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth',block:'start'});
    navs.forEach(button => button.setAttribute('aria-current', String(button.dataset.question === question)));
  }
  document.querySelectorAll('[data-framework-target]').forEach(link => link.addEventListener('click', event => {
    const target = document.getElementById(link.dataset.frameworkTarget);
    if (!target) return;
    event.preventDefault();
    setPane('passage');
    // Keep focus on the source unit; briefly mark only its English paragraph.
    target.setAttribute('tabindex', '-1');
    target.focus({preventScroll:true});
    target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth',block:'start'});
    flashFrameworkParagraph(target);
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
  addEventListener('storage',()=>{refreshRecords();refresh();});
  addEventListener('reading-study-updated',()=>{refreshRecords();refresh();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshRecords();refresh();}});
  document.querySelectorAll('.inline-answer').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    onlyWrong = false; refresh();
    document.getElementById(link.dataset.review).scrollIntoView({behavior:'smooth',block:'center'});
  }));
  document.querySelectorAll('[data-pane]').forEach(button => button.addEventListener('click', () => setPane(button.dataset.pane)));
  clearFrameworkFlash();
  renderPersistentEvidence();
  refreshRecords();
  const sourceChoice=new URLSearchParams(location.search).get('source');
  if(sourceChoice&&[...select.options].some(option=>option.value===sourceChoice))select.value=sourceChoice;
  refresh();
  if (location.hash) {
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target?.classList.contains('question-card')) { setPane('questions'); target.scrollIntoView({block:'start'}); }
  }
})();
