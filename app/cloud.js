import {config} from './config.js';
/* 两台设备写入了完全相同的内容时不算冲突：直接采纳云端版本。
   典型场景：手机和平板同一天各跑一次「每日补任务」，写的是同一条记录、同样的值。 */
const VOLATILE_KEYS=['version','mutation','dirty','conflict','updatedAt','_baseVersion','_partial'];
function samePayload(a,b){
 if(!a||!b)return false;
 const keys=o=>Object.keys(o).filter(k=>!VOLATILE_KEYS.includes(k)&&o[k]!==undefined).sort();
 const ka=keys(a),kb=keys(b);
 if(ka.length!==kb.length||ka.some((k,i)=>k!==kb[i]))return false;
 return ka.every(k=>JSON.stringify(a[k])===JSON.stringify(b[k]));
}
export class Cloud{
 constructor(store,onStatus){this.store=store;this.onStatus=onStatus;this.session=JSON.parse(localStorage.getItem('growth-session')||'null');this.running=false;this.status='本地模式 · 尚未开启跨设备同步';this.generation=0;}
 get enabled(){return !!(config.url&&config.key)}
 statusSet(s){this.status=s;this.onStatus?.(s)}
 async request(path,body,method='POST',auth=true){const response=await fetch(config.url+path,{method,headers:{apikey:config.key,'Content-Type':'application/json',...(auth&&this.session?{Authorization:'Bearer '+this.session.access_token}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json().catch(()=>null);if(!response.ok)throw Error(data?.msg||data?.message||data?.error_description||response.statusText);return data;}
 saveSession(s){this.session=s;localStorage.setItem('growth-session',JSON.stringify(s))}
 async login(email,password,signup=false){if(!this.enabled)throw Error('请先按 README 配置 app/config.js');const s=await this.request(signup?'/auth/v1/signup':'/auth/v1/token?grant_type=password',{email,password},'POST',false);if(!s.access_token)throw Error('注册成功，请先查看邮箱确认链接，然后登录。');this.saveSession(s);return s.user;}
 async refresh(){const run=async()=>{const saved=JSON.parse(localStorage.getItem('growth-session')||'null');if(saved?.user?.id===this.session?.user?.id)this.session=saved;if(this.session?.expires_at*1000<Date.now()+60000){const s=await this.request('/auth/v1/token?grant_type=refresh_token',{refresh_token:this.session.refresh_token},'POST',false);this.saveSession(s)}};if(navigator.locks)await navigator.locks.request('growth-auth-refresh',run);else await run();}
 async logout(){this.generation++;try{if(this.enabled&&navigator.onLine)await this.request('/auth/v1/logout',{})}finally{this.session=null;localStorage.removeItem('growth-session');localStorage.removeItem(this.cursorKey);this.store.close();await new Promise((resolve,reject)=>{const q=indexedDB.deleteDatabase('growth-v4-'+this.store.name);q.onsuccess=resolve;q.onerror=()=>reject(q.error);q.onblocked=()=>reject(Error('请关闭其他页面后退出'))});for(const k of await caches.keys())if(k.startsWith('growth-user-'))await caches.delete(k);}}
 // 历史遗留的冲突里，如果本机与云端内容其实一模一样，直接采纳云端版本，不用人工处理。
 async healIdentical(){
  const rows=this.store.records.filter(r=>r&&r.conflict&&r.conflict.payload&&samePayload(r,r.conflict.payload));
  if(!rows.length)return 0;
  const next=rows.map(r=>{const o={...r.conflict.payload,id:r.id,version:r.conflict.version,dirty:false,mutation:r.mutation};delete o.conflict;return o;});
  await this.store.transaction(next);
  return rows.length;
 }
 // A cursor is persisted only after summaries have committed to IndexedDB.
 get cursorKey(){return 'growth-cursor-v2:'+this.store.name}
 async sync(){if(this.pending){await this.pending;return this.sync()}this.pending=this.runSync();try{return await this.pending}finally{this.pending=null}}
 async runSync(){if(!this.enabled||!this.session){this.statusSet('本地模式 · 尚未开启跨设备同步');return}if(!navigator.onLine){this.statusSet('离线待同步');return}const generation=this.generation;this.statusSet('同步中');
 try{await this.refresh();if(this.store.db)this.store.records=await this.store.readAll();const healed=await this.healIdentical();if(healed)this.statusSet('已自动合并 '+healed+' 条重复改动');
 const initialHead=Number(await this.request('/rest/v1/rpc/sync_head',{}));const outgoing=[...this.store.records.filter(x=>x.dirty&&!x.conflict)];
 for(const r of outgoing){if(generation!==this.generation)return;const res=await this.request('/rest/v1/rpc/apply_record',{p_id:r.id,p_kind:r.kind,p_payload:r,p_version:r.version,p_mutation:r.mutation});if(generation!==this.generation)return;const live=this.store.get(r.id);if(live?.mutation!==r.mutation)continue;if(res.conflict){const remote=res.conflict;if(samePayload(r,remote.payload))await this.store.transaction([{...remote.payload,version:remote.version,dirty:false,mutation:r.mutation}]);else await this.store.transaction([{...r,conflict:remote}]);}else await this.store.transaction([{...res.record.payload,version:res.record.version,dirty:false,mutation:r.mutation}]);}
 let cursor=this.store.records.length?Number(localStorage.getItem(this.cursorKey)||0):0;const head=outgoing.length?Number(await this.request('/rest/v1/rpc/sync_head',{})):initialHead;
 // No changes: a single numeric response, no table scan/download.
 while(cursor<head){const rows=await this.request('/rest/v1/rpc/sync_changes',{p_after:cursor,p_limit:200});if(generation!==this.generation)return;if(!rows.length)throw Error('同步游标异常，请重试');const changes=[];
 for(const r of rows){const local=this.store.get(r.id);if(!local?.dirty){if(!local||local.version!==r.version)changes.push({...r.payload,version:r.version,dirty:false});}}
 await this.store.transaction(changes);cursor=Number(rows.at(-1).sync_revision);localStorage.setItem(this.cursorKey,String(cursor));
 }
 const c=this.store.records.filter(x=>x.conflict).length;this.statusSet(c?`同步失败 · ${c} 项冲突待处理`:this.store.records.some(x=>x.dirty)?'同步中 · 有待提交修改':'已同步');
 }catch(e){this.statusSet((navigator.onLine?'同步失败 · ':'离线待同步 · ')+e.message+(e.message.includes('sync_')?'；请先执行省流量升级 SQL':''))}}
 async detail(key){const local=this.store.get(key);if(!this.session||!this.enabled||!local?._partial)return local;if(!navigator.onLine)throw Error('这部分详情尚未缓存；请联网打开一次后再离线查看');if(local.dirty)throw Error('请先同步这条记录的修改，再读取详情');await this.refresh();const generation=this.generation;const r=await this.request('/rest/v1/rpc/record_detail',{p_id:key});if(generation!==this.generation)throw Error('账号已退出');if(!r)throw Error('云端没有这条记录');const live=this.store.get(key);if(live?.dirty||live?.version>r.version)return live;const full={...r.payload,version:r.version,dirty:false,_partial:false};await this.store.transaction([full]);return full;}
 async details(keys){const wanted=[...new Set(keys)].filter(k=>this.store.get(k)?._partial);if(!wanted.length||!this.session||!this.enabled)return;if(!navigator.onLine)throw Error('这部分详情尚未缓存；请联网打开一次后再离线查看');await this.refresh();const generation=this.generation;for(let i=0;i<wanted.length;i+=100){const batch=wanted.slice(i,i+100);const rows=await this.request('/rest/v1/rpc/record_details',{p_ids:batch});if(generation!==this.generation)throw Error('账号已退出');const updates=[];for(const r of rows){const local=this.store.get(r.id);if(local&&!local.dirty&&local.version<=r.version)updates.push({...r.payload,version:r.version,dirty:false,_partial:false});}await this.store.transaction(updates);if(batch.some(k=>this.store.get(k)?._partial))throw Error('有记录尚未同步或已变更，请同步后重试');}}
 async cacheAll(onProgress){await this.sync();if(this.status.startsWith('同步失败'))throw Error(this.status);const rows=this.store.all().filter(x=>x._partial);for(let i=0;i<rows.length;i+=100){await this.details(rows.slice(i,i+100).map(r=>r.id));onProgress?.(Math.min(i+100,rows.length),rows.length);}return this.store.records;}
 async redeem(key,reward){await this.sync();if(this.store.records.some(r=>r.dirty||r.conflict))throw Error('请先完成同步并处理冲突');const r=await this.request('/rest/v1/rpc/redeem_reward',{p_id:key,p_reward:reward});await this.sync();return r;}
}
