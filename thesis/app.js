import {config} from '../app/config.js';

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function authorName(){
  try{if(!JSON.parse(localStorage.getItem('thesis-session')||'null'))return '导师'}catch(e){return '导师'}
  try{
    const s=JSON.parse(localStorage.getItem('thesis-session')||'null');
    if(s&&s.user){
      const e=s.user.email||'';
      return (s.user.user_metadata&&(s.user.user_metadata.name||s.user.user_metadata.full_name))||e.split('@')[0]||'学生';
    }
  }catch(e){}
  return '学生';
}
function roleName(){try{return JSON.parse(localStorage.getItem('thesis-session')||'null')?'学生':'导师'}catch(e){return '导师'}}
const H=()=>({apikey:config.key,'Content-Type':'application/json'});
let code=new URLSearchParams(location.search).get('code')||localStorage.getItem('thesis-code')||'';
let data=null, session=JSON.parse(localStorage.getItem('thesis-session')||'null');
let openComments=new Set(), openEdits=new Set(), filter='todo';

async function rpc(name,body){const hd=Object.assign({},H(),{Authorization:'Bearer '+((session&&session.access_token)||config.key)});const r=await fetch(config.url+'/rest/v1/rpc/'+name,{method:'POST',headers:hd,body:JSON.stringify(body||{})});const t=await r.text();let d=null;try{d=JSON.parse(t)}catch(e){d=t}if(!r.ok)throw Error((d&&(d.message||d.error))||t||r.status);return d}
function toast(s){const t=$('#toast');t.textContent=s;t.style.display='block';clearTimeout(toast.h);toast.h=setTimeout(()=>t.style.display='none',4000)}

async function load(){
  if(!code){render();return}
  try{
    data=await rpc('thesis_view',{p_code:code});
    if(!data.ok){data=null;localStorage.removeItem('thesis-code');toast('分享码无效或已停用');render();return}
    localStorage.setItem('thesis-code',code);
    render();
  }catch(e){alert('加载失败：'+e.message);render()}
}



async function goMyThesis(){
  if(!session)return false;
  try{
    const r=await fetch(config.url+'/rest/v1/thesis_share?select=*&owner_id=eq.'+session.user.id+'&order=created_at.desc',
      {headers:Object.assign(H(),{Authorization:'Bearer '+session.access_token})});
    const list=await r.json();
    if(!Array.isArray(list)||!list.length)return false;
    const pick=list.find(x=>!x.revoked)||list[0];
    code=pick.code;localStorage.setItem('thesis-code',code);
    await load();
    return true;
  }catch(e){return false}
}
async function doAuth(signup){
  const em=document.getElementById('qEmail'),pw=document.getElementById('qPass');
  const email=(em&&em.value||'').trim(),pass=(pw&&pw.value||'');
  if(!email||!pass){toast('填邮箱和密码');return}
  try{
    const r=await fetch(config.url+(signup?'/auth/v1/signup':'/auth/v1/token?grant_type=password'),
      {method:'POST',headers:H(),body:JSON.stringify({email,password:pass})});
    const d=await r.json();
    if(!r.ok)throw Error(d.error_description||d.msg||'失败');
    if(!d.access_token){toast('注册成功，去邮箱点确认链接后再登录');return}
    session=d;localStorage.setItem('thesis-session',JSON.stringify(d));
    const went=await goMyThesis();
    if(!went){renderOwner()}
    toast(signup?'注册成功':'登录成功');
  }catch(e){toast(e.message)}
}
function render(){
  const app=$('#app');
  if(!code||!data){
    app.innerHTML=`<div class="panel"><h2>输入导师分享码</h2><p class="meta">由学生本人提供，形如 THESIS-7K2M</p>
      <form id="codeForm"><input id="codeInput" placeholder="THESIS-XXXX" value="${esc(code)}"><button class="primary">打开</button></form>
      <p class="meta" style="margin-top:12px">学生本人？<a href="#" id="ownerLink">生成 / 管理分享码</a></p></div>
      <div id="owner"></div>`;
    $('#codeForm').onsubmit=e=>{e.preventDefault();code=$('#codeInput').value.trim().toUpperCase();load()};
    const ol=$('#ownerLink');if(ol)ol.onclick=e=>{e.preventDefault();renderOwner()};
    return;
  }
  const ts=data.tasks||[], doneN=ts.filter(t=>t.done).length, pct=ts.length?Math.round(doneN/ts.length*100):0;
  const shown=filter==='todo'?ts.filter(t=>!t.done):ts;
  const cm=data.comments||[], files=data.files||[];
  app.innerHTML=`<div class="panel"><div class="rolebar"><span class="rolebadge ${role}">${role==='owner'?'学生端':'导师端'}</span><span class="meta">当前身份：${role==='owner'?'学生（论文作者）':'导师（查看与确认）'}</span><button class="link" id="switchRole">切换身份</button></div>
      <div class="topline"><div><h2>论文进度</h2><p class="meta">导师：${esc(data.advisor||'未命名')} · 分享码 ${esc(code)}</p></div><div class="pct">${pct}%</div></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <p class="meta">${doneN} / ${ts.length} 步完成 · 双方都可以勾选</p>
    <div class="row-actions"><button id="fTodo" class="${filter==='todo'?'primary':''}">未完成</button><button id="fAll" class="${filter==='all'?'primary':''}">全部</button><button id="refresh">刷新</button><a href="#" id="switch">换分享码</a></div></div>
    <div class="panel"><h2>任务清单</h2>${shown.map(t=>taskHtml(t,cm,files)).join('')||'<p class="meta">没有任务</p>'}</div>
    <div class="panel"><h2>留言板</h2>${cm.filter(c=>!c.task_id).map(c=>`<div class="cmt"><b>${esc(c.author)}</b> <span class="meta">${esc((c.created_at||'').slice(0,16).replace('T',' '))}</span><p>${esc(c.body)}</p></div>`).join('')||'<p class="meta">还没有留言</p>'}
      <div class="form"><textarea id="gbBody" placeholder="给对方的留言…"></textarea><button id="gbSend" class="primary">发送</button></div></div>`;
  $('#fTodo').onclick=()=>{filter='todo';render()};
  $('#fAll').onclick=()=>{filter='all';render()};
  $('#refresh').onclick=load;
  const sw=$('#switch');if(sw)sw.onclick=e=>{e.preventDefault();code='';data=null;localStorage.removeItem('thesis-code');render()};
  $('#gbSend').onclick=async()=>{
    const body=$('#gbBody').value.trim();
    if(!body)return;
    try{await rpc('thesis_comment_add',{p_code:code,p_task_id:null,p_author:authorName(),p_body:body});$('#gbBody').value='';load()}catch(e){toast(e.message)}
  };
  bindTask();
}

function taskHtml(t,cm,files){
  const tc=cm.filter(c=>c.task_id===t.id), tf=files.filter(f=>f.task_id===t.id);
  return `<div class="task ${t.done?'done':''}">
    <input type="checkbox" data-toggle="${esc(t.id)}" ${t.done?'checked':''}>
    <div class="body"><b>${esc(t.title)}</b><div class="meta">${esc(t.date||'未排期')} · ${esc(t.duration||30)} 分钟</div></div>
    <button data-cmt="${esc(t.id)}">评语 ${tc.length?('('+tc.length+')'):''}</button>
    <button data-file="${esc(t.id)}">文件 ${tf.length?('('+tf.length+')'):''}</button>
    ${openComments.has(t.id)?`<div class="sub"><div class="subhead"><b>评语</b><button data-close="${esc(t.id)}">收起</button></div>
      ${tc.map(c=>`<div class="cmt"><b>${esc(c.author)}</b> <span class="meta">${esc((c.created_at||'').slice(0,16).replace('T',' '))}</span><p>${esc(c.body)}</p></div>`).join('')||'<p class="meta">还没有评语</p>'}
      <div class="form"><input data-name="${esc(t.id)}" placeholder="你的名字" value="${esc(localStorage.getItem('thesis-name')||'')}"><textarea data-body="${esc(t.id)}" placeholder="对这一步的评语…"></textarea><button class="primary" data-send="${esc(t.id)}">发送评语</button></div>
      <div class="subhead"><b>文件</b><label class="upload">上传<input type="file" data-up="${esc(t.id)}" hidden></label></div>
      ${tf.map(f=>`<p><a href="${config.url}/storage/v1/object/public/thesis-files/${encodeURI(f.path)}" target="_blank" rel="noopener">${esc(f.name)}</a> <span class="meta">${esc(f.uploaded_by)}</span></p>`).join('')||'<p class="meta">还没有文件</p>'}
    </div>`:''}
  </div>`;
}

