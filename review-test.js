(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('test-data').textContent);
  const key = 'zyz-reading-test-v1:' + data.passageId;
  const controls = [...document.querySelectorAll('[data-response], [data-set]')];
  const groups = new Map(data.groups.map(g => [g.id, g]));
  const cards = new Map([...document.querySelectorAll('[data-group]')].map(el => [el.dataset.group, el]));
  const submit = document.getElementById('submit-test');
  const restart = document.getElementById('restart-test');
  const lastButton = document.getElementById('last-result');
  const translationButton = document.getElementById('translation-toggle');
  const summary = document.getElementById('test-summary');
  const status = document.getElementById('save-status');
  const announcement = document.getElementById('test-announcement');
  let editing = true, assisted = false, previewingLast = false, record = {}, draft = {responses:{},sets:{}};
  let storageAvailable = true;
  let elapsedSeconds = 0,lastSavedClock = 0,lastActivity = Date.now();
  try {
    record = JSON.parse(localStorage.getItem(key) || '{}');
    if (!record || record.version !== data.version) record = {};
  } catch (_) { storageAvailable = false; record = {}; }
  if (record.draft && typeof record.draft.responses === 'object' && typeof record.draft.sets === 'object') {
    draft = record.draft;
    assisted = !!record.draftAssisted;
    status.textContent = '已恢复未交卷的作答';
    elapsedSeconds = Math.max(0,Number(record.draftElapsedSeconds)||0);
  }
  const shared = ReadingStudyStore.list();
  const previousAttempts = shared.attempts.filter(a => a.passageId === data.passageId && a.version === data.version);
  const previousShared = previousAttempts[previousAttempts.length - 1];
  if (previousShared && (!record.lastSubmission || previousShared.submittedAt > record.lastSubmission.submittedAt)) {
    record.lastSubmission = {snapshot:previousShared.snapshot,assisted:previousShared.assisted,submittedAt:previousShared.submittedAt,durationSeconds:previousShared.durationSeconds,historyId:previousShared.id};
  }
  function saveShared(snapshot,usedTranslation,result,submittedAt,durationSeconds,id) {
    return ReadingStudyStore.append({id,passageId:data.passageId,version:data.version,submittedAt,
      earned:result.earned,total:result.total,assisted:usedTranslation,durationSeconds,snapshot,
      outcomes:Object.entries(result.results).map(([id,r])=>({id,earned:r.earned,total:r.total}))});
  }
  if (record.lastSubmission?.snapshot && record.lastSubmission.submittedAt) {
    const last = record.lastSubmission;
    const id = last.historyId || 'legacy:'+data.passageId+':'+last.submittedAt;
    const saved = saveShared(last.snapshot,last.assisted,ReadingTestCore.grade(data.groups,last.snapshot),last.submittedAt,last.durationSeconds||0,id);
    if(saved.ok)last.historyId=id;
  }
  if (record.lastSubmission?.snapshot) {
    lastButton.hidden = false;
    const previous = ReadingTestCore.grade(data.groups, record.lastSubmission.snapshot);
    status.textContent = '上次 ' + previous.earned + ' / ' + previous.total + ' 分；本次可重新作答';
  }
  const smooth = () => matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth';
  function setPane(pane) {
    document.body.dataset.mobilePane = pane;
    document.querySelectorAll('[data-pane]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pane === pane)));
  }
  function readSnapshot() {
    const responses = {}, sets = {};
    for (const input of controls) {
      if (input.dataset.set) {
        sets[input.dataset.set] ||= [];
        if (input.checked) sets[input.dataset.set].push(input.value);
      } else if (input.type !== 'radio' || input.checked) responses[input.dataset.response] = input.value;
    }
    return {responses, sets};
  }
  function applySnapshot(snapshot) {
    const responses = snapshot.responses || {}, sets = snapshot.sets || {};
    for (const input of controls) {
      if (input.dataset.set) input.checked = Array.isArray(sets[input.dataset.set]) && sets[input.dataset.set].includes(input.value);
      else if (input.type === 'radio') input.checked = responses[input.dataset.response] === input.value;
      else input.value = typeof responses[input.dataset.response] === 'string' ? responses[input.dataset.response] : '';
    }
  }
  function persist() {
    if(editing){record.draftElapsedSeconds=elapsedSeconds;record.draftUpdatedAt=new Date().toISOString();}
    try {
      localStorage.setItem(key, JSON.stringify({...record, version:data.version}));
      storageAvailable = true;
    } catch (_) { storageAvailable = false; }
    if (!storageAvailable) status.textContent = '当前浏览器无法保存，请在离开前交卷核对';
  }
  function updateReuse() {
    const selects = controls.filter(c => c.tagName === 'SELECT' && c.dataset.reuse === 'forbidden');
    for (const input of selects) {
      for (const option of input.options) {
        option.disabled = !!option.value && selects.some(other => other.dataset.task === input.dataset.task && other.dataset.response !== input.dataset.response && other.value === option.value);
      }
    }
  }
  function progress(snapshot = readSnapshot()) {
    let answered = 0;
    for (const g of data.groups) {
      const count = g.evaluation === 'unordered-membership' ? (snapshot.sets[g.id] || []).length : g.responses.filter(id => String(snapshot.responses[id] || '').trim()).length;
      answered += Math.min(count, g.responses.length);
      const button = document.querySelector('[data-test-question="' + g.id + '"]');
      if (editing) button.dataset.testStatus = count ? 'answered' : '';
    }
    document.getElementById('test-progress').textContent = '已答 ' + answered + ' / ' + Object.keys(data.responseNumbers).length;
    updateReuse();
  }
  function setTranslations(show) {
    document.body.dataset.translations = show ? 'on' : 'off';
    translationButton.setAttribute('aria-pressed', String(show));
    translationButton.textContent = show ? '隐藏翻译' : '显示翻译';
    for (const option of document.querySelectorAll('option[data-option-en]')) option.textContent = option.dataset.optionEn + (show && option.dataset.optionZh ? ' / ' + option.dataset.optionZh : '');
    if (editing && show) assisted = true;
  }
  function displayValue(value, g) {
    const option = g.options.find(o => o.value === value);
    return option ? (option.label ? option.label + ' · ' : '') + option.text : String(value || '未作答');
  }
  function addText(parent, tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text;
    parent.append(el);
    return el;
  }
  function showResults(snapshot, usedTranslation, save) {
    const result = ReadingTestCore.grade(data.groups, snapshot);
    editing = false;
    previewingLast = !save;
    document.body.dataset.testState = 'submitted';
    applySnapshot(snapshot);
    controls.forEach(c => c.disabled = true);
    submit.hidden = true; restart.hidden = false;
    restart.textContent = save ? '重新测试' : '返回当前测试';
    setTranslations(true);
    summary.replaceChildren();
    addText(summary, 'h2', '', '本次测试结果');
    const score = addText(summary, 'div', 'test-score', String(result.earned));
    addText(score, 'small', '', ' / ' + result.total + ' 分');
    const wrong = Object.values(result.results).filter(r => r.status !== 'correct').length;
    addText(summary, 'p', '', wrong ? wrong + ' 个题组需要复习；下方保留了你的答案。' : '全部正确。可以稍后再次闭卷回忆。');
    addText(summary, 'p', '', usedTranslation ? '本次使用了翻译辅助，满分同样计入记忆进度。' : '本次交卷前未打开翻译，满分计入记忆进度。');
    const retry = addText(summary, 'button', '', save ? '重新测试' : '返回当前测试'); retry.type = 'button'; retry.addEventListener('click', reset);
    const clear = addText(summary, 'button', 'clear-test-record', '清空当前作答');
    clear.type = 'button';
    clear.addEventListener('click', () => {
      try { localStorage.removeItem(key); } catch (_) { storageAvailable = false; }
      record = {};previewingLast = false;reset();
    });
    summary.hidden = false;
    for (const g of data.groups) {
      const grade = result.results[g.id];
      const box = cards.get(g.id).querySelector('.test-result');
      box.replaceChildren();box.hidden = false;box.dataset.status = grade.status;
      const header = addText(box, 'div', 'test-result-header', 'Q' + g.number + ' · ' + ({correct:'正确',partial:'部分正确',incorrect:'错误',unanswered:'未作答'})[grade.status]);
      addText(header, 'span', '', grade.earned + ' / ' + grade.total);
      addText(box, 'p', 'test-answer-title', '你的答案');
      const own = g.evaluation === 'unordered-membership' ? (snapshot.sets[g.id] || []).map(v => displayValue(v,g)) : g.responses.map(id => displayValue(snapshot.responses[id],g));
      addText(box, 'p', 'test-answer-value', own.length ? own.join('；') : '未作答');
      for (const value of g.evaluation === 'unordered-membership' ? snapshot.sets[g.id] || [] : g.responses.map(id => snapshot.responses[id])) {
        const o = g.options.find(o => o.value === value);
        if (o?.zh) addText(box, 'p', 'test-answer-zh test-translation', o.zh);
      }
      addText(box, 'p', 'test-answer-title', '正确答案');
      for (const answer of g.correct) {
        addText(box, 'p', 'test-answer-value', answer.en);
        addText(box, 'p', 'test-answer-zh test-translation', answer.zh);
      }
      if (grade.note) addText(box, 'p', 'test-result-note', grade.note);
      const link = addText(box, 'a', '', '查看该题复习与对应原文 →');link.href = data.reviewHref + '#' + g.id;
      document.querySelectorAll('[data-blank-group="' + g.id + '"]').forEach(el => el.dataset.status = grade.status);
      document.querySelector('[data-test-question="' + g.id + '"]').dataset.testStatus = grade.status;
    }
    progress(snapshot);
    if (save) {
      const submittedAt=new Date().toISOString(),durationSeconds=Math.round(elapsedSeconds);
      const historyId=globalThis.crypto?.randomUUID?.() || Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
      const saved = saveShared(snapshot,usedTranslation,result,submittedAt,durationSeconds,historyId);
      record = {...record, draft:null, draftAssisted:false, draftElapsedSeconds:0,lastSubmission:{snapshot,assisted:usedTranslation,submittedAt,durationSeconds,historyId:saved.ok?historyId:undefined}};
      persist();
      if (saved.ok) status.textContent = '本次结果已计入计划与成绩';
      else status.textContent = '本篇结果已保留，统计保存失败：'+saved.error;
      const plan = addText(summary,'a','test-plan-link','查看统计与后续计划 →');plan.href='../复习计划.html';
      const practice=addText(summary,'a','test-plan-link',wrong?'先复习本篇错题 →':'按顺序背诵本篇 →');practice.href=data.reviewHref+(wrong?'?wrong=1':'?recall=1');
      const next=addText(summary,'a','test-plan-link','继续今日任务 →');next.href='../复习计划.html';
    } else status.textContent = '正在查看历史结果';
    setPane('questions');
    summary.focus({preventScroll:true});summary.scrollIntoView({behavior:smooth(),block:'start'});
  }
  function reset() {
    const resume = previewingLast && record.draft;
    editing = true;assisted = resume ? !!record.draftAssisted : false;
    draft = resume ? record.draft : {responses:{},sets:{}};
    previewingLast = false;
    elapsedSeconds=resume ? Math.max(0,Number(record.draftElapsedSeconds)||0) : 0;lastSavedClock=0;lastActivity=Date.now();
    controls.forEach(c => c.disabled = false);
    applySnapshot(draft);
    document.body.dataset.testState = 'editing';
    document.querySelectorAll('.test-result').forEach(el => {el.hidden = true;el.replaceChildren();});
    document.querySelectorAll('[data-blank-group]').forEach(el => delete el.dataset.status);
    summary.hidden = true;submit.hidden = false;restart.hidden = true;
    lastButton.hidden = !record.lastSubmission;
    announcement.textContent = '';
    setTranslations(preferredTranslation());progress();
    record.draft = draft;record.draftAssisted = assisted;persist();
    if (storageAvailable) status.textContent = resume ? '已返回未交卷的作答' : '新一轮测试，答案自动保存';
    setPane('questions');
    document.querySelector('.test-intro').scrollIntoView({behavior:smooth(),block:'start'});
  }
  function answerChanged(event) {
    if (!editing) return;
    const input = event.target;
    // Text/radio/checkbox use input; selects use change. Process each action once.
    if ((event.type === 'input' && input.tagName === 'SELECT') || (event.type === 'change' && input.tagName !== 'SELECT')) return;
    if (input.dataset.set) {
      const g = groups.get(input.dataset.set);
      const selected = controls.filter(c => c.dataset.set === input.dataset.set && c.checked);
      if (selected.length > g.maxSelections) {
        input.checked = false;
        announcement.textContent = 'Q' + g.number + ' 最多选择 ' + g.maxSelections + ' 项。先取消一项，才能更换选择。';
        return;
      }
    } else if (input.dataset.response) {
      for (const other of controls) if (other !== input && other.dataset.response === input.dataset.response) {
        if (other.type === 'radio') other.checked = other.value === input.value;
        else other.value = input.value;
      }
    } else return;
    announcement.textContent = '';
    draft = readSnapshot();record.draft = draft;record.draftAssisted = assisted;
    progress(draft);persist();
    if (storageAvailable) status.textContent = '作答已自动保存';
  }
  document.addEventListener('input', answerChanged);
  document.addEventListener('change', answerChanged);
  translationButton.addEventListener('click', () => {
    setTranslations(document.body.dataset.translations !== 'on');
    try{localStorage.setItem('zyz-reading-translation-pref-v1',document.body.dataset.translations);}catch(_){}
    if (editing) {record.draft = readSnapshot();record.draftAssisted = assisted;persist();}
  });
  submit.addEventListener('click', () => showResults(readSnapshot(),assisted,true));
  restart.addEventListener('click', reset);
  lastButton.addEventListener('click', () => { if (record.lastSubmission?.snapshot) showResults(record.lastSubmission.snapshot,record.lastSubmission.assisted,false); });
  document.querySelectorAll('[data-pane]').forEach(b => b.addEventListener('click', () => setPane(b.dataset.pane)));
  document.querySelectorAll('[data-test-question]').forEach(b => b.addEventListener('click', () => {
    const g = groups.get(b.dataset.testQuestion);
    const target = document.querySelector('[data-blank-group="' + g.id + '"]') || cards.get(g.id);
    setPane('questions');target.scrollIntoView({behavior:smooth(),block:'center'});
    const control = g.evaluation === 'unordered-membership' ? document.querySelector('[data-set="' + g.id + '"]') : controls.find(c => c.dataset.response === g.responses[0] && c.closest('.questions-pane'));
    if (editing && control) control.focus({preventScroll:true});
  }));
  function preferredTranslation(){try{return localStorage.getItem('zyz-reading-translation-pref-v1')==='on';}catch(_){return false;}}
  applySnapshot(draft);setTranslations(preferredTranslation());progress();
  const requestedId=new URLSearchParams(location.search).get('attempt');
  if(requestedId) {
    const requested=shared.attempts.find(a=>a.id===requestedId&&a.passageId===data.passageId&&a.version===data.version);
    if(requested)showResults(requested.snapshot,requested.assisted,false);
    else announcement.textContent='未找到可用于当前题库的历史记录，已打开新测试。';
  }
  const clock=document.getElementById('test-clock');
  ['pointerdown','keydown','scroll','input'].forEach(type=>document.addEventListener(type,()=>{lastActivity=Date.now();},{capture:true,passive:true}));
  setInterval(()=>{
    if(editing&&!document.hidden&&Date.now()-lastActivity<120000)elapsedSeconds++;
    if(clock)clock.textContent=Math.floor(elapsedSeconds/60)+':'+String(Math.round(elapsedSeconds)%60).padStart(2,'0');
    if(editing&&elapsedSeconds-lastSavedClock>=15){record.draft=readSnapshot();record.draftAssisted=assisted;persist();lastSavedClock=elapsedSeconds;}
  },1000);
  addEventListener('pagehide',()=>{if(editing){record.draft=readSnapshot();record.draftAssisted=assisted;persist();}});
  if (!storageAvailable) status.textContent = '当前浏览器无法保存，请在离开前交卷核对';
})();
