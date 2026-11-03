/* thesis/app.js — 学生—导师论文协作平台（单页，无框架）
 * 铁律：每个 renderXxx 只定义一次；不要在文件末尾追加同名函数覆盖。
 * 身份只由「URL 是否带 ?code」+「是否有 session」实时计算，不持久化 role。
 */
import { config } from '../app/config.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SKEY = 'thesis-session';
const TKEY = 'thesis-theme';
const THEMES = [['rose', '玫', '#b43b70'], ['blue', '蓝', '#3b7dd8'], ['cyan', '青', '#2f8f8a'], ['purple', '紫', '#7a5cd6'], ['orange', '橙', '#d9782f'], ['ink', '墨', '#4a4a55']];
const todayStr = () => new Date().toLocaleDateString('sv-SE');
const mmdd = s => String(s || '').slice(5, 10) || String(s || '');

/* ── 状态 ────────────────────────────────────────────────────── */
let session = JSON.parse(localStorage.getItem(SKEY) || 'null');
let urlCode = new URLSearchParams(location.search).get('code') || '';
let code = urlCode;
let data = null, loading = false, manage = false;
let openEdits = new Set(), openComments = new Set(), myCodes = [], panel = '';

/* 身份：导师端优先（URL 带 code），其次看有没有登录 */
const role = () => urlCode ? 'advisor' : (session ? 'student' : 'guest');
const isStudent = () => role() === 'student';
const isAdvisor = () => role() === 'advisor';
const author = () => isAdvisor() ? '导师' : ((session?.user?.email || '').split('@')[0] || '学生');

/* ── 主题 ────────────────────────────────────────────────────── */
const themeKey = () => { const k = localStorage.getItem(TKEY); return THEMES.some(t => t[0] === k) ? k : 'rose'; };
function applyTheme(k) { document.documentElement.dataset.theme = THEMES.some(t => t[0] === k) ? k : 'rose'; }
function setTheme(k) { localStorage.setItem(TKEY, k); applyTheme(k); render(); }

/* ── 提示 / 弹窗 ─────────────────────────────────────────────── */
function toast(m) {
  const t = $('#toast'); if (!t) return;
  t.textContent = m; t.style.display = 'block';
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.style.display = 'none'; }, 4200);
}
function openModal(html) {
  closeModal();
  const d = document.createElement('div');
  d.className = 'modal';
  d.innerHTML = `<div class="box">${html}</div>`;
  d.addEventListener('click', e => { if (e.target === d) closeModal(); });
  document.body.appendChild(d);
  return d;
}
function closeModal() { document.querySelectorAll('.modal').forEach(m => m.remove()); }

/* ── 网络 ────────────────────────────────────────────────────── */
async function api(path, opt = {}) {
  const h = { 'Content-Type': 'application/json', apikey: config.key };
  h.Authorization = 'Bearer ' + (opt.anon ? config.key : ((session && session.access_token) || config.key));
  const r = await fetch(config.url + path, {
    method: opt.method || 'GET',
    headers: h,
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  });
  const text = await r.text();
  let d = null; try { d = text ? JSON.parse(text) : null; } catch { d = text; }
  if (!r.ok) throw Error((d && (d.message || d.error_description || d.msg || d.error)) || text || r.status);
  return d;
}
const rpc = (n, b) => api('/rest/v1/rpc/' + n, { method: 'POST', body: b || {} });
const reload = () => code ? openCode(code) : render();

/* ── 账号 ────────────────────────────────────────────────────── */
async function doAuth(email, pass, signup) {
  email = String(email || '').trim(); pass = String(pass || '');
  if (!email || !pass) { toast('请填写邮箱和密码'); return false; }
  try {
    const d = await api('/auth/v1/' + (signup ? 'signup' : 'token?grant_type=password'), { method: 'POST', anon: true, body: { email, password: pass } });
    if (!d.access_token) { toast('注册成功，请先点邮箱里的确认链接，再回来登录'); return false; }
    session = d;
    localStorage.setItem(SKEY, JSON.stringify(d));
    /* 登录后统一回到学生端：丢掉 URL 上的 ?code，否则会被锁在导师端 */
    urlCode = ''; code = ''; data = null; manage = false; panel = '';
    openEdits.clear(); openComments.clear();
    history.replaceState(null, '', location.pathname);
    await loadCodes();
    closeModal();
    render();
    toast('已登录，进入学生端');
    return true;
  } catch (e) { toast(e.message); return false; }
}
function auth(signup) { return doAuth($('#aEmail')?.value, $('#aPass')?.value, signup); }
/* 登录窗口：入口页用内嵌表单，导师端用这个弹窗（导师本人想切回学生端时用） */
function loginModal() {
  openModal(`<h3>学生登录</h3>
    <p class="meta">登录后进入学生端，管理邀请码和阶段。导师不需要登录，直接用邀请链接打开就行。</p>
    <label>邮箱</label><input id="mEmail" type="email" autocomplete="username" placeholder="you@example.com">
    <label>密码</label><input id="mPass" type="password" autocomplete="current-password" placeholder="至少 6 位">
    <div class="acts"><button class="primary" id="mLogin">登录</button><button id="mSignup">注册</button></div>
    <div class="acts"><button id="mCancel">取消</button></div>`);
  $('#mLogin').onclick = () => doAuth($('#mEmail').value, $('#mPass').value, false);
  $('#mSignup').onclick = () => doAuth($('#mEmail').value, $('#mPass').value, true);
  $('#mCancel').onclick = closeModal;
}
function logout() {
  session = null;
  localStorage.removeItem(SKEY);
  openEdits.clear(); openComments.clear(); manage = false; panel = '';
  if (!urlCode) { code = ''; } else { code = urlCode; }
  data = null; myCodes = [];
  render();
}

