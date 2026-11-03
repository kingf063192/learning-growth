import {config} from '../app/config.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SKEY='thesis-session';
let session=JSON.parse(localStorage.getItem(SKEY)||'null');
let urlCode=new URLSearchParams(location.search).get('code')||'';
let code=urlCode, data=null, loading=false, manage=false;
let openEdits=new Set(), openComments=new Set(), myCodes=[], panel='';

function toast(m){const t=$('#toast');t.textContent=m;t.style.display='block';clearTimeout(toast.h);toast.h=setTimeout(()=>t.style.display='none',4000)}
async function api(path,opt={}){
  const h={'Content-Type':'application/json',apikey:config.key};
  const tok=opt.anon?config.key:((session&&session.access_token)||config.key);
  h.Authorization='Bearer '+tok;
  const r=await fetch(config.url+path,{method:opt.method||'GET',headers:h,body:opt.body?JSON.stringify(opt.body):undefined});
  const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch(e){d=t}
  if(!r.ok)throw Error((d&&(d.message||d.error_description||d.msg))||t||r.status);
  return d;
}
const rpc=(n,b)=>api('/rest/v1/rpc/'+n,{method:'POST',body:b||{}});
const isStudent=()=>!!session&&!urlCode;
function author(){ if(!session)return '导师'; const e=(session.user&&session.user.email)||''; return e?e.split('@')[0]:'学生' }

/* ---------- 账号 ---------- */
async function auth(signup){
  const email=($('#aEmail')||{}).value||'', pass=($('#aPass')||{}).value||'';
  if(!email||!pass){toast('填邮箱和密码');return}
  try{
    const d=await api('/auth/v1/'+(signup?'signup':'token?grant_type=password'),{method:'POST',anon:true,body:{email,password:pass}});
    if(!d.access_token){toast('注册成功，请先点邮箱确认链接再登录');return}
    session=d;localStorage.setItem(SKEY,JSON.stringify(d));
    await loadCodes();render();toast('登录成功');
  }catch(e){toast(e.message)}
}
function logout(){session=null;localStorage.removeItem(SKEY);code='';data=null;myCodes=[];render()}

/* ---------- 分享码 ---------- */
async function loadCodes(){
  if(!session){myCodes=[];return}
  try{myCodes=await api('/rest/v1/thesis_share?select=*&owner_id=eq.'+session.user.id+'&order=created_at.desc')||[]}catch(e){myCodes=[]}
}
async function createCode(){
  const adv=($('#advName')||{}).value||'';
  const c='THESIS-'+Math.random().toString(36).slice(2,6).toUpperCase();
  try{
    await api('/rest/v1/thesis_share',{method:'POST',body:{code:c,advisor:adv.trim()||null,owner_id:session.user.id}});
    await loadCodes();render();toast('已生成 '+c);
  }catch(e){toast(e.message)}
}
async function revoke(id){try{await api('/rest/v1/thesis_share?id=eq.'+id,{method:'PATCH',body:{revoked:true}});await loadCodes();render()}catch(e){toast(e.message)}}
async function delCode(id){if(!confirm('彻底删除这个邀请码？'))return;try{await rpc('thesis_share_delete',{p_id:id});await loadCodes();render()}catch(e){toast(e.message)}}
const linkOf=c=>location.origin+location.pathname+'?code='+encodeURIComponent(c);

/* ---------- 视图 ---------- */
async function openCode(c){
  if(!c)return;code=c;data=null;loading=true;render();
  try{
    const d=await rpc('thesis_view',{p_code:c});
    if(!d||!d.ok)throw Error((d&&d.error)||'邀请码无效或已停用');
    data=d;loading=false;render();
  }catch(e){loading=false;data=null;toast(e.message);render()}
}
const reload=()=>code?openCode(code):render();

