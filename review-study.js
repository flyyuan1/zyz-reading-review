(() => {
  'use strict';
  const articles=JSON.parse(document.getElementById('study-data').textContent);
  const $=id=>document.getElementById(id);
  const dateFormat=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric'});
  const momentFormat=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
  let selectedDay=ReadingStudyCore.dateKey(new Date()),currentPlan;
  function node(tag,text,className) {const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
  function link(text,href,className) {const n=node('a',text,className);n.href=href;return n;}
  function formatMinutes(value) {
    const rounded=Math.ceil(value);
    if(rounded<60)return rounded+' 分钟';
    return Math.floor(rounded/60)+' 小时'+(rounded%60?' '+rounded%60+' 分钟':'');
  }
  function message(text) {$('study-message').hidden=!text;$('study-message').textContent=text;}
  function errorLabel(state) {
    if(state.wrongSource==='source')return state.wrongCount?'新原站记录错题 '+state.wrongCount+' 题':'原站已正确，待本站回忆确认';
    if(state.current)return state.passed?'最近满分':'最近错／未答 '+state.wrongCount+' 题';
    return '备份错题 '+state.wrongCount+' 题'+(state.article.backupUnanswered?' · 未答 '+state.article.backupUnanswered+' 题':'');
  }
  function renderLibrary(plan) {
    const query=$('study-search').value.trim().toLocaleLowerCase(),filter=$('study-state').value;
    const states=plan.states.filter(s=>(!query||(s.article.title+' '+s.article.titleZh).toLocaleLowerCase().includes(query)) &&
      (filter==='all'||filter==='passed'&&s.passed||filter==='untested'&&!s.latest||filter==='retry'&&s.latest&&!s.passed));
    states.sort((a,b)=>Number(a.passed)-Number(b.passed)||ReadingStudyCore.comparePriority(a,b));
    const body=$('article-results');body.replaceChildren();
    for(const state of states) {
      const a=state.article,tr=node('tr'),titleCell=node('td');
      const titleRow=node('div','','results-title-row');
      if(a.part)titleRow.append(node('span','P'+a.part,'position-badge'));
      titleRow.append(node('strong',a.title,'results-title'));
      titleCell.append(titleRow,node('span',a.titleZh+' · '+({high:'高频',medium:'中频',low:'低频'})[a.frequency],'results-subtitle'));
      titleCell.append(node('span',errorLabel(state),'results-subtitle'));
      if(state.history.length) {
        const details=node('details',undefined,'attempt-details');details.append(node('summary',state.history.length+' 次测试记录'));
        const list=node('ol');
        for(const attempt of [...state.history].reverse().slice(0,10)) {
          const li=node('li',momentFormat.format(new Date(attempt.submittedAt))+' · '+attempt.earned+'/'+attempt.total+' · '+(attempt.assisted?'翻译辅助':'无翻译')+' · '+formatMinutes(attempt.durationSeconds/60));
          if(attempt.version===a.version)li.append(link('查看','逐篇测试/'+a.file+'?attempt='+encodeURIComponent(attempt.id)));
          else li.append(node('span',' · 旧题库版本'));
          list.append(li);
        }
        if(state.history.length>10)list.append(node('li','显示最近 10 次；全部记录保留在导出文件中。'));
        details.append(list);titleCell.append(details);
      }
      const scoreCell=node('td');
      scoreCell.append(node('span',state.latest?state.latest.earned+' / '+state.latest.total:'未测','results-score'));
      const status=node('span',(state.sourceNeedsReview?'原站新错题，待复测':({passed:'满分通过',retry:'需要复测',outdated:'题库已更新，待复测',untested:'尚无新测试结果'})[state.status])+(state.latest?.assisted?' · 使用翻译':''),'results-status');status.dataset.status=state.status;scoreCell.append(status);
      if(state.consecutiveFullScores)scoreCell.append(node('small','连续 '+state.consecutiveFullScores+' 次满分 · '+state.fullScoreDays+' 天'+(state.stableRecall?' · 隔天已巩固':''),'results-subtitle'));
      const next=node('td',undefined,'results-next');
      if(!state.latest)next.textContent='错题多的文章优先；相同再按历史错题与频次';
      else if(ReadingStudyCore.dateKey(state.dueAt)>=plan.examDate)next.textContent=state.passed?'考前轻量回顾':'考前优先复习错题';
      else next.textContent=(state.passed?'次日复测 · ':'再次测试 · ')+momentFormat.format(new Date(state.dueAt));
      const action=node('td'),actions=node('div',undefined,'results-actions');
      actions.append(link(state.latest?'再测':'测试','逐篇测试/'+a.file),link('复习','逐篇复习/'+a.file));action.append(actions);
      tr.append(titleCell,scoreCell,next,action);body.append(tr);
    }
    $('library-count').textContent=states.length+' / '+articles.length+' 篇';$('library-empty').hidden=states.length!==0;
  }
  function renderDay(plan) {
    const day=plan.days.find(d=>d.date===selectedDay);
    $('day-tasks').replaceChildren();
    if(!day) {
      $('selected-day-heading').textContent='考试日：轻量回顾';$('selected-day-meta').textContent='上午 9 点考试';
      const pending=plan.states.filter(s=>!s.passed&&s.wrongCount>0).sort(ReadingStudyCore.comparePriority).slice(0,5);
      for(const s of pending){const li=node('li');li.append(node('div',s.article.title,'day-task-copy'),link('看错题','逐篇复习/'+s.article.file));$('day-tasks').append(li);}
      $('day-reserve').textContent=plan.examOver?'考试时间已到，成绩与记录继续保留。':'考前可用 10–15 分钟回顾仍未通过的题目，出发前留出充分准备时间。';return;
    }
    $('selected-day-heading').textContent=(day.date===plan.today?'今天先做这些':dateFormat.format(new Date(day.date+'T12:00:00+08:00'))+'的任务');
    $('selected-day-meta').textContent=day.past?'当日已记录 '+day.completedAttempts+' 次测试':day.tasks.length+' 篇 · 预计 '+day.plannedMinutes+' 分钟';
    for(const [i,task] of day.tasks.entries()) {
      const state=plan.states.find(s=>s.article.id===task.id),a=state.article,li=node('li'),copy=node('div',undefined,'day-task-copy');
      const waiting=task.kind!=='first'&&ReadingStudyCore.dateKey(task.notBefore)===plan.today&&Date.parse(task.notBefore)>Date.now();
      const titleRow=node('div','','day-task-title');
      if(a.part)titleRow.append(node('span','P'+a.part,'position-badge'));
      titleRow.append(node('strong',a.title));
      copy.append(titleRow,node('small',errorLabel(state)+' · '+({first:'首测',retry:'错题复习＋复测',confirm:'满分后的次日复测'})[task.kind]+' · 约 '+task.minutes+' 分钟'+(waiting?' · '+momentFormat.format(new Date(task.notBefore))+' 后再测':'')));
      li.append(node('span',String(i+1).padStart(2,'0'),'task-sequence'),copy,link(waiting?'先复习':'测试',(waiting?'逐篇复习/':'逐篇测试/')+a.file));$('day-tasks').append(li);
    }
    $('day-reserve').textContent=day.past?'已完成测试 '+day.completedAttempts+' 次，记录用时 '+formatMinutes(day.spentMinutes)+'。':
      '另留 '+day.reserveMinutes+' 分钟：核对错题的依据句，合上答案再回忆。'+(!day.tasks.length?'当前时段没有新增任务；可查看下方未通过文章。':'完成后交卷，任务会根据真实成绩重新排序。');
  }
  function render() {
    const stored=ReadingStudyStore.list();
    const plan=ReadingStudyCore.buildPlan(ReadingStudyStore.enrichArticles(articles),stored.attempts,ReadingStudyStore.getSettings(),new Date());currentPlan=plan;
    if(!stored.ok)message('当前浏览器无法读取本机记录。请检查存储权限；若已启用同步，恢复权限后可重新拉取云端记录。');
    const valid=plan.states.filter(s=>s.current),assisted=valid.filter(s=>s.latest.assisted).length;
    $('metric-passed').textContent=plan.passed+' / '+articles.length;
    $('metric-accuracy').textContent=plan.latestAccuracy===null?'—':(plan.latestAccuracy*100).toFixed(1)+'%';
    $('metric-tested').textContent='有有效成绩 '+valid.length+' 篇'+(assisted?'，含使用翻译 '+assisted+' 篇':'');
    $('metric-attempts').textContent=plan.attempts.length+' 次';$('metric-retry').textContent='待复测 '+plan.needsRetry+' 篇 · 未测 '+plan.untested+' 篇';
    const todayMinutes=plan.attempts.filter(a=>ReadingStudyCore.dateKey(a.submittedAt)===plan.today).reduce((n,a)=>n+a.durationSeconds/60,0);
    $('metric-time').textContent=formatMinutes(todayMinutes);
    $('goal-progress').value=plan.passed;$('goal-percent').textContent=(plan.passed/articles.length*100).toFixed(1)+'%';
    $('goal-caption').textContent='使用翻译也可计入满分进度。已有隔天连续满分 '+plan.stableRecall+' 篇，仅作巩固提示。';
    const delta=Date.parse(plan.config.examAt)-Date.now();
    $('exam-countdown').textContent=delta<=0?'考试时间已到':Math.floor(delta/86400000)+' 天 '+Math.floor(delta/3600000)%24+' 小时';
    const capacity=$('capacity-note');capacity.replaceChildren();
    if(plan.today>=plan.examDate)capacity.append(node('strong','今天进入考前回顾阶段。'),node('p','计划表保留已记录成绩，考前优先看仍未通过的文章与依据句。'));
    else if(plan.passed===articles.length)capacity.append(node('strong','175 篇最近一轮均已满分通过。'),node('p','继续按到期任务复测，确认隔天仍能回忆。'));
    else {
      capacity.append(node('strong','距全篇满分还差 '+(articles.length-plan.passed)+' 篇。'));
      capacity.append(node('p','按当前测试速度估算，还需约 '+formatMinutes(plan.requiredMinutes)+'；剩余计划可用于测试约 '+formatMinutes(plan.availableMinutes)+'（每天另留 10 分钟核对错题）。'));
      capacity.append(node('p',plan.gapMinutes>0?'现有时间少于全覆盖所需时间，约差 '+formatMinutes(plan.gapMinutes)+'。'+plan.unplanned.length+' 篇尚未排入每日预算；先复习错题多的文章，再根据真实速度调整。':'当前估计可覆盖待通过任务，进度仍以实际交卷为准。'));
    }
    const body=$('plan-days');body.replaceChildren();
    for(const day of plan.days) {
      const row=node('tr');row.dataset.active=String(day.date===selectedDay);
      const d=node('td',dateFormat.format(new Date(day.date+'T12:00:00+08:00')));d.append(node('small',day.past?'已过去':day.date===plan.today?'今天':'暂定'));
      const first=day.tasks.filter(t=>t.kind==='first').length,again=day.tasks.length-first;
      const action=node('td'),button=node('button',day.past?'看记录':'看任务');button.type='button';button.addEventListener('click',()=>{selectedDay=day.date;render();$('selected-day-heading').scrollIntoView({block:'nearest'});});action.append(button);
      row.append(d,node('td',first+' 篇'),node('td',again+' 篇'),node('td',day.past?'—':day.plannedMinutes+' + '+day.reserveMinutes+' 分钟'),node('td',day.completedAttempts+' 次 · '+formatMinutes(day.spentMinutes)),action);body.append(row);
    }
    renderDay(plan);renderLibrary(plan);dispatchEvent(new CustomEvent('reading-study-rendered'));
  }
  window.ReadingStudyPage={getPlan:()=>currentPlan,render};
  $('study-search').addEventListener('input',()=>renderLibrary(currentPlan));$('study-state').addEventListener('change',()=>renderLibrary(currentPlan));
  $('export-history').addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify(ReadingStudyStore.exportData(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=link('','');
    a.href=url;a.download='阅读学习记录-'+ReadingStudyCore.dateKey(new Date())+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    message('记录已导出。可在另一浏览器或线上／本地版本导入。');
  });
  $('import-history').addEventListener('click',()=>$('history-file').click());
  $('history-file').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    try{if(file.size>64000000)throw new Error('记录文件过大，请选择导出的 JSON 文件。');const result=ReadingStudyStore.merge(JSON.parse(await file.text()),articles);message('新增 '+result.added+' 条本站测试、'+result.sourceAdded+' 条原站记录；补全 '+result.sourceUpdated+' 条原站记录。'+(result.sourceConflicts?result.sourceConflicts+' 条原站冲突未覆盖。':'')+'重复记录已跳过。');render();}
    catch(error){message(error.message||'导入失败，请检查记录文件。');}finally{event.target.value='';}
  });
  addEventListener('storage',render);addEventListener('reading-study-updated',render);document.addEventListener('visibilitychange',()=>{if(!document.hidden)render();});
  setInterval(()=>{if(!document.hidden)render();},60000);
  render();
})();