/* ── 邀请码 ──────────────────────────────────────────────────── */
async function loadCodes() {
  if (!session) { myCodes = []; return; }
  try {
    myCodes = await api('/rest/v1/thesis_share?select=*&owner_id=eq.' + session.user.id + '&order=created_at.desc') || [];
  } catch { myCodes = []; }
}
async function createCode() {
  if (!session) { toast('请先登录'); return; }
  const adv = ($('#advName') || {}).value?.trim() || '';
  const c = 'THESIS-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  try {
    await api('/rest/v1/thesis_share', { method: 'POST', body: { code: c, advisor: adv || null, owner_id: session.user.id } });
    await loadCodes(); render(); toast('已生成 ' + c);
  } catch (e) { toast(e.message); }
}
async function revokeCode(id) {
  if (!confirm('停用这个邀请码？导师链接会立即失效，记录保留。')) return;
  try { await api('/rest/v1/thesis_share?id=eq.' + id, { method: 'PATCH', body: { revoked: true } }); await loadCodes(); render(); toast('已停用'); }
  catch (e) { toast(e.message); }
}
async function deleteCode(id) {
  if (!confirm('彻底删除这个邀请码？连它的阶段进度、评语、文件记录和上传的文件都会删除，无法恢复。')) return;
  try { await rpc('thesis_share_delete', { p_id: id }); await loadCodes(); render(); toast('已删除'); }
  catch (e) { toast(e.message); }
}
const advisorLink = c => location.origin + location.pathname + '?code=' + encodeURIComponent(c);
async function copyText(v) {
  try { await navigator.clipboard.writeText(v); toast('已复制导师链接'); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = v; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已复制导师链接'); } catch { toast('复制失败，请手动选中链接'); }
    ta.remove();
  }
}

/* ── 打开某个邀请码 ──────────────────────────────────────────── */
async function openCode(c) {
  if (!c) return;
  code = c; data = null; loading = true; render();
  try {
    const d = await rpc('thesis_view', { p_code: c });
    if (!d || !d.ok) throw Error((d && d.error) || '邀请码无效或已停用');
    data = d; loading = false; render();
  } catch (e) { loading = false; data = null; toast(e.message); render(); }
}
function goBack() {
  code = ''; data = null; urlCode = '';
  history.replaceState(null, '', location.pathname);
  render();
}

/* ── 阶段定义 ────────────────────────────────────────────────── */
const DEFAULT_STAGES = [
  { t: '选题确认', d: '确定研究对象、创新点与题目', items: ['确定研究对象', '写清创新点', '拟 2–3 个题目', '导师确认'], eta: '1 周', deliver: '选题说明（1 页）', accept: '导师同意题目' },
  { t: '文献与引用', d: '核心文献与引用格式', items: ['精读 10 篇', '整理文献表', '确定引用格式', '导师确认'], eta: '2 周', deliver: '文献表 + 引用格式说明', accept: '导师认可文献覆盖度' },
  { t: '方法与指标', d: '工艺与检测方法', items: ['确定工艺路线', '确定检测指标', '确定测定方法', '导师确认'], eta: '1–2 周', deliver: '方法与指标清单', accept: '指标可测、方法可复现' },
  { t: '设备与材料', d: '设备与耗材到位', items: ['设备预约', '采购清单', '原料方案', '导师确认'], eta: '1 周', deliver: '设备与采购清单', accept: '设备和原料到位' },
  { t: '开题报告', d: '初稿到定稿', items: ['写初稿', '按意见修改', '提交学院', '开题答辩通过'], eta: '3–4 周', deliver: '开题报告 + 答辩 PPT', accept: '开题答辩通过' },
  { t: '预实验', d: '参数摸底', items: ['完成预实验', '数据整理', '导师看数据', '确定正式方案'], eta: '2 周', deliver: '预实验数据表', accept: '关键参数范围确定' },
  { t: '正式实验', d: '重复与取样', items: ['实验完成', '取样检测', '数据归档', '导师确认'], eta: '6–8 周', deliver: '原始记录 + 数据表', accept: '三次平行、数据完整' },
  { t: '数据与统计', d: '统计与作图', items: ['统计分析', '图表定稿', '结论框架', '导师确认'], eta: '2 周', deliver: '图表 + 统计说明', accept: '统计方法正确、图可直接用' },
  { t: '本科论文', d: '成稿查重', items: ['写初稿', '按意见修改', '查重', '导师签字'], eta: '4 周', deliver: '本科论文定稿', accept: '查重达标、导师签字' },
  { t: '英文稿', d: 'SCI 稿件', items: ['方法与结果', '引言与讨论', '语言润色', '导师定稿'], eta: '4 周', deliver: '英文稿', accept: '方法结果可复现、语言达标' },
  { t: '投稿', d: '主投 JFMC', items: ['选刊', 'Cover letter', '在线投稿', '导师知悉'], eta: '2 周', deliver: '投稿回执', accept: '成功提交' },
  { t: '返修与接收', d: '回复与录用', items: ['逐条回复', '补实验', '接收', '录用证明'], eta: '视期刊', deliver: '回复信 + 修订稿', accept: '审稿意见逐条回应' },
];

function defs() {
  const raw = (data && data.defs) || [];
  const norm = (s, i) => ({
    id: s.id || ('c' + i),
    t: s.t || s.title || '阶段',
    d: s.d || s.desc || '',
    items: Array.isArray(s.items) ? s.items.map(x => (typeof x === 'string' ? x : (x && x.text) || '')) .filter(Boolean) : [],
    eta: s.eta || '',
    deliver: s.deliver || '',
    accept: s.accept || '',
  });
  if (Array.isArray(raw) && raw.length) return raw.map(norm);
  return DEFAULT_STAGES.map((x, i) => ({ ...x, items: x.items.slice(), id: 's' + (i + 1) }));
}
const smap = () => { const m = {}; ((data && data.stages) || []).forEach(s => { m[s.stage_id] = s; }); return m; };
const stageChecks = id => (smap()[id] || {}).checks || {};
const doneOf = (sm, id) => !!(sm[id] && sm[id].owner_ok && sm[id].advisor_ok);
const unlocked = (sm, ds, i) => { for (let k = 0; k < i; k++) if (!doneOf(sm, ds[k].id)) return false; return true; };

