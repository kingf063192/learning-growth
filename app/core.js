export const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
export const addDays=(s,n)=>{const d=new Date(s+'T12:00:00');d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
export const monday=s=>addDays(s,-((new Date(s+'T12:00:00').getDay()+6)%7));
export const id=()=>crypto.randomUUID();
export const hash=s=>{let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0).toString(36)};
export const minutes=t=>{const [h,m]=t.split(':').map(Number);return h*60+m};
export const clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
export const defaults={confirmed:false,semester:'2026-09-07',horizon:28,break:10,capacity:120,windows:Array.from({length:7},()=>['09:00','21:00']),slots:{早:['07:00','08:00'],上午:['09:00','11:00'],下午:['14:00','16:00'],傍晚:['18:30','19:30'],晚上:['20:00','22:00'],睡前:['22:00','22:30']}};
export function conflicts(tasks){return tasks.filter(a=>a.start&&a.end&&tasks.some(b=>a.id!==b.id&&a.date===b.date&&b.start&&a.start<b.end&&b.start<a.end)).map(x=>x.id)}
export function plan(records,settings,start=today()){
 const tasks=records.filter(x=>x.kind==='task'&&!x.deleted),courses=records.filter(x=>x.kind==='course'&&!x.deleted),chapters=records.filter(x=>x.kind==='chapter'&&!x.deleted);
 const moves=[],unplaced=[],busy=tasks.filter(x=>x.start&&x.date&&(x.done||x.locked||x.category==='固定课程'||x.date<start)).map(x=>({...x}));
 const candidates=tasks.filter(x=>!x.done&&!x.locked&&x.category!=='固定课程'&&(!x.date||x.date>=start)).sort((a,b)=>{
 const ca=courses.find(c=>c.id===a.courseId)||{},cb=courses.find(c=>c.id===b.courseId)||{};
 return (cb.priority||1)-(ca.priority||1)||(ca.deadline||'9999').localeCompare(cb.deadline||'9999')||(a.order||0)-(b.order||0);
 });
 const placed=new Map(tasks.filter(t=>t.done).map(t=>[t.id,{date:start,end:'00:00'}]));
 const daily={},weekly={};
 for(const t of busy){if(t.category!=='固定课程'){daily[t.date]=(daily[t.date]||0)+t.duration;const k=t.courseId+':'+monday(t.date);weekly[k]=(weekly[k]||0)+1;}placed.set(t.id,t)}
 for(const t of candidates){const c=courses.find(c=>c.id===t.courseId)||{};let found=false;
 for(let n=0;n<settings.horizon;n++){const date=addDays(start,n);if(date<(c.start||start)||date>(c.deadline||'9999-12-31'))continue;
 const previous=tasks.filter(p=>p.courseId&&p.courseId===t.courseId&&(p.order||0)<(t.order||0));
 if(previous.some(p=>!placed.has(p.id)||placed.get(p.id).date>date))continue;
 const wk=t.courseId+':'+monday(date);if(c.frequency&&(weekly[wk]||0)>=c.frequency)continue;
 if((daily[date]||0)+t.duration>settings.capacity)continue;
 const win=settings.windows[(new Date(date+'T12:00').getDay()+6)%7];if(!win||!win[0]||!win[1])continue;
 let begin=minutes(win[0]);for(const p of previous){const q=placed.get(p.id);if(q?.date===date&&q.end)begin=Math.max(begin,minutes(q.end)+settings.break)}
 for(let m=begin;m+t.duration<=minutes(win[1]);m+=5){const a=clock(m),b=clock(m+t.duration);if(busy.some(x=>x.date===date&&m<minutes(x.end)+settings.break&&m+t.duration+settings.break>minutes(x.start)))continue;
 const v={...t,date,start:a,end:b};moves.push(v);busy.push(v);placed.set(t.id,v);daily[date]=(daily[date]||0)+t.duration;weekly[wk]=(weekly[wk]||0)+1;found=true;break;}if(found)break;
 }if(!found)unplaced.push(t);
 }return {moves,unplaced};
}
export function taskGuide(course,chapter){const p=chapter.topic||chapter.title;return {prerequisite:chapter.prerequisite||'能读懂本节关键词；不懂时先用 5 分钟写出 3 个生词并查课程讲义。',objective:chapter.objective||`能用自己的话说明“${p}”，并完成一个小作品或练习。`,steps:[`第 1 步 · 5 分钟：回忆前置知识，写下对“${p}”的一个问题。`,`第 2 步 · 15 分钟：阅读对应讲义或已核对的教材小节，边读边画关系图；只处理一个知识点。`,`第 3 步 · 10 分钟：合上材料完成下方练习，再对照材料用另一种颜色订正。`],material:chapter.material||'本课程课堂讲义或自有教材对应小节；教材版本、页码和外部资源待补充。',example:chapter.example||`把“${p}”放进一个具体场景：先写输入条件，再写处理过程，最后写结果；用箭头连接。`,practice:chapter.practice||`不看资料，解释“${p}”的含义，写一个例子和一个容易混淆的情况。对照讲义逐项核对；有差异的地方标出来源，仍不确定的交给老师确认。`,output:chapter.output||'一张概念图＋一个例子＋订正记录。',acceptance:'能脱离材料讲解核心概念，完成练习并核对；不会的地方已标注和记录。仅计时不算完成。',fallback:'缩小到一个术语：查定义→用自己的话复述→举一个例子。仍不会就记录问题，下次先补基础。'};}
export function migrate(old){
 if(!old||typeof old!=='object'||!Array.isArray(old.goals)||!Array.isArray(old.fixed))throw Error('不是有效的 life-system-v3 备份');
 if(!old.goals.every(g=>g&&typeof g.id==='string'&&typeof g.title==='string'&&Array.isArray(g.sessions)&&g.sessions.every(t=>t&&typeof t.id==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(t.date))))throw Error('目标或学习记录格式错误');
 const out=[],put=(kind,key,x)=>out.push({...x,id:'legacy:'+kind+':'+key,kind});
 put('archive','original',{raw:old});
 for(const g of old.goals){out.push({id:g.id,kind:'course',title:g.title,category:g.cat,start:g.start,deadline:g.deadline,frequency:g.perWeek||2,priority:1});for(const s of g.sessions)put('task',s.id,{...s,courseId:g.id,legacyCredited:!!s.done,duration:30,category:g.cat,legacy:true,locked:true,slot:s.slot});}
 for(const f of old.fixed){if(!f||typeof f.id!=='string'||typeof f.title!=='string'||!Number.isInteger(f.wd))throw Error('固定课程格式错误');out.push({...f,id:'fixed-'+f.id,kind:'fixed'})}
 for(const [key,done] of Object.entries(old.fixedDone||{})){if(!done)continue;const i=key.indexOf(':'),f=old.fixed.find(x=>x.id===key.slice(0,i)),wk=key.slice(i+1);if(f&&/^\d{4}-\d{2}-\d{2}$/.test(wk)){const date=addDays(wk,(f.wd+6)%7);out.push({id:'fixed-'+f.id+':'+date,kind:'task',title:f.title,category:'固定课程',slot:f.slot,date,duration:30,locked:true,done:true,legacyCredited:true})}}
 for(const [k,list] of Object.entries({card:old.cards||[],weight:old.weights||[],redemption:old.redeemed||[]})){if(!Array.isArray(list))throw Error(k+' 格式错误');list.forEach((v,i)=>{if(!v||typeof v!=='object')throw Error(k+' 格式错误');put(k,v.id||hash(JSON.stringify(v))+':'+i,v)})}
 for(const [k,obj] of Object.entries({bill:old.bills||{},water:old.water||{},exercise:old.exercise||{}})){if(!obj||typeof obj!=='object')throw Error(k+' 格式错误');Object.entries(obj).forEach(([key,v])=>{if(k==='water'||k==='exercise')out.push({id:k+':'+key,kind:k,date:key,value:v,done:k==='exercise'&&Array.isArray(v)?v.length>0:undefined});else put(k,key,typeof v==='object'?v:{date:key,value:v})})}
 for(const x of [...(old.tasks||[]),...(old.custom||[])]){if(!x||typeof x.title!=='string')throw Error('待办格式错误');if(/服药|喝水|运动|记账|专业课|课程作业/.test(x.title))continue;put('task',x.id||hash(x.title),{title:x.title,date:x.doneDate||today(),done:x.doneDate===today(),duration:20,category:'生活',locked:true})}
 put('opening','balance',{amount:(Number(old.points)||0)+(old.redeemed||[]).reduce((n,r)=>n+(Number(r.cost)||0),0)});put('setting','profile',{height:old.height,target:old.target});return out;
}
export function validateRecords(rows){
 const kinds=['course','chapter','task','fixed','card','weight','redemption','bill','water','exercise','award','opening','setting','archive','research','settlement','retry'];
 if(!Array.isArray(rows)||rows.length>50000)throw Error('记录数量或格式不正确');
 const ids=new Set();const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!isNaN(new Date(d+'T12:00').valueOf());
 for(const r of rows){if(!r||typeof r!=='object'||typeof r.id!=='string'||!r.id||ids.has(r.id)||!kinds.includes(r.kind))throw Error('记录 ID 或类型不正确');ids.add(r.id);if(r.deleted)continue;
 if(['course','chapter','task','fixed'].includes(r.kind)&&(typeof r.title!=='string'||!r.title.trim()))throw Error('课程、章节或任务缺少标题');
 if(r.kind==='task'){if(!Number.isFinite(r.duration)||r.duration<1||r.duration>1440)throw Error('任务时长不正确');if(r.date&&!validDate(r.date))throw Error('任务日期错误');if((r.start&&!r.end)||(!r.start&&r.end)||r.start&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.end)||r.start>=r.end))throw Error('任务起止时间错误');}
 if(r.kind==='card'&&(typeof r.front!=='string'||typeof r.back!=='string'))throw Error('卡片缺少问题或答案');
 for(const field of r.kind==='weight'?['kg']:r.kind==='bill'||r.kind==='award'||r.kind==='opening'?['amount']:r.kind==='redemption'?['cost']:[]){if(!Number.isFinite(Number(r[field]))||Number(r[field])<0)throw Error('记录数值错误');}
 if(r.kind==='weight'&&!validDate(r.date))throw Error('体重日期错误');
 }return rows;
}
