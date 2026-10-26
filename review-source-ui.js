(() => {
  'use strict';
  const header=document.querySelector('.study-header-actions'),hero=document.querySelector('.study-hero');
  if(!header||!hero||!window.ReadingSourceBackup||!window.ReadingSourceBackupIndex||!window.ReadingStudyStore)return;
  const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
  const format=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
  const passages=new Map(ReadingSourceBackupIndex.passages.map(p=>[p.id,p]));
  const launch=node('button','导入原站备份');launch.type='button';launch.id='import-source-backup';header.append(launch);
  const input=node('input');input.type='file';input.accept='.json,application/json';input.hidden=true;input.id='source-backup-file';header.append(input);
  const status=node('p',undefined,'source-history-status');status.setAttribute('role','status');hero.after(status);
  const history=node('details',undefined,'source-history');history.append(node('summary','查看导入的原站历史'));const historyBody=node('div');history.append(historyBody);status.after(history);
  const dialog=node('dialog',undefined,'source-import-dialog');dialog.setAttribute('aria-labelledby','source-import-title');
  const title=node('h2','导入原 PASSAGE 备份');title.id='source-import-title';
  const detail=node('p'),warnings=node('div',undefined,'source-import-warnings'),preview=node('div',undefined,'source-import-preview'),actions=node('div',undefined,'source-import-actions');
  const cancel=node('button','取消'),merge=node('button','合并记录');cancel.type=merge.type='button';merge.className='source-import-primary';merge.id='confirm-source-import';
  actions.append(cancel,merge);dialog.append(title,detail,node('p','原站记录更新个人答案与错题顺序，单独保留来源；不会当作新完成的本站记忆测试。'),warnings,preview,actions);document.body.append(dialog);
  let pending=null;
  function renderHistory(){
    const stored=ReadingStudyStore.listSources(),rows=stored.attempts;
    const submissions=new Set(rows.map(a=>a.sourceId)).size,articles=new Set(rows.map(a=>a.passageId)).size;
    status.textContent=rows.length?'已导入原站 '+submissions+' 次提交 · '+articles+' 篇文章。本站测试成绩另外统计。':'原站做了新题，可直接点「导入原站备份」；在本站测试交卷会自动记录。';
    if(!stored.ok)status.textContent='当前浏览器无法读取原站记录，请检查浏览器存储权限。';
    history.hidden=!rows.length;historyBody.replaceChildren();
    for(const attempt of [...rows].reverse().slice(0,30)){
      const row=node('div',undefined,'source-history-row'),passage=passages.get(attempt.passageId),copy=node('div');
      copy.append(node('strong',passage.title),node('small',format.format(new Date(attempt.submittedAt))+' · '+attempt.earned+'/'+attempt.total+(attempt.fullCoverage?' · 整篇':' · 部分题组')+(attempt.evidenceOnly?' · 恢复证据':'')));
      const link=node('a','查看作答');link.href='逐篇复习/'+passage.file+'?source='+encodeURIComponent(attempt.sourceId);row.append(copy,link);historyBody.append(row);
    }
    if(rows.length>30)historyBody.append(node('p','这里显示最近 30 条文章记录；全部记录均保留，并随「导出记录」一起备份。'));
  }
  function close(){pending=null;dialog.close();input.value='';}
  launch.addEventListener('click',()=>input.click());cancel.addEventListener('click',close);
  dialog.addEventListener('cancel',()=>{pending=null;input.value='';});
  input.addEventListener('change',async()=>{
    const file=input.files?.[0];if(!file)return;
    launch.disabled=true;status.textContent='正在读取备份…';
    try{
      if(file.size>64000000)throw new Error('文件超过 64 MB，请选择原站直接导出的 JSON 备份。');
      const parsed=ReadingSourceBackup.parse(JSON.parse((await file.text()).replace(/^\uFEFF/,'')),ReadingSourceBackupIndex);
      if(!parsed.attempts.length)throw new Error('没有找到能可靠关联到当前 175 篇文章的已提交记录。');
      const changes=ReadingStudyStore.previewSources(parsed.attempts);
      pending=parsed;
      detail.textContent='识别 '+parsed.counts.submittedRecords+' 次原站提交，关联 '+parsed.counts.knownPassages+' 篇文章；可新增 '+changes.added+' 条、补全 '+changes.updated+' 条。相同记录自动去重。';
      warnings.replaceChildren();for(const warning of [...new Set([...parsed.warnings,...changes.warnings])])warnings.append(node('p',warning));
      preview.replaceChildren();
      for(const attempt of [...parsed.attempts].reverse().slice(0,8))preview.append(node('p',passages.get(attempt.passageId).title+' · '+attempt.earned+'/'+attempt.total+' · '+(attempt.fullCoverage?'整篇':'部分题组')));
      if(parsed.attempts.length>8)preview.append(node('p','另有 '+(parsed.attempts.length-8)+' 条文章记录。'));
      merge.disabled=changes.added+changes.updated===0;merge.textContent=merge.disabled?'没有可合并的新记录':'确认合并';dialog.showModal();
      renderHistory();
    }catch(error){status.textContent=error.message||'读取失败，请选择原 PASSAGE 导出的备份 JSON。';input.value='';}
    finally{launch.disabled=false;}
  });
  merge.addEventListener('click',()=>{
    if(!pending)return;
    try{const result=ReadingStudyStore.mergeSources(pending.attempts);close();renderHistory();status.textContent='新增 '+result.added+' 条、补全 '+result.updated+' 条原站文章记录；跳过 '+result.skipped+' 条重复记录'+(result.conflicts?'，另有 '+result.conflicts+' 条冲突未覆盖':'')+'。计划与个人作答已更新；可以导出备份。';}
    catch(error){warnings.replaceChildren(node('p',error.message||'合并失败，请先导出已有记录。'));}
  });
  addEventListener('storage',renderHistory);addEventListener('reading-study-updated',renderHistory);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)renderHistory();});
  renderHistory();
})();