function statusOf(st, i, sm, ds) {
  const s = sm[st.id] || {};
  if (s.owner_ok && s.advisor_ok) return { key: 'done', label: '已确认' };
  if (!unlocked(sm, ds, i)) return { key: 'locked', label: '未解锁' };
  if (s.owner_ok || s.advisor_ok) return { key: 'wait', label: '待对方确认' };
  return { key: 'now', label: '进行中' };
}

/* ── 清单条目：勾选 / 修改 / 批注 / 历史 ─────────────────────── */
function normalizeCheck(c) {
  if (c === true) return { done: true };
  if (!c || typeof c !== 'object') return { done: false };
  return { done: !!c.done, text: c.text || '', note: c.note || '', history: Array.isArray(c.history) ? c.history : [] };
}
function compressCheck(o) {
  const out = { done: !!o.done };
  if (o.text) out.text = String(o.text).slice(0, 500);
  if (o.note) out.note = String(o.note).slice(0, 2000);
  if (o.history && o.history.length) out.history = o.history.slice(-10);
  return out;
}

function itemRow(st, item, j, stageState) {
  const key = st.id + ':' + j;
  const c = normalizeCheck((stageState.checks || {})[j]);
  const changed = !!c.text && c.text !== item;
  const editing = openEdits.has(key);
  const hist = (c.history || []).slice(-10).reverse();
  const label = changed
    ? `<span><s class="orig">${esc(item)}</s> <span class="newtxt">${esc(c.text)}</span> <span class="edtag">已改</span></span>`
    : `<span>${esc(item)}</span>`;
  return `<li>
    <div class="cli">
      <label><input type="checkbox" data-st="${esc(st.id)}" data-j="${j}" ${c.done ? 'checked' : ''}> ${label}</label>
      <button class="mini" data-ed="${esc(key)}">${editing ? '收起' : '修改/批注'}</button>
    </div>
    ${c.note ? `<div class="note">📝 ${esc(c.note)}</div>` : ''}
    ${hist.length ? `<div class="hist">${hist.map(h => `${esc(h.by || '')} ${esc(mmdd(h.at))} 把「${esc(h.from || '')}」改成「${esc(h.to || '')}」`).join('<br>')}</div>` : ''}
    ${editing ? `<div class="editbox">
      <div class="origline">原文：<b>${esc(item)}</b></div>
      <input data-et="${esc(key)}" value="${esc(c.text || '')}" placeholder="改后的内容（留空保存 = 恢复原文）">
      <textarea data-en="${esc(key)}" placeholder="批注（会显示在这条下面）">${esc(c.note || '')}</textarea>
      <div class="acts"><button class="primary" data-es="${esc(key)}">保存</button><button data-ec="${esc(key)}">取消</button></div>
    </div>` : ''}
  </li>`;
}

/* ── 评语 ────────────────────────────────────────────────────── */
const kindOf = body => { const m = /^【(.+?)】/.exec(body || ''); return m ? m[1] : ''; };
const kindClass = k => k === '必须改' ? 'must' : k === '疑问' ? 'q' : 'ask';
function commentsFor(taskId) { return ((data && data.comments) || []).filter(c => String(c.task_id || '') === String(taskId || '')); }
function commentHtml(c) {
  const k = kindOf(c.body);
  const body = k ? String(c.body).replace(/^【.+?】/, '') : String(c.body || '');
  return `<div class="cmt ${kindClass(k)}">
    <div class="cmt-head"><b>${esc(c.author || '')}</b><span>${esc((c.created_at || '').replace('T', ' ').slice(0, 16))}</span>${k ? `<span class="kk ${kindClass(k)}">${esc(k)}</span>` : ''}</div>
    <p class="cmt-body">${esc(body)}</p>
  </div>`;
}
const kindSelect = (attr, id) => `<select ${attr}="${esc(id)}"><option>建议</option><option>必须改</option><option>疑问</option></select>`;

/* ── 文件 ────────────────────────────────────────────────────── */
const fileUrl = p => config.url + '/storage/v1/object/public/thesis-files/' + String(p || '').split('/').map(encodeURIComponent).join('/');
function fileItems(taskId) {
  const files = ((data && data.files) || []).filter(f => String(f.task_id || '') === String(taskId || ''));
  if (!files.length) return '';
  return `<div class="files">${files.map(f => `<div class="fitem">
      <a href="${esc(fileUrl(f.path))}" target="_blank" rel="noopener">${esc(f.name)}</a>
      <span class="meta">${esc(f.uploaded_by || '')} · ${esc((f.created_at || '').slice(0, 10))}</span>
    </div>`).join('')}</div>`;
}

