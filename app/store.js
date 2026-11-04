import {id, payloadOnly} from './core.js';
export class Store{
 constructor(name='local'){this.name=name;this.records=[];this.db=null;}
 async open(){this.db=await new Promise((resolve,reject)=>{const q=indexedDB.open('growth-v4-'+this.name,1);q.onupgradeneeded=()=>q.result.createObjectStore('records',{keyPath:'id'});q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});this.records=await this.readAll();return this;}
 readAll(){return new Promise((resolve,reject)=>{const q=this.db.transaction('records').objectStore('records').getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})}
 async transaction(rows){await new Promise((resolve,reject)=>{const t=this.db.transaction('records','readwrite');for(const r of rows)t.objectStore('records').put(r);t.oncomplete=resolve;t.onerror=()=>reject(t.error)});for(const r of rows){const n=this.records.findIndex(x=>x.id===r.id);if(n<0)this.records.push(r);else this.records[n]=r;}}
 all(kind){return this.records.filter(x=>!x.deleted&&(!kind||x.kind===kind))}
 get(key){return this.records.find(x=>x.id===key)}
 async put(r){const previous=this.get(r.id);
  /* _base = 上一次同步成功时的内容快照。云端也改了同一条时，用它做三方合并，
     这样「本机改了标题、云端改了时间」两边都能留下，而不是整条二选一。 */
  const base=r._base!==undefined?r._base:(previous?(previous.dirty?previous._base:payloadOnly(previous)):undefined);
  const next={...previous,...r,version:r._baseVersion??previous?.version??0,dirty:true,mutation:id(),updatedAt:new Date().toISOString()};
  delete next._baseVersion;
  if(base===undefined||base===null)delete next._base;else next._base=base;
  await this.transaction([next]);return next;}
 async merge(rows){const out=[];for(const r of rows)if(!this.get(r.id))out.push({...r,version:0,dirty:true,mutation:id()});await this.transaction(out);}
 async remove(key){const r=this.get(key);if(r)await this.put({...r,deleted:true})}
 async complete(key,done){const old=this.get(key);if(!old)return;const stamp=new Date().toLocaleDateString('sv-SE');
  const base=old.dirty?old._base:payloadOnly(old);
  const task={...old,done,everCompleted:done||old.everCompleted||false,completedDate:old.completedDate||(done?stamp:undefined),version:old.version||0,dirty:true,mutation:id(),updatedAt:new Date().toISOString(),_base:base};
  if(!base)delete task._base;
  const rows=[task];if(done&&!this.get('award:'+key))rows.push({id:'award:'+key,kind:'award',amount:old.legacyCredited?0:10,taskId:key,date:task.completedDate,version:0,dirty:true,mutation:id()});await this.transaction(rows);}
 async award(task){await this.merge([{id:'award:'+task.id,kind:'award',amount:task.legacyCredited?0:10,taskId:task.id,date:task.completedDate||new Date().toLocaleDateString('sv-SE')}])}
 balance(){return this.all().reduce((s,r)=>s+(['award','opening'].includes(r.kind)?Number(r.amount)||0:r.kind==='redemption'?-(r.cost||0):0),0)}
 close(){this.db?.close()}
}
