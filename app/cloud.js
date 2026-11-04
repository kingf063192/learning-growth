import {config} from './config.js';
import {id, samePayload, payloadOnly, mergePayloads, isDerivedRecord} from './core.js';

/* 同步合并策略（按记录自动执行，不再逐条弹确认）
 * 1 两版内容一样                          → 采纳云端（same）
 * 2 云端已删除 / 本机已删除                → 删除优先（remote）
 * 3 派生记录（积分、余额、每日补任务等）    → 采纳云端（remote），缺了下次会重算
 * 4 其它（用户自己编辑的课程/章节/任务）    → 逐字段三方合并（merged），两边都改的字段本机优先
 * 每条自动合并写一行明细到 growth-merge-log（本机，最多 200 条），设置页可一次性导出。 */
const MERGE_LOG = 'growth-merge-log';
const LOG_CAP = 200;
const BATCH = 200;        // 批量推送每批条数（服务端 apply_records 上限 200）
const PAGE = 500;         // 拉取每页条数（服务端平时一次给 200，能多要就多要）
const PROFILE = 'growth-sync-profile'; // 最近几次同步的分段耗时，设置页可看
const PROFILE_CAP = 12;
const PUSH_PARALLEL = 5;  // 没有批量接口时的并发数

const clip = v => { const s = typeof v === 'string' ? v : JSON.stringify(v === undefined ? null : v); return s.length > 120 ? s.slice(0, 120) + '…' : s; };
const clean = (payload, version, mutation) => { const o = { ...payloadOnly(payload), version: version ?? 0, dirty: false, mutation: mutation || id() }; delete o.conflict; return o; };

/* 实时通道参数：连上后云端一有变化就提前拉一轮，轮询当兜底 */
const JWT_LIKE = t => typeof t === 'string' && t.split('.').length === 3 && t.length > 40;
const REALTIME_GAP = 400;      // 连续到达的事件合并成一次拉取
const REALTIME_PING = 25000;   // 服务端 30 秒收不到心跳会断线，提前发
const REALTIME_BACKOFF = [1000, 2000, 5000, 15000, 30000, 60000];