/* ── 阶段卡片 ────────────────────────────────────────────────── */
function stageCard(st, i, sm, ds) {
  const s = sm[st.id] || {};
  const stt = statusOf(st, i, sm, ds);
  const locked = stt.key === 'locked';
  const cmtN = commentsFor(st.id).length;
  const manageBtns = isStudent() && manage
    ? `<div class="sop"><button class="mini" data-up="${esc(st.id)}" title="上移">↑</button><button class="mini" data-dn="${esc(st.id)}" title="下移">↓</button><button class="mini" data-editst="${esc(st.id)}">编辑</button><button class="mini danger" data-delst="${esc(st.id)}">删</button></div>`
    : '';
  const metaBits = [
    st.eta ? `预计时长：<b>${esc(st.eta)}</b>` : '',
    st.deliver ? `交付物：<b>${esc(st.deliver)}</b>` : '',
    st.accept ? `验收：<b>${esc(st.accept)}</b>` : '',
  ].filter(Boolean).join('　');
  const confirmBtn = isStudent()
    ? `<button class="${s.owner_ok ? 'okbtn' : ''}" data-ok="${esc(st.id)}:owner">${s.owner_ok ? '✓ 已学生确认（点击撤销）' : '学生确认'}</button>`
    : `<button class="${s.advisor_ok ? 'okbtn' : ''}" data-ok="${esc(st.id)}:advisor">${s.advisor_ok ? '✓ 已导师确认（点击撤销）' : '导师确认'}</button>`;
  return `<article class="stage ${stt.key}" data-stage="${esc(st.id)}">
    <div class="sh">
      <span class="idx">${i + 1}</span>
      <div class="st"><b>${esc(st.t)}</b>${st.d ? `<div class="meta">${esc(st.d)}</div>` : ''}${metaBits ? `<div class="smeta">${metaBits}</div>` : ''}</div>
      <span class="sb ${stt.key === 'done' ? 'done' : stt.key === 'wait' ? 'wait' : stt.key === 'locked' ? 'lock' : 'now'}">${stt.label}</span>
      ${manageBtns}
    </div>
    <div class="gate"><span class="${s.owner_ok ? 'y' : ''}">学生${s.owner_ok ? ' ✓ 已确认' : ' 待确认'}</span><span class="${s.advisor_ok ? 'y' : ''}">导师${s.advisor_ok ? ' ✓ 已确认' : ' 待确认'}</span></div>
    ${locked ? '<p class="meta">上一阶段双方确认后解锁。</p>' : `
      <ul class="cl">${(st.items || []).map((it, j) => itemRow(st, it, j, s)).join('') || '<li class="meta">这个阶段还没有清单条目，学生可在「管理阶段 → 编辑」里补充。</li>'}</ul>
      <div class="sf">
        ${confirmBtn}
        <button class="link" data-cmt="${esc(st.id)}">评语${cmtN ? ' · ' + cmtN : ''}</button>
        <label class="upload">上传文件<input type="file" data-upfile="${esc(st.id)}" hidden></label>
      </div>
      ${openComments.has(st.id) ? `<div class="sub">
        ${commentsFor(st.id).map(commentHtml).join('') || '<p class="meta">还没有评语</p>'}
        <div class="form">
          ${kindSelect('data-kind', st.id)}
          <textarea data-body="${esc(st.id)}" placeholder="给这个阶段写评语…"></textarea>
          <button class="primary" data-send="${esc(st.id)}">发送评语</button>
        </div>
      </div>` : ''}
      ${fileItems(st.id)}`}
  </article>`;
}

/* ── 留言板 ──────────────────────────────────────────────────── */
function boardCard() {
  const list = commentsFor(null);
  return `<details class="panel" id="boardPanel"><summary>留言板 · ${list.length}</summary>
    <div>${list.map(commentHtml).join('') || '<p class="meta">还没有留言</p>'}</div>
    <div class="form">
      ${kindSelect('id', 'bKind')}
      <textarea id="bBody" placeholder="不针对某个阶段的留言…"></textarea>
      <button class="primary" id="bSend">发送留言</button>
    </div>
  </details>`;
}

/* ── 文献库 / 实验记录 / 导出 ────────────────────────────────── */
const refsOf = () => ((data && data.auxx) || {}).refs || [];
const logsOf = () => ((data && data.auxx) || {}).logs || [];
async function saveAux(refs, logs) {
  await rpc('thesis_aux_save', { p_code: code, p_refs: refs, p_logs: logs });
  await reload();
}
function researchPanels() {
  const refs = refsOf(), logs = logsOf();
  return `<details class="panel" id="refPanel"><summary>文献库 · ${refs.length}</summary>
    <div class="form">
      <div class="form-row"><input id="rA" placeholder="作者 / 年份"><input id="rD" placeholder="DOI 或期刊"></div>
      <input id="rT" placeholder="标题">
      <textarea id="rC" placeholder="一句话结论 / 用在哪一节"></textarea>
      <button class="primary" id="rAdd">加入文献库</button>
    </div>
    ${refs.map((r, i) => `<div class="codebox"><b>${esc(r.t || '')}</b>
      <p class="meta">${esc(r.a || '')}${r.d ? ' · ' + esc(r.d) : ''}</p>
      ${r.c ? `<p>${esc(r.c)}</p>` : ''}
      <button class="danger" data-refdel="${i}">删除</button></div>`).join('') || '<p class="meta">还没有文献，学生和导师都可以加。</p>'}
  </details>
  <details class="panel" id="logPanel"><summary>实验记录 · ${logs.length}</summary>
    <div class="form">
      <div class="form-row"><input id="lD" type="date" value="${todayStr()}"><input id="lB" placeholder="批次 / 组别"></div>
      <textarea id="lP" placeholder="参数与条件（温度、时间、转速…）"></textarea>
      <textarea id="lR" placeholder="结果与异常"></textarea>
      <button class="primary" id="lAdd">记一笔</button>
    </div>
    ${logs.map((r, i) => `<div class="codebox"><b>${esc(r.d || '')} ${esc(r.b || '')}</b>
      ${r.p ? `<p class="meta">参数：${esc(r.p)}</p>` : ''}
      ${r.r ? `<p>${esc(r.r)}</p>` : ''}
      <button class="danger" data-logdel="${i}">删除</button></div>`).join('') || '<p class="meta">还没有记录，学生和导师都可以记。</p>'}
  </details>
  <details class="panel"><summary>导出阶段报告</summary>
    <p class="meta">导出 Markdown：每个阶段的清单与勾选、双方确认状态、修改与批注、评语、文献库、实验记录。可直接发给导师或用于中期检查。</p>
    <button class="primary" id="expBtn">导出 .md</button>
  </details>`;
}

