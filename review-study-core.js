(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReadingStudyCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const DAY = 86400000;
  const defaults = {startDate:'2026-10-25',examAt:'2026-10-28T09:00:00+08:00',dailyMinutes:90,reserveMinutes:10,firstTestMinutes:4};
  function dateKey(value) {
    const parts = new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
    return ['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('-');
  }
  const addDays = (date,n) => dateKey(Date.parse(date+'T12:00:00+08:00')+n*DAY);
  const median = values => {const a=[...values].sort((a,b)=>a-b);return a.length ? a[Math.floor(a.length/2)] : null;};
  function settings(value = {}) {
    return {...defaults,dailyMinutes:Number.isFinite(+value.dailyMinutes) ? Math.max(15,Math.min(720,Math.round(+value.dailyMinutes))) : defaults.dailyMinutes};
  }
  function validAttempt(value) {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || value.id.length>250 ||
        typeof value.passageId !== 'string' || value.passageId.length>250 || typeof value.version !== 'string' ||
        !Number.isFinite(Date.parse(value.submittedAt)) || !Number.isFinite(value.earned) || !Number.isFinite(value.total) ||
        value.total<1 || value.total>50 || value.earned<0 || value.earned>value.total || !Number.isInteger(value.earned) || !Number.isInteger(value.total)) return null;
    const snapshot = {responses:{},sets:{}};
    for (const [k,v] of Object.entries(value.snapshot?.responses || {})) if (/^r\d+$/.test(k) && typeof v === 'string' && v.length<=300) snapshot.responses[k]=v;
    for (const [k,v] of Object.entries(value.snapshot?.sets || {})) if (/^q\d+$/.test(k) && Array.isArray(v) && v.length<=10 && v.every(s=>typeof s==='string'&&s.length<=300)) snapshot.sets[k]=[...new Set(v)];
    const outcomes = Array.isArray(value.outcomes) ? value.outcomes.filter(o=>o && /^q\d+$/.test(o.id) && Number.isFinite(o.earned) && Number.isFinite(o.total) && o.earned>=0 && o.earned<=o.total).map(o=>({id:o.id,earned:o.earned,total:o.total})) : [];
    return {id:value.id,passageId:value.passageId,version:value.version,submittedAt:new Date(value.submittedAt).toISOString(),
      earned:value.earned,total:value.total,assisted:value.assisted===true,durationSeconds:Number.isFinite(value.durationSeconds) ? Math.max(0,Math.min(10800,Math.round(value.durationSeconds))) : 0,snapshot,outcomes};
  }
  function uniqueAttempts(attempts) {
    const map = new Map();
    for (const raw of attempts || []) {const a=validAttempt(raw);if(a&&!map.has(a.id))map.set(a.id,a);}
    return [...map.values()].sort((a,b)=>a.submittedAt.localeCompare(b.submittedAt)||a.id.localeCompare(b.id));
  }
  function summary(articles, attempts) {
    const known = new Set(articles.map(a=>a.id));
    const all = uniqueAttempts(attempts).filter(a=>known.has(a.passageId));
    const byArticle = new Map();
    for (const a of all) {if(!byArticle.has(a.passageId))byArticle.set(a.passageId,[]);byArticle.get(a.passageId).push(a);}
    const states = articles.map(article=>{
      const history = byArticle.get(article.id)||[], latest=history[history.length-1];
      const current = !!latest && latest.version===article.version && latest.total===article.marks;
      const sourceTime=Date.parse(article.sourceSubmittedAt),sourceWrong=Math.max(0,Math.min(article.marks,Number(article.sourceWrong ?? article.backupWrong)||0));
      const sourceErrorTime=Date.parse(article.sourceErrorAt||article.sourceSubmittedAt);
      const newerSource=!!latest&&Number.isFinite(sourceTime)&&sourceTime>Date.parse(latest.submittedAt);
      const sourceNeedsReview=newerSource&&sourceWrong>0&&Number.isFinite(sourceErrorTime)&&sourceErrorTime>Date.parse(latest.submittedAt);
      const passed = current && latest.earned===latest.total&&!sourceNeedsReview;
      let consecutiveFullScores=0;
      const fullScoreDates=new Set();
      if(passed)for(let i=history.length-1;i>=0;i--){
        const previous=history[i];
        if(previous.version!==article.version||previous.total!==article.marks||previous.earned!==previous.total)break;
        if(Number.isFinite(sourceErrorTime)&&sourceWrong>0&&Date.parse(previous.submittedAt)<=sourceErrorTime)break;
        consecutiveFullScores++;fullScoreDates.add(dateKey(previous.submittedAt));
      }
      const backupWrong=Math.max(0,Number(article.backupWrong ?? article.historicalWrong)||0);
      const useSourcePriority=newerSource&&!passed;
      const wrongCount=useSourcePriority ? sourceWrong : current ? latest.total-latest.earned : backupWrong;
      let dueAt = null;
      if (latest) dueAt = passed ? addDays(dateKey(latest.submittedAt),1)+'T07:00:00+08:00' : new Date(Date.parse(latest.submittedAt)+20*60000).toISOString();
      if(sourceNeedsReview)dueAt=new Date(sourceErrorTime+20*60000).toISOString();
      return {article,history,latest,current,passed,dueAt,wrongCount,newerSource,sourceNeedsReview,consecutiveFullScores,fullScoreDays:fullScoreDates.size,stableRecall:passed&&fullScoreDates.size>=2,wrongSource:useSourcePriority?'source':current?'latest':'backup',status:!latest?'untested':!current?'outdated':passed?'passed':'retry'};
    });
    const measured=states.filter(s=>s.latest&&s.current);
    const recentEarned=measured.reduce((n,s)=>n+s.latest.earned,0),recentTotal=measured.reduce((n,s)=>n+s.latest.total,0);
    return {states,attempts:all,passed:states.filter(s=>s.passed).length,stableRecall:states.filter(s=>s.stableRecall).length,untested:states.filter(s=>!s.latest).length,
      needsRetry:states.filter(s=>s.latest&&!s.passed).length,latestAccuracy:recentTotal ? recentEarned/recentTotal : null,
      cumulativeEarned:all.reduce((n,a)=>n+a.earned,0),cumulativeTotal:all.reduce((n,a)=>n+a.total,0)};
  }
  function comparePriority(a,b) {
    const frequency={high:2,medium:1,low:0};
    return b.wrongCount-a.wrongCount || (b.article.historicalWrong||0)-(a.article.historicalWrong||0) ||
      (frequency[b.article.frequency]||0)-(frequency[a.article.frequency]||0) || a.article.title.localeCompare(b.article.title);
  }
  function buildPlan(articles, attempts, options = {}, now = new Date()) {
    const config=settings(options), result=summary(articles,attempts),today=dateKey(now),examDate=dateKey(config.examAt);
    const versions=new Map(articles.map(a=>[a.id,{version:a.version,marks:a.marks}]));
    const eligible=result.attempts.filter(a=>a.version===versions.get(a.passageId)?.version&&a.total===versions.get(a.passageId)?.marks&&a.durationSeconds>=45&&a.durationSeconds<=1200);
    const globalMinutes=median(eligible.map(a=>a.durationSeconds/60)) || config.firstTestMinutes;
    function estimate(state,retest=false) {
      const own=state.history.filter(a=>a.version===state.article.version&&a.total===state.article.marks&&a.durationSeconds>=45&&a.durationSeconds<=1200).map(a=>a.durationSeconds/60);
      const base=Math.max(1.5,Math.min(15,median(own)||globalMinutes));
      return Math.ceil(retest ? Math.max(2,base*.65)+(state.passed?0:2) : base);
    }
    const scheduled=new Set(),days=[];
    for (let day = config.startDate; day<examDate&&days.length<30; day=addDays(day,1)) {
      const done=result.attempts.filter(a=>dateKey(a.submittedAt)===day),spent=done.reduce((n,a)=>n+a.durationSeconds/60,0);
      if(day<today){days.push({date:day,budget:config.dailyMinutes,spentMinutes:spent,completedAttempts:done.length,reserveMinutes:0,tasks:[],plannedMinutes:0,remainingMinutes:0,past:true});continue;}
      const reserve=Math.min(config.reserveMinutes,config.dailyMinutes);
      let remaining=Math.max(0,config.dailyMinutes-spent-reserve);
      const tasks=[];
      const add=(state,kind,heldMinutes=0)=>{
        const minutes=estimate(state,kind!=='first');
        if(minutes>remaining-heldMinutes+.0001||scheduled.has(state.article.id))return false;
        tasks.push({id:state.article.id,kind,minutes,notBefore:kind==='first'?null:state.dueAt});
        remaining-=minutes;scheduled.add(state.article.id);return true;
      };
      const eligibleStates=result.states.filter(s=>!scheduled.has(s.article.id)&&(!s.latest||dateKey(s.dueAt)<=day));
      const pending=eligibleStates.filter(s=>!s.passed).sort(comparePriority);
      const confirmations=eligibleStates.filter(s=>s.passed).sort(comparePriority);
      // Put articles with more outstanding errors first, while keeping a small confirmation block.
      const confirmationReserve=confirmations.length ? Math.min(10,remaining) : 0;
      for(const s of pending)add(s,s.latest?'retry':'first',confirmationReserve);
      let confirmationUsed=0;
      for(const s of confirmations){const minutes=estimate(s,true);if(confirmationUsed+minutes<=confirmationReserve&&add(s,'confirm'))confirmationUsed+=minutes;}
      for(const s of pending)add(s,s.latest?'retry':'first');
      if(!pending.some(s=>!scheduled.has(s.article.id)))for(const s of confirmations)add(s,'confirm');
      days.push({date:day,budget:config.dailyMinutes,spentMinutes:spent,completedAttempts:done.length,reserveMinutes:reserve,
        tasks,plannedMinutes:tasks.reduce((n,t)=>n+t.minutes,0),remainingMinutes:Math.max(0,remaining)});
    }
    const targetRemaining=result.states.filter(s=>!s.passed);
    const requiredMinutes=targetRemaining.reduce((n,s)=>n+estimate(s,!!s.latest),0);
    const availableMinutes=days.filter(d=>!d.past).reduce((n,d)=>n+Math.max(0,d.budget-d.spentMinutes-d.reserveMinutes),0);
    return {...result,config,today,examDate,days,examOver:Date.parse(now)>=Date.parse(config.examAt),
      requiredMinutes,availableMinutes,gapMinutes:Math.max(0,requiredMinutes-availableMinutes),
      unplanned:targetRemaining.filter(s=>!scheduled.has(s.article.id)),estimatedFirstMinutes:Math.max(1.5,globalMinutes)};
  }
  function nextAction(plan,drafts=[],now=new Date()) {
    const instant=Date.parse(now),states=new Map(plan.states.map(s=>[s.article.id,s]));
    if(plan.today>=plan.examDate){
      const state=plan.states.filter(s=>!s.passed&&s.wrongCount>0).sort(comparePriority)[0];
      return {kind:'exam',article:state?.article};
    }
    const day=plan.days.find(d=>d.date===plan.today);
    if(!day)return {kind:'done'};
    if(day.budget-day.spentMinutes-day.reserveMinutes<=0)return {kind:'budget'};
    const ready=s=>!s.latest||!s.dueAt||Date.parse(s.dueAt)<=instant;
    const hasAnswer=snapshot=>Object.values(snapshot?.responses||{}).some(value=>typeof value==='string'&&value.trim())||
      Object.values(snapshot?.sets||{}).some(values=>Array.isArray(values)&&values.some(value=>typeof value==='string'&&value.trim()));
    const resumable=drafts.filter(d=>{
      const state=states.get(d.passageId);
      return state&&d.version===state.article.version&&hasAnswer(d.snapshot)&&ready(state);
    }).sort((a,b)=>(Date.parse(b.updatedAt)||0)-(Date.parse(a.updatedAt)||0)||comparePriority(states.get(a.passageId),states.get(b.passageId)));
    if(resumable.length){const draft=resumable[0],state=states.get(draft.passageId);return {kind:'resume',article:state.article,state,draft};}
    const task=day.tasks.find(t=>!t.notBefore||Date.parse(t.notBefore)<=instant);
    if(task){const state=states.get(task.id);return {kind:'test',task,article:state.article,state};}
    const waiting=day.tasks.filter(t=>t.notBefore&&Date.parse(t.notBefore)>instant).sort((a,b)=>Date.parse(a.notBefore)-Date.parse(b.notBefore))[0];
    if(waiting){const state=states.get(waiting.id);return {kind:'review',task:waiting,article:state.article,state,readyAt:waiting.notBefore};}
    return {kind:'done',nextDate:plan.days.find(d=>d.date>plan.today&&d.tasks.length)?.date};
  }
  return {defaults,dateKey,addDays,settings,validAttempt,uniqueAttempts,summary,comparePriority,buildPlan,nextAction};
});
