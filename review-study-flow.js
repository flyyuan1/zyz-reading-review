(() => {
  'use strict';
  const data=document.getElementById('study-data'),hero=document.querySelector('.study-hero');
  if(!data||!hero||!window.ReadingStudyCore||!window.ReadingStudyStore)return;
  const articles=JSON.parse(data.textContent);
  const panel=document.createElement('section');panel.className='study-flow';panel.setAttribute('aria-label','接下来做什么');
  const copy=document.createElement('div');copy.className='study-flow-copy';
  const label=document.createElement('span');label.className='study-flow-label';label.textContent='接下来做什么';
  const title=document.createElement('h2'),description=document.createElement('p'),recall=document.createElement('p');recall.className='study-flow-recall';
  const actions=document.createElement('div');actions.className='study-flow-actions';
  const primary=document.createElement('a');primary.className='study-flow-primary';
  const secondary=document.createElement('a');secondary.className='study-flow-secondary';secondary.textContent='先复习本篇';
  copy.append(label,title,description,recall);actions.append(primary,secondary);panel.append(copy,actions);hero.after(panel);
  const moments=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
  function drafts(){
    const rows=[];
    try{for(const article of articles){
      const raw=localStorage.getItem('zyz-reading-test-v1:'+article.id);if(!raw)continue;
      try{const value=JSON.parse(raw);if(value.draft)rows.push({passageId:article.id,version:value.version,snapshot:value.draft,updatedAt:value.draftUpdatedAt});}catch(_){}
    }}catch(_){}
    return rows;
  }
  function render(){
    const stored=ReadingStudyStore.list();
    const plan=window.ReadingStudyPage?.getPlan?.()||ReadingStudyCore.buildPlan(ReadingStudyStore.enrichArticles?.(articles)||articles,stored.attempts,ReadingStudyStore.getSettings());
    const action=ReadingStudyCore.nextAction(plan,drafts());
    primary.hidden=secondary.hidden=true;recall.hidden=true;panel.dataset.state=action.kind;
    title.textContent=action.article?.title||({budget:'今天先到这里',done:'今天的任务已安排完毕',exam:'考前轻量回顾'})[action.kind]||'按整篇文章继续复习';
    if(action.article?.part){
      const badge=document.createElement('span');badge.className='position-badge';badge.textContent='P'+action.article.part;
      title.prepend(badge);
    }
    description.textContent='';
    if(action.kind==='resume'||action.kind==='test'){
      primary.textContent=action.kind==='resume'?'继续本篇':'开始今天任务';primary.href='逐篇测试/'+action.article.file+'?from=plan';primary.hidden=false;
      secondary.href='逐篇复习/'+action.article.file;secondary.hidden=false;
      description.textContent=action.kind==='resume'?'已找到本篇未交卷的作答，继续时会自动恢复。':
        action.task.kind==='confirm'?'上次已经满分，今天按原题顺序再回忆一遍。':
          '按错题优先顺序开始；每次只测这一篇，题目顺序与原题一致。';
      if(action.state.consecutiveFullScores){recall.hidden=false;recall.textContent='连续 '+action.state.consecutiveFullScores+' 次满分 · 跨 '+action.state.fullScoreDays+' 天'+(action.state.stableRecall?' · 已有隔天回忆记录':'');}
    }else if(action.kind==='review'){
      description.textContent='本篇安排在 '+moments.format(new Date(action.readyAt))+' 后复测，现在可以先核对原文与答案。';
      primary.textContent='等待期间先复习';primary.href='逐篇复习/'+action.article.file;primary.hidden=false;
    }else if(action.kind==='budget')description.textContent='今天的 90 分钟预算已用完，先核对错题，下一天再继续整篇任务。';
    else if(action.kind==='exam'){
      description.textContent='上午 9 点考试，考前只做轻量回忆，不再开启新的整篇测试。';
      if(action.article){primary.textContent='回顾仍未熟悉的文章';primary.href='逐篇复习/'+action.article.file;primary.hidden=false;}
    }else description.textContent=action.nextDate?'下一批任务在 '+action.nextDate.slice(5).replace('-','/')+'；也可在下面查看文章与历史成绩。':'暂时没有新的到期任务，成绩与草稿都已保留。';
  }
  let queued=false;
  function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;render();});}
  addEventListener('reading-study-rendered',schedule);addEventListener('reading-study-updated',schedule);addEventListener('storage',schedule);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
  render();
})();
