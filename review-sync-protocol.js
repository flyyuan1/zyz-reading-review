(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ReadingSyncProtocol=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const MAX_CIPHERTEXT=96*1024,encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
  const fail=()=>{throw new Error('invalid-sync-data');};
  const cryptoApi=value=>value||root.crypto;
  function encode(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
  function decode(text,max){
    if(typeof text!=='string'||!text.length||text.length>max||!/^[A-Za-z0-9_-]+$/.test(text))return fail();
    let raw;try{raw=atob(text.replace(/-/g,'+').replace(/_/g,'/'));}catch(_){return fail();}
    const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(encode(bytes)!==text)return fail();return bytes;
  }
  function canonical(value,depth=0){
    if(depth>40)return fail();
    if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
    if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
    if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
    if(value&&typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)){
      return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k],depth+1)).join(',')+'}';
    }
    return fail();
  }
  const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  function createCode(crypto){return 'ZYZ1-'+encode(cryptoApi(crypto).getRandomValues(new Uint8Array(32)));}
  async function derive(code,crypto){
    if(typeof code!=='string'||!/^ZYZ1-[A-Za-z0-9_-]{43}$/.test(code))return fail();
    const secret=decode(code.slice(5),43);if(secret.length!==32)return fail();
    const c=cryptoApi(crypto),material=await c.subtle.importKey('raw',secret,'HKDF',false,['deriveBits']);
    const bits=async label=>new Uint8Array(await c.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:encoder.encode('zyz-reading-sync.v1'),info:encoder.encode(label)},material,256));
    const spaceId=hex(await bits('space-id')),token=encode(await bits('auth-token'));
    const key=await c.subtle.importKey('raw',await bits('encryption'),'AES-GCM',false,['encrypt','decrypt']);
    const recordKey=await c.subtle.importKey('raw',await bits('record-id'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    return {spaceId,token,key,recordKey};
  }
  async function seal(keys,payload,crypto){
    const c=cryptoApi(crypto),plain=encoder.encode(canonical(payload));if(plain.length+16>MAX_CIPHERTEXT*3/4)return fail();
    const id=hex(await c.subtle.sign('HMAC',keys.recordKey,plain)),iv=c.getRandomValues(new Uint8Array(12));
    const ciphertext=await c.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('zyz-reading-sync.v1:'+keys.spaceId+':'+id)},keys.key,plain);
    return {id,iv:encode(iv),ciphertext:encode(new Uint8Array(ciphertext))};
  }
  async function open(keys,envelope,crypto){
    if(!envelope||!/^[a-f0-9]{64}$/.test(envelope.id))return fail();
    const iv=decode(envelope.iv,16),ciphertext=decode(envelope.ciphertext,MAX_CIPHERTEXT);if(iv.length!==12||ciphertext.length<16)return fail();
    try{
      const c=cryptoApi(crypto),plain=await c.subtle.decrypt({name:'AES-GCM',iv,additionalData:encoder.encode('zyz-reading-sync.v1:'+keys.spaceId+':'+envelope.id)},keys.key,ciphertext);
      const payload=JSON.parse(decoder.decode(plain)),serialized=encoder.encode(canonical(payload));
      if(hex(await c.subtle.sign('HMAC',keys.recordKey,serialized))!==envelope.id)return fail();return payload;
    }catch(_){return fail();}
  }
  return {createCode,derive,seal,open,canonical};
});