export class Cloud{
 constructor(store,onStatus,onSummary){this.store=store;this.onStatus=onStatus;this.onSummary=onSummary;this.session=JSON.parse(localStorage.getItem('growth-session')||'null');this.running=false;this.status='本地模式 · 尚未开启跨设备同步';this.generation=0;this.batch=null;
  /* 实时通道默认关着；只有登录后 token 是真的 JWT 才由 startRealtime() 打开 */
  this.realtimeState='off';this.realtimeWanted=false;this.socket=null;this.pingTimer=0;this.pokeTimer=0;this.realtimeTimer=0;this.realtimeBackoff=0;this.openSocket=url=>new WebSocket(url);
  /* 凭证状态：authDead=需要重新登录（不清本机数据）；refreshStale=别的设备先续期过，本轮用旧 access_token */
  this.authDead=false;this.refreshStale=false;this.authNotifiedAt=0;}
 get enabled(){return !!(config.url&&config.key)}
 statusSet(s){this.status=s;this.onStatus?.(s)}
 async request(path,body,method='POST',auth=true){const response=await fetch(config.url+path,{method,headers:{apikey:config.key,'Content-Type':'application/json',...(auth&&this.session?{Authorization:'Bearer '+this.session.access_token}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json().catch(()=>null);if(!response.ok)throw Error(data?.msg||data?.message||data?.error_description||response.statusText);return data;}
 saveSession(s){this.session=s;localStorage.setItem('growth-session',JSON.stringify(s))}
 async login(email,password,signup=false){if(!this.enabled)throw Error('请先按 README 配置 app/config.js');const s=await this.request(signup?'/auth/v1/signup':'/auth/v1/token?grant_type=password',{email,password},'POST',false);if(!s.access_token)throw Error('注册成功，请先查看邮箱确认链接，然后登录。');this.saveSession(s);this.authDead=false;this.refreshStale=false;this.authNotifiedAt=0;return s.user;}
 async refresh(){
  const run=async()=>{
   const saved=JSON.parse(localStorage.getItem('growth-session')||'null');
   if(saved?.user?.id===this.session?.user?.id)this.session=saved;
   if(!this.session)return;
   if(!(this.session.expires_at*1000<Date.now()+60000))return;
   try{
    const s=await this.request('/auth/v1/token?grant_type=refresh_token',{refresh_token:this.session.refresh_token},'POST',false);
    this.saveSession(s);this.authDead=false;this.refreshStale=false;
   }catch(e){
    const dead=/invalid refresh token|refresh token not found|invalid_grant|revoked|already used/i.test(String(e.message||''));
    const usable=Number(this.session?.expires_at||0)*1000>Date.now()+5000;
    /* 同一账号在别的设备先续过期了：本机的 refresh_token 作废，但 access_token 还没过期，先用它撑完这一轮 */
    if(dead&&usable){this.refreshStale=true;return;}
    if(dead){this.markAuthDead(e);throw Error('登录已过期，请重新登录');}
    throw e;
   }
  };
  if(navigator.locks)await navigator.locks.request('growth-auth-refresh',run);else await run();
 }
 /* 凭证彻底失效：不清本机数据，只把界面切到「请重新登录」，并停止实时通道 */
 markAuthDead(e){
  this.authDead=true;this.refreshStale=false;
  this.stopRealtime();
  this.statusSet('登录已过期 · 请重新登录');
  if(!this.authNotifiedAt||Date.now()-this.authNotifiedAt>30000){this.authNotifiedAt=Date.now();this.onAuthExpired?.(e);}
 }
 get needsLogin(){return this.authDead}
 async logout(){this.stopRealtime();this.generation++;try{if(this.enabled&&navigator.onLine)await this.request('/auth/v1/logout',{})}finally{this.session=null;localStorage.removeItem('growth-session');localStorage.removeItem(this.cursorKey);this.store.close();await new Promise((resolve,reject)=>{const q=indexedDB.deleteDatabase('growth-v4-'+this.store.name);q.onsuccess=resolve;q.onerror=()=>reject(q.error);q.onblocked=()=>reject(Error('请关闭其他页面后退出'))});for(const k of await caches.keys())if(k.startsWith('growth-user-'))await caches.delete(k);}}

 /* ── 记录级合并：一条冲突算出「最终该是什么」 ───────────────── */
 resolvePair(r,remotePayload,remoteVersion){
  const version=Number(remoteVersion)||0;
  if(!remotePayload||typeof remotePayload!=='object'||remotePayload.id!==r.id){
   /* 云端那条读不出来（损坏/被清理）：保留本机，标脏让它再推一次 */
   const keep={...r,version:r.version??0,dirty:true,mutation:id()};
   delete keep.conflict;
   return {row:keep,policy:'local',fields:[]};
  }
  if(remotePayload.deleted)return {row:clean(remotePayload,version,r.mutation),policy:'remote',fields:[]};
  if(r.deleted)return {row:{...payloadOnly(r),deleted:true,version,dirty:true,mutation:id(),_base:payloadOnly(remotePayload)},policy:'local',fields:[]};
  if(samePayload(r,remotePayload))return {row:clean(remotePayload,version,r.mutation),policy:'same',fields:[]};
  if(isDerivedRecord(r))return {row:clean(remotePayload,version,r.mutation),policy:'remote',fields:[]};
  const hasBase=r._base&&typeof r._base==='object';
  const {merged,fields}=mergePayloads(hasBase?r._base:{},r,remotePayload);
  const row={...merged,id:r.id,kind:r.kind||merged.kind,version,dirty:true,mutation:id(),_base:payloadOnly(remotePayload)};
  if(fields.length)row._merge=fields;
  return {row,policy:hasBase?'merged':'local',fields};
 }
 newSummary(){return {same:0,remote:0,local:0,merged:0,fields:0,failed:0,log:[]}}
 logMerge(sum,r,policy,fields,remote){
  if(policy==='same')sum.same++;
  else if(policy==='remote')sum.remote++;
  else if(policy==='merged'){sum.merged++;sum.fields+=fields.length}
  else sum.local++;
  const local=payloadOnly(r);
  sum.log.push({ts:new Date().toISOString(),id:r.id,kind:r.kind||'',title:r.title||'',policy,diffs:fields.map(k=>[k,clip(local[k]),clip(remote?.[k])])});
 }
 saveLog(sum){
  try{
   const old=JSON.parse(localStorage.getItem(MERGE_LOG)||'[]');
   localStorage.setItem(MERGE_LOG,JSON.stringify([...sum.log,...(Array.isArray(old)?old:[])].slice(0,LOG_CAP)));
  }catch{/* 存储满时只是没有明细，不影响同步 */}
 }
 /* 历史遗留的冲突（比如升级前攒下的 251 条）一次性全部落地，不再等人逐条点 */
 async autoResolveConflicts(sum){
  const rows=this.store.records.filter(r=>r&&r.conflict);
  if(!rows.length)return 0;
  const next=[];
  for(const r of rows){
   const {row,policy,fields}=this.resolvePair(r,r.conflict?.payload,r.conflict?.version??r.version);
   next.push(row);
   this.logMerge(sum,r,policy,fields,r.conflict?.payload);
  }
  await this.store.transaction(next);
  return rows.length;
 }
 /* A cursor is persisted only after summaries have committed to IndexedDB. */
 get cursorKey(){return 'growth-cursor-v2:'+this.store.name}
 async sync(){if(this.pending){await this.pending;return this.sync()}this.pending=this.runSync();try{return await this.pending}finally{this.pending=null}}
 async runSync(){
  if(!this.enabled||!this.session){this.statusSet('本地模式 · 尚未开启跨设备同步');return}
  if(this.authDead){this.statusSet('登录已过期 · 请重新登录');return}
  if(!navigator.onLine){this.statusSet('离线待同步');return}
  const generation=this.generation;
  this.statusSet('同步中');
  const sum=this.newSummary();
  const now=()=>performance.now();
  const started=now();let t=started;
  const prof={at:Date.now(),refresh:0,resolve:0,push:0,pull:0,total:0,pushed:0,pulled:0,head:0,error:null};
  try{
   await this.refresh();prof.refresh=Math.round(now()-t);t=now();
   if(this.store.db)this.store.records=await this.store.readAll();
   await this.autoResolveConflicts(sum);prof.resolve=Math.round(now()-t);t=now();
   if(generation!==this.generation)return;
   const outgoing=[...this.store.records.filter(x=>x.dirty&&!x.conflict)];
   prof.pushed=outgoing.length;
   /* 没有待推送、也没有历史冲突时，只要 head 没变就是一次空转：1 个请求就结束 */
   if(outgoing.length){await this.pushAll(outgoing,sum,generation);if(generation!==this.generation)return;prof.push=Math.round(now()-t);t=now();}
   const head=Number(await this.request('/rest/v1/rpc/sync_head',{}));
   if(generation!==this.generation)return;
   prof.head=head;
   let cursor=this.store.records.length?Number(localStorage.getItem(this.cursorKey)||0):0;
   // No changes: a single numeric response, no table scan/download.
   while(cursor<head){
    const rows=await this.request('/rest/v1/rpc/sync_changes',{p_after:cursor,p_limit:PAGE});
    if(generation!==this.generation)return;
    if(!rows.length)throw Error('同步游标异常，请重试');
    const changes=[];
    for(const r of rows){const local=this.store.get(r.id);if(!local?.dirty){if(!local||local.version!==r.version)changes.push({...payloadOnly(r.payload),version:r.version,dirty:false});}}
    await this.store.transaction(changes);cursor=Number(rows.at(-1).sync_revision);localStorage.setItem(this.cursorKey,String(cursor));
    prof.pulled+=changes.length;
   }
   prof.pull=Math.round(now()-t);
   prof.total=Math.round(now()-started);
   this.saveProfile(prof);
   this.finish(sum);
  }catch(e){prof.error=e.message;prof.total=Math.round(now()-started);this.saveProfile(prof);if(this.authDead)this.statusSet('登录已过期 · 请重新登录');else this.statusSet((navigator.onLine?'同步失败 · ':'离线待同步 · ')+e.message+(e.message.includes('sync_')?'；请先执行省流量升级 SQL':''))}
 }
 /* 分段耗时只留最近 12 次，设置页显示最近一次，方便定位到底慢在哪一段 */
 saveProfile(prof){
  try{
   const list=JSON.parse(localStorage.getItem(PROFILE)||'[]');
   list.push(prof);
   while(list.length>PROFILE_CAP)list.shift();
   localStorage.setItem(PROFILE,JSON.stringify(list));
  }catch{/* 隐私模式或配额满：只是没有统计，不影响同步 */}
 }
 get lastProfile(){
  try{const list=JSON.parse(localStorage.getItem(PROFILE)||'[]');return list.length?list[list.length-1]:null;}catch{return null}
 }
 /* 推送：能用批量接口就一批一批推，没有就并发 5 条一轮 */
 async pushAll(rows,sum,generation){
  if(rows.length>1&&this.batch!==false){if(await this.pushBatch(rows,sum,generation))return;}
  for(let i=0;i<rows.length;i+=PUSH_PARALLEL){
   if(generation!==this.generation)return;
   const chunk=rows.slice(i,i+PUSH_PARALLEL);
   const results=await Promise.all(chunk.map(r=>this.pushOne(r).then(res=>({r,res})).catch(error=>({r,error}))));
   if(generation!==this.generation)return;
   const writes=[];
   for(const {r,res,error} of results){
    if(error){sum.failed++;continue;}
    const live=this.store.get(r.id);
    if(live&&live.mutation!==r.mutation)continue;
    writes.push(...this.applyResult(r,res,sum));
   }
   await this.store.transaction(writes);
  }
 }
 async pushOne(r){return this.request('/rest/v1/rpc/apply_record',{p_id:r.id,p_kind:r.kind,p_payload:payloadOnly(r),p_version:r.version??0,p_mutation:r.mutation});}
 async pushBatch(rows,sum,generation){
  for(let i=0;i<rows.length;i+=BATCH){
   if(generation!==this.generation)return true;
   const chunk=rows.slice(i,i+BATCH);
   let data;
   try{
    data=await this.request('/rest/v1/rpc/apply_records',{p_rows:chunk.map(r=>({id:r.id,kind:r.kind,payload:payloadOnly(r),version:r.version??0,mutation:r.mutation}))});
   }catch(e){this.batch=false;return false;} // 服务端还没升批量接口：自动退回逐条并发
   this.batch=true;
   const byId=new Map((data?.results||[]).map(x=>[x?.id,x]));
   const writes=[];
   for(const r of chunk){
    const item=byId.get(r.id);
    if(!item||item.error){sum.failed++;continue;}
    const live=this.store.get(r.id);
    if(live&&live.mutation!==r.mutation)continue;
    writes.push(...this.applyResult(r,item.result||{},sum));
   }
   await this.store.transaction(writes);
  }
  return true;
 }
 applyResult(r,res,sum){
  /* 服务端返回 {conflict: <整行>} 或 {conflict:true, record:<整行>} 两种形状都兼容 */
  const conflict=res&&(res.conflict===true?res.record:res.conflict);
  if(conflict&&conflict.payload){
   const {row,policy,fields}=this.resolvePair(r,conflict.payload,conflict.version);
   this.logMerge(sum,r,policy,fields,conflict.payload);
   return [row];
  }
  if(res&&res.record)return [{...payloadOnly(res.record.payload||{}),version:res.record.version,dirty:false,mutation:r.mutation}];
  return [];
 }
 finish(sum){
  if(sum.log.length)this.saveLog(sum);
  const c=this.store.records.filter(x=>x.conflict).length;
  if(c)this.statusSet('已同步 · '+c+' 条待确认');
  else if(this.store.records.some(x=>x.dirty))this.statusSet('同步中 · 有待提交修改');
  else this.statusSet('已同步');
  if(sum.log.length)this.onSummary?.(sum);
 }
 /* ── 实时通道（Supabase Realtime，可选加速）──────────────────────
 * 只做一句话的事：云端这张表一有变化，就把「拉一轮」提前到现在（约 0.3~1 秒），
 * 而不是等 15 秒的轮询。连不上 / 没开 publication / 没有 SELECT 策略时静默失败，
 * 轮询照常工作，所以它永远是加速项，不是必需品。 */
startRealtime(){
 this.realtimeWanted=true;
 if(!this.enabled||!this.session||!navigator.onLine)return;
 if(this.socket||this.realtimeTimer)return;
 this.connectRealtime();
}
stopRealtime(){
 this.realtimeWanted=false;
 clearTimeout(this.realtimeTimer);this.realtimeTimer=0;
 clearTimeout(this.pokeTimer);this.pokeTimer=0;
 clearInterval(this.pingTimer);this.pingTimer=0;
 const ws=this.socket;this.socket=null;
 if(ws){try{ws.close()}catch{/* 已断 */}}
 this.realtimeState='off';
}
get realtimeStatus(){return this.realtimeState||'off'}
get realtimeOk(){return this.realtimeState==='ok'}
realtimeUrl(){
 const token=this.session?.access_token;
 if(!JWT_LIKE(token))return ''; // 桩数据/异常 token 不连，免得每个用例都刷一屏连接错误
 const base=String(config.url).replace(/^https/,'wss').replace(/^http/,'ws').replace(/\/+$/,'');
 return base+'/realtime/v1/websocket?apikey='+encodeURIComponent(config.key)+'&vsn=1.0.0';
}
sendFrame(ws,frame){try{ws.send(JSON.stringify(frame))}catch{/* 半关闭状态 */}}
connectRealtime(){
 if(!this.realtimeWanted||!this.enabled||!navigator.onLine)return;
 const url=this.realtimeUrl();
 if(!url){this.realtimeState='off';return;}
 let ws;
 try{ws=this.openSocket(url)}catch{this.scheduleRealtime();return;}
 const generation=this.generation;
 let ref=0;
 const nextRef=()=>String(++ref);
 this.socket=ws;
 this.realtimeState='connecting';
 const filter='user_id=eq.'+(this.session?.user?.id||'');
 ws.onopen=()=>{
  if(generation!==this.generation)return;
  this.sendFrame(ws,{topic:'realtime:public:records:'+filter,event:'phx_join',payload:{config:{broadcast:{self:false},presence:{key:''},postgres_changes:[{event:'*',schema:'public',table:'records',filter}]},access_token:this.session?.access_token},ref:nextRef()});
  clearInterval(this.pingTimer);
  this.pingTimer=setInterval(()=>this.sendFrame(ws,{topic:'phoenix',event:'heartbeat',payload:{},ref:nextRef()}),REALTIME_PING);
 };
 ws.onmessage=e=>{
  if(generation!==this.generation)return;
  let msg;try{msg=JSON.parse(typeof e.data==='string'?e.data:String(e.data))}catch{return}
  if(msg.event==='phx_reply'){
   const status=msg.payload?.status;
   if(status==='ok'){this.realtimeState='ok';this.realtimeBackoff=0;this.onRealtime?.('ok');return;}
   if(status==='error'){this.realtimeState='error';this.closeSocket(ws);this.scheduleRealtime();}
   return;
  }
  if(msg.event==='postgres_changes'){this.pokeRealtime();return;}
  if(msg.event==='system'||msg.event==='phx_error'||msg.event==='phx_close'){this.closeSocket(ws);this.scheduleRealtime();}
 };
 ws.onclose=()=>{
  if(this.socket===ws)this.socket=null;
  clearInterval(this.pingTimer);this.pingTimer=0;
  if(this.realtimeWanted&&generation===this.generation){this.realtimeState='reconnecting';this.scheduleRealtime();}
  else this.realtimeState='off';
 };
}
scheduleRealtime(){
 if(!this.realtimeWanted||this.socket||this.realtimeTimer)return;
 const wait=REALTIME_BACKOFF[Math.min(this.realtimeBackoff||0,REALTIME_BACKOFF.length-1)];
 this.realtimeBackoff=(this.realtimeBackoff||0)+1;
 this.realtimeTimer=setTimeout(()=>{this.realtimeTimer=0;this.connectRealtime()},wait);
}
closeSocket(ws){
 clearInterval(this.pingTimer);this.pingTimer=0;
 if(this.socket===ws)this.socket=null;
 try{ws.close()}catch{/* 已断 */}
}
/* 云端刚变过：连发的事件合并，最多 400 毫秒后补一轮增量拉取（不直接写库，避免半截数据） */
pokeRealtime(){
 if(this.pokeTimer)return;
 this.pokeTimer=setTimeout(async()=>{
  this.pokeTimer=0;
  if(!this.enabled||!this.session||!navigator.onLine)return;
  try{await this.sync();this.onRealtimeSync?.()}catch{/* 下一轮轮询会补 */}
 },REALTIME_GAP);
}
async detail(key){const local=this.store.get(key);if(!this.session||!this.enabled||!local?._partial)return local;if(!navigator.onLine)throw Error('这部分详情尚未缓存；请联网打开一次后再离线查看');if(local.dirty)throw Error('请先同步这条记录的修改，再读取详情');await this.refresh();const generation=this.generation;const r=await this.request('/rest/v1/rpc/record_detail',{p_id:key});if(generation!==this.generation)throw Error('账号已退出');if(!r)throw Error('云端没有这条记录');const live=this.store.get(key);if(live?.dirty||live?.version>r.version)return live;const full={...r.payload,version:r.version,dirty:false,_partial:false};await this.store.transaction([full]);return full;}
 async details(keys){const wanted=[...new Set(keys)].filter(k=>this.store.get(k)?._partial);if(!wanted.length||!this.session||!this.enabled)return;if(!navigator.onLine)throw Error('这部分详情尚未缓存；请联网打开一次后再离线查看');await this.refresh();const generation=this.generation;for(let i=0;i<wanted.length;i+=100){const batch=wanted.slice(i,i+100);const rows=await this.request('/rest/v1/rpc/record_details',{p_ids:batch});if(generation!==this.generation)throw Error('账号已退出');const updates=[];for(const r of rows){const local=this.store.get(r.id);if(local&&!local.dirty&&local.version<=r.version)updates.push({...r.payload,version:r.version,dirty:false,_partial:false});}await this.store.transaction(updates);if(batch.some(k=>this.store.get(k)?._partial))throw Error('有记录尚未同步或已变更，请同步后重试');}}
 async cacheAll(onProgress){await this.sync();if(this.status.startsWith('同步失败'))throw Error(this.status);const rows=this.store.all().filter(x=>x._partial);for(let i=0;i<rows.length;i+=100){await this.details(rows.slice(i,i+100).map(r=>r.id));onProgress?.(Math.min(i+100,rows.length),rows.length);}return this.store.records;}
 async redeem(key,reward){await this.sync();if(this.store.records.some(r=>r.dirty||r.conflict))throw Error('请先完成同步并处理冲突');const r=await this.request('/rest/v1/rpc/redeem_reward',{p_id:key,p_reward:reward});await this.sync();return r;}
}
