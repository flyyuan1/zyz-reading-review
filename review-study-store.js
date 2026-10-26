(() => {
  'use strict';
  const prefix='zyz-reading-attempt-v1:',sourcePrefix='zyz-reading-source-attempt-v1:',settingsKey='zyz-reading-plan-v1';
  function list() {
    try {
      const rows=[];
      for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(prefix)){try{rows.push(JSON.parse(localStorage.getItem(key)));}catch(_){}}}
      return {ok:true,attempts:ReadingStudyCore.uniqueAttempts(rows)};
    } catch(error) {return {ok:false,attempts:[]};}
  }
  function append(value,notify=true) {
    const record=ReadingStudyCore.validAttempt(value);
    if(!record)return {ok:false,error:'记录格式不完整，未计入统计。'};
    try {
      const key=prefix+record.id;
      if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(record));
      if(notify)dispatchEvent(new CustomEvent('reading-study-updated'));
      return {ok:true};
    } catch(error) {return {ok:false,error:'浏览器未能保存本次统计，请导出当前记录备份。'};}
  }
  function getSettings() {try{return ReadingStudyCore.settings(JSON.parse(localStorage.getItem(settingsKey)||'{}'));}catch(_){return ReadingStudyCore.settings();}}
  function saveSettings(value) {try{localStorage.setItem(settingsKey,JSON.stringify(ReadingStudyCore.settings(value)));return true;}catch(_){return false;}}
  function sourceIndex() {return window.ReadingSourceBackupIndex;}
  function validSource(value) {
    if(!window.ReadingSourceBackup||!sourceIndex())return null;
    try{return window.ReadingSourceBackup.validateAttempt(value,sourceIndex());}catch(_){return null;}
  }
  const sourceReadCache=new Map();
  let cachedSourceIndex=null,cachedSourceParser=null;
  function listSources() {
    try {
      const index=sourceIndex(),parser=window.ReadingSourceBackup;
      if(index!==cachedSourceIndex||parser!==cachedSourceParser){sourceReadCache.clear();cachedSourceIndex=index;cachedSourceParser=parser;}
      const rows=new Map(),seenKeys=new Set();
      for(let i=0;i<localStorage.length;i++){
        const key=localStorage.key(i);if(!key?.startsWith(sourcePrefix))continue;
        seenKeys.add(key);const raw=localStorage.getItem(key);let entry=sourceReadCache.get(key);
        if(!entry||entry.raw!==raw){
          let value=null;try{value=validSource(JSON.parse(raw));}catch(_){}
          entry={raw,value};sourceReadCache.set(key,entry);
        }
        const value=entry.value;if(value&&!rows.has(value.id))rows.set(value.id,value);
      }
      for(const key of sourceReadCache.keys())if(!seenKeys.has(key))sourceReadCache.delete(key);
      return {ok:true,attempts:[...rows.values()].sort((a,b)=>a.submittedAt.localeCompare(b.submittedAt)||a.id.localeCompare(b.id))};
    }catch(_){return {ok:false,attempts:[]};}
  }
  function hasAnswer(value) {return Array.isArray(value)?value.some(hasAnswer):typeof value==='string'&&!!value.trim();}
  function hasPersonalText(value) {return typeof value==='string'&&!!value.trim()&&!/^(?:（未提供|（未找到|（空白）$|未作答$)/.test(value);}
  function mergeGroupAnswers(existing,incoming,preferIncoming) {
    const passage=sourceIndex().passages.find(p=>p.groups.some(g=>g.sourceId===existing.sourceId));
    const canonical=passage?.groups.find(g=>g.sourceId===existing.sourceId),aliases=new Map();
    for(const response of canonical?.responses||[]){aliases.set(response.id,response.id);aliases.set(response.legacyKey,response.id);}
    const primary=preferIncoming?incoming:existing,secondary=preferIncoming?existing:incoming,answers=new Map();
    for(const item of primary.answers||[])answers.set(aliases.get(item.key)||item.key,{...item});
    for(const item of secondary.answers||[]){const key=aliases.get(item.key)||item.key,previous=answers.get(key);if(!previous||!hasAnswer(previous.value)&&hasAnswer(item.value))answers.set(key,{...item});}
    const sorted=[...answers.values()].sort((a,b)=>{
      const order=canonical?.responses?.map(r=>r.id)||[];
      const rank=item=>{const i=order.indexOf(aliases.get(item.key)||item.key);return i<0?1000:i;};
      return rank(a)-rank(b)||a.key.localeCompare(b.key);
    });
    const render=item=>item.display||(Array.isArray(item.value)?item.value.join(' + '):item.value)||'（空白）';
    const userAnswer=sorted.length?sorted.map(render).join(' / '):hasPersonalText(primary.userAnswer)?primary.userAnswer:secondary.userAnswer||primary.userAnswer;
    return {...primary,answers:sorted,userAnswer};
  }
  function sourceVersion(existing,incoming) {
    const upgrade=existing.evidenceOnly&&!incoming.evidenceOnly;
    if(existing.sourceId!==incoming.sourceId||existing.passageId!==incoming.passageId)return {conflict:'相同记录 ID 的文章或提交身份不同，已保留原记录。'};
    if(Date.parse(existing.submittedAt)!==Date.parse(incoming.submittedAt)){
      if(!upgrade)return {conflict:'相同提交 ID 的时间不同，已保留原记录，未猜测应采用哪个版本。'};
      return {value:incoming,warning:'已用当前备份中的提交时间和记录替换先前的恢复证据版本。'};
    }
    const oldGroups=new Map(existing.groups.map(g=>[g.sourceId,g]));
    const sameScore=(a,b)=>a.earned===b.earned&&a.total===b.total&&a.status===b.status&&a.wrongMarks===b.wrongMarks&&a.unansweredMarks===b.unansweredMarks;
    for(const group of incoming.groups){const previous=oldGroups.get(group.sourceId);if(previous&&!sameScore(previous,group)&&!upgrade)return {conflict:'相同提交 ID 的题目判分存在冲突，已保留原记录；当前可靠判分不会被静默覆盖。'};}
    if(!existing.groups.length&&!incoming.groups.length&&(existing.earned!==incoming.earned||existing.total!==incoming.total)&&!upgrade)return {conflict:'相同提交 ID 的汇总成绩不同，已保留原记录。'};
    if(existing.groups.length&&!incoming.groups.length&&upgrade&&(existing.earned!==incoming.earned||existing.total!==incoming.total))return {conflict:'当前版本只有不同的汇总成绩，缺少可核对的题目判分，已保留原恢复题组并跳过冲突版本。'};
    const groups=new Map(existing.groups.map(g=>[g.sourceId,g]));
    for(const group of incoming.groups){const previous=groups.get(group.sourceId);groups.set(group.sourceId,previous?mergeGroupAnswers(previous,group,upgrade):group);}
    const combined=[...groups.values()],base=upgrade?incoming:existing;
    const merged={...base,evidenceOnly:existing.evidenceOnly&&incoming.evidenceOnly,
      durationSeconds:base.durationSeconds||(upgrade?existing.durationSeconds:incoming.durationSeconds),
      groups:combined,earned:combined.length?combined.reduce((n,g)=>n+g.earned,0):base.earned,
      total:combined.length?combined.reduce((n,g)=>n+g.total,0):base.total,
      fullCoverage:combined.length>0,
      unmatchedOutcomes:Math.min(existing.unmatchedOutcomes,incoming.unmatchedOutcomes)};
    const value=validSource(merged);
    if(!value)return {conflict:'合并后的原站题组无法通过完整性核对，已保留原记录。'};
    return {value,warning:upgrade?'已用当前备份更新先前的恢复证据，并保留可关联的个人作答。':null};
  }
  function prepareSources(values) {
    if(!Array.isArray(values)||values.length>20000)throw new Error('原站记录数量或格式不正确。');
    if(values.length&&(!window.ReadingSourceBackup||!sourceIndex()))throw new Error('原站题目索引未加载，请刷新后再导入。');
    const existing=new Map(listSources().attempts.map(a=>[a.id,a])),changes=new Map(),added=new Set(),updated=new Set(),warnings=new Set();let skipped=0,conflicts=0;
    for(const raw of values){
      const incoming=validSource(raw);if(!incoming){skipped++;warnings.add('部分原站记录的格式或身份无效，已跳过。');continue;}
      const previous=existing.get(incoming.id);
      if(!previous){existing.set(incoming.id,incoming);changes.set(incoming.id,incoming);added.add(incoming.id);continue;}
      const result=sourceVersion(previous,incoming);
      if(result.conflict){skipped++;conflicts++;warnings.add(result.conflict);continue;}
      if(JSON.stringify(result.value)===JSON.stringify(previous)){skipped++;continue;}
      if(result.warning)warnings.add(result.warning);
      existing.set(incoming.id,result.value);changes.set(incoming.id,result.value);if(!added.has(incoming.id))updated.add(incoming.id);
    }
    return {changes,result:{added:added.size,updated:updated.size,skipped,conflicts,warnings:[...warnings]}};
  }
  function previewSources(values) {return prepareSources(values).result;}
  function mergeSources(values,notify=true) {
    const prepared=prepareSources(values);
    for(const value of prepared.changes.values()){
      try{localStorage.setItem(sourcePrefix+value.id,JSON.stringify(value));}
      catch(_){throw new Error('浏览器空间不足，已保存的记录仍保留，请先导出备份。');}
    }
    if(notify)dispatchEvent(new CustomEvent('reading-study-updated'));
    return prepared.result;
  }
  function enrichArticles(articles) {
    const sources=listSources().attempts;
    if(!sources.length||!sourceIndex())return articles;
    const canonical=new Map(sourceIndex().passages.map(p=>[p.id,p])),byPassage=new Map();
    for(const attempt of sources){if(!byPassage.has(attempt.passageId))byPassage.set(attempt.passageId,[]);byPassage.get(attempt.passageId).push(attempt);}
    return articles.map(article=>{
      const imported=byPassage.get(article.id),passage=canonical.get(article.id);if(!imported?.length||!passage)return article;
      const latest=new Map(passage.groups.filter(g=>g.baseline).map(g=>[g.sourceId,{...g.baseline,
        wrongMarks:Number.isInteger(g.baseline.wrongMarks)?g.baseline.wrongMarks:['incorrect','partial'].includes(g.baseline.status)?g.baseline.total-g.baseline.earned:0,
        unansweredMarks:Number.isInteger(g.baseline.unansweredMarks)?g.baseline.unansweredMarks:g.baseline.status==='unanswered'?g.baseline.total-g.baseline.earned:0}]));
      for(const attempt of imported){
        for(const group of attempt.groups){
          const previous=latest.get(group.sourceId);
          if(!previous||Date.parse(attempt.submittedAt)>Date.parse(previous.submittedAt))latest.set(group.sourceId,{...group,submittedAt:attempt.submittedAt});
        }
      }
      const merged=[...latest.values()],sourceWrong=merged.reduce((n,g)=>n+g.wrongMarks,0),sourceUnanswered=merged.reduce((n,g)=>n+g.unansweredMarks,0);
      const sourceSubmittedAt=merged.map(g=>g.submittedAt).filter(Boolean).sort().at(-1)||null;
      const sourceErrorAt=merged.filter(g=>g.wrongMarks>0).map(g=>g.submittedAt).sort().at(-1)||null;
      return {...article,backupWrong:sourceWrong,backupUnanswered:sourceUnanswered,historicalWrong:Math.max(article.historicalWrong||0,sourceWrong),
        sourceWrong,sourceUnanswered,sourceSubmittedAt,sourceErrorAt,sourceRecordCount:imported.length};
    });
  }
  function merge(payload,articles) {
    if(payload?.schemaVersion!=='zyz-reading-test-history.v1'||!Array.isArray(payload.attempts)||payload.attempts.length>20000)throw new Error('请选择从「计划与成绩」导出的测试记录 JSON。');
    if(payload.sourceAttempts!==undefined&&(!Array.isArray(payload.sourceAttempts)||payload.sourceAttempts.length>20000))throw new Error('原站历史记录格式不正确。');
    if(payload.sourceAttempts?.length&&(!window.ReadingSourceBackup||!sourceIndex()))throw new Error('原站题目索引未加载，请刷新后再导入。');
    const known=new Set(articles.map(a=>a.id)),existing=new Set(list().attempts.map(a=>a.id));
    let added=0,skipped=0;
    for(const raw of payload.attempts){const a=ReadingStudyCore.validAttempt(raw);if(!a||!known.has(a.passageId)||existing.has(a.id)){skipped++;continue;}const r=append(a,false);if(!r.ok)throw new Error(r.error);existing.add(a.id);added++;}
    const sources=mergeSources(payload.sourceAttempts||[],false);
    dispatchEvent(new CustomEvent('reading-study-updated'));
    return {added,skipped,sourceAdded:sources.added,sourceUpdated:sources.updated,sourceSkipped:sources.skipped,sourceConflicts:sources.conflicts,sourceWarnings:sources.warnings};
  }
  window.ReadingStudyStore={list,append,getSettings,saveSettings,merge,listSources,previewSources,mergeSources,enrichArticles,
    exportData:()=>({schemaVersion:'zyz-reading-test-history.v1',exportedAt:new Date().toISOString(),settings:getSettings(),attempts:list().attempts,sourceAttempts:listSources().attempts})};
})();
