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
  document.querySelectorAll('[data-send]').forEach(el=>el.onclick=async()=>{
    const id=el.getAttribute('data-send');
    const name=document.querySelector(`[data-name="${id}"]`).value.trim()||'匿名';
    const body=document.querySelector(`[data-body="${id}"]`).value.trim();
    if(!body)return;localStorage.setItem('thesis-name',name);
    try{await rpc('thesis_comment_add',{p_code:code,p_task_id:id,p_author:name,p_body:body});load()}catch(e){toast(e.message)}
  });
  document.querySelectorAll('[data-up]').forEach(el=>el.onchange=async()=>{
    const id=el.getAttribute('data-up'),f=el.files[0];if(!f)return;
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
