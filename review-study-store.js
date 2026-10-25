(() => {
  'use strict';
  const prefix='zyz-reading-attempt-v1:',settingsKey='zyz-reading-plan-v1';
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
  function merge(payload,articles) {
    if(payload?.schemaVersion!=='zyz-reading-test-history.v1'||!Array.isArray(payload.attempts)||payload.attempts.length>20000)throw new Error('请选择从「计划与成绩」导出的测试记录 JSON。');
    const known=new Set(articles.map(a=>a.id)),existing=new Set(list().attempts.map(a=>a.id));
    let added=0,skipped=0;
    for(const raw of payload.attempts){const a=ReadingStudyCore.validAttempt(raw);if(!a||!known.has(a.passageId)||existing.has(a.id)){skipped++;continue;}const r=append(a,false);if(!r.ok)throw new Error(r.error);existing.add(a.id);added++;}
    dispatchEvent(new CustomEvent('reading-study-updated'));
    return {added,skipped};
  }
  window.ReadingStudyStore={list,append,getSettings,saveSettings,merge,
    exportData:()=>({schemaVersion:'zyz-reading-test-history.v1',exportedAt:new Date().toISOString(),settings:getSettings(),attempts:list().attempts})};
})();