const DEFAULTS=[
 ['选题确认','确定研究对象、创新点与题目','确定研究对象|写清创新点|拟 2–3 个题目|导师确认'],
 ['文献与引用','核心文献与引用格式','精读 10 篇|整理文献表|确定引用格式|导师确认'],
 ['方法与指标','工艺与检测方法','确定工艺|确定指标|确定方法|导师确认'],
 ['设备与材料','设备与耗材到位','设备预约|采购清单|原料方案|导师确认'],
 ['开题报告','初稿到定稿','初稿|修改|提交|答辩通过'],
 ['预实验','参数摸底','完成预实验|数据整理|导师看数据|确定方案'],
 ['正式实验','重复与取样','实验完成|取样检测|数据归档|导师确认'],
 ['数据与统计','统计与作图','统计分析|图表定稿|结论框架|导师确认'],
 ['本科论文','成稿查重','初稿|修改|查重|导师签字'],
 ['英文稿','SCI 稿件','方法结果|引言讨论|润色|导师定稿'],
 ['投稿','主投 JFMC','选刊|Cover letter|投稿|导师知悉'],
 ['返修与接收','回复与录用','逐条回复|补实验|接收|录用证明']
];
function defs(){
  const d=(data&&data.defs)||[];
  if(Array.isArray(d)&&d.length)return d.map((s,i)=>({id:s.id||('c'+i),t:s.t||s.title||'阶段',d:s.d||'',items:s.items||[]}));
  return DEFAULTS.map((x,i)=>({id:'s'+(i+1),t:x[0],d:x[1],items:x[2].split('|')}));
}
function smap(){const m={};((data&&data.stages)||[]).forEach(s=>m[s.stage_id]=s);return m}
const doneOf=(sm,id)=>!!(sm[id]&&sm[id].owner_ok&&sm[id].advisor_ok);
const unlocked=(sm,ds,i)=>{for(let k=0;k<i;k++)if(!doneOf(sm,ds[k].id))return false;return true};