function bindTask(){
  document.querySelectorAll('[data-toggle]').forEach(el=>el.onchange=async()=>{
    const id=el.getAttribute('data-toggle');
    try{await rpc('thesis_toggle',{p_code:code,p_task_id:id,p_done:el.checked});load()}catch(e){toast(e.message);el.checked=!el.checked}
  });
  document.querySelectorAll('[data-cmt]').forEach(el=>el.onclick=()=>{const id=el.getAttribute('data-cmt');openComments.has(id)?openComments.delete(id):openComments.add(id);render()});
  document.querySelectorAll('[data-file]').forEach(el=>el.onclick=()=>{const id=el.getAttribute('data-file');openComments.has(id)?openComments.delete(id):openComments.add(id);render()});
  document.querySelectorAll('[data-close]').forEach(el=>el.onclick=()=>{openComments.delete(el.getAttribute('data-close'));render()});
  document.querySelectorAll('[data-sup]').forEach(el=>el.onchange=async()=>{
    const id=el.getAttribute('data-sup'),f=el.files[0];if(!f)return;
    if(f.size>10*1024*1024){toast('文件超过 10 MB');return}
    const name=authorName();
    const path=code+'/'+Date.now()+'_'+f.name.replace(/[^\w.\-\u4e00-\u9fa5]/g,'_');
    try{
      const r=await fetch(config.url+'/storage/v1/object/thesis-files/'+encodeURI(path),{method:'POST',headers:{apikey:config.key,Authorization:'Bearer '+config.key,'Content-Type':f.type||'application/octet-stream'},body:f});
      if(!r.ok)throw Error('上传失败 '+(await r.text()).slice(0,120));
      await rpc('thesis_file_add',{p_code:code,p_task_id:id,p_name:f.name,p_path:path,p_by:name});
      toast('已上传');load();
    }catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-send]').forEach(el=>el.onclick=async()=>{
    const id=el.getAttribute('data-send');
    const body=document.querySelector(`[data-body="${id}"]`).value.trim();
    if(!body)return;
    try{await rpc('thesis_comment_add',{p_code:code,p_task_id:id,p_author:authorName(),p_body:body});load()}catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-up]').forEach(el=>el.onchange=async()=>{
    const id=el.getAttribute('data-up'),f=el.files[0];if(!f)return;if(f.size>20*1024*1024){toast('文件超过 20 MB，请压缩后再传');return;}
    const name=authorName();
    const path=code+'/'+Date.now()+'_'+f.name.replace(/[^\w.\-\u4e00-\u9fa5]/g,'_');
    try{
      const r=await fetch(config.url+'/storage/v1/object/thesis-files/'+encodeURI(path),{method:'POST',headers:{apikey:config.key,Authorization:'Bearer '+config.key,'Content-Type':f.type||'application/octet-stream'},body:f});
      if(!r.ok)throw Error('上传失败 '+(await r.text()).slice(0,120));
      await rpc('thesis_file_add',{p_code:code,p_task_id:id,p_name:f.name,p_path:path,p_by:name});
      toast('已上传');load();
    }catch(e){toast(e.message)}
  });
}

function renderOwner(){
  const el=$('#owner');
  if(!session){
    el.innerHTML=`<div class="panel"><h2>学生本人登录</h2><p class="meta">用主 App 同一个账号（Supabase）登录，凭据只存在本机。</p>
      <div class="form"><input id="oEmail" placeholder="邮箱" type="email"><input id="oPass" placeholder="密码" type="password"><button class="primary" id="oLogin">登录</button></div></div>`;
    $('#oLogin').onclick=async()=>{
      const email=$('#oEmail').value.trim(),pass=$('#oPass').value;
      try{
        const r=await fetch(config.url+'/auth/v1/token?grant_type=password',{method:'POST',headers:H(),body:JSON.stringify({email,password:pass})});
        const d=await r.json();
        if(!r.ok)throw Error(d.error_description||d.msg||'登录失败');
        session=d;localStorage.setItem('thesis-session',JSON.stringify(d));renderOwner();
      }catch(e){toast(e.message)}
    };
    return;
  }
  el.innerHTML=`<div class="panel"><h2>我的分享码</h2><p class="meta">${esc(session.user.email)}</p>
    <div class="form"><input id="advName" placeholder="导师称呼（可空）"><button class="primary" id="newCode">生成分享码</button><button id="oOut">退出</button></div>
    <div id="codes"><p class="meta">加载中…</p></div></div>`;
  $('#oOut').onclick=()=>{session=null;localStorage.removeItem('thesis-session');renderOwner()};
  $('#newCode').onclick=async()=>{
    const c='THESIS-'+Math.random().toString(36).slice(2,6).toUpperCase();
    try{
      const r=await fetch(config.url+'/rest/v1/thesis_share',{method:'POST',headers:{...H(),Authorization:'Bearer '+session.access_token,Prefer:'return=representation'},body:JSON.stringify({code:c,advisor:$('#advName').value.trim()||null,owner_id:session.user.id})});
      if(!r.ok)throw Error((await r.text()).slice(0,160));
      toast('已生成 '+c);loadCodes();
    }catch(e){toast(e.message)}
  };
  loadCodes();
}

async function loadCodes(){
  if(!session)return;
  const r=await fetch(config.url+'/rest/v1/thesis_share?select=*&owner_id=eq.'+session.user.id+'&order=created_at.desc',{headers:{...H(),Authorization:'Bearer '+session.access_token}});
  const list=await r.json();
  const box=$('#codes');
  if(!Array.isArray(list)){box.innerHTML='<p class="meta">读取失败</p>';return}
  box.innerHTML=list.map(s=>{
    const link=location.origin+location.pathname+'?code='+encodeURIComponent(s.code);
    return `<div class="codebox"><b>${esc(s.code)}</b> ${s.revoked?'<span class="tag">已停用</span>':''}<p class="meta">${esc(s.advisor||'未命名导师')} · 创建 ${esc((s.created_at||'').slice(0,10))}</p>
      <p class="meta">导师链接：<a href="${link}">${esc(link)}</a></p>
      <button class="primary" data-enter="${esc(s.code)}">进入</button><button class="primary" data-enter="${esc(s.code)}">进入论文</button><button data-copy="${esc(link)}">复制链接</button>${s.revoked?'':`<button data-revoke="${esc(s.id)}">停用</button>`}<button class="danger" data-delcode="${esc(s.id)}">删除</button></div>`;
  }).join('')||'<p class="meta">还没有分享码</p>';
  document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>{navigator.clipboard.writeText(b.getAttribute('data-copy'));toast('链接已复制')});
  document.querySelectorAll('[data-enter]').forEach(b=>b.onclick=async()=>{code=b.getAttribute('data-enter');localStorage.setItem('thesis-code',code);await load()});
  document.querySelectorAll('[data-enter]').forEach(b=>b.onclick=()=>{code=b.getAttribute('data-enter');localStorage.setItem('thesis-code',code);load()});
  document.querySelectorAll('[data-delcode]').forEach(b=>b.onclick=async()=>{
    if(!confirm('彻底删除这个分享码？它下面的阶段、评语、文件和上传的文档都会一起删掉，无法恢复。'))return;
    try{await rpc('thesis_share_delete',{p_id:b.getAttribute('data-delcode')});toast('已删除');loadCodes()}catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-revoke]').forEach(b=>b.onclick=async()=>{
    const r=await fetch(config.url+'/rest/v1/thesis_share?id=eq.'+b.getAttribute('data-revoke'),{method:'PATCH',headers:{...H(),Authorization:'Bearer '+session.access_token},body:JSON.stringify({revoked:true})});
    if(r.ok){toast('已停用');loadCodes()}else toast('操作失败');
  });
}

