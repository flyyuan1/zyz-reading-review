/* Ordered recall for one article. Reveals are practice aids, never test scores. */
(() => {
  'use strict';
  const source = document.getElementById('article-data');
  const pane = document.querySelector('.questions-pane');
  const heading = pane?.querySelector('.questions-heading');
  if (!source || !pane || !heading || document.getElementById('recall-launch')) return;
  const article = JSON.parse(source.textContent);
  const cards = [...pane.querySelectorAll('.question-card')];
  if (!cards.length) return;
  const navs = [...document.querySelectorAll('.question-nav [data-question]')];
  const navById = new Map(navs.map(button => [button.dataset.question, button]));
  const headingById = new Map([...document.querySelectorAll('[data-heading-review]')].map(el => [el.dataset.headingReview, el]));
  const units = [], unitByCard = new Map(), seenTasks = new Set();
  const originalAria = new Map();
  let active = false, current = 0, restoreWrongFilter = false;
  const wrongToggle = document.getElementById('wrong-toggle');
  const wasWrongDisabled = wrongToggle?.disabled;

  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function button(text, className, action) {
    const el = node('button', text, className);
    el.type = 'button';el.addEventListener('click', action);return el;
  }
  function rememberAria(el, attribute) {
    if (!originalAria.has(el)) originalAria.set(el, new Map());
    if (!originalAria.get(el).has(attribute)) originalAria.get(el).set(attribute, el.getAttribute(attribute));
  }
  function setAria(el, attribute, value) {
    rememberAria(el, attribute);
    if (value === null) {
      const original = originalAria.get(el).get(attribute);
      if (original === null) el.removeAttribute(attribute);else el.setAttribute(attribute, original);
    } else el.setAttribute(attribute, value);
  }
  function questionLabel(unitCards) {
    const labels = unitCards.map(card => navById.get(card.id)?.textContent.trim() || card.querySelector('.question-number')?.firstChild?.textContent.trim().replace(/^Question\s*/i, '') || card.id);
    return 'Q' + (labels.length === 1 ? labels[0] : labels[0] + '–' + labels[labels.length - 1]);
  }

  for (const card of cards) {
    const task = card.closest('.task-group');
    if (task && seenTasks.has(task)) continue;
    if (task) seenTasks.add(task);
    const container = task || card;
    const unitCards = task ? [...task.querySelectorAll('.question-card')] : [card];
    const unit = {container,cards:unitCards,label:questionLabel(unitCards),connected:!!task,revealed:false,controls:[],headings:[],masks:[],inlines:[]};
    container.classList.add('recall-unit');
    container.dataset.recallUnit = String(units.length);
    for (const member of unitCards) {
      unitByCard.set(member.id, unit);
      const comparison = member.querySelector('.answer-comparison');
      if (comparison) unit.masks.push(comparison);
      // Format notes can contain the exact accepted word, so mask them too.
      const notes=member.querySelector('.question-bottom > span');
      if(notes)unit.masks.push(notes);
      unit.masks.push(...member.querySelectorAll('.answer-note'));
      // The explanation quotes the answer, so hide it until this unit is revealed.
      unit.masks.push(...member.querySelectorAll('.question-explanation'));
      const paragraphHeading = headingById.get(member.id);
      if (paragraphHeading) {
        unit.headings.push(paragraphHeading);
        paragraphHeading.classList.add('recall-heading');
        unit.masks.push(...paragraphHeading.querySelectorAll('.paragraph-correct-heading,.paragraph-own-heading'));
      }
    }
    for (const inline of container.querySelectorAll('.inline-answer[data-review]')) {
      const value = node('span', undefined, 'recall-inline-value');
      for (const child of [...inline.childNodes]) if (!(child.nodeType === 1 && child.tagName === 'SUP')) value.append(child);
      inline.append(value);
      unit.masks.push(value);unit.inlines.push(inline);
    }
    const controlText = task ? '揭晓整组答案' : '揭晓答案';
    const control = button(controlText, 'recall-unit-control', () => {selectUnit(units.indexOf(unit), false);reveal(unit);});
    control.setAttribute('aria-label',unit.label+'，'+controlText);
    (task?.querySelector('.task-heading') || card.querySelector('.question-top') || container).append(control);
    unit.controls.push(control);
    for (const paragraphHeading of unit.headings) {
      const revealHeading = button('揭晓本题标题', 'recall-unit-control recall-heading-control', () => {selectUnit(units.indexOf(unit), false);reveal(unit);});
      revealHeading.setAttribute('aria-label',unit.label+'，揭晓本题标题与答案');
      paragraphHeading.querySelector('.paragraph-heading-meta')?.append(revealHeading);
      unit.controls.push(revealHeading);
    }
    units.push(unit);
  }

  const launchRow = node('div', undefined, 'recall-launch-row');
  const launch = button('遮住答案背诵','recall-launch',start);launch.id='recall-launch';launch.setAttribute('aria-pressed','false');
  launchRow.append(launch,node('span','按原题顺序回忆，连续题组保留完整结构。','recall-launch-hint'));
  const directTest=node('a','本篇测试','recall-test-link');directTest.href=article.testHref||'../逐篇测试/'+location.pathname.split('/').pop();launchRow.append(directTest);
  heading.after(launchRow);
  const toolbar = node('section',undefined,'recall-toolbar');toolbar.hidden=true;toolbar.setAttribute('aria-label','本篇背诵控制');
  const top = node('div',undefined,'recall-toolbar-top');
  const currentLabel=node('strong'),count=node('span',undefined,'recall-count');
  top.append(currentLabel,count,button('退出背诵','recall-exit',stop));
  const actions=node('div',undefined,'recall-actions');
  const previous=button('上一题','recall-step',()=>selectUnit(current-1,true));
  const revealCurrent=button('揭晓答案','recall-primary',()=>reveal(units[current]));
  const next=button('下一题','recall-step',()=>selectUnit(current+1,true));
  const test=node('a','本篇测试','recall-test-link');
  test.href=article.testHref || '../逐篇测试/'+location.pathname.split('/').pop();
  actions.append(previous,revealCurrent,next,test,button('重新遮住','recall-remask',()=>{for(const unit of units){unit.revealed=false;paint(unit);}updateToolbar();}));
  const help=node('p','连续填空／摘要按整组揭晓；← → 切题，R 揭晓。不计入测试成绩。','recall-help');
  const live=node('span',undefined,'recall-live');live.setAttribute('role','status');live.setAttribute('aria-live','polite');
  toolbar.append(top,actions,help,live);launchRow.after(toolbar);

  function paint(unit) {
    unit.container.dataset.recallRevealed=String(unit.revealed);
    for(const paragraphHeading of unit.headings)paragraphHeading.dataset.recallRevealed=String(unit.revealed);
    for(const mask of unit.masks)setAria(mask,'aria-hidden',active&&!unit.revealed?'true':null);
    for(const inline of unit.inlines) {
      setAria(inline,'aria-label',active&&!unit.revealed?'第 '+inline.querySelector('sup')?.textContent+' 题，答案已遮住；点击揭晓整组':null);
    }
    for(const control of unit.controls){control.disabled=unit.revealed;control.textContent=unit.revealed?'已揭晓':control.classList.contains('recall-heading-control')?'揭晓本题标题':unit.connected?'揭晓整组答案':'揭晓答案';}
  }
  function updateToolbar() {
    const unit=units[current];
    currentLabel.textContent=unit.label+(unit.connected?' · 连续题组':'');
    count.textContent=(current+1)+' / '+units.length+' · 已揭晓 '+units.filter(u=>u.revealed).length;
    previous.disabled=current===0;next.disabled=current===units.length-1;
    revealCurrent.disabled=unit.revealed;revealCurrent.textContent=unit.revealed?'本题已揭晓':unit.connected?'揭晓整组答案':'揭晓答案';
    for(const item of units)item.container.classList.toggle('recall-current',active&&item===unit);
    for(const nav of navs)nav.classList.toggle('recall-nav-current',active&&unit.cards.some(card=>card.id===nav.dataset.question));
  }
  function selectUnit(index,scroll) {
    if(!active||index<0||index>=units.length)return;
    current=index;updateToolbar();
    if(scroll) {
      if(matchMedia('(max-width:700px)').matches)document.querySelector('[data-pane="questions"]')?.click();
      units[current].container.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});
    }
  }
  function reveal(unit) {
    if(!active||unit.revealed)return;
    unit.revealed=true;paint(unit);updateToolbar();
    live.textContent=unit.label+(unit.connected?' 整组答案已揭晓。':' 答案已揭晓。');
  }
  function start() {
    if(active)return;
    restoreWrongFilter=wrongToggle?.getAttribute('aria-pressed')==='true';
    if(restoreWrongFilter)wrongToggle.click();
    if(wrongToggle)wrongToggle.disabled=true;
    active=true;document.body.dataset.recallMode='on';launch.setAttribute('aria-pressed','true');toolbar.hidden=false;
    for(const status of document.querySelectorAll('.question-status,.heading-status'))setAria(status,'aria-hidden','true');
    for(const unit of units){unit.revealed=false;paint(unit);}
    let hash='';try{hash=decodeURIComponent(location.hash.slice(1));}catch(_){}
    current=Math.max(0,units.indexOf(unitByCard.get(hash)));
    selectUnit(current,true);
    live.textContent='已遮住本篇正确答案和个人答案。按原题顺序回忆，连续题组整组揭晓。';
  }
  function stop() {
    if(!active)return;
    active=false;delete document.body.dataset.recallMode;launch.setAttribute('aria-pressed','false');toolbar.hidden=true;
    for(const unit of units)paint(unit);
    for(const status of document.querySelectorAll('.question-status,.heading-status'))setAria(status,'aria-hidden',null);
    updateToolbar();
    if(wrongToggle){wrongToggle.disabled=wasWrongDisabled;if(restoreWrongFilter&&wrongToggle.getAttribute('aria-pressed')!=='true')wrongToggle.click();}
    launch.focus({preventScroll:true});
  }
  // The existing navigation keeps evidence highlighting and original question order.
  for(const nav of navs)nav.addEventListener('click',()=>{if(active)selectUnit(units.indexOf(unitByCard.get(nav.dataset.question)),false);});
  document.addEventListener('click',event=>{
    if(!active)return;
    const inline=event.target.closest?.('.inline-answer[data-review]');
    if(!inline)return;
    const unit=unitByCard.get(inline.dataset.review);
    if(!unit)return;
    event.preventDefault();event.stopImmediatePropagation();selectUnit(units.indexOf(unit),false);reveal(unit);
  },true);
  document.addEventListener('keydown',event=>{
    if(!active||event.defaultPrevented||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||event.target.isContentEditable||event.target.closest?.('input,textarea,select,[role="textbox"]'))return;
    if(event.key==='ArrowLeft'){event.preventDefault();selectUnit(current-1,true);}
    else if(event.key==='ArrowRight'){event.preventDefault();selectUnit(current+1,true);}
    else if(event.key.toLowerCase()==='r'){event.preventDefault();reveal(units[current]);}
  });
  if(new URLSearchParams(location.search).get('recall')==='1')start();
})();