/* ---------- 渲染 ---------- */
function render(){
  const app=$('#app');
  if(!session&&!urlCode&&!code){app.innerHTML=landing();bindLanding();return}
  if(!code){app.innerHTML=studentHome();bindStudentHome();return}
  if(loading){app.innerHTML='<div class="panel"><p class="meta">加载中…</p></div>';return}
  if(!data){app.innerHTML='<div class="panel"><p class="meta">打不开这个邀请码</p><button id="back">返回</button></div>';$('#back').onclick=()=>{code='';render()};return}
  const ds=defs(),sm=smap(),total=ds.length,dn=ds.filter(s=>doneOf(sm,s.id)).length,pct=total?Math.round(dn/total*100):0;
  const student=isStudent();
  app.innerHTML=`
  <div class="panel">
    <div class="rolebar"><span class="rolebadge ${student?'owner':'advisor'}">${student?'学生端':'导师端'}</span>
      <span class="meta">${student?'已登录：'+esc(session.user.email||''):'邀请码进入 · 无需登录'}</span>
      <button class="link" id="exitBtn">${student?'退出登录':'返回'}</button></div>
    <div class="topline"><div><h2>论文进度</h2><p class="meta">邀请码 ${esc(code)}${data.advisor?' · '+esc(data.advisor):''}</p></div><div class="pct">${pct}%</div></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <p class="meta">${dn}/${total} 阶段双方确认 · 都确认后进入下一阶段</p>
    <div class="manage">${student?`<button id="myCodes">我的邀请码</button><button id="mg">${manage?'完成管理':'管理阶段'}</button><button id="add">＋ 新增阶段</button>`:''}<button id="rf">刷新</button></div>
  </div>
  ${panel==='codes'&&student?codesPanel():''}
  <div id="grid">${ds.map((st,i)=>stageCard(st,i,sm,ds)).join('')}</div>
  <details class="panel"><summary>评语与文件（按阶段）</summary><p class="meta">在阶段卡片里点“评语”即可查看和上传。</p></details>
  <details class="panel"><summary>说明</summary><p class="meta">学生登录后生成邀请码，把链接发导师；导师打开即导师端，可勾选、确认、评语、上传文件。</p></details>`;
  bindStage(student,sm,ds);
}
function landing(){
  return `<div class="panel"><h2>学生登录</h2><p class="meta">登录后自动进入学生端，管理邀请码和阶段</p>
    <div class="form"><input id="aEmail" placeholder="邮箱" type="email"><input id="aPass" placeholder="密码" type="password"><button class="primary" id="loginBtn">登录</button><button id="signupBtn">注册</button></div></div>
  <div class="panel"><h2>导师入口</h2><p class="meta">粘贴学生给你的邀请码，或直接打开邀请链接</p>
    <div class="form"><input id="cInput" placeholder="THESIS-XXXX"><button class="primary" id="openBtn">进入</button></div></div>`;
}
function bindLanding(){
  $('#loginBtn').onclick=()=>auth(false);
  $('#signupBtn').onclick=()=>auth(true);
  $('#openBtn').onclick=()=>{const v=($('#cInput').value||'').trim().toUpperCase();if(v){urlCode=v;openCode(v)}};
}
function studentHome(){
  return `<div class="panel"><div class="rolebar"><span class="rolebadge owner">学生端</span><span class="meta">已登录：${esc(session.user.email||'')}</span><button class="link" id="logoutBtn">退出登录</button></div>
    <h2>我的邀请码</h2>
    <div class="form"><input id="advName" placeholder="导师称呼（可空）"><button class="primary" id="createBtn">生成邀请码</button></div>
    ${myCodes.length?myCodes.map(s=>`<div class="codebox"><b>${esc(s.code)}</b> ${s.revoked?'<span class="sb lock">已停用</span>':'<span class="sb done">可用</span>'}
      <p class="meta">${esc(s.advisor||'未命名导师')} · ${esc((s.created_at||'').slice(0,10))}</p>
      <p class="meta">导师链接：<a href="${linkOf(s.code)}">${esc(linkOf(s.code))}</a></p>
      <div class="sf"><button class="primary" data-enter="${esc(s.code)}">进入</button><button data-copy="${esc(linkOf(s.code))}">复制导师链接</button>
      ${s.revoked?'':`<button data-revoke="${esc(s.id)}">停用</button>`}<button class="danger" data-del="${esc(s.id)}">删除</button></div></div>`).join(''):'<p class="meta">还没有邀请码，先生成一个。</p>'}
  </div>`;
}
function bindStudentHome(){
  $('#logoutBtn').onclick=logout;
  $('#createBtn').onclick=createCode;
  bindCodes();
}
function codesPanel(){return `<div class="panel"><h2>邀请码</h2>${myCodes.map(s=>`<div class="codebox"><b>${esc(s.code)}</b><p class="meta">导师链接：<a href="${linkOf(s.code)}">${esc(linkOf(s.code))}</a></p>
  <div class="sf"><button data-copy="${esc(linkOf(s.code))}">复制导师链接</button><button class="primary" data-enter="${esc(s.code)}">进入</button></div></div>`).join('')||'<p class="meta">还没有邀请码</p>'}</div>`}