if(!config.url||!config.key){document.getElementById('app').innerHTML='<div class="panel">还没有配置 Supabase（app/config.js）</div>'}else{load()}
window.addEventListener('hashchange',()=>{});

/* ===== 阶段流程：双方确认才进入下一阶段 ===== */
const STAGES=[
 {id:'s1',t:'选题确认',d:'确定研究对象、创新点与题目表述',eta:'2 周',out:'选题说明（1 页）+ 3 个备选题目',acc:'导师在平台点“导师确认”，你点“我方确认”',items:['确定研究对象：黄晶果果浆/皮渣','写清创新点（新基质+首组数据）','拟 2–3 个题目备选','导师确认方向']},
 {id:'s2',t:'文献与引用',d:'核心文献清单 + 引用格式统一',eta:'3 周',out:'文献表（10 篇）+ 引用格式规范',acc:'文献覆盖近 5 年 ≥60%，格式全文统一',items:['精读 10 篇核心文献','整理文献表（作者/年份/结论/可借鉴点）','确定引用格式（学校/期刊）','导师确认文献清单']},
 {id:'s3',t:'方法与指标',d:'工艺参数、检测指标与方法确认',eta:'2 周',out:'技术路线图 + 指标方法表（含标准号）',acc:'每个指标都有方法、仪器、取样点',items:['确定工艺组合与水平','确定检测指标（分层/沉淀/持水力/黏度/粒径）','确定方法标准号','导师确认方案']},
 {id:'s4',t:'设备与材料',d:'设备可约、试剂耗材到位',eta:'2 周',out:'设备清单 + 采购清单 + 排期表',acc:'关键设备已预约，试剂到货周期可控',items:['设备预约确认','试剂耗材采购清单','果实采购与贮存方案','导师确认开工条件']},
 {id:'s5',t:'开题报告',d:'初稿→导师修改→定稿提交',eta:'4 周',out:'开题报告全文 + 汇报 PPT',acc:'导师完整读过 2 轮并同意提交',items:['初稿完成','导师批注回复','定稿提交学院','开题答辩通过']},
 {id:'s6',t:'预实验',d:'参数摸底与鲜/冻浆对比',eta:'4 周',out:'预实验数据表 + 修正后的正式方案',acc:'关键参数范围确定，异常已排查',items:['完成预实验','数据整理','导师看数据','确定正式方案']},
 {id:'s7',t:'正式实验',d:'3–4 轮重复 + 贮藏取样',eta:'8 周',out:'原始数据表（每轮每处理）',acc:'重复数够、缺失值有记录、可复现',items:['正式实验完成','取样与检测完成','原始数据归档','导师确认数据完整']},
 {id:'s8',t:'数据与统计',d:'统计、作图、结论',eta:'3 周',out:'统计结果表 + 全套图',acc:'显著性标注正确、图能直接进论文',items:['ANOVA 与显著性','图表定稿','结论与讨论框架','导师确认']},
 {id:'s9',t:'本科论文',d:'按模板成稿、查重',eta:'4 周',out:'本科论文定稿 + 查重报告',acc:'查重达标、导师签字',items:['初稿','修改稿','查重通过','导师签字']},
 {id:'s10',t:'英文稿',d:'SCI 稿件与投稿材料',eta:'4 周',out:'英文稿 + Cover letter + Highlights',acc:'导师定稿、语言润色完成',items:['Methods/Results','Intro/Discussion','润色','导师定稿']},
 {id:'s11',t:'投稿',d:'主投 JFMC；首投不晚于 2027-10-31',eta:'1 周',out:'投稿回执 + 稿号',acc:'系统显示 submitted',items:['选定期刊','Cover letter','完成投稿','导师知悉']},
 {id:'s12',t:'返修与接收',d:'回复审稿意见，拿到录用',eta:'2–3 个月',out:'回复信 + 录用证明',acc:'收到 accept',items:['逐条回复','补实验（如需）','接收','录用证明']}
];
function stageMap(){const m={};((data&&data.stages)||[]).forEach(s=>m[s.stage_id]=s);return m}
function stageDone(sm,id){const s=sm[id];return !!(s&&s.owner_ok&&s.advisor_ok)}
function unlocked(sm,i){for(let k=0;k<i;k++){if(!stageDone(sm,STAGES[k].id))return false}return true}
function checksOf(sm,id){const s=sm[id];return (s&&s.checks)||{}}

async function stageSet(stageId,checks,owner,advisor){
  await rpc('thesis_stage_set',{p_code:code,p_stage:stageId,p_checks:checks,p_owner:owner,p_advisor:advisor});
  await load();
}

