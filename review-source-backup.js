(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ReadingSourceBackup=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const statuses=new Set(['correct','incorrect','partial','unanswered']);
  const MAX_NODES=700000,MAX_DEPTH=80,MAX_EMBEDDED=80000000,MAX_RECORDS=20000;
  const isObject=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
  const shortString=(v,max=300)=>typeof v==='string'&&v.length>0&&v.length<=max;
  const date=v=>typeof v==='string'&&v.length<=60&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
  const number=v=>{const m=String(v??'').trim().match(/^(?:q\s*)?(\d+)(?:\s*[-–—]\s*\d+)?$/i);return m?Number(m[1]):-1;};
  const marks=(earned,total)=>Number.isInteger(earned)&&Number.isInteger(total)&&total>0&&total<=50&&earned>=0&&earned<=total;
  function compile(index){
    if(index?.schemaVersion!=='zyz-reading-source-index.v1'||!Array.isArray(index.passages)||index.passages.length>1000)throw new Error('原站题目关联索引不可用，请刷新页面。');
    const passages=new Map();
    for(const passage of index.passages){
      if(!shortString(passage.id)||!Array.isArray(passage.groups))continue;
      const tasks=new Map(),byId=new Map();
      for(const group of passage.groups){
        byId.set(group.id,group);if(!tasks.has(group.taskId))tasks.set(group.taskId,[]);
        for(const [offset,slot] of (group.scoreSlots||[]).entries())tasks.get(group.taskId).push({slot,group,position:number(group.number)+offset});
      }
      passages.set(passage.id,{...passage,tasks,byId,slots:passage.groups.flatMap(group=>(group.scoreSlots||[]).map((slot,offset)=>({slot,group,position:number(group.number)+offset})))});
    }
    return {passages,options:isObject(index.options)?index.options:{}};
  }
  function identity(outcome,pid,passage){
    const id=typeof outcome.questionId==='string'?outcome.questionId.trim():'';
    const task=typeof outcome.taskId==='string'?outcome.taskId:'';
    const supplied=outcome.questionNumber!==undefined&&outcome.questionNumber!==null&&outcome.questionNumber!=='';
    const display=supplied?number(outcome.questionNumber):-1;
    if(supplied&&display<0)return null;
    if(id.includes('|')){
      const parts=id.split('|'),position=parts.length===3?number(parts[2]):-1;
      if(parts.length!==3||parts[0]!==pid||!passage.tasks.has(parts[1])||task&&task!==parts[1]||position<0||supplied&&position!==display)return null;
      return {task:parts[1],position,key:parts[1]+'|'+position};
    }
    const exact=passage.slots.find(s=>s.slot===id);
    if(exact){
      if(task&&task!==exact.group.taskId)return null;
      return {task:exact.group.taskId,position:supplied?display:exact.position,key:exact.slot,slot:exact.slot};
    }
    const position=number(id);
    if(!id||position<0||supplied&&position!==display||task&&!passage.tasks.has(task))return null;
    return {task,position,key:(task||'legacy')+'|'+position};
  }
  function answerValue(value){
    if(isObject(value)&&Object.hasOwn(value,'userAnswer'))return answerValue(value.userAnswer);
    if(value==null)return '';
    if(typeof value==='string')return value.slice(0,500);
    if(typeof value==='number'&&Number.isFinite(value))return String(value);
    if(Array.isArray(value)&&value.length<=20){const result=[];for(const v of value){const item=answerValue(v);if(typeof item==='string')result.push(item);}return result;}
    return '';
  }
  function answerText(value,options){
    if(Array.isArray(value))return value.map(v=>answerText(v,options)).join(' + ')||'（空白）';
    return !value?'（空白）':Object.hasOwn(options,value)&&typeof options[value]==='string'?options[value]:value;
  }
  function scorePair(value){
    const earned=value?.earnedMarks??value?.correct,total=value?.availableMarks??value?.total;
    return marks(earned,total)?{earned,total}:null;
  }
  function validGroup(raw,canonical){
    if(!isObject(raw)||raw.id!==canonical.id||raw.sourceId!==canonical.sourceId||!marks(raw.earned,raw.total)||raw.total>canonical.marks||!statuses.has(raw.status))return null;
    if(raw.status==='correct'&&raw.earned!==raw.total||raw.status==='unanswered'&&raw.earned!==0||raw.status==='partial'&&(raw.earned===0||raw.earned===raw.total)||raw.status==='incorrect'&&raw.earned!==0)return null;
    const wrongMarks=Number.isInteger(raw.wrongMarks)?raw.wrongMarks:raw.status==='incorrect'||raw.status==='partial'?raw.total-raw.earned:0;
    const unansweredMarks=Number.isInteger(raw.unansweredMarks)?raw.unansweredMarks:raw.status==='unanswered'?raw.total-raw.earned:0;
    if(wrongMarks<0||unansweredMarks<0||wrongMarks+unansweredMarks!==raw.total-raw.earned)return null;
    const answers=[];
    for(const item of Array.isArray(raw.answers)?raw.answers.slice(0,10):[]){
      if(!shortString(item?.key,300))continue;
      const value=answerValue(item.value),display=typeof item.display==='string'?item.display.slice(0,3000):'';
      answers.push({key:item.key,value,display});
    }
    return {id:canonical.id,sourceId:canonical.sourceId,number:canonical.number,earned:raw.earned,total:raw.total,
      status:raw.status,userAnswer:typeof raw.userAnswer==='string'?raw.userAnswer.slice(0,5000):'',answers,
      historicalNumbers:Array.isArray(raw.historicalNumbers)?raw.historicalNumbers.filter(n=>typeof n==='string'&&n.length<=60).slice(0,10):[],
      wrongMarks,unansweredMarks};
  }
  function validateAttempt(raw,index){
    const compiled=compile(index),passage=compiled.passages.get(raw?.passageId);
    if(!passage||!shortString(raw.id,700)||!shortString(raw.sourceId,300)||raw.id!=='source:'+raw.sourceId+'::'+raw.passageId||!date(raw.submittedAt)||!marks(raw.earned,raw.total)||!Array.isArray(raw.groups)||raw.groups.length>50)return null;
    const groups=[],seen=new Set();
    for(const group of raw.groups){const canonical=passage.byId.get(group?.id),validated=canonical&&validGroup(group,canonical);if(!validated||seen.has(validated.id))return null;seen.add(validated.id);groups.push(validated);}
    groups.sort((a,b)=>passage.groups.findIndex(g=>g.id===a.id)-passage.groups.findIndex(g=>g.id===b.id));
    const groupedTotal=groups.reduce((n,g)=>n+g.total,0),groupedEarned=groups.reduce((n,g)=>n+g.earned,0);
    if(groups.length&&(groupedTotal!==raw.total||groupedEarned!==raw.earned))return null;
    const fullCoverage=raw.fullCoverage===true&&groups.length===passage.groups.length&&raw.total===passage.total&&groups.every(g=>g.total===passage.byId.get(g.id).marks);
    return {id:raw.id,sourceId:raw.sourceId,passageId:passage.id,submittedAt:date(raw.submittedAt),earned:raw.earned,total:raw.total,
      articleTotal:passage.total,fullCoverage,evidenceOnly:raw.evidenceOnly===true,
      durationSeconds:Number.isFinite(raw.durationSeconds)?Math.max(0,Math.min(43200,Math.round(raw.durationSeconds))):0,
      groups,wrongMarks:groups.reduce((n,g)=>n+g.wrongMarks,0),unansweredMarks:groups.reduce((n,g)=>n+g.unansweredMarks,0),
      unmatchedOutcomes:Number.isInteger(raw.unmatchedOutcomes)?Math.max(0,Math.min(1000,raw.unmatchedOutcomes)):0,
      format:raw.format==='legacy'?'legacy':'runtime',scoreOnly:groups.length===0};
  }
  function parse(raw,index){
    if(!isObject(raw))throw new Error('请选择原 PASSAGE 导出的完整备份 JSON。');
    const compiled=compile(index),records=new Map(),snapshots=new Map();
    const counts={submittedRecords:0,sourceAttempts:0,knownPassages:0,mappedOutcomes:0,unmatchedOutcomes:0,skippedRecords:0,
      duplicateRecords:0,duplicateSnapshots:0,recordConflicts:0,embeddedJsonParsed:0,embeddedJsonFailed:0,missingSnapshots:0,
      incompleteAttempts:0,evidenceOnlyAttempts:0,invalidOutcomes:0,invalidIdentities:0};
    const warnings=[],warningKeys=new Set();
    const warn=(key,text)=>{if(!warningKeys.has(key)){warningKeys.add(key);warnings.push(text);}};
    const isRecovery=raw.schemaVersion==='passage-recovery-transfer.v1';
    let recognized=isRecovery||raw.schemaVersion==='zyz-reading-personal-backup.v1'||Array.isArray(raw.records);
    const stack=[{value:raw,depth:0,rank:isRecovery?1:0}],seen=new WeakSet();
    if(isObject(raw.backup))stack.push({value:raw.backup,depth:0,rank:0});
    let nodes=0,embeddedBytes=0;
    const collect=(map,identity,value,rank,kind)=>{
      if(!shortString(identity,300))return;
      const previous=map.get(identity);
      if(previous){counts[kind==='record'?'duplicateRecords':'duplicateSnapshots']++;if(kind==='record'&&JSON.stringify(previous.value.questionOutcomes)!==JSON.stringify(value.questionOutcomes))counts.recordConflicts++;}
      if(!previous||rank<previous.rank)map.set(identity,{value,rank});
      if(map.size>MAX_RECORDS)throw new Error('备份记录超过本页处理上限，请拆分导出文件。');
    };
    while(stack.length){
      const {value,depth,rank}=stack.pop();
      if(++nodes>MAX_NODES||depth>MAX_DEPTH)throw new Error('备份嵌套或内容过大，请选择原站直接导出的备份。');
      if(value&&typeof value==='object'){
        if(seen.has(value))continue;seen.add(value);
        if(value.schemaVersion==='zyz-reading-student-records.v1'){
          recognized=true;
          if(value.type==='submitted')collect(records,value.recordId,value,rank,'record');
        }
        if(value.schemaVersion==='zyz-reading-private-attempt-snapshot.v1'){
          recognized=true;collect(snapshots,value.snapshotId,value,rank,'snapshot');
        }
        const values=Array.isArray(value)?value:Object.values(value);
        for(let i=values.length-1;i>=0;i--)stack.push({value:values[i],depth:depth+1,rank});
      }else if(typeof value==='string'){
        const trimmed=value.trim();
        if(trimmed.startsWith('{')||trimmed.startsWith('[')){
          embeddedBytes+=value.length;
          if(embeddedBytes>MAX_EMBEDDED)throw new Error('备份内嵌数据超过处理上限，请使用原站直接导出的备份。');
          try{const parsed=JSON.parse(value);counts.embeddedJsonParsed++;stack.push({value:parsed,depth:depth+1,rank});}catch(error){counts.embeddedJsonFailed++;}
        }
      }
    }
    if(!recognized)throw new Error('未识别到原 PASSAGE 备份。本站测试记录请使用「导入记录」。');
    counts.submittedRecords=records.size;
    const attempts=[];
    for(const [sourceId,entry] of records){
      const record=entry.value,snapshot=snapshots.get(sourceId)?.value,payload=isObject(snapshot?.payload)?snapshot.payload:{},legacy=isObject(payload.answers),format=legacy?'legacy':'runtime';
      const submittedAt=date(record.submittedAt??payload.endTime);
      const declared=Array.isArray(record.passageIds)?record.passageIds.filter(pid=>shortString(pid)):[];
      const rawOutcomes=Array.isArray(record.questionOutcomes)?record.questionOutcomes:[];
      if(!submittedAt||declared.length>10||rawOutcomes.length>1000){counts.skippedRecords++;continue;}
      if(!snapshot)counts.missingSnapshots++;
      const known=declared.filter(pid=>compiled.passages.has(pid)),buckets=new Map(),unmatchedByPassage=new Map();
      for(const outcome of rawOutcomes){
        const pid=outcome?.passageId||(declared.length===1?declared[0]:null);
        if(!compiled.passages.has(pid)||(declared.length&&!declared.includes(pid))){counts.unmatchedOutcomes++;continue;}
        const resolved=identity(outcome,pid,compiled.passages.get(pid));
        if(!resolved){counts.invalidIdentities++;counts.unmatchedOutcomes++;unmatchedByPassage.set(pid,(unmatchedByPassage.get(pid)||0)+1);continue;}
        const earned=outcome.earnedMarks,total=outcome.availableMarks;
        if(!marks(earned,total)||!statuses.has(outcome.status)||
            outcome.status==='correct'&&earned!==total||outcome.status==='unanswered'&&earned!==0||
            outcome.status==='incorrect'&&earned===total||outcome.status==='partial'&&(earned===0||earned===total)){
          counts.invalidOutcomes++;counts.unmatchedOutcomes++;unmatchedByPassage.set(pid,(unmatchedByPassage.get(pid)||0)+1);continue;
        }
        const task=resolved.task;
        const key=pid+'\u0000'+task;if(!buckets.has(key))buckets.set(key,{pid,task,outcomes:[]});buckets.get(key).outcomes.push({...outcome,_identity:resolved});
      }
      const grouped=new Map();
      for(const {pid,task,outcomes} of buckets.values()){
        const passage=compiled.passages.get(pid),slots=task?passage.tasks.get(task):passage.slots;
        const sorted=[...outcomes].sort((a,b)=>a._identity.position-b._identity.position);
        const identities=sorted.map(o=>o._identity.key);
        const offsets=slots&&new Set(sorted.map((o,i)=>o._identity.position-(slots[i]?.position??NaN)));
        if(!slots||slots.length!==sorted.length||new Set(identities).size!==identities.length||offsets.size!==1||
            sorted.some((o,i)=>o._identity.slot&&o._identity.slot!==slots[i].slot)){
          counts.unmatchedOutcomes+=outcomes.length;unmatchedByPassage.set(pid,(unmatchedByPassage.get(pid)||0)+outcomes.length);continue;
        }
        for(let i=0;i<slots.length;i++){
          const {group}=slots[i],outcome=sorted[i],key=pid+'\u0000'+group.id;
          if(!grouped.has(key))grouped.set(key,{pid,group,outcomes:[]});grouped.get(key).outcomes.push(outcome);
        }
      }
      const passageGroups=new Map();
      const answerLookup=legacy?payload.answers:isObject(payload.runtimeState?.answers)?payload.runtimeState.answers:{};
      for(const {pid,group,outcomes} of grouped.values()){
        const earned=outcomes.reduce((n,o)=>n+o.earnedMarks,0),total=outcomes.reduce((n,o)=>n+o.availableMarks,0);
        if(total!==group.marks){counts.unmatchedOutcomes+=outcomes.length;unmatchedByPassage.set(pid,(unmatchedByPassage.get(pid)||0)+outcomes.length);continue;}
        const answers=[];
        for(const response of group.responses||[]){const key=legacy?response.legacyKey:response.id;if(Object.hasOwn(answerLookup,key)){const value=answerValue(answerLookup[key]);answers.push({key,value,display:answerText(value,compiled.options)});}}
        const status=earned===total?'correct':outcomes.every(o=>o.status==='unanswered')?'unanswered':earned>0?'partial':'incorrect';
        const normalized={id:group.id,sourceId:group.sourceId,number:group.number,earned,total,status,
          userAnswer:answers.length?answers.map(a=>a.display).join(' / '):'（未提供可关联的个人作答快照）',answers,
          historicalNumbers:outcomes.map(o=>String(o.questionNumber??o.questionId)),
          wrongMarks:outcomes.reduce((n,o)=>n+(o.status==='incorrect'||o.status==='partial'?o.availableMarks-o.earnedMarks:0),0),
          unansweredMarks:outcomes.reduce((n,o)=>n+(o.status==='unanswered'?o.availableMarks-o.earnedMarks:0),0)};
        if(!passageGroups.has(pid))passageGroups.set(pid,[]);passageGroups.get(pid).push(normalized);counts.mappedOutcomes+=outcomes.length;
      }
      const candidatePassages=[...new Set([...known,...passageGroups.keys()])];
      if(!candidatePassages.length){counts.skippedRecords++;continue;}
      for(const pid of candidatePassages){
        const passage=compiled.passages.get(pid),groups=passageGroups.get(pid)||[];
        groups.sort((a,b)=>passage.groups.findIndex(g=>g.id===a.id)-passage.groups.findIndex(g=>g.id===b.id));
        const sourceResult=Array.isArray(record.passageResults)?record.passageResults.find(p=>p.passageId===pid):null;
        const fallback=scorePair(sourceResult)||(declared.length===1?scorePair(record.score):null);
        const earned=groups.length?groups.reduce((n,g)=>n+g.earned,0):fallback?.earned,total=groups.length?groups.reduce((n,g)=>n+g.total,0):fallback?.total;
        if(!marks(earned,total)){counts.skippedRecords++;continue;}
        const rawAttempt={id:'source:'+sourceId+'::'+pid,sourceId,passageId:pid,submittedAt,earned,total,articleTotal:passage.total,
          fullCoverage:groups.length===passage.groups.length&&total===passage.total,evidenceOnly:entry.rank>0,groups,
          durationSeconds:sourceResult?.elapsedSeconds??(declared.length===1?record.elapsedSeconds:0),format,unmatchedOutcomes:unmatchedByPassage.get(pid)||0};
        const attempt=validateAttempt(rawAttempt,index);
        if(attempt){attempts.push(attempt);if(!attempt.fullCoverage)counts.incompleteAttempts++;if(attempt.evidenceOnly)counts.evidenceOnlyAttempts++;}
      }
    }
    attempts.sort((a,b)=>a.submittedAt.localeCompare(b.submittedAt)||a.id.localeCompare(b.id));
    counts.sourceAttempts=attempts.length;counts.knownPassages=new Set(attempts.map(a=>a.passageId)).size;
    if(counts.unmatchedOutcomes)warn('unmatched',counts.unmatchedOutcomes+' 条题目判分未能可靠关联，已跳过对应题组，未猜测答案或补造记录。');
    if(counts.invalidIdentities)warn('identities',counts.invalidIdentities+' 条题目身份缺失、格式不支持或与文章／题组／题号冲突，已跳过。支持原站 passage|task|题号、旧版 qN 和已知评分项 ID。');
    if(counts.incompleteAttempts)warn('partial',counts.incompleteAttempts+' 条为题组练习或不完整文章记录，只更新已可靠关联的题目。');
    if(counts.evidenceOnlyAttempts)warn('evidence',counts.evidenceOnlyAttempts+' 条来自原文件的恢复证据，保留来源标记，不代表原站回放已修复。');
    if(counts.recordConflicts)warn('conflicts','相同提交 ID 有不同版本，优先采用当前 backup 中的版本。');
    if(counts.missingSnapshots)warn('snapshots',counts.missingSnapshots+' 次提交没有个人作答快照，可保留判分，但不会推断个人答案。');
    if(raw.evidence?.complete===false)warn('incomplete','原备份标记恢复证据不完整；只能导入此文件实际保存的记录。');
    if(counts.skippedRecords)warn('skipped',counts.skippedRecords+' 条无可靠日期、文章身份或分数的记录已跳过。');
    return {attempts,counts,warnings};
  }
  return {parse,validateAttempt};
});