function bindCodes(){
  document.querySelectorAll('[data-enter]').forEach(b=>b.onclick=()=>{openCode(b.getAttribute('data-enter'))});
  document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>{try{navigator.clipboard.writeText(b.getAttribute('data-copy'));toast('已复制')}catch(e){toast('复制失败')}});
  document.querySelectorAll('[data-revoke]').forEach(b=>b.onclick=()=>revoke(b.getAttribute('data-revoke')));
  document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>delCode(b.getAttribute('data-del')));
}
function stageCard(st,i,sm,ds){
  const s=sm[st.id]||{},ck=s.checks||{},lock=!unlocked(sm,ds,i),both=doneOf(sm,st.id);
  const cls=both?'done':lock?'locked':'now';
  const badge=both?'<span class="sb done">已确认</span>':lock?'<span class="sb lock">未解锁</span>':'<span class="sb now">进行中</span>';
  const items=(st.items||[]).map((it,j)=>{
    const c=ck[j]||{};const d=typeof c==='boolean'?c:!!c.done;const ed=!!(c.text&&c.text!==it);
    return `<li class="cli"><label><input type="checkbox" data-st="${st.id}" data-j="${j}" ${d?'checked':''}> ${ed?`<s class="orig">${esc(it)}</s> <span class="newtxt">${esc(c.text)}</span>`:`<span>${esc(it)}</span>`}</label>
      <button class="mini" data-ed="${st.id}:${j}">批注</button>
      ${c.note?`<div class="note">📝 ${esc(c.note)}</div>`:''}
      ${openEdits.has(st.id+':'+j)?`<div class="editbox"><input data-et="${st.id}:${j}" value="${esc(c.text||'')}" placeholder="改后的内容"><textarea data-en="${st.id}:${j}" placeholder="批注">${esc(c.note||'')}</textarea><div class="sf"><button class="primary" data-es="${st.id}:${j}">保存</button><button data-ec="${st.id}:${j}">取消</button></div></div>`:''}
    </li>`;
  }).join('');
  return `<div class="stage ${cls}"><div class="sh"><span class="idx">${i+1}</span><div class="st"><b>${esc(st.t)}</b><div class="meta">${esc(st.d)}</div></div>${badge}
    ${manage?`<div class="sop"><button data-up="${st.id}">↑</button><button data-dn="${st.id}">↓</button><button class="danger" data-delst="${st.id}">删</button></div>`:''}</div>
    ${lock&&!manage?'<p class="meta">上一阶段双方确认后解锁。</p>':`<ul class="cl">${items}</ul>
    <div class="sf"><button class="${s.owner_ok?'primary':''}" data-ok="${st.id}:owner">${s.owner_ok?'✓ ':''}学生确认</button>
      <button class="${s.advisor_ok?'primary':''}" data-ok="${st.id}:advisor">${s.advisor_ok?'✓ ':''}导师确认</button>
      <button class="link" data-cmt="${st.id}">评语</button></div>
    ${openComments.has(st.id)?`<div class="sub">${((data.comments)||[]).filter(c=>c.task_id===st.id).map(c=>`<div class="cmt"><b>${esc(c.author)}</b> <p>${esc(c.body)}</p></div>`).join('')||'<p class="meta">还没有评语</p>'}
      <div class="form"><textarea data-body="${st.id}" placeholder="评语…"></textarea><button class="primary" data-send="${st.id}">发送</button></div>
      <label class="upload">上传文件<input type="file" data-up="${st.id}" hidden></label></div>`:''}`}</div>`;
}
function bindStage(student,sm,ds){
  $('#exitBtn').onclick=()=>{if(student)logout();else{code='';data=null;history.replaceState(null,'',location.pathname);render()}};
  $('#rf').onclick=reload;
  const mc=$('#myCodes');if(mc)mc.onclick=()=>{panel=panel==='codes'?'':'codes';render()};
  const mg=$('#mg');if(mg)mg.onclick=()=>{manage=!manage;render()};
  const ad=$('#add');if(ad)ad.onclick=addStage;
  bindCodes();
  document.querySelectorAll('[data-up],[data-dn],[data-delst]').forEach(b=>b.onclick=async()=>{
    const list=defs();const id=b.getAttribute('data-up')||b.getAttribute('data-dn')||b.getAttribute('data-delst');
    const i=list.findIndex(x=>x.id===id);if(i<0)return;
    if(b.hasAttribute('data-delst')){if(!confirm('删除阶段？'))return;list.splice(i,1)}
    else{const j=b.hasAttribute('data-up')?i-1:i+1;if(j<0||j>=list.length)return;[list[i],list[j]]=[list[j],list[i]]}
    try{await rpc('thesis_def_save',{p_code:code,p_defs:list});await reload()}catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-st]').forEach(el=>el.onchange=async()=>{
    const sid=el.dataset.st,j=el.dataset.j;const cur=Object.assign({},sm[sid]&&sm[sid].checks||{});
    const o=(typeof cur[j]==='object'&&cur[j])?{...cur[j]}:{done:!!cur[j]};o.done=el.checked;cur[j]=o;
    try{await rpc('thesis_stage_set',{p_code:code,p_stage:sid,p_checks:cur,p_owner:null,p_advisor:null});await reload()}catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-ed]').forEach(b=>b.onclick=()=>{const k=b.getAttribute('data-ed');openEdits.has(k)?openEdits.delete(k):openEdits.add(k);render()});
  document.querySelectorAll('[data-ec]').forEach(b=>b.onclick=()=>{openEdits.delete(b.getAttribute('data-ec'));render()});
  document.querySelectorAll('[data-es]').forEach(b=>b.onclick=async()=>{
    const k=b.getAttribute('data-es');const[sid,j]=k.split(':');
    const cur=Object.assign({},sm[sid]&&sm[sid].checks||{});
    const o=(typeof cur[j]==='object'&&cur[j])?{...cur[j]}:{done:!!cur[j]};
    o.text=document.querySelector(`[data-et="${k}"]`).value.trim();
    o.note=document.querySelector(`[data-en="${k}"]`).value.trim();
    cur[j]=o;
    try{await rpc('thesis_stage_set',{p_code:code,p_stage:sid,p_checks:cur,p_owner:null,p_advisor:null});openEdits.delete(k);await reload()}catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-ok]').forEach(b=>b.onclick=async()=>{
    const[sid,who]=b.getAttribute('data-ok').split(':');const s=sm[sid]||{};
    try{
      if(who==='owner')await rpc('thesis_stage_set',{p_code:code,p_stage:sid,p_checks:s.checks||{},p_owner:!(s.owner_ok),p_advisor:null});
      else await rpc('thesis_stage_set',{p_code:code,p_stage:sid,p_checks:s.checks||{},p_owner:null,p_advisor:!(s.advisor_ok)});
      await reload();
    }catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-cmt]').forEach(b=>b.onclick=()=>{const id=b.getAttribute('data-cmt');openComments.has(id)?openComments.delete(id):openComments.add(id);render()});
  document.querySelectorAll('[data-send]').forEach(b=>b.onclick=async()=>{
    const id=b.getAttribute('data-send');const v=document.querySelector(`[data-body="${id}"]`).value.trim();if(!v)return;
    try{await rpc('thesis_comment_add',{p_code:code,p_task_id:id,p_author:author(),p_body:v});await reload()}catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-up]').forEach(el=>{if(el.tagName==='INPUT'&&el.type==='file')el.onchange=async()=>{
    const id=el.getAttribute('data-up'),f=el.files[0];if(!f)return;if(f.size>10*1024*1024){toast('超过 10MB');return}
    const path=code+'/'+Date.now()+'_'+f.name.replace(/[^\w.\-\u4e00-\u9fa5]/g,'_');
    try{
      const r=await fetch(config.url+'/storage/v1/object/thesis-files/'+encodeURI(path),{method:'POST',headers:{apikey:config.key,Authorization:'Bearer '+config.key,'Content-Type':f.type||'application/octet-stream'},body:f});
      if(!r.ok)throw Error('上传失败');
      await rpc('thesis_file_add',{p_code:code,p_task_id:id,p_name:f.name,p_path:path,p_by:author()});await reload();toast('已上传');
    }catch(e){toast(e.message)}
  }});
}
function addStage(){
  const t=prompt('新阶段名称');if(!t)return;
  const list=defs();list.push({id:'c'+Date.now(),t:t,d:'',items:[]});
  rpc('thesis_def_save',{p_code:code,p_defs:list}).then(reload).catch(e=>toast(e.message));
}

/* ---------- 启动 ---------- */
(async()=>{
  if(session)await loadCodes();
  if(urlCode){code=urlCode;await openCode(urlCode);return}
  render();
})();