render = function(){
  const app=$('#app');
  if(!code||!data){
    app.innerHTML=`<div class="panel"><h2>输入导师分享码</h2><p class="meta">由学生本人提供，形如 THESIS-7K2M</p>
      <form id="codeForm"><input id="codeInput" placeholder="THESIS-XXXX" value="${esc(code)}"><button class="primary">打开</button></form>
      ${session?'<p class="meta" style="margin-top:12px">学生本人？<a href="#" id="ownerLink">生成 / 管理分享码</a></p>':''}</div><div id="owner"></div>`;
    $('#codeForm').onsubmit=e=>{e.preventDefault();code=$('#codeInput').value.trim().toUpperCase();load()};
    const ol=$('#ownerLink');if(ol)ol.onclick=e=>{e.preventDefault();renderOwner()};
    return;
  }
  const sm=stageMap(), total=STAGES.length;
  const doneN=STAGES.filter(s=>stageDone(sm,s.id)).length;
  const pct=Math.round(doneN/total*100);
  const cur=STAGES.findIndex((s,i)=>unlocked(sm,i)&&!stageDone(sm,s.id));
  const cm=data.comments||[];
  app.innerHTML=`
  <div class="panel"><div class="topline"><div><h2>论文进度</h2><p class="meta">导师：${esc(data.advisor||'未命名')} · 分享码 ${esc(code)}</p></div><div class="pct">${pct}%</div></div>
  <div class="bar"><i style="width:${pct}%"></i></div>
  <p class="meta">${doneN} / ${total} 阶段已双方确认 · 每个阶段两边都确认后，才进入下一阶段</p>
  <div class="row-actions"><button id="refresh">刷新</button>${session?'<a href="#" id="switch">换分享码</a>':''}</div></div>
  ${STAGES.map((st,i)=>{
    const s=sm[st.id]||{}, ck=checksOf(sm,st.id);
    const lock=!unlocked(sm,i);
    const both=stageDone(sm,st.id);
    const one=(s.owner_ok||s.advisor_ok)&&!both;
    const cls=both?'done':lock?'locked':(i===cur?'now':'');
    const badge=both?'<span class="sb done">已确认</span>':one?'<span class="sb wait">待对方确认</span>':lock?'<span class="sb lock">未解锁</span>':'<span class="sb now">进行中</span>';
    const scm=cm.filter(c=>c.task_id===st.id);
    return `<div class="stage ${cls}">
      <div class="sh"><span class="idx">${i+1}</span><div class="st"><b>${esc(st.t)}</b><div class="meta">${esc(st.d)} · 预计 ${esc(st.eta||'')}</div></div>${badge}</div>
      ${lock?'<p class="meta">上一阶段双方确认后解锁。</p>':`
      <ul class="cl">${st.items.map((it,j)=>{
        const c=ck[j]||{};const done=typeof c==='boolean'?c:!!c.done;const txt=(c&&c.text)||it;const note=(c&&c.note)||'';
        const ed=openEdits.has(st.id+':'+j);
        const edited=!!(c&&c.text&&c.text!==it);
        return `<li class="cli"><label><input type="checkbox" data-st="${st.id}" data-j="${j}" ${done?'checked':''}> ${edited?`<s class="orig">${esc(it)}</s> <span class="newtxt">${esc(c.text)}</span>`:`<span>${esc(it)}</span>`}</label>${edited?'<span class="edtag">已改</span>':''}<button class="mini" data-ed="${st.id}:${j}">修改/批注</button>
          ${note?`<div class="note">📝 ${esc(note)}</div>`:''}
          ${(c&&c.history&&c.history.length)?`<div class="hist">${c.history.map(h=>`<div>${esc(h.by)} ${esc((h.at||'').slice(5,10))} 把「${esc(h.from)}」改成「${esc(h.to)}」</div>`).join('')}</div>`:''}
          ${ed?`<div class="editbox"><p class="meta" style="margin:0">原文：${esc(it)}</p><input data-et="${st.id}:${j}" value="${esc((c&&c.text)||'')}" placeholder="填写修改后的内容（留空则保留原文）"><textarea data-en="${st.id}:${j}" placeholder="批注：为什么改/有什么疑问">${esc(note)}</textarea><button class="primary" data-es="${st.id}:${j}">保存</button><button class="link" data-ec="${st.id}:${j}">取消</button></div>`:''}
        </li>`;
      }).join('')}</ul>
      <p class="meta">交付物：${esc(st.out||'')}<br>验收标准：${esc(st.acc||'')}</p>
      <div class="sf">
        <button class="${s.owner_ok?'primary':''}" data-sok="${st.id}:owner">${s.owner_ok?'✓ 我方已确认':'我方确认'}</button>
        <button class="${s.advisor_ok?'primary':''}" data-sok="${st.id}:advisor">${s.advisor_ok?'✓ 对方已确认':'对方确认'}</button>
        <button class="link" data-scmt="${st.id}">评语 (${scm.length})</button>
      </div>
      ${openComments.has(st.id)?`<div class="sub">${scm.map(c=>`<div class="cmt"><b>${esc(c.author)}</b> <span class="meta">${esc((c.created_at||'').slice(0,16).replace('T',' '))}</span><p>${esc(c.body)}</p></div>`).join('')||'<p class="meta">还没有评语</p>'}
        <div class="form"><textarea data-body="${st.id}" placeholder="对这一步的评语…"></textarea><button class="primary" data-send="${st.id}">发送</button></div>${(data.files||[]).filter(f=>f.task_id===st.id).map(f=>`<p><a href="${config.url}/storage/v1/object/public/thesis-files/${encodeURI(f.path)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a></p>`).join('')}<label class="upload">上传文件<input type="file" data-sup="${st.id}" hidden></label></div>`:''}
      `}
    </div>`;
  }).join('')}
  <div class="panel"><h2>留言板</h2>${cm.filter(c=>!c.task_id).map(c=>`<div class="cmt"><b>${esc(c.author)}</b> <span class="meta">${esc((c.created_at||'').slice(0,16).replace('T',' '))}</span><p>${esc(c.body)}</p></div>`).join('')||'<p class="meta">还没有留言</p>'}
    <div class="form"><textarea id="gbBody" placeholder="给对方的留言…"></textarea><button id="gbSend" class="primary">发送</button></div></div>`;
  $('#refresh').onclick=()=>load();
  const sw=$('#switch');if(sw)sw.onclick=e=>{e.preventDefault();code='';data=null;localStorage.removeItem('thesis-code');render()};
  $('#gbSend').onclick=async()=>{
    const body=$('#gbBody').value.trim();
    if(!body)return;
    try{await rpc('thesis_comment_add',{p_code:code,p_task_id:null,p_author:authorName(),p_body:body});$('#gbBody').value='';load()}catch(e){toast(e.message)}
  };
  document.querySelectorAll('[data-st]').forEach(el=>el.onchange=async()=>{
    const sid=el.dataset.st, j=el.dataset.j;
    const cur2={...(checksOf(stageMap(),sid))};
    const old=cur2[j];const obj=typeof old==='object'&&old?{...old}:{};
    obj.done=el.checked;cur2[j]=obj;
    try{await stageSet(sid,cur2,null,null)}catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-ed]').forEach(el=>el.onclick=()=>{const k=el.getAttribute('data-ed');openEdits.has(k)?openEdits.delete(k):openEdits.add(k);render()});
  document.querySelectorAll('[data-ec]').forEach(el=>el.onclick=()=>{openEdits.delete(el.getAttribute('data-ec'));render()});
  document.querySelectorAll('[data-es]').forEach(el=>el.onclick=async()=>{
    const k=el.getAttribute('data-es');const [sid,j]=k.split(':');
    const txt=document.querySelector(`[data-et="${k}"]`).value.trim();
    const note=document.querySelector(`[data-en="${k}"]`).value.trim();
    const cur2={...(checksOf(stageMap(),sid))};
    const old=cur2[j];const obj=typeof old==='object'&&old?{...old}:{done:!!old};
    const st=STAGES.find(x=>x.id===sid);
    const origText=st?st.items[+j]:'';
    const oldText=(obj.text||'').trim()||origText;
    const newText=txt||origText;
    if(newText!==oldText){
      obj.history=(obj.history||[]).concat([{by:roleName(),at:new Date().toISOString(),from:oldText,to:newText}]).slice(-10);
    }
    obj.text=txt;obj.note=note;cur2[j]=obj;
    try{await stageSet(sid,cur2,null,null);openEdits.delete(k);toast('已保存')}catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-sok]').forEach(el=>el.onclick=async()=>{
    const [sid,who]=el.getAttribute('data-sok').split(':');
    const s=stageMap()[sid]||{};
    try{
      if(who==='owner')await stageSet(sid,s.checks||{},!(s.owner_ok),null);
      else await stageSet(sid,s.checks||{},null,!(s.advisor_ok));
    }catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-scmt]').forEach(el=>el.onclick=()=>{const id=el.getAttribute('data-scmt');openComments.has(id)?openComments.delete(id):openComments.add(id);render()});
  document.querySelectorAll('[data-sup]').forEach(el=>el.onchange=async()=>{
    const id=el.getAttribute('data-sup'),f=el.files[0];if(!f)return;
    if(f.size>10*1024*1024){toast('文件超过 10 MB');return}
    const name=authorName();
    const path=code+'/'+Date.now()+'_'+f.name.replace(/[^\w.\-\u4e00-\u9fa5]/g,'_');
    try{
      const r=await fetch(config.url+'/storage/v1/object/thesis-files/'+encodeURI(path),{method:'POST',headers:{apikey:config.key,Authorization:'Bearer '+config.key,'Content-Type':f.type||'application/octet-stream'},body:f});
      if(!r.ok)throw Error('上传失败 '+(await r.text()).slice(0,120));
      await rpc('thesis_file_add',{p_code:code,p_task_id:id,p_name:f.name,p_path:path,p_by:name});
      toast('已上传');load();
    }catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-send]').forEach(el=>el.onclick=async()=>{
    const id=el.getAttribute('data-send');
    const body=document.querySelector(`[data-body="${id}"]`).value.trim();
    if(!body)return;
    try{await rpc('thesis_comment_add',{p_code:code,p_task_id:id,p_author:authorName(),p_body:body});load()}catch(e){toast(e.message)}
  });
};
(async()=>{ if(session&&!code){ if(await goMyThesis())return } load() })();

/* ===== 页签 / 阶段管理 / AI 导入导出 ===== */
let tab='stage', manage=false, editStage=null;
let role=localStorage.getItem('thesis-role')||'';

function defsOf(){
  const d=(data&&data.defs)||[];
  const src=Array.isArray(d)&&d.length?d:STAGES;
  return src.map((s,i)=>({id:s.id||('c'+(i+1)),t:s.t||s.title||'阶段',d:s.d||s.desc||'',eta:s.eta||'',out:s.out||'',acc:s.acc||'',items:Array.isArray(s.items)?s.items:[]}));
}
async function saveDefs(list){
  await rpc('thesis_def_save',{p_code:code,p_defs:list});
  await load();
}
const INFO_HTML=`<div class="panel"><h2>全流程（可改，改完同步给导师）</h2><ol class="flow">
<li><div class="b"><div class="t">选题与方向</div><div class="m">黄晶果果浆/皮渣加工与品质；读 10 篇核心文献定创新点</div></div></li>
<li><div class="b"><div class="t">文献综述</div><div class="m">3000 字，按“原料—工艺—品质—稳定性”写</div></div></li>
<li><div class="b"><div class="t">开题报告 + 答辩</div><div class="m">背景、目的、内容、方法、进度、预期成果</div></div></li>
<li><div class="b"><div class="t">预实验 → 正式实验</div><div class="m">参数摸底 → 3–4 轮重复</div></div></li>
<li><div class="b"><div class="t">数据 → 本科论文 → 英文稿</div><div class="m">统计作图 → 成稿查重 → SCI 稿件</div></div></li>
<li><div class="b"><div class="t">投稿 → 返修 → 接收</div><div class="m">主投 JFMC，首投不晚于 2027-10-31，目标 2028-02 前接收</div></div></li>
</ol></div>
<div class="panel"><h2>投稿策略</h2><table class="jt">
<tr><th>梯队</th><th>期刊</th><th>说明</th></tr>
<tr><td class="tier">主投</td><td>JFMC</td><td>数据完整、英文过关；订阅制零 APC</td></tr>
<tr><td class="tier">有条件首选</td><td>Food Bioscience</td><td>只有机制数据够才先投</td></tr>
<tr><td class="tier">备选</td><td>JSFA / JFS / IJFST</td><td>被拒或太慢时按序降级</td></tr>
<tr><td class="tier">保底</td><td>中文核心</td><td>必须 2028-02 前录用时启用</td></tr>
</table></div>`;