function exportReport() {
  const ds = defs(), sm = smap();
  const L = [];
  L.push(`# ${data.advisor || '论文'} 阶段报告`);
  L.push('');
  L.push(`- 邀请码：${code}`);
  if (data.advisor) L.push(`- 导师：${data.advisor}`);
  L.push(`- 生成时间：${new Date().toLocaleString()}`);
  const dn = ds.filter(s => doneOf(sm, s.id)).length;
  L.push(`- 进度：${dn}/${ds.length} 阶段双方确认`);
  L.push('');
  ds.forEach((st, i) => {
    const s = sm[st.id] || {}, ck = s.checks || {};
    L.push(`## ${i + 1}. ${st.t}`);
    L.push('');
    if (st.d) L.push(`- 说明：${st.d}`);
    if (st.eta) L.push(`- 预计时长：${st.eta}`);
    if (st.deliver) L.push(`- 交付物：${st.deliver}`);
    if (st.accept) L.push(`- 验收标准：${st.accept}`);
    L.push(`- 学生确认：${s.owner_ok ? '是' : '否'} · 导师确认：${s.advisor_ok ? '是' : '否'}`);
    L.push('');
    (st.items || []).forEach((it, j) => {
      const c = normalizeCheck(ck[j]);
      const text = c.text && c.text !== it ? `${it} → ${c.text}` : it;
      L.push(`- [${c.done ? 'x' : ' '}] ${text}`);
      if (c.note) L.push(`  - 批注：${c.note}`);
      (c.history || []).forEach(h => L.push(`  - 修改记录：${h.by || ''} ${h.at || ''} 把「${h.from || ''}」改成「${h.to || ''}」`));
    });
    const cmts = commentsFor(st.id);
    if (cmts.length) {
      L.push('');
      L.push('**评语**');
      cmts.forEach(c => L.push(`- ${c.author || ''}（${String(c.created_at || '').replace('T', ' ').slice(0, 16)}）：${c.body}`));
    }
    L.push('');
  });
  const board = commentsFor(null);
  if (board.length) {
    L.push('## 留言板');
    board.forEach(c => L.push(`- ${c.author || ''}（${String(c.created_at || '').replace('T', ' ').slice(0, 16)}）：${c.body}`));
    L.push('');
  }
  const refs = refsOf();
  if (refs.length) {
    L.push('## 文献库');
    refs.forEach(r => L.push(`- ${r.a || ''} ${r.t || ''}${r.d ? '（' + r.d + '）' : ''}${r.c ? '：' + r.c : ''}`));
    L.push('');
  }
  const logs = logsOf();
  if (logs.length) {
    L.push('## 实验记录');
    logs.forEach(r => L.push(`- ${r.d || ''} ${r.b || ''}｜参数：${r.p || ''}｜结果：${r.r || ''}`));
    L.push('');
  }
  const blob = new Blob([L.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '阶段报告-' + todayStr() + '.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  toast('报告已导出');
}

/* ── 页面 ────────────────────────────────────────────────────── */
function landing() {
  return `<div class="panel"><h2>学生登录</h2><p class="meta">登录后直接进入学生端，管理邀请码和阶段，不用再输邀请码。</p>
    <div class="form"><input id="aEmail" placeholder="邮箱" type="email" autocomplete="username">
      <input id="aPass" placeholder="密码" type="password" autocomplete="current-password">
      <button class="primary" id="loginBtn">登录</button><button id="signupBtn">注册</button></div></div>
  <div class="panel"><h2>导师入口</h2><p class="meta">粘贴学生发给你的邀请码，或直接打开邀请链接。</p>
    <div class="form"><input id="cInput" placeholder="THESIS-XXXX" autocapitalize="characters">
      <button class="primary" id="openBtn">进入</button></div></div>`;
}
function bindLanding() {
  $('#loginBtn').onclick = () => auth(false);
  $('#signupBtn').onclick = () => auth(true);
  $('#openBtn').onclick = () => {
    const v = ($('#cInput').value || '').trim().toUpperCase();
    if (!v) { toast('请输入邀请码'); return; }
    urlCode = v;
    history.replaceState(null, '', location.pathname + '?code=' + encodeURIComponent(v));
    openCode(v);
  };
}
function studentHome() {
  return `<div class="panel">
    <div class="rolebar"><span class="rolebadge owner">学生端</span>
      <span class="meta">已登录：${esc(session?.user?.email || '')}</span>
      <span class="spacer"></span><button class="linkbtn" id="logoutBtn">退出登录</button></div>
    <div class="theme-bar"><span class="lab">主题色</span>${THEMES.map(([k, , c]) => `<button class="sw ${themeKey() === k ? 'on' : ''}" data-theme="${k}" style="background:${c}" aria-label="主题${k}"></button>`).join('')}</div>
  </div>
  <div class="panel"><h2>我的邀请码</h2>
    <p class="meta">生成一个发给导师；导师打开链接就是导师端，能看到阶段并勾选、确认、写评语。</p>
    <div class="form"><input id="advName" placeholder="导师称呼（可空）"><button class="primary" id="createBtn">生成邀请码</button></div>
    ${myCodes.length ? myCodes.map(s => `<div class="codebox">
      <div class="tagline"><b>${esc(s.code)}</b>${s.revoked ? '<span class="sb lock">已停用</span>' : '<span class="sb done">可用</span>'}</div>
      <p class="meta">${esc(s.advisor || '未填导师称呼')} · 创建于 ${esc((s.created_at || '').slice(0, 10))}</p>
      <p class="meta">导师链接：<a href="${esc(advisorLink(s.code))}" target="_blank" rel="noopener">${esc(advisorLink(s.code))}</a></p>
      <div class="sf">
        <button class="primary" data-enter="${esc(s.code)}">进入</button>
        <button data-copy="${esc(advisorLink(s.code))}">复制导师链接</button>
        ${s.revoked ? '' : `<button data-revoke="${esc(s.id)}">停用</button>`}
        <button class="danger" data-del="${esc(s.id)}">删除</button>
      </div></div>`).join('') : '<p class="meta">还没有邀请码，先生成一个。</p>'}
  </div>`;
}
function bindStudentHome() {
  $('#logoutBtn').onclick = logout;
  $('#createBtn').onclick = createCode;
  document.querySelectorAll('[data-theme]').forEach(b => { b.onclick = () => setTheme(b.dataset.theme); });
  document.querySelectorAll('[data-enter]').forEach(b => { b.onclick = () => openCode(b.getAttribute('data-enter')); });
  document.querySelectorAll('[data-copy]').forEach(b => { b.onclick = () => copyText(b.getAttribute('data-copy')); });
  document.querySelectorAll('[data-revoke]').forEach(b => { b.onclick = () => revokeCode(b.getAttribute('data-revoke')); });
  document.querySelectorAll('[data-del]').forEach(b => { b.onclick = () => deleteCode(b.getAttribute('data-del')); });
}
function codesPanel() {
  return `<div class="panel"><h2>我的邀请码</h2>
    ${myCodes.map(s => `<div class="codebox"><div class="tagline"><b>${esc(s.code)}</b>${s.revoked ? '<span class="sb lock">已停用</span>' : '<span class="sb done">可用</span>'}</div>
      <p class="meta">导师链接：<a href="${esc(advisorLink(s.code))}" target="_blank" rel="noopener">${esc(advisorLink(s.code))}</a></p>
      <div class="sf"><button data-copy="${esc(advisorLink(s.code))}">复制导师链接</button><button class="primary" data-enter="${esc(s.code)}">进入</button></div></div>`).join('') || '<p class="meta">还没有邀请码</p>'}
  </div>`;
}

function mainView() {
  const ds = defs(), sm = smap(), total = ds.length;
  const dn = ds.filter(s => doneOf(sm, s.id)).length;
  const pct = total ? Math.round(dn / total * 100) : 0;
  const stu = isStudent();
  const allFiles = ((data && data.files) || []).length;
  return `<div class="panel">
    <div class="rolebar">
      <span class="rolebadge ${stu ? 'owner' : 'advisor'}">${stu ? '学生端' : '导师端'}</span>
      <span class="meta">${stu ? '已登录：' + esc(session?.user?.email || '') : '邀请码进入 · 无需登录'}</span>
      <span class="spacer"></span>
      ${stu ? '' : '<button class="linkbtn" id="stuLogin">学生登录</button>'}
      <button class="linkbtn" id="exitBtn">${stu ? '退出登录' : '返回'}</button>
    </div>
    <div class="theme-bar"><span class="lab">主题色</span>${THEMES.map(([k, , c]) => `<button class="sw ${themeKey() === k ? 'on' : ''}" data-theme="${k}" style="background:${c}" aria-label="主题${k}"></button>`).join('')}</div>
  </div>
  <div class="panel">
    <div class="topline"><div><h2>论文进度</h2>
      <p class="meta">邀请码 ${esc(code)}${data.advisor ? ' · ' + esc(data.advisor) : ''}</p></div>
      <div class="pct">${pct}%</div></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <p class="meta">${dn} / ${total} 阶段双方确认 · 上一阶段双方都确认后，下一阶段才解锁</p>
    <div class="manage">
      ${stu ? `<button id="myCodes">我的邀请码</button><button id="mg">${manage ? '完成管理' : '管理阶段'}</button><button id="add">＋ 新增阶段</button>` : ''}
      <button id="rf">刷新</button>
    </div>
  </div>
  ${stu && panel === 'codes' ? codesPanel() : ''}
  <div id="stages-grid">${ds.map((st, i) => stageCard(st, i, sm, ds)).join('')}</div>
  ${boardCard()}
  ${allFiles ? `<details class="panel"><summary>全部文件 · ${allFiles}</summary>
    <div class="files">${((data.files) || []).map(f => {
      const st = ds.find(x => x.id === f.task_id);
      return `<div class="fitem"><a href="${esc(fileUrl(f.path))}" target="_blank" rel="noopener">${esc(f.name)}</a>
        <span class="meta">${st ? esc(st.t) + ' · ' : ''}${esc(f.uploaded_by || '')} · ${esc((f.created_at || '').slice(0, 10))}</span></div>`;
    }).join('')}</div></details>` : ''}
  ${researchPanels()}
  <details class="panel"><summary>怎么用</summary>
    <p class="meta">学生登录后生成邀请码，把“导师链接”发给导师。导师打开链接永远是导师端，即使这台浏览器登录过学生账号。</p>
    <p class="meta">每个阶段要「学生确认」和「导师确认」都完成才算通过，下一阶段才解锁。清单条目两边都能勾选、修改和批注，改动会留下痕迹。</p>
    <p class="meta">文献库和实验记录两边都能加、都能删。导师端右上角有「学生登录」，学生本人用导师链接打开时可以从那里登录切回学生端。</p>
  </details>`;
}

function render() {
  const app = $('#app');
  if (!app) return;
  if (role() === 'guest') { app.innerHTML = landing(); bindLanding(); return; }
  if (!code) { app.innerHTML = studentHome(); bindStudentHome(); return; }
  if (loading) { app.innerHTML = '<div class="panel"><p class="meta">加载中…</p></div>'; return; }
  if (!data) {
    app.innerHTML = `<div class="panel"><p class="meta">打不开这个邀请码：可能链接失效或已被停用。</p>
      <div class="sf"><button id="back">返回</button></div></div>`;
    $('#back').onclick = goBack;
    return;
  }
  app.innerHTML = mainView();
  bindMain();
}

/* ── 阶段编辑弹窗（学生端） ──────────────────────────────────── */
function stageEditor(stage) {
  const isNew = !stage;
  openModal(`<h3>${isNew ? '新增阶段' : '编辑阶段'}</h3>
    <label>名称</label><input id="sT" value="${esc(stage?.t || '')}" placeholder="如：开题报告">
    <label>一句话说明</label><input id="sD" value="${esc(stage?.d || '')}" placeholder="这个阶段要做什么">
    <label>清单（每行一条）</label><textarea id="sI" placeholder="一行一条">${esc((stage?.items || []).join('\n'))}</textarea>
    <label>预计时长</label><input id="sE" value="${esc(stage?.eta || '')}" placeholder="如：2 周">
    <label>交付物</label><input id="sV" value="${esc(stage?.deliver || '')}" placeholder="如：开题报告 + 答辩 PPT">
    <label>验收标准</label><input id="sC" value="${esc(stage?.accept || '')}" placeholder="如：开题答辩通过">
    <div class="acts"><button class="primary" id="sSave">保存</button><button id="sCancel">取消</button></div>`);
  $('#sCancel').onclick = closeModal;
  $('#sSave').onclick = async () => {
    const t = $('#sT').value.trim();
    if (!t) { toast('阶段名称不能为空'); return; }
    const list = defs();
    const next = {
      id: stage?.id || ('c' + Date.now()),
      t,
      d: $('#sD').value.trim(),
      items: $('#sI').value.split('\n').map(x => x.trim()).filter(Boolean),
      eta: $('#sE').value.trim(),
      deliver: $('#sV').value.trim(),
      accept: $('#sC').value.trim(),
    };
    const idx = list.findIndex(x => x.id === next.id);
    if (idx >= 0) list[idx] = next; else list.push(next);
    try { await rpc('thesis_def_save', { p_code: code, p_defs: list }); closeModal(); await reload(); toast('已保存'); }
    catch (e) { toast(e.message); }
  };
}

/* ── 事件绑定 ────────────────────────────────────────────────── */
function bindMain() {
  $('#exitBtn').onclick = () => { if (isStudent()) logout(); else goBack(); };
  $('#rf').onclick = reload;
  const sl = $('#stuLogin'); if (sl) sl.onclick = loginModal;
  document.querySelectorAll('[data-theme]').forEach(b => { b.onclick = () => setTheme(b.dataset.theme); });
  const mc = $('#myCodes'); if (mc) mc.onclick = () => { panel = panel === 'codes' ? '' : 'codes'; render(); };
  const mg = $('#mg'); if (mg) mg.onclick = () => { manage = !manage; render(); };
  const ad = $('#add'); if (ad) ad.onclick = () => stageEditor(null);

  /* 阶段管理 */
  document.querySelectorAll('[data-up],[data-dn]').forEach(b => {
    b.onclick = async () => {
      const list = defs();
      const id = b.getAttribute('data-up') || b.getAttribute('data-dn');
      const i = list.findIndex(x => x.id === id);
      if (i < 0) return;
      const j = b.hasAttribute('data-up') ? i - 1 : i + 1;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      try { await rpc('thesis_def_save', { p_code: code, p_defs: list }); await reload(); } catch (e) { toast(e.message); }
    };
  });
  document.querySelectorAll('[data-editst]').forEach(b => {
    b.onclick = () => { const id = b.getAttribute('data-editst'); stageEditor(defs().find(x => x.id === id)); };
  });
  document.querySelectorAll('[data-delst]').forEach(b => {
    b.onclick = async () => {
      const id = b.getAttribute('data-delst');
      const list = defs();
      const i = list.findIndex(x => x.id === id);
      if (i < 0) return;
      if (!confirm(`删除阶段「${list[i].t}」？它的清单勾选和评语记录仍会保留在库里，但不再显示。`)) return;
      list.splice(i, 1);
      try { await rpc('thesis_def_save', { p_code: code, p_defs: list }); await reload(); toast('已删除'); } catch (e) { toast(e.message); }
    };
  });

  /* 清单勾选 */
  document.querySelectorAll('[data-st]').forEach(el => {
    el.onchange = async () => {
      const sid = el.dataset.st, j = el.dataset.j;
      const cur = { ...stageChecks(sid) };
      const o = normalizeCheck(cur[j]);
      o.done = el.checked;
      cur[j] = compressCheck(o);
      try { await rpc('thesis_stage_set', { p_code: code, p_stage: sid, p_checks: cur, p_owner: null, p_advisor: null }); await reload(); }
      catch (e) { toast(e.message); await reload(); }
    };
  });

  /* 修改 / 批注 */
  document.querySelectorAll('[data-ed]').forEach(b => {
    b.onclick = () => { const k = b.getAttribute('data-ed'); openEdits.has(k) ? openEdits.delete(k) : openEdits.add(k); render(); };
  });
  document.querySelectorAll('[data-ec]').forEach(b => {
    b.onclick = () => { openEdits.delete(b.getAttribute('data-ec')); render(); };
  });
  document.querySelectorAll('[data-es]').forEach(b => {
    b.onclick = async () => {
      const key = b.getAttribute('data-es');
      const [sid, j] = key.split(':');
      const st = defs().find(x => x.id === sid);
      if (!st) return;
      const orig = (st.items || [])[+j] || '';
      const cur = { ...stageChecks(sid) };
      const o = normalizeCheck(cur[j]);
      const txt = (document.querySelector(`[data-et="${key}"]`)?.value || '').trim();
      const note = (document.querySelector(`[data-en="${key}"]`)?.value || '').trim();
      const prev = o.text || orig;
      const next = (txt && txt !== orig) ? txt : '';   /* 留空或写回原文 = 恢复原文 */
      if (next && next !== prev) {
        o.history = [...(o.history || []), { by: author(), at: todayStr(), from: prev, to: next }].slice(-10);
      }
      o.text = next;
      o.note = note;
      cur[j] = compressCheck(o);
      try {
        await rpc('thesis_stage_set', { p_code: code, p_stage: sid, p_checks: cur, p_owner: null, p_advisor: null });
        openEdits.delete(key); await reload(); toast('已保存');
      } catch (e) { toast(e.message); }
    };
  });

  /* 双方确认（各自只能点自己那一边） */
  document.querySelectorAll('[data-ok]').forEach(b => {
    b.onclick = async () => {
      const [sid, who] = b.getAttribute('data-ok').split(':');
      const s = smap()[sid] || {};
      try {
        if (who === 'owner') await rpc('thesis_stage_set', { p_code: code, p_stage: sid, p_checks: s.checks || {}, p_owner: !s.owner_ok, p_advisor: null });
        else await rpc('thesis_stage_set', { p_code: code, p_stage: sid, p_checks: s.checks || {}, p_owner: null, p_advisor: !s.advisor_ok });
        await reload();
      } catch (e) { toast(e.message); }
    };
  });

  /* 评语 */
  document.querySelectorAll('[data-cmt]').forEach(b => {
    b.onclick = () => { const id = b.getAttribute('data-cmt'); openComments.has(id) ? openComments.delete(id) : openComments.add(id); render(); };
  });
  document.querySelectorAll('[data-send]').forEach(b => {
    b.onclick = async () => {
      const id = b.getAttribute('data-send');
      const body = (document.querySelector(`[data-body="${id}"]`)?.value || '').trim();
      if (!body) { toast('评语不能为空'); return; }
      const kind = document.querySelector(`[data-kind="${id}"]`)?.value || '建议';
      try { await rpc('thesis_comment_add', { p_code: code, p_task_id: id, p_author: author(), p_body: '【' + kind + '】' + body }); await reload(); toast('已发送'); }
      catch (e) { toast(e.message); }
    };
  });

  /* 留言板 */
  const bs = $('#bSend');
  if (bs) bs.onclick = async () => {
    const body = ($('#bBody')?.value || '').trim();
    if (!body) { toast('留言不能为空'); return; }
    const kind = $('#bKind')?.value || '建议';
    try { await rpc('thesis_comment_add', { p_code: code, p_task_id: null, p_author: author(), p_body: '【' + kind + '】' + body }); await reload(); toast('已发送'); }
    catch (e) { toast(e.message); }
  };

  /* 上传文件 */
  document.querySelectorAll('[data-upfile]').forEach(el => {
    el.onchange = async () => {
      const sid = el.getAttribute('data-upfile');
      const f = el.files && el.files[0];
      if (!f) return;
      if (f.size > 10 * 1024 * 1024) { toast('文件超过 10MB，请压缩后再传'); el.value = ''; return; }
      const safe = f.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(0, 80);
      const path = code + '/' + Date.now() + '_' + safe;
      try {
        const r = await fetch(config.url + '/storage/v1/object/thesis-files/' + encodeURIComponent(path).replace(/%2F/g, '/'), {
          method: 'POST',
          headers: { apikey: config.key, Authorization: 'Bearer ' + config.key, 'Content-Type': f.type || 'application/octet-stream' },
          body: f,
        });
        if (!r.ok) throw Error('上传失败：' + (await r.text()).slice(0, 120));
        await rpc('thesis_file_add', { p_code: code, p_task_id: sid, p_name: f.name, p_path: path, p_by: author() });
        await reload(); toast('已上传');
      } catch (e) { toast(e.message); }
      el.value = '';
    };
  });

  /* 文献库 */
  const rAdd = $('#rAdd');
  if (rAdd) rAdd.onclick = async () => {
    const refs = refsOf().concat([{ a: $('#rA').value.trim(), t: $('#rT').value.trim(), d: $('#rD').value.trim(), c: $('#rC').value.trim() }]);
    try { await saveAux(refs, logsOf()); toast('已加入文献库'); } catch (e) { toast(e.message); }
  };
  document.querySelectorAll('[data-refdel]').forEach(b => {
    b.onclick = async () => {
      const i = +b.getAttribute('data-refdel');
      const refs = refsOf().slice(); refs.splice(i, 1);
      try { await saveAux(refs, logsOf()); toast('已删除'); } catch (e) { toast(e.message); }
    };
  });
  /* 实验记录 */
  const lAdd = $('#lAdd');
  if (lAdd) lAdd.onclick = async () => {
    const logs = logsOf().concat([{ d: $('#lD').value, b: $('#lB').value.trim(), p: $('#lP').value.trim(), r: $('#lR').value.trim() }]);
    try { await saveAux(refsOf(), logs); toast('已记录'); } catch (e) { toast(e.message); }
  };
  document.querySelectorAll('[data-logdel]').forEach(b => {
    b.onclick = async () => {
      const i = +b.getAttribute('data-logdel');
      const logs = logsOf().slice(); logs.splice(i, 1);
      try { await saveAux(refsOf(), logs); toast('已删除'); } catch (e) { toast(e.message); }
    };
  });
  const ex = $('#expBtn'); if (ex) ex.onclick = exportReport;
}

/* ── 启动 ────────────────────────────────────────────────────── */
applyTheme(themeKey());
(async () => {
  if (session) await loadCodes();
  if (urlCode) { await openCode(urlCode); return; }
  render();
})();
