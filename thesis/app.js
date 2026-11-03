import {config} from '../app/config.js';

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const H=()=>({apikey:config.key,'Content-Type':'application/json'});
let code=new URLSearchParams(location.search).get('code')||localStorage.getItem('thesis-code')||'';
let data=null, session=JSON.parse(localStorage.getItem('thesis-session')||'null');
let openComments=new Set(), filter='todo';

async function rpc(name,body){const r=await fetch(config.url+'/rest/v1/rpc/'+name,{method:'POST',headers:H(),body:JSON.stringify(body||{})});const t=await r.text();let d=null;try{d=JSON.parse(t)}catch(e){d=t}if(!r.ok)throw Error((d&&(d.message||d.error))||t||r.status);return d}
function toast(s){const t=$('#toast');t.textContent=s;t.style.display='block';clearTimeout(toast.h);toast.h=setTimeout(()=>t.style.display='none',4000)}

async function load(){
  if(!code){render();return}
  try{
    data=await rpc('thesis_view',{p_code:code});
    if(!data.ok){data=null;localStorage.removeItem('thesis-code');toast('分享码无效或已停用');render();return}
    localStorage.setItem('thesis-code',code);
    render();
  }catch(e){toast('加载失败：'+e.message);render()}
}

function render(){
  const app=$('#app');
  if(!code||!data){
    app.innerHTML=`<div class="panel"><h2>输入导师分享码</h2><p class="meta">由学生本人提供，形如 THESIS-7K2M</p>
      <form id="codeForm"><input id="codeInput" placeholder="THESIS-XXXX" value="${esc(code)}"><button class="primary">打开</button></form>
      <p class="meta" style="margin-top:12px">学生本人？<a href="#" id="ownerLink">生成 / 管理分享码</a></p></div>
      <div id="owner"></div>`;
    $('#codeForm').onsubmit=e=>{e.preventDefault();code=$('#codeInput').value.trim().toUpperCase();load()};
    $('#ownerLink').onclick=e=>{e.preventDefault();renderOwner()};
    return;
  }
  const ts=data.tasks||[], doneN=ts.filter(t=>t.done).length, pct=ts.length?Math.round(doneN/ts.length*100):0;
  const shown=filter==='todo'?ts.filter(t=>!t.done):ts;
  const cm=data.comments||[], files=data.files||[];
  app.innerHTML=`<div class="panel"><div class="topline"><div><h2>论文进度</h2><p class="meta">导师：${esc(data.advisor||'未命名')} · 分享码 ${esc(code)}</p></div><div class="pct">${pct}%</div></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <p class="meta">${doneN} / ${ts.length} 步完成 · 双方都可以勾选</p>
    <div class="row-actions"><button id="fTodo" class="${filter==='todo'?'primary':''}">未完成</button><button id="fAll" class="${filter==='all'?'primary':''}">全部</button><button id="refresh">刷新</button><a href="#" id="switch">换分享码</a></div></div>
    <div class="panel"><h2>任务清单</h2>${shown.map(t=>taskHtml(t,cm,files)).join('')||'<p class="meta">没有任务</p>'}</div>
    <div class="panel"><h2>留言板</h2>${cm.filter(c=>!c.task_id).map(c=>`<div class="cmt"><b>${esc(c.author)}</b> <span class="meta">${esc((c.created_at||'').slice(0,16).replace('T',' '))}</span><p>${esc(c.body)}</p></div>`).join('')||'<p class="meta">还没有留言</p>'}
      <div class="form"><input id="gbName" placeholder="你的名字" value="${esc(localStorage.getItem('thesis-name')||'')}"><textarea id="gbBody" placeholder="给对方的留言…"></textarea><button id="gbSend" class="primary">发送</button></div></div>`;
  $('#fTodo').onclick=()=>{filter='todo';render()};
  $('#fAll').onclick=()=>{filter='all';render()};
  $('#refresh').onclick=load;
  $('#switch').onclick=e=>{e.preventDefault();code='';data=null;localStorage.removeItem('thesis-code');render()};
  $('#gbSend').onclick=async()=>{
    const name=$('#gbName').value.trim()||'匿名',body=$('#gbBody').value.trim();
    if(!body)return;localStorage.setItem('thesis-name',name);
    try{await rpc('thesis_comment_add',{p_code:code,p_task_id:null,p_author:name,p_body:body});$('#gbBody').value='';load()}catch(e){toast(e.message)}
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
    if(f.size>20*1024*1024){toast('文件超过 20 MB');return}
    const name=localStorage.getItem('thesis-name')||'匿名';
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
    const name=document.querySelector(`[data-name="${id}"]`).value.trim()||'匿名';
    const body=document.querySelector(`[data-body="${id}"]`).value.trim();
    if(!body)return;localStorage.setItem('thesis-name',name);
    try{await rpc('thesis_comment_add',{p_code:code,p_task_id:id,p_author:name,p_body:body});load()}catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-up]').forEach(el=>el.onchange=async()=>{
    const id=el.getAttribute('data-up'),f=el.files[0];if(!f)return;if(f.size>20*1024*1024){toast('文件超过 20 MB，请压缩后再传');return;}
    const name=localStorage.getItem('thesis-name')||'匿名';
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
      <button data-copy="${esc(link)}">复制链接</button>${s.revoked?'':`<button data-revoke="${esc(s.id)}">停用</button>`}</div>`;
  }).join('')||'<p class="meta">还没有分享码</p>';
  document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>{navigator.clipboard.writeText(b.getAttribute('data-copy'));toast('链接已复制')});
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
      <p class="meta" style="margin-top:12px">学生本人？<a href="#" id="ownerLink">生成 / 管理分享码</a></p></div><div id="owner"></div>`;
    $('#codeForm').onsubmit=e=>{e.preventDefault();code=$('#codeInput').value.trim().toUpperCase();load()};
    $('#ownerLink').onclick=e=>{e.preventDefault();renderOwner()};
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
  <div class="row-actions"><button id="refresh">刷新</button><a href="#" id="switch">换分享码</a></div></div>
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
      <ul class="cl">${st.items.map((it,j)=>`<li><label><input type="checkbox" data-st="${st.id}" data-j="${j}" ${ck[j]?'checked':''}> ${esc(it)}</label></li>`).join('')}</ul>
      <p class="meta">交付物：${esc(st.out||'')}<br>验收标准：${esc(st.acc||'')}</p>
      <div class="sf">
        <button class="${s.owner_ok?'primary':''}" data-sok="${st.id}:owner">${s.owner_ok?'✓ 我方已确认':'我方确认'}</button>
        <button class="${s.advisor_ok?'primary':''}" data-sok="${st.id}:advisor">${s.advisor_ok?'✓ 导师已确认':'导师确认'}</button>
        <button class="link" data-scmt="${st.id}">评语 (${scm.length})</button>
      </div>
      ${openComments.has(st.id)?`<div class="sub">${scm.map(c=>`<div class="cmt"><b>${esc(c.author)}</b> <span class="meta">${esc((c.created_at||'').slice(0,16).replace('T',' '))}</span><p>${esc(c.body)}</p></div>`).join('')||'<p class="meta">还没有评语</p>'}
        <div class="form"><input data-name="${st.id}" placeholder="你的名字" value="${esc(localStorage.getItem('thesis-name')||'')}"><textarea data-body="${st.id}" placeholder="对这一步的评语…"></textarea><button class="primary" data-send="${st.id}">发送</button></div>${(data.files||[]).filter(f=>f.task_id===st.id).map(f=>`<p><a href="${config.url}/storage/v1/object/public/thesis-files/${encodeURI(f.path)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a></p>`).join('')}<label class="upload">上传文件<input type="file" data-sup="${st.id}" hidden></label></div>`:''}
      `}
    </div>`;
  }).join('')}
  <div class="panel"><h2>留言板</h2>${cm.filter(c=>!c.task_id).map(c=>`<div class="cmt"><b>${esc(c.author)}</b> <span class="meta">${esc((c.created_at||'').slice(0,16).replace('T',' '))}</span><p>${esc(c.body)}</p></div>`).join('')||'<p class="meta">还没有留言</p>'}
    <div class="form"><input id="gbName" placeholder="你的名字" value="${esc(localStorage.getItem('thesis-name')||'')}"><textarea id="gbBody" placeholder="给对方的留言…"></textarea><button id="gbSend" class="primary">发送</button></div></div>`;
  $('#refresh').onclick=()=>load();
  $('#switch').onclick=e=>{e.preventDefault();code='';data=null;localStorage.removeItem('thesis-code');render()};
  $('#gbSend').onclick=async()=>{
    const name=$('#gbName').value.trim()||'匿名',body=$('#gbBody').value.trim();
    if(!body)return;localStorage.setItem('thesis-name',name);
    try{await rpc('thesis_comment_add',{p_code:code,p_task_id:null,p_author:name,p_body:body});$('#gbBody').value='';load()}catch(e){toast(e.message)}
  };
  document.querySelectorAll('[data-st]').forEach(el=>el.onchange=async()=>{
    const sid=el.dataset.st, j=el.dataset.j;
    const cur2={...(checksOf(stageMap(),sid))};
    cur2[j]=el.checked;
    try{await stageSet(sid,cur2,null,null)}catch(e){toast(e.message)}
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
    if(f.size>20*1024*1024){toast('文件超过 20 MB');return}
    const name=localStorage.getItem('thesis-name')||'匿名';
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
    const name=document.querySelector(`[data-name="${id}"]`).value.trim()||'匿名';
    const body=document.querySelector(`[data-body="${id}"]`).value.trim();
    if(!body)return;localStorage.setItem('thesis-name',name);
    try{await rpc('thesis_comment_add',{p_code:code,p_task_id:id,p_author:name,p_body:body});load()}catch(e){toast(e.message)}
  });
};
load();