function stageCard(st,i,sm){
  const s=sm[st.id]||{}, ck=(s.checks||{}), lock=!unlockedById(sm,i,defsOf()), both=!!(s.owner_ok&&s.advisor_ok);
  const one=(s.owner_ok||s.advisor_ok)&&!both;
  const cls=both?'done':lock?'locked':'now';
  const badge=both?'<span class="sb done">已确认</span>':one?'<span class="sb wait">待对方确认</span>':lock?'<span class="sb lock">未解锁</span>':'<span class="sb now">进行中</span>';
  const scm=(data.comments||[]).filter(c=>c.task_id===st.id);
  const items=(st.items||[]).map((it,j)=>{
    const c=ck[j]||{};const done=typeof c==='boolean'?c:!!c.done;const edited=!!(c&&c.text&&c.text!==it);
    return `<li class="cli"><label><input type="checkbox" data-st="${st.id}" data-j="${j}" ${done?'checked':''}> ${edited?`<s class="orig">${esc(it)}</s> <span class="newtxt">${esc(c.text)}</span>`:`<span>${esc(it)}</span>`}</label>
      ${edited?'<span class="edtag">已改</span>':''}<button class="mini" data-ed="${st.id}:${j}">修改/批注</button>
      ${c&&c.note?`<div class="note">📝 ${esc(c.note)}</div>`:''}
      ${(c&&c.history&&c.history.length)?`<div class="hist">${c.history.map(h=>`<div>${esc(h.by)} ${esc((h.at||'').slice(5,10))} 把「${esc(h.from)}」改成「${esc(h.to)}」</div>`).join('')}</div>`:''}
      ${openEdits.has(st.id+':'+j)?`<div class="editbox"><p class="meta" style="margin:0">原文：${esc(it)}</p><input data-et="${st.id}:${j}" value="${esc((c&&c.text)||'')}" placeholder="修改后的内容（留空=原文）"><textarea data-en="${st.id}:${j}" placeholder="批注">${esc((c&&c.note)||'')}</textarea><button class="primary" data-es="${st.id}:${j}">保存</button><button class="link" data-ec="${st.id}:${j}">取消</button></div>`:''}
    </li>`;
  }).join('');
  return `<div class="stage ${cls}">
    <div class="sh"><span class="idx">${i+1}</span><div class="st"><b>${esc(st.t)}</b><div class="meta">${esc(st.d)}${st.eta?' · 预计 '+esc(st.eta):''}</div></div>${badge}
    ${manage?`<div class="sop"><button data-seup="${st.id}">↑</button><button data-sedn="${st.id}">↓</button><button class="danger" data-sedel="${st.id}">删</button></div>`:''}</div>
    ${lock&&!manage?'<p class="meta">上一阶段双方确认后解锁。</p>':`<ul class="cl">${items}</ul>
    <p class="meta">交付物：${esc(st.out||'—')}<br>验收：${esc(st.acc||'—')}</p>
    <div class="sf"><button class="${s.owner_ok?'primary':''}" data-sok="${st.id}:owner">${s.owner_ok?'✓ ':''}学生确认</button>
      <button class="${s.advisor_ok?'primary':''}" data-sok="${st.id}:advisor">${s.advisor_ok?'✓ ':''}导师确认</button>
      <button class="link" data-scmt="${st.id}">评语 (${scm.length})</button></div>
    ${openComments.has(st.id)?`<div class="sub">${scm.map(c=>`<div class="cmt"><b>${esc(c.author)}</b> <span class="meta">${esc((c.created_at||'').slice(0,16).replace('T',' '))}</span><p>${esc(c.body)}</p></div>`).join('')||'<p class="meta">还没有评语</p>'}
      <div class="form"><textarea data-body="${st.id}" placeholder="对这一步的评语…"></textarea><button class="primary" data-send="${st.id}">发送</button></div>
      ${(data.files||[]).filter(f=>f.task_id===st.id).map(f=>`<p><a href="${config.url}/storage/v1/object/public/thesis-files/${encodeURI(f.path)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a></p>`).join('')}
      <label class="upload">上传文件<input type="file" data-sup="${st.id}" hidden></label></div>`:''}`}
  </div>`;
}
function unlockedById(sm,i,defs){for(let k=0;k<i;k++){const s=sm[defs[k].id];if(!(s&&s.owner_ok&&s.advisor_ok))return false}return true}

function stageModal(st){
  const isNew=!st;
  const s=st||{id:'c'+Date.now(),t:'',d:'',eta:'',out:'',acc:'',items:[]};
  const box=document.createElement('div');box.className='modal';
  box.innerHTML=`<div class="box"><h3>${isNew?'新增阶段':'编辑阶段'}</h3>
    <label>阶段名称</label><input id="mT" value="${esc(s.t)}">
    <label>一句话说明</label><input id="mD" value="${esc(s.d)}">
    <label>预计时长</label><input id="mE" value="${esc(s.eta||'')}" placeholder="如 2 周">
    <label>交付物</label><input id="mO" value="${esc(s.out||'')}">
    <label>验收标准</label><input id="mA" value="${esc(s.acc||'')}">
    <label>清单（一行一条）</label><textarea id="mI">${esc((s.items||[]).join('\n'))}</textarea>
    <div class="acts"><button id="mOk" class="primary">保存</button><button id="mNo">取消</button></div></div>`;
  document.body.appendChild(box);
  box.querySelector('#mNo').onclick=()=>box.remove();
  box.querySelector('#mOk').onclick=async()=>{
    const defs=defsOf();
    const item=defs.find(x=>x.id===s.id);
    const obj={id:s.id,t:box.querySelector('#mT').value.trim()||'未命名阶段',d:box.querySelector('#mD').value.trim(),
      eta:box.querySelector('#mE').value.trim(),out:box.querySelector('#mO').value.trim(),acc:box.querySelector('#mA').value.trim(),
      items:box.querySelector('#mI').value.split('\n').map(x=>x.trim()).filter(Boolean)};
    if(item)Object.assign(item,obj);else defs.push(obj);
    box.remove();
    try{await saveDefs(defs);toast('已保存阶段')}catch(e){toast(e.message)}
  };
}

render = function(){
  const app=$('#app');
  if(!code||!data){
    app.innerHTML=`<div class="panel"><h2>输入导师分享码</h2><p class="meta">由学生本人提供，形如 THESIS-7K2M</p>
      <form id="codeForm"><input id="codeInput" placeholder="THESIS-XXXX" value="${esc(code)}"><button class="primary">打开</button></form>
      ${session?'<p class="meta" style="margin-top:12px">学生本人？<a href="#" id="ownerLink">生成 / 管理分享码</a></p>':''}</div><div id="owner"></div>`;
    $('#codeForm').onsubmit=e=>{e.preventDefault();code=$('#codeInput').value.trim().toUpperCase();load()};
    const ol=$('#ownerLink');if(ol)ol.onclick=e=>{e.preventDefault();renderOwner()};
    return;
  }
  if(!role){
    app.innerHTML=`<div class="panel"><h2>你是谁？</h2><p class="meta">选择身份后，页面文案会跟着变；可以随时在顶部切换。</p>
      <div class="row-actions" style="flex-direction:column">
        <button class="primary" data-role="owner" style="width:100%">我是学生（论文作者本人）</button>
        <button data-role="advisor" style="width:100%;margin-top:8px">我是导师（查看并确认）</button>
      </div>
      <p class="meta" style="margin-top:12px">学生需要登录：<a href="#" id="toLogin">学生登录 / 注册</a></p></div>`;
    document.querySelectorAll('[data-role]').forEach(b=>b.onclick=()=>{role=b.getAttribute('data-role');localStorage.setItem('thesis-role',role);render()});
    const tl2=$('#toLogin');if(tl2)tl2.onclick=e=>{e.preventDefault();code='';data=null;localStorage.removeItem('thesis-code');render();setTimeout(()=>{const b2=document.getElementById('owner');if(b2)b2.scrollIntoView({block:'center'})},60)};
    return;
  }
  const sm=stageMap(), defs=defsOf(), total=defs.length;
  const doneN=defs.filter(s=>stageDone(sm,s.id)).length, pct=total?Math.round(doneN/total*100):0;
  const tabs=[['stage','阶段'],['files','文件'],['msg','留言'],['ai','AI 助手'],['info','说明']];
  let body='';
  const loginPanel=false?`<div class="panel"><h2>学生登录</h2><p class="meta">登录后才能生成分享码、管理阶段。</p>
    <div class="form"><input id="qEmail" placeholder="邮箱" type="email"><input id="qPass" placeholder="密码" type="password"><button class="primary" id="qLogin">登录</button><button id="qSignup">注册</button></div></div>`:'';
  if(tab==='stage'){
    body=`${loginPanel}<div class="panel"><div class="topline"><div><h2>论文进度</h2><p class="meta">导师：${esc(data.advisor||'未命名')} · 分享码 ${esc(code)}</p></div><div class="pct">${pct}%</div></div>
      <div class="bar"><i style="width:${pct}%"></i></div><p class="meta">${doneN}/${total} 阶段双方确认 · 都确认后进入下一阶段</p>
      <div class="manage">${isOwner?`<button id="mgBtn">${manage?'完成管理':'管理阶段'}</button><button id="addStage">＋ 新增阶段</button>`:''}<button id="refresh">刷新</button></div></div>
      ${defs.map((st,i)=>stageCard(st,i,sm)).join('')}`;
  } else if(tab==='files'){
    const fs=(data.files||[]);
    body=`<div class="panel"><h2>全部文件 · ${fs.length}</h2>${fs.length?fs.map(f=>`<p><a href="${config.url}/storage/v1/object/public/thesis-files/${encodeURI(f.path)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a> <span class="meta">${esc(f.uploaded_by||'')} · ${esc((f.created_at||'').slice(0,10))}</span></p>`).join(''):'<p class="meta">还没有文件。到某个阶段里点“上传文件”。</p>'}</div>`;
  } else if(tab==='msg'){
    const cm=(data.comments||[]).filter(c=>!c.task_id);
    body=`<div class="panel"><h2>留言板</h2>${cm.map(c=>`<div class="cmt"><b>${esc(c.author)}</b> <span class="meta">${esc((c.created_at||'').slice(0,16).replace('T',' '))}</span><p>${esc(c.body)}</p></div>`).join('')||'<p class="meta">还没有留言</p>'}
      <div class="form"><textarea id="gbBody" placeholder="给对方的留言…"></textarea><button id="gbSend" class="primary">发送</button></div></div>`;
  } else if(tab==='ai'){
    body=`<div class="panel"><h2>AI 助手</h2>
      <p class="meta">用途：把阶段/清单/评语导出给 AI，让 AI 帮你改写成更清楚的表述，再把结果粘回来一键更新。<br>不需要 API key，不产生额外费用。</p>
      <div class="row-actions"><button id="aiCopy" class="primary">复制当前状态</button><button id="aiPaste">导入 AI 结果</button></div>
      <textarea id="aiBox" class="aiarea" placeholder="点“复制当前状态”，把内容发给 AI；或把 AI 返回的 JSON 粘到这里再点“导入 AI 结果”"></textarea>
      <p class="meta">支持的格式：{"type":"thesis-update","stages":[{...}],"comments":[{"stage_id":"s1","body":"..."}],"items":[{"stage_id":"s1","index":0,"text":"新表述","note":"批注"}]}</p></div>`;
  } else {
    body=INFO_HTML;
  }
  app.innerHTML=`<div class="tabs">${tabs.map(([k,n])=>`<button class="${tab===k?'on':''}" data-tab="${k}">${n}</button>`).join('')}</div>${body}${tPicker()}`;

  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.getAttribute('data-tab');render()});
  const mc=$('#myCodes');if(mc)mc.onclick=e=>{e.preventDefault();code='';data=null;localStorage.removeItem('thesis-code');renderOwner()};
  const ql=$('#qLogin');if(ql)ql.onclick=()=>doAuth(false);
  const qs=$('#qSignup');if(qs)qs.onclick=()=>doAuth(true);
  const rf=$('#refresh');if(rf)rf.onclick=()=>load();
  const mg=$('#mgBtn');if(mg)mg.onclick=()=>{manage=!manage;render()};
  const ad=$('#addStage');if(ad)ad.onclick=()=>stageModal(null);
  document.querySelectorAll('[data-seup],[data-sedn],[data-sedel]').forEach(b=>b.onclick=async()=>{
    const defs=defsOf();const id=b.getAttribute('data-seup')||b.getAttribute('data-sedn')||b.getAttribute('data-sedel');
    const i=defs.findIndex(x=>x.id===id);if(i<0)return;
    if(b.hasAttribute('data-sedel')){
      if(!confirm('删除阶段「'+defs[i].t+'」？'))return;defs.splice(i,1);
    } else {
      const j=b.hasAttribute('data-seup')?i-1:i+1;if(j<0||j>=defs.length)return;
      const tmp=defs[i];defs[i]=defs[j];defs[j]=tmp;
    }
    try{await saveDefs(defs);toast('已更新')}catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-st]').forEach(el=>el.onchange=async()=>{
    const sid=el.dataset.st,j=el.dataset.j;const cur2={...(checksOf(stageMap(),sid))};
    const old=cur2[j];const obj=typeof old==='object'&&old?{...old}:{};obj.done=el.checked;cur2[j]=obj;
    try{await stageSet(sid,cur2,null,null)}catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-ed]').forEach(el=>el.onclick=()=>{const k=el.getAttribute('data-ed');openEdits.has(k)?openEdits.delete(k):openEdits.add(k);render()});
  document.querySelectorAll('[data-ec]').forEach(el=>el.onclick=()=>{openEdits.delete(el.getAttribute('data-ec'));render()});
  document.querySelectorAll('[data-es]').forEach(el=>el.onclick=async()=>{
    const k=el.getAttribute('data-es');const [sid,j]=k.split(':');
    const txt=document.querySelector(`[data-et="${k}"]`).value.trim();
    const note=document.querySelector(`[data-en="${k}"]`).value.trim();
    const cur2={...(checksOf(stageMap(),sid))},old=cur2[j];
    const obj=typeof old==='object'&&old?{...old}:{done:!!old};
    const st=defsOf().find(x=>x.id===sid);
    const orig=st?(st.items[+j]||''):'';
    const oldText=(obj.text||'').trim()||orig,newText=txt||orig;
    if(newText!==oldText)obj.history=(obj.history||[]).concat([{by:roleName(),at:new Date().toISOString(),from:oldText,to:newText}]).slice(-10);
    obj.text=txt;obj.note=note;cur2[j]=obj;
    try{await stageSet(sid,cur2,null,null);openEdits.delete(k);toast('已保存')}catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-sok]').forEach(el=>el.onclick=async()=>{
    const [sid,who]=el.getAttribute('data-sok').split(':');const s=stageMap()[sid]||{};
    try{ if(who==='owner')await stageSet(sid,s.checks||{},!(s.owner_ok),null); else await stageSet(sid,s.checks||{},null,!(s.advisor_ok)); }catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-scmt]').forEach(el=>el.onclick=()=>{const id=el.getAttribute('data-scmt');openComments.has(id)?openComments.delete(id):openComments.add(id);render()});
  document.querySelectorAll('[data-send]').forEach(el=>el.onclick=async()=>{
    const id=el.getAttribute('data-send');const body=document.querySelector(`[data-body="${id}"]`).value.trim();
    if(!body)return;try{await rpc('thesis_comment_add',{p_code:code,p_task_id:id,p_author:authorName(),p_body:body});load()}catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-sup]').forEach(el=>el.onchange=async()=>{
    const id=el.getAttribute('data-sup'),f=el.files[0];if(!f)return;
    if(f.size>10*1024*1024){toast('文件超过 10 MB');return}
    const name=authorName();
    const path=code+'/'+Date.now()+'_'+f.name.replace(/[^\w.\-\u4e00-\u9fa5]/g,'_');
    try{
      const r=await fetch(config.url+'/storage/v1/object/thesis-files/'+encodeURI(path),{method:'POST',headers:{apikey:config.key,Authorization:'Bearer '+config.key,'Content-Type':f.type||'application/octet-stream'},body:f});
      if(!r.ok)throw Error('上传失败 '+(await r.text()).slice(0,120));
      await rpc('thesis_file_add',{p_code:code,p_task_id:id,p_name:f.name,p_path:path,p_by:name});toast('已上传');load();
    }catch(e){toast(e.message)}
  });
  const gs=$('#gbSend');if(gs)gs.onclick=async()=>{
    const b=$('#gbBody').value.trim();if(!b)return;
    try{await rpc('thesis_comment_add',{p_code:code,p_task_id:null,p_author:authorName(),p_body:b});$('#gbBody').value='';load()}catch(e){toast(e.message)}
  };
  const ac=$('#aiCopy');if(ac)ac.onclick=()=>{
    const sm2=stageMap();
    const payload={type:'thesis-state',advisor:data.advisor,stages:defsOf().map(s=>({id:s.id,title:s.t,items:s.items,checks:sm2[s.id]?.checks||{},owner_ok:!!sm2[s.id]?.owner_ok,advisor_ok:!!sm2[s.id]?.advisor_ok})),
      comments:(data.comments||[]).map(c=>({stage_id:c.task_id,author:c.author,body:c.body}))};
    const txt='请以论文导师的视角，把下面 JSON 里的阶段名/清单/交付物写得更具体、可执行。只输出 thesis-update 格式的 JSON：\n'+JSON.stringify(payload,null,1);
    $('#aiBox').value=txt;
    try{navigator.clipboard.writeText(txt);toast('已复制，发给 AI 即可')}catch(e){toast('已生成，手动复制')}
  };
  const ap2=$('#aiPaste');if(ap2)ap2.onclick=async()=>{
    try{
      const raw=$('#aiBox').value.replace(/^[\s\S]*?(\{)/,'$1');
      const o=JSON.parse(raw);
      if(o.type!=='thesis-update')throw Error('不是 thesis-update');
      if(Array.isArray(o.stages)&&o.stages.length){
        const defs=defsOf();
        o.stages.forEach(ns=>{
          const i=defs.findIndex(x=>x.id===ns.id);
          const obj={id:ns.id,t:ns.title||ns.t||'阶段',d:ns.desc||ns.d||'',eta:ns.eta||'',out:ns.out||'',acc:ns.acc||'',items:ns.items||[]};
          if(i>=0)defs[i]={...defs[i],...obj};else defs.push(obj);
        });
        await saveDefs(defs);
      }
      if(Array.isArray(o.items)){
        for(const it of o.items){
          const cur2={...(checksOf(stageMap(),it.stage_id))};
          const old=cur2[it.index];const obj=typeof old==='object'&&old?{...old}:{done:!!old};
          if(it.text)obj.text=it.text;if(it.note)obj.note=it.note;
          cur2[it.index]=obj;
          await rpc('thesis_stage_set',{p_code:code,p_stage:it.stage_id,p_checks:cur2,p_owner:null,p_advisor:null});
        }
      }
      if(Array.isArray(o.comments))for(const c of o.comments){await rpc('thesis_comment_add',{p_code:code,p_task_id:c.stage_id||null,p_author:authorName(),p_body:c.body})}
      toast('已导入');await load();
    }catch(e){toast('导入失败：'+e.message)}
  };
};
load();

/* ===== 主题色 ===== */
const TTHEMES=[['玫瑰','#b43b70','#f9e9ef'],['天蓝','#2f6fb3','#e8f1fb'],['青绿','#1f7a52','#e6f6ee'],['葡萄','#6b4bb8','#f0ebfb'],['焦糖','#b8621f','#fbeee2'],['墨黑','#2f3337','#eef0f2']];
function tApply(){
  let i=Number(localStorage.getItem('theme')||0);if(!TTHEMES[i])i=0;
  document.documentElement.style.setProperty('--pink',TTHEMES[i][1]);
  document.documentElement.style.setProperty('--soft',TTHEMES[i][2]);
}
function tPicker(){
  const cur=Number(localStorage.getItem('theme')||0);
  return `<div class="theme-bar"><span class="meta">主题色</span>${TTHEMES.map((t,i)=>`<button class="sw ${i===cur?'on':''}" data-ttheme="${i}" title="${t[0]}" style="background:${t[1]}"></button>`).join('')}</div>`;
}
document.addEventListener('click',e=>{
  const b=e.target.closest&&e.target.closest('[data-ttheme]');
  if(!b)return;e.preventDefault();e.stopImmediatePropagation();
  localStorage.setItem('theme',b.getAttribute('data-ttheme'));
  tApply();render();
},true);
tApply();

/* ===== 单页版：不分子页面，全部折叠在同一个页面 ===== */
render = function(){
  const app=$('#app');
  if(!code||!data){
    if(session){app.innerHTML='<div id="owner"></div>';renderOwner();return}
    app.innerHTML=`<div class="panel"><h2>输入导师分享码</h2><p class="meta">形如 THESIS-7K2M</p>
      <form id="codeForm"><input id="codeInput" placeholder="THESIS-XXXX" value="${esc(code)}"><button class="primary">打开</button></form>
      <p class="meta" style="margin-top:10px">学生登录 / 注册：<a href="#" id="ownerLink">点这里</a></p></div><div id="owner"></div>`;
    $('#codeForm').onsubmit=e=>{e.preventDefault();code=$('#codeInput').value.trim().toUpperCase();load()};
    const ol=$('#ownerLink');if(ol)ol.onclick=e=>{e.preventDefault();renderOwner()};
    return;
  }
  const isOwner=!!session;
  const sm=stageMap(), defs=defsOf(), total=defs.length;
  const doneN=defs.filter(s=>stageDone(sm,s.id)).length, pct=total?Math.round(doneN/total*100):0;
  const cm=(data.comments||[]).filter(c=>!c.task_id), fs=(data.files||[]);
  const loginPanel=false?`<div class="panel"><h2>学生登录</h2><p class="meta">登录后才能生成分享码、管理阶段。</p>
    <div class="form"><input id="qEmail" placeholder="邮箱" type="email"><input id="qPass" placeholder="密码" type="password"><button class="primary" id="qLogin">登录</button><button id="qSignup">注册</button></div></div>`:'';
  app.innerHTML=`${loginPanel}
  <div class="panel">
    <div class="rolebar"><span class="rolebadge ${isOwner?'owner':'advisor'}">${isOwner?'学生端':'导师端'}</span><span class="meta">${isOwner?'学生（已登录）':'导师（查看与确认，未登录）'}</span>${isOwner?'<a href="#" id="myCodes" class="link">我的分享码</a>':''}</div>
    <div class="topline"><div><h2>论文进度</h2><p class="meta">导师：${esc(data.advisor||'未命名')} · 分享码 ${esc(code)}</p></div><div class="pct">${pct}%</div></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <p class="meta">${doneN}/${total} 阶段双方确认 · 都确认后进入下一阶段</p>
    <div class="manage">${isOwner?`<button id="mgBtn">${manage?'完成管理':'管理阶段'}</button><button id="addStage">＋ 新增阶段</button>`:''}<button id="refresh">刷新</button></div>
  </div>
  <div id="stages-grid">${defs.map((st,i)=>stageCard(st,i,sm)).join('')}</div>
  <details class="panel"><summary>文件 · ${fs.length}</summary>
    ${fs.length?fs.map(f=>`<p><a href="${config.url}/storage/v1/object/public/thesis-files/${encodeURI(f.path)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a> <span class="meta">${esc(f.uploaded_by||'')} · ${esc((f.created_at||'').slice(0,10))}</span></p>`).join(''):'<p class="meta">还没有文件；到阶段里上传。</p>'}</details>
  <details class="panel"><summary>留言板 · ${cm.length}</summary>
    ${cm.map(c=>`<div class="cmt"><b>${esc(c.author)}</b> <span class="meta">${esc((c.created_at||'').slice(0,16).replace('T',' '))}</span><p>${esc(c.body)}</p></div>`).join('')||'<p class="meta">还没有留言</p>'}
    <div class="form"><textarea id="gbBody" placeholder="给对方的留言…"></textarea><button id="gbSend" class="primary">发送</button></div></details>
  <details class="panel"><summary>AI 助手</summary>
    <p class="meta">复制状态发给 AI → 粘回 JSON → 一键更新阶段/清单/批注。不接 API，不产生费用。</p>
    <div class="row-actions"><button id="aiCopy" class="primary">复制当前状态</button><button id="aiPaste">导入 AI 结果</button></div>
    <textarea id="aiBox" class="aiarea" placeholder="AI 返回的 thesis-update JSON"></textarea></details>
  <details class="panel"><summary>说明（流程 / 投稿策略）</summary>${INFO_HTML}</details>
  ${tPicker()}`;

  const ql=$('#qLogin');if(ql)ql.onclick=()=>doAuth(false);
  const qs=$('#qSignup');if(qs)qs.onclick=()=>doAuth(true);
  const rf=$('#refresh');if(rf)rf.onclick=()=>load();
  const mg=$('#mgBtn');if(mg)mg.onclick=()=>{manage=!manage;render()};
  const ad=$('#addStage');if(ad)ad.onclick=()=>stageModal(null);
  document.querySelectorAll('[data-seup],[data-sedn],[data-sedel]').forEach(b=>b.onclick=async()=>{
    const defs2=defsOf();const id=b.getAttribute('data-seup')||b.getAttribute('data-sedn')||b.getAttribute('data-sedel');
    const i=defs2.findIndex(x=>x.id===id);if(i<0)return;
    if(b.hasAttribute('data-sedel')){if(!confirm('删除阶段？'))return;defs2.splice(i,1)}
    else{const j=b.hasAttribute('data-seup')?i-1:i+1;if(j<0||j>=defs2.length)return;[defs2[i],defs2[j]]=[defs2[j],defs2[i]]}
    try{await saveDefs(defs2);toast('已更新')}catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-st]').forEach(el=>el.onchange=async()=>{
    const sid=el.dataset.st,j=el.dataset.j;const cur2={...(checksOf(stageMap(),sid))};
    const old=cur2[j];const obj=typeof old==='object'&&old?{...old}:{};obj.done=el.checked;cur2[j]=obj;
    try{await stageSet(sid,cur2,null,null)}catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-ed]').forEach(el=>el.onclick=()=>{const k=el.getAttribute('data-ed');openEdits.has(k)?openEdits.delete(k):openEdits.add(k);render()});
  document.querySelectorAll('[data-ec]').forEach(el=>el.onclick=()=>{openEdits.delete(el.getAttribute('data-ec'));render()});
  document.querySelectorAll('[data-es]').forEach(el=>el.onclick=async()=>{
    const k=el.getAttribute('data-es');const [sid,j]=k.split(':');
    const txt=document.querySelector(`[data-et="${k}"]`).value.trim();
    const note=document.querySelector(`[data-en="${k}"]`).value.trim();
    const cur2={...(checksOf(stageMap(),sid))},old=cur2[j];
    const obj=typeof old==='object'&&old?{...old}:{done:!!old};
    const st2=defsOf().find(x=>x.id===sid);const orig=st2?(st2.items[+j]||''):'';
    const oldText=(obj.text||'').trim()||orig,newText=txt||orig;
    if(newText!==oldText)obj.history=(obj.history||[]).concat([{by:roleName(),at:new Date().toISOString(),from:oldText,to:newText}]).slice(-10);
    obj.text=txt;obj.note=note;cur2[j]=obj;
    try{await stageSet(sid,cur2,null,null);openEdits.delete(k);toast('已保存')}catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-sok]').forEach(el=>el.onclick=async()=>{
    const [sid,who]=el.getAttribute('data-sok').split(':');const s=stageMap()[sid]||{};
    try{ if(who==='owner')await stageSet(sid,s.checks||{},!(s.owner_ok),null); else await stageSet(sid,s.checks||{},null,!(s.advisor_ok)); }catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-scmt]').forEach(el=>el.onclick=()=>{const id=el.getAttribute('data-scmt');openComments.has(id)?openComments.delete(id):openComments.add(id);render()});
  document.querySelectorAll('[data-send]').forEach(el=>el.onclick=async()=>{
    const id=el.getAttribute('data-send');const body=document.querySelector(`[data-body="${id}"]`).value.trim();
    if(!body)return;try{await rpc('thesis_comment_add',{p_code:code,p_task_id:id,p_author:authorName(),p_body:body});load()}catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-sup]').forEach(el=>el.onchange=async()=>{
    const id=el.getAttribute('data-sup'),f=el.files[0];if(!f)return;
    if(f.size>10*1024*1024){toast('文件超过 10 MB');return}
    const name=authorName();const path=code+'/'+Date.now()+'_'+f.name.replace(/[^\w.\-\u4e00-\u9fa5]/g,'_');
    try{
      const r=await fetch(config.url+'/storage/v1/object/thesis-files/'+encodeURI(path),{method:'POST',headers:{apikey:config.key,Authorization:'Bearer '+config.key,'Content-Type':f.type||'application/octet-stream'},body:f});
      if(!r.ok)throw Error('上传失败');
      await rpc('thesis_file_add',{p_code:code,p_task_id:id,p_name:f.name,p_path:path,p_by:name});toast('已上传');load();
    }catch(e){toast(e.message)}
  });
  const gs=$('#gbSend');if(gs)gs.onclick=async()=>{
    const b=$('#gbBody').value.trim();if(!b)return;
    try{await rpc('thesis_comment_add',{p_code:code,p_task_id:null,p_author:authorName(),p_body:b});$('#gbBody').value='';load()}catch(e){toast(e.message)}
  };
  const ac=$('#aiCopy');if(ac)ac.onclick=()=>{
    const sm2=stageMap();
    const payload={type:'thesis-state',stages:defsOf().map(s=>({id:s.id,title:s.t,items:s.items,checks:sm2[s.id]?.checks||{}}))};
    const txt='请把下面 JSON 的阶段/清单/交付物写得更具体可执行，只输出 thesis-update JSON：\n'+JSON.stringify(payload,null,1);
    $('#aiBox').value=txt;try{navigator.clipboard.writeText(txt);toast('已复制')}catch(e){toast('已生成，手动复制')}
  };
  const ap2=$('#aiPaste');if(ap2)ap2.onclick=async()=>{
    try{
      const raw=$('#aiBox').value.replace(/^[\s\S]*?(\{)/,'$1');const o=JSON.parse(raw);
      if(Array.isArray(o.stages)&&o.stages.length){
        const dd=defsOf();o.stages.forEach(ns=>{const i=dd.findIndex(x=>x.id===ns.id);
          const obj={id:ns.id,t:ns.title||ns.t,d:ns.d||'',eta:ns.eta||'',out:ns.out||'',acc:ns.acc||'',items:ns.items||[]};
          if(i>=0)dd[i]={...dd[i],...obj};else dd.push(obj)});
        await saveDefs(dd);
      }
      if(Array.isArray(o.items))for(const it of o.items){
        const cur2={...(checksOf(stageMap(),it.stage_id))};const old=cur2[it.index];
        const obj=typeof old==='object'&&old?{...old}:{done:!!old};
        if(it.text)obj.text=it.text;if(it.note)obj.note=it.note;cur2[it.index]=obj;
        await rpc('thesis_stage_set',{p_code:code,p_stage:it.stage_id,p_checks:cur2,p_owner:null,p_advisor:null});
      }
      toast('已导入');await load();
    }catch(e){toast('导入失败：'+e.message)}
  };
};
load();
