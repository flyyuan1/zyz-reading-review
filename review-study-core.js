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
      const passed = current && latest.earned===latest.total;
      let dueAt = null;
      if (latest) dueAt = passed ? addDays(dateKey(latest.submittedAt),1)+'T07:00:00+08:00' : new Date(Date.parse(latest.submittedAt)+20*60000).toISOString();
      return {article,history,latest,current,passed,dueAt,status:!latest?'untested':!current?'outdated':passed?'passed':'retry'};
    });
    const measured=states.filter(s=>s.latest&&s.current);
    const recentEarned=measured.reduce((n,s)=>n+s.latest.earned,0),recentTotal=measured.reduce((n,s)=>n+s.latest.total,0);
    return {states,attempts:all,passed:states.filter(s=>s.passed).length,untested:states.filter(s=>!s.latest).length,
      needsRetry:states.filter(s=>s.latest&&!s.passed).length,latestAccuracy:recentTotal ? recentEarned/recentTotal : null,
      cumulativeEarned:all.reduce((n,a)=>n+a.earned,0),cumulativeTotal:all.reduce((n,a)=>n+a.total,0)};
  }
  function buildPlan(articles, attempts, options = {}, now = new Date()) {
    const config=settings(options), result=summary(articles,attempts),today=dateKey(now),examDate=dateKey(config.examAt);
    const eligible=result.attempts.filter(a=>a.durationSeconds>=45&&a.durationSeconds<=1200);
    const globalMinutes=median(eligible.map(a=>a.durationSeconds/60)) || config.firstTestMinutes;
    function estimate(state,retest=false) {
      const own=state.history.filter(a=>a.durationSeconds>=45&&a.durationSeconds<=1200).map(a=>a.durationSeconds/60);
      const base=Math.max(1.5,Math.min(15,median(own)||globalMinutes));
      return Math.ceil(retest ? Math.max(2,base*.65)+(state.passed?0:2) : base);
    }
    const priority = s => ({high:60,medium:30,low:0}[s.article.frequency]||0)+Math.min(30,(s.article.historicalWrong||0)*3)+(s.latest&&!s.passed?80+(1-s.latest.earned/s.latest.total)*40:0);
    const scheduled=new Set(),days=[];
    for (let day = config.startDate; day<examDate&&days.length<30; day=addDays(day,1)) {
      const done=result.attempts.filter(a=>dateKey(a.submittedAt)===day),spent=done.reduce((n,a)=>n+a.durationSeconds/60,0);
      if(day<today){days.push({date:day,budget:config.dailyMinutes,spentMinutes:spent,completedAttempts:done.length,reserveMinutes:0,tasks:[],plannedMinutes:0,remainingMinutes:0,past:true});continue;}
      const reserve=Math.min(config.reserveMinutes,config.dailyMinutes);
      let remaining=Math.max(0,config.dailyMinutes-spent-reserve),reviewUsed=0;
      const tasks=[];
      const add=(state,kind)=>{
        const minutes=estimate(state,kind!=='first');
        if(minutes>remaining+.0001||scheduled.has(state.article.id))return false;
        tasks.push({id:state.article.id,kind,minutes,notBefore:kind==='first'?null:state.dueAt});
        remaining-=minutes;scheduled.add(state.article.id);return true;
      };
      const due=result.states.filter(s=>s.latest&&!scheduled.has(s.article.id)&&dateKey(s.dueAt)<=day)
        .sort((a,b)=>priority(b)-priority(a)||a.dueAt.localeCompare(b.dueAt)||a.article.title.localeCompare(b.article.title));
      // Reserve part of each block for real, already-known retests. Future outcomes are never assumed.
      for(const s of due) {
        const minutes=estimate(s,true);
        if(reviewUsed+minutes<=30&&add(s,s.passed?'confirm':'retry'))reviewUsed+=minutes;
      }
      const fresh=result.states.filter(s=>!s.latest&&!scheduled.has(s.article.id)).sort((a,b)=>priority(b)-priority(a)||a.article.title.localeCompare(b.article.title));
      for(const s of fresh)add(s,'first');
      for(const s of due)add(s,s.passed?'confirm':'retry');
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
  return {defaults,dateKey,addDays,settings,validAttempt,uniqueAttempts,summary,buildPlan};
});
