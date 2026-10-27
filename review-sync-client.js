(function(root,factory){
  const api=factory(root,typeof module==='object'&&module.exports?require('./review-sync-protocol.js'):root.ReadingSyncProtocol);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ReadingSyncClient=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root,protocol){
  'use strict';
  const CONNECTION='zyz-reading-sync-connection-v1',DEVICE='zyz-reading-sync-device-v1',SETTINGS='zyz-reading-plan-v1',META='zyz-reading-sync-settings-v1';
  const ENDPOINT='https://zyz-reading-sync.chalky-grass-0591.chatgpt.site';
  const settingNames=['dailyMinutes'];
  function create(options={}){
    const storage=options.storage||root.localStorage,store=options.store||root.ReadingStudyStore,core=options.core||root.ReadingStudyCore;
    const crypto=options.crypto||root.crypto,fetcher=options.fetch||root.fetch.bind(root),endpoint=(options.endpoint||ENDPOINT).replace(/\/$/,'');
    const requestTimeoutMs=Number.isFinite(options.requestTimeoutMs)&&options.requestTimeoutMs>0?options.requestTimeoutMs:20000;
    const sourceBackup=()=>options.sourceBackup||root.ReadingSourceBackup,sourceIndex=()=>options.sourceIndex||root.ReadingSourceBackupIndex;
    let connection=null,generation=0,running=null,requested=false,applying=false;
    let state={status:'disconnected',connected:false,lastSyncedAt:null,conflicts:0,error:null};
    const read=(key,fallback)=>{const raw=storage.getItem(key);return raw?JSON.parse(raw):fallback;};
    const write=(key,value)=>storage.setItem(key,JSON.stringify(value));
    const emit=patch=>{state={...state,...patch};if(options.onState)options.onState({...state});};
    const checkpoint=gen=>{if(gen!==generation||!connection)throw new Error('sync-disconnected');};
    const progressKey=keys=>'zyz-reading-sync-space-v1:'+keys.spaceId;
    function progress(keys){const p=read(progressKey(keys),{});return {cursor:Number.isSafeInteger(p.cursor)&&p.cursor>=0?p.cursor:0,acks:Array.isArray(p.acks)?p.acks:[],conflicts:Array.isArray(p.conflicts)?p.conflicts:[],lastSyncedAt:p.lastSyncedAt||null};}
    function device(){let id=storage.getItem(DEVICE);if(!id){id=protocol.createCode(crypto).slice(5);storage.setItem(DEVICE,id);}return id;}
    function settingsMeta(){
      let meta=read(META,{fields:{}});if(!meta||!meta.fields)throw new Error('invalid-settings');
      const raw=read(SETTINGS,null);
      if(raw){for(const name of settingNames){if(Object.hasOwn(raw,name)&&!meta.fields[name])meta.fields[name]={value:core.settings(raw)[name],modifiedAt:new Date().toISOString(),deviceId:device()};}write(META,meta);}
      return validateSettings(meta);
    }
    function validateSettings(value){
      if(!value||!value.fields||typeof value.fields!=='object'||Array.isArray(value.fields)||Object.keys(value.fields).some(k=>!settingNames.includes(k)))throw new Error('invalid-settings');
      const fields={};for(const name of Object.keys(value.fields)){
        const f=value.fields[name];if(!f||typeof f.deviceId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(f.deviceId)||typeof f.modifiedAt!=='string'||!Number.isFinite(Date.parse(f.modifiedAt))||!Number.isInteger(f.value)||f.value<15||f.value>720)throw new Error('invalid-settings');
        fields[name]={value:f.value,modifiedAt:new Date(f.modifiedAt).toISOString(),deviceId:f.deviceId};
      }return {fields};
    }
    function validate(payload){
      if(!payload||!['attempt','source','settings'].includes(payload.kind))throw new Error('invalid-sync-data');
      let value;if(payload.kind==='attempt'){
        const index=sourceIndex();value=core.validAttempt(payload.value);if(index&&!index.passages.some(p=>p.id===value?.passageId))value=null;
      }else if(payload.kind==='source')value=sourceBackup()&&sourceIndex()&&sourceBackup().validateAttempt(payload.value,sourceIndex());
      else value=validateSettings(payload.value);
      if(!value)throw new Error('invalid-sync-data');return {kind:payload.kind,value};
    }
    function locals(){
      const a=store.list(),s=store.listSources();if(!a.ok||!s.ok)throw new Error('storage-unavailable');
      const rows=[...a.attempts.map(value=>validate({kind:'attempt',value})),...s.attempts.map(value=>validate({kind:'source',value}))];
      const meta=settingsMeta();if(Object.keys(meta.fields).length)rows.push({kind:'settings',value:meta});return rows;
    }
    async function request(keys,path,method='GET',body){
      const controller=new AbortController();
      const init={method,credentials:'omit',cache:'no-store',signal:controller.signal,headers:{'X-Sync-Token':keys.token}};
      if(body){init.body=JSON.stringify(body);if(new TextEncoder().encode(init.body).length>512*1024)throw new Error('sync-limit');init.headers['Content-Type']='application/json';}
      let timer;
      const exchange=async()=>{
        let response;try{response=await fetcher(endpoint+'/v1/spaces/'+keys.spaceId+path,init);}catch(_){throw new Error('sync-offline');}
        if(!response.ok)throw new Error(response.status===401||response.status===404?'sync-access-denied':'sync-service-error');
        let text;try{text=await response.text();}catch(_){throw new Error('sync-offline');}
        if(new TextEncoder().encode(text).length>512*1024)throw new Error('sync-limit');
        try{return JSON.parse(text);}catch(_){throw new Error('invalid-sync-response');}
      };
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('sync-offline'));},requestTimeoutMs);});
      try{return await Promise.race([exchange(),timeout]);}finally{clearTimeout(timer);}
    }
    function apply(payload,id,p){
      if(payload.kind==='attempt'){
        const list=store.list();if(!list.ok)throw new Error('storage-unavailable');const previous=list.attempts.find(a=>a.id===payload.value.id);
        if(previous&&protocol.canonical(previous)!==protocol.canonical(payload.value)){if(!p.conflicts.includes(id))p.conflicts.push(id);return;}
        if(!previous){
          if(!store.append(payload.value,false).ok)throw new Error('storage-unavailable');
          // append is intentionally idempotent, including when an unreadable raw key
          // already exists. Never acknowledge a record until its validated value is visible.
          const saved=store.list(),actual=saved.attempts.find(a=>a.id===payload.value.id);
          if(!saved.ok||!actual||protocol.canonical(actual)!==protocol.canonical(payload.value))throw new Error('storage-unavailable');
        }
      }else if(payload.kind==='source'){
        const result=store.mergeSources([payload.value],false);if(result.conflicts&&!p.conflicts.includes(id))p.conflicts.push(id);
      }else{
        const local=settingsMeta(),merged={fields:{...local.fields}},saved=read(SETTINGS,{});
        for(const [name,incoming] of Object.entries(payload.value.fields)){
          const current=merged.fields[name],difference=current&&current.value!==incoming.value;
          if(difference&&current.modifiedAt===incoming.modifiedAt&&!p.conflicts.includes(id))p.conflicts.push(id);
          if(!current||incoming.modifiedAt>current.modifiedAt||incoming.modifiedAt===current.modifiedAt&&incoming.deviceId>current.deviceId){merged.fields[name]=incoming;saved[name]=incoming.value;}
        }
        // The metadata is committed last so failed value writes are safely retried.
        if(Object.keys(merged.fields).length){write(SETTINGS,saved);write(META,merged);}
      }
    }
    async function run(gen){
      const keys=await protocol.derive(connection.code,crypto);checkpoint(gen);let p=progress(keys);
      emit({status:'syncing',connected:true,error:null,conflicts:p.conflicts.length,lastSyncedAt:p.lastSyncedAt});
      // Capture local versions before pulling; conflicts and source enrichment remain in the cloud.
      const pending=locals();let more=true;
      while(more){
        checkpoint(gen);const page=await request(keys,'/records?after='+p.cursor);checkpoint(gen);
        if(!page||!Array.isArray(page.records)||page.records.length>50||!Number.isSafeInteger(page.cursor)||page.cursor<p.cursor||typeof page.hasMore!=='boolean')throw new Error('invalid-sync-response');
        let seq=p.cursor;const decoded=[];
        for(const row of page.records){if(!Number.isSafeInteger(row.seq)||row.seq<=seq||row.seq>page.cursor)throw new Error('invalid-sync-response');seq=row.seq;decoded.push({id:row.id,payload:validate(await protocol.open(keys,row,crypto))});checkpoint(gen);}
        if(page.hasMore&&(!page.records.length||page.cursor<=p.cursor))throw new Error('invalid-sync-response');
        applying=true;try{for(const row of decoded){checkpoint(gen);apply(row.payload,row.id,p);if(!p.acks.includes(row.id))p.acks.push(row.id);}checkpoint(gen);p.cursor=page.cursor;write(progressKey(keys),p);}finally{applying=false;}
        if(decoded.length&&root.dispatchEvent&&root.CustomEvent){applying=true;try{root.dispatchEvent(new root.CustomEvent('reading-study-updated',{detail:{source:'sync'}}));}finally{applying=false;}}
        more=page.hasMore;
      }
      pending.push(...locals());const seen=new Set(p.acks),envelopes=[];
      for(const payload of pending){checkpoint(gen);const envelope=await protocol.seal(keys,payload,crypto);checkpoint(gen);if(!seen.has(envelope.id)){seen.add(envelope.id);envelopes.push(envelope);}}
      while(envelopes.length){
        checkpoint(gen);const batch=[];let bytes=20;
        while(envelopes.length&&batch.length<20){const size=JSON.stringify(envelopes[0]).length+1;if(bytes+size>500*1024)break;batch.push(envelopes.shift());bytes+=size;}
        const response=await request(keys,'/records','POST',{records:batch});checkpoint(gen);
        if(!Array.isArray(response.accepted)||batch.some(r=>!response.accepted.includes(r.id)))throw new Error('invalid-sync-response');
        p.acks.push(...batch.map(r=>r.id));write(progressKey(keys),p);
      }
      checkpoint(gen);p.lastSyncedAt=new Date().toISOString();write(progressKey(keys),p);
      emit({status:p.conflicts.length?'conflict':'synced',connected:true,lastSyncedAt:p.lastSyncedAt,conflicts:p.conflicts.length,error:null});
    }
    function sync(){
      if(!connection)return Promise.resolve(getState());requested=true;if(running?.generation===generation)return running.promise;
      const gen=generation;
      const task={generation:gen,promise:null};running=task;
      task.promise=(async()=>{try{while(requested&&gen===generation&&connection){requested=false;await run(gen);}}catch(error){if(gen===generation&&connection)emit({status:error.message==='sync-offline'||root.navigator?.onLine===false?'offline':'error',error:['sync-offline','sync-access-denied','sync-service-error','sync-limit','invalid-sync-data','invalid-sync-response'].includes(error.message)?error.message:'sync-failed'});}finally{if(running===task){running=null;if(requested&&connection)Promise.resolve().then(sync);}}return getState();})();return task.promise;
    }
    async function connect(code,creating){
      if(creating&&connection)throw new Error('sync-already-connected');
      const gen=generation,keys=await protocol.derive(code,crypto);
      await request(keys,creating?'':'/records?after=0',creating?'PUT':'GET');if(gen!==generation)throw new Error('sync-disconnected');
      write(CONNECTION,{code});generation++;requested=false;connection={code};emit({connected:true,status:'syncing',error:null});
      if(connection?.code===code)await sync();return getState();
    }
    function disconnect(){generation++;requested=false;connection=null;storage.removeItem(CONNECTION);emit({status:'disconnected',connected:false,lastSyncedAt:null,conflicts:0,error:null});return getState();}
    function getState(){return {...state};}
    function reloadConnection(){
      const saved=read(CONNECTION,null),code=saved&&/^ZYZ1-[A-Za-z0-9_-]{43}$/.test(saved.code)?saved.code:null;
      if(code===connection?.code||!code&&!connection)return getState();
      generation++;requested=false;connection=code?{code}:null;
      emit({status:code?'offline':'disconnected',connected:!!code,lastSyncedAt:null,conflicts:0,error:null});
      if(code)sync();return getState();
    }
    try{const saved=read(CONNECTION,null);if(saved&&/^ZYZ1-[A-Za-z0-9_-]{43}$/.test(saved.code)){connection={code:saved.code};state.connected=true;state.status='offline';}}catch(_){state.error='sync-storage-unavailable';}
    if(options.autoSyncEvents!==false&&root.addEventListener)root.addEventListener('reading-study-updated',()=>{if(!applying&&connection)sync();});
    return {createSpace:()=>connect(protocol.createCode(crypto),true),join:code=>connect(code,false),sync,disconnect,getCode:()=>connection?.code||null,getState,reloadConnection};
  }
  return {create};
});
