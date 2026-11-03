/* main.js — 渲染与交互。七个页面：今日 / 行程 / 学习 / 复习 / 生活 / 奖励 / 设置
 * 铁律：每个 renderXxx 只定义一次，不追加覆盖。
 */
import {
  today, addDays, monday, wdOf, dateDiff, id, hash, esc, minutes, clock, clamp,
  SLOTS, SLOT_KEYS, slotOf, THEMES, THEME_KEYS, defaults,
  semesterWeek, fixedInstances, conflicts, courseProgress, chaptersOf, tasksOf,
  nextTaskOf, dailyPicks, hwTasks, HW_SHOW, planAll, taskGuide, migrate, validateRecords, live,
} from './core.js';
import { Store } from './store.js';
import { Cloud } from './cloud.js';

/* ── 工具 ── */
const $ = s => document.querySelector(s);
const toastEl = () => $('#toast');
function toast(msg) {
  const el = toastEl(); if (!el) return;
  el.textContent = msg; el.style.display = 'block';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.style.display = 'none'; }, 5200);
}
function modal(title, html) { $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html; if (!$('#modal').open) $('#modal').showModal(); }
function closeModal() { const m = $('#modal'); if (m?.open) m.close(); }
const action = (label, name, key = '', cls = '') => `<button class="${cls}" data-action="${name}" data-id="${esc(key)}">${label}</button>`;
const empty = (text = '暂时没有记录') => `<div class="empty">${text}</div>`;
const input = (label, name, value = '', type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const shortDate = d => (d || '').slice(5);

/* ── 全局状态 ── */
let store = await new Store('local').open();
let cloud = new Cloud(store, s => { const el = $('#sync'); if (el) el.textContent = s; });
const content = await fetch('./app/content.json').then(r => r.json()).catch(() => []);

let page = 'today';
let week = monday(today());
let selected = today();
let lifeMonth = today().slice(0, 7);
let preview = null;
let showAllCourses = false;
let drag = null, lastDragEnd = 0;
let focusState = null;

if (cloud.session) {
  store.close();
  store = await new Store(cloud.session.user.id).open();
  cloud.store = store;
} else if (!store.records.length && content.length) {
  await store.merge(content);
}

const settings = () => ({ ...defaults, ...(store.get('settings')?.value || {}) });
const allTasks = () => store.all('task');
const courseOf = t => (t?.courseId ? store.get(t.courseId) : null);
const chapterOf = t => (t?.chapterId ? store.get(t.chapterId) : null);

async function putSetting(patch) {
  const cur = store.get('settings')?.value || {};
  await store.put({ id: 'settings', kind: 'setting', value: { ...defaults, ...cur, ...patch } });
}
async function save(r, { render_ = true } = {}) {
  await store.put(r);
  if (render_) render();
  cloud.sync().then(() => { if (!$('#modal')?.open && render_) render(); });
}

/* ── 主题 ── */
function applyTheme(key) {
  const k = THEME_KEYS.includes(key) ? key : defaults.theme;
  document.documentElement.dataset.theme = k;
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim() || '#f9e9ef');
  return k;
}

/* ── 种子升级（老用户也能拿到新的固定日程、课程分类与章节权重） ── */
async function ensureSeed() {
  const s = store.get('settings')?.value || {};
  if (Number(s.seedVersion || 1) >= 4) return;
  const seedIds = new Set(content.map(c => c.id));
  /* 1) 旧的 fixed-fN 命名换成新的 fixed-*，避免行程页出现两份日程 */
  const stale = store.all('fixed').filter(f => !seedIds.has(f.id));
  for (const f of stale) await store.put({ ...f, deleted: true });
  for (const f of content.filter(c => c.kind === 'fixed')) await store.put({ ...f });
  /* 2) 已有 course 的元数据覆盖成新分类/优先级（保留用户其它字段） */
  for (const c of content.filter(c => c.kind === 'course')) {
    const cur = store.get(c.id);
    if (cur) await store.put({
      ...cur, title: c.title, category: c.category, start: c.start, deadline: c.deadline,
      frequency: c.frequency, priority: c.priority, thesisOnly: !!c.thesisOnly,
    });
  }
  /* 3) 章节：标题/知识点/顺序/权重用新种子覆盖，用户写的学习指导保留 */
  for (const c of content.filter(c => c.kind === 'chapter')) {
    const cur = store.get(c.id);
    if (cur) await store.put({ ...cur, title: c.title, topic: c.topic, order: c.order, weight: c.weight });
  }
  /* 4) 补齐新增的课程/章节/固定日程 */
  await store.merge(content);
  await store.put({ id: 'settings', kind: 'setting', value: { ...defaults, ...s, seedVersion: 4 } });
}

/* ── 每日补任务 + 作业生成 ── */
function freeSlotOn(date) {
  const s = settings();
  const busy = new Set(fixedInstances(store.all('fixed'), s, date, 1).map(f => f.slot));
  const used = new Set(allTasks().filter(t => t.date === date && t.slot).map(t => t.slot));
  return SLOT_KEYS.find(k => !busy.has(k) && !used.has(k)) || '';
}
async function ensureDaily() {
  const d = today();
  const s = settings();
  if (s.dailyAnchor === d) return;
  const picks = dailyPicks(d, store.records, s);
  for (const tid of picks.ids) {
    const t = store.get(tid);
    if (!t || t.done || t.date) continue;
    const slot = freeSlotOn(d);
    const sl = slotOf(slot);
    await store.put({ ...t, date: d, slot, start: sl ? sl.start : '', end: sl && t.duration ? clock(minutes(sl.start) + t.duration) : '', source: t.source || 'plan', auto: true, locked: false });
  }
  await putSetting({ dailyAnchor: d });
}
async function ensureHomework() {
  let s = settings();
  if (!s.hwAnchor) { await putSetting({ hwAnchor: addDays(today(), 14) }); s = settings(); }
  const rows = hwTasks(today(), store.records, s);
  if (rows.length) await store.merge(rows);
}
/* 每个章节至少有一条可执行任务，否则学习页进度和每日补任务都没有抓手 */
async function ensureChapterTasks() {
  const rows = [];
  for (const ch of store.all('chapter')) {
    const tid = ch.id + '-task';
    if (store.get(tid)) continue;
    rows.push({
      id: tid, kind: 'task', courseId: ch.courseId, chapterId: ch.id,
      title: ch.topic || ch.title, category: '学习', duration: 30,
      order: ch.order || 0, date: '', done: false, source: 'plan',
    });
  }
  if (rows.length) await store.merge(rows);
}
async function refreshAuto() { await ensureSeed(); await ensureChapterTasks(); await ensureHomework(); await ensureDaily(); }

/* ── 首页：今日 ───────────────────────────────────────────── */
function todayItems() {
  const d = today();
  const s = settings();
  /* 今日只放「要做的」：固定课程 + 生活（服药/复诊/陪聊）+ 任务 + 本周到期的作业。
     兴趣与游戏是固定日程，只在行程页展示，避免把休闲安排也算成待办。 */
  const fixed = fixedInstances(store.all('fixed'), s, d, 1).filter(f => f.cat !== '游戏' && f.cat !== '兴趣');
  const tasks = allTasks();
  const planned = tasks.filter(t => t.date === d);
  const hw = tasks.filter(t => t.category === '作业' && t.due && !t.done && t.due >= addDays(d, -7) && t.due <= addDays(d, HW_SHOW));
  const seen = new Set();
  const list = [];
  for (const t of planned) if (!seen.has(t.id)) { seen.add(t.id); list.push({ type: 'task', t }); }
  for (const t of hw) if (!seen.has(t.id)) { seen.add(t.id); list.push({ type: 'task', t }); }
  for (const f of fixed) list.push({ type: 'fixed', f });
  const rank = it => {
    if (it.type === 'fixed') return SLOT_KEYS.indexOf(it.f.slot) * 100;
    const t = it.t;
    if (t.slot && SLOT_KEYS.includes(t.slot)) return SLOT_KEYS.indexOf(t.slot) * 100 + 1;
    if (t.category === '作业') return 900 + (dateDiff(today(), t.due || today())) * 1;
    return 800;
  };
  list.sort((a, b) => rank(a) - rank(b) || (a.type === b.type ? 0 : a.type === 'fixed' ? -1 : 1));
  return list;
}

function taskRow(t) {
  const overdue = !t.done && ((t.due && t.due < today()) || (!t.due && t.date && t.date < today()));
  const c = courseOf(t), ch = chapterOf(t);
  const due = t.due ? `截止 ${shortDate(t.due)}` : (t.date ? `计划 ${shortDate(t.date)}` : '时间待定');
  const cat = t.category || '待办';
  const sub = c && c.title && cat !== '学习' ? c.title : (ch?.title && cat !== '作业' ? ch.title : '');
  return `<li class="task${t.done ? ' done' : ''}${overdue ? ' overdue' : ''}" data-id="${esc(t.id)}">
    <input class="task-check" type="checkbox" data-task="${esc(t.id)}" ${t.done ? 'checked' : ''} aria-label="完成 ${esc(t.title)}">
    <div class="task-body">
      <button class="task-title" data-action="detail" data-id="${esc(t.id)}">${esc(t.title)}</button>
      <p class="task-meta"><span class="tag">${esc(cat)}</span> ${esc(due)} · ${t.duration || 30} 分钟${sub ? ' · ' + esc(sub) : ''}${overdue ? ' <span class="badge-overdue">已逾期</span>' : ''}${t.auto ? ' · 自动补' : ''}</p>
    </div>
    <div class="task-ops">
      <button class="op" data-action="split" data-id="${esc(t.id)}" title="拆成今天和明天两步">×</button>
      <button class="op op-del" data-action="delete" data-id="${esc(t.id)}" title="删除">删</button>
    </div>
  </li>`;
}
function fixedRow(f) {
  const doneId = `fix:${f.fixedId}:${f.date}`;
  const done = !!store.get(doneId)?.done;
  return `<li class="task task-fixed${done ? ' done' : ''}" data-id="${esc(f.instanceId)}">
    <input class="task-check" type="checkbox" data-fix="${esc(f.fixedId + '@' + f.date)}" ${done ? 'checked' : ''} aria-label="完成 ${esc(f.title)}">
    <div class="task-body">
      <button class="task-title" data-action="fixedDetail" data-id="${esc(f.fixedId + '@' + f.date)}">${esc(f.title)}</button>
      <p class="task-meta"><span class="tag tag-fixed">${esc(f.cat || '固定课程')}</span> ${esc(f.start + '–' + f.end)} · ${esc(f.note || '')}</p>
    </div>
  </li>`;
}

function renderToday() {
  const list = todayItems();
  const pending = list.filter(it => !(it.type === 'task' ? it.t.done : store.get(`fix:${it.f.fixedId}:${it.f.date}`)?.done));
  const focus = pending.find(it => it.type === 'task' && it.t.category !== '固定课程') || null;
  const doneCount = list.length - pending.length;
  const d = today();
  const overdue = allTasks().filter(t => !t.done && ((t.due && t.due < addDays(d, -7)) || (!t.due && t.date && t.date < d)))
    .sort((a, b) => String(a.due || a.date).localeCompare(String(b.due || b.date))).slice(0, 12);

  const focusCard = focus ? `<section class="focus-card">
      <div>
        <p class="focus-label">现在做</p>
        <h2 class="focus-title">${esc(focus.t.title)}</h2>
        <p class="focus-meta">${esc(courseOf(focus.t)?.title || focus.t.category || '任务')} · 约 ${focus.t.duration || 30} 分钟${focus.t.due ? ' · 截止 ' + shortDate(focus.t.due) : ''}</p>
      </div>
      <div class="focus-actions">
        <button class="primary" data-action="focus" data-id="${esc(focus.t.id)}">开始 2 分钟</button>
        <button data-action="detail" data-id="${esc(focus.t.id)}">看步骤</button>
      </div>
    </section>`
    : `<section class="focus-card focus-empty">
      <div><p class="focus-label">今天没有待办</p><h2 class="focus-title">想加一条就加一条</h2><p class="focus-meta">不必一次完成所有事。</p></div>
      <div class="focus-actions"><button class="primary" data-action="newTask">＋ 添加任务</button></div>
    </section>`;

  return `${focusCard}
  <section class="panel">
    <div class="toolbar"><h2>今天要做的</h2><button data-action="newTask">＋ 添加</button></div>
    <p class="meta">${doneCount} / ${list.length} 项完成 · 固定课程不可拆不可删，其它任务可以 × 拆成两步或删除。</p>
    <ul class="task-list">${list.map(it => it.type === 'fixed' ? fixedRow(it.f) : taskRow(it.t)).join('') || '<li class="empty">今天还没有任务</li>'}</ul>
  </section>
  ${overdue.length ? `<section class="panel">
    <div class="toolbar"><h2>已逾期 · ${overdue.length}</h2></div>
    <p class="meta">这些还没做。可以延期到明天，或直接删掉。</p>
    <ul class="task-list">${overdue.map(t => taskRow(t)).join('')}</ul>
  </section>` : ''}`;
}

/* ── 行程页 ───────────────────────────────────────────────── */
function evClass(it) {
  if (it.type === 'fixed') {
    const cat = it.f.cat || '固定课程';
    return cat === '兴趣' ? 'ev-hobby' : cat === '游戏' ? 'ev-game' : cat === '生活' ? 'ev-life' : cat === '论文' ? 'ev-thesis' : 'ev-fixed';
  }
  const c = courseOf(it.t);
  const cat = c?.category || '';
  if (cat === '论文' || it.t.category === '论文') return 'ev-thesis';
  if (cat === '兴趣') return 'ev-hobby';
  return 'ev-study';
}
function renderWeek() {
  const s = settings();
  const dates = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const inst = fixedInstances(store.all('fixed'), s, week, 7).map(f => ({ type: 'fixed', f }));
  const tks = allTasks().filter(t => t.date && dates.includes(t.date)).map(t => ({ type: 'task', t }));
  const items = [...inst, ...tks];
  const flat = items.map(it => it.type === 'fixed' ? it.f : it.t);
  const bad = conflicts(flat);
  const keyOf = it => it.type === 'fixed' ? it.f.fixedId : it.t.id;
  const idOf = it => it.type === 'fixed' ? it.f.instanceId : it.t.id;

  const heads = dates.map((d, i) => `<div class="wg-head${d === today() ? ' today' : ''}${d === selected ? ' selected' : ''}">周${['一', '二', '三', '四', '五', '六', '日'][i]}<br>${shortDate(d)}${d === today() ? ' · 今天' : ''}</div>`).join('');
  const rows = SLOTS.map(sl => {
    const cells = dates.map(d => {
      const cellItems = items.filter(it => (it.type === 'fixed' ? it.f : it.t).slot === sl.key && (it.type === 'fixed' ? it.f : it.t).date === d);
      const body = cellItems.map(it => {
        const x = it.type === 'fixed' ? it.f : it.t;
        const done = it.type === 'fixed' ? !!store.get(`fix:${x.fixedId}:${x.date}`)?.done : !!x.done;
        const isConflict = bad.has(it.type === 'fixed' ? x.instanceId : x.id);
        const draggable = it.type === 'task' && x.category !== '固定课程';
        const cls = `ev ${evClass(it)}${done ? ' done' : ''}${isConflict ? ' conflict' : ''}${draggable ? ' ev-draggable' : ''}`;
        const attrs = draggable ? ` data-drag="1" data-action="detail" data-id="${esc(x.id)}"` : ` data-action="detail" data-id="${esc(idOf(it))}"`;
        return `<button class="${cls}"${attrs} title="${esc(x.title)}">${isConflict ? '⚠ ' : ''}${esc(x.title)}<br><small>${esc(x.start || '')}${x.end ? '–' + esc(x.end) : ''}</small></button>`;
      }).join('');
      return `<div class="wg-cell" data-date="${d}" data-slot="${sl.key}">${body}</div>`;
    }).join('');
    return `<div class="wg-rowlabel">${sl.key}<br><small>${sl.start}</small></div>${cells}`;
  }).join('');

  const legend = `<div class="legend">
    <span class="legend-item"><i class="swatch sw-fixed"></i>固定课程</span>
    <span class="legend-item"><i class="swatch sw-study"></i>学习任务</span>
    <span class="legend-item"><i class="swatch sw-hobby"></i>兴趣 / 游戏</span>
    <span class="legend-item"><i class="swatch sw-thesis"></i>论文</span>
    <span class="legend-item"><i class="swatch sw-life"></i>生活</span>
  </div>`;

  const unplaced = allTasks().filter(t => t.date && dates.includes(t.date) && !t.slot && t.category !== '固定课程');

  return `<section class="panel">
    <div class="toolbar">
      ${action('← 上一周', 'prevWeek')}${action('本周', 'thisWeek')}${action('下一周 →', 'nextWeek')}
      <b>${week} — ${addDays(week, 6)}</b>
      ${action('＋ 任务', 'newTask')}
    </div>
    <p class="meta">行是时段，列是周一到周日。实线是固定课程/日程（拖不动），虚线是你自己排的学习任务（可拖到别的格子）。</p>
    ${legend}
    <div class="week-scroll"><div class="week-grid">
      <div class="wg-corner">时段</div>${heads}
      ${rows}
    </div></div>
  </section>
  <section class="panel">
    <div class="toolbar"><h2>待安排 · 没有时段</h2></div>
    <ul class="task-list">${unplaced.map(t => taskRow(t)).join('') || '<li class="empty">这一周的任务都排进时段了</li>'}</ul>
  </section>`;
}

/* ── 学习页 ───────────────────────────────────────────────── */
const CAT_ORDER = { '期末': 0, '考研': 1, '课程': 2, '论文': 3, '兴趣': 4 };
function renderCourses() {
  const s = settings();
  const courses = store.all('course').slice().sort((a, b) => (CAT_ORDER[a.category] ?? 9) - (CAT_ORDER[b.category] ?? 9) || (b.priority || 1) - (a.priority || 1) || String(a.title).localeCompare(String(b.title)));
  const shown = showAllCourses || s.showAllCourses ? courses : courses.slice(0, 5);
  const cards = shown.map(c => {
    const p = courseProgress(c.id, store.records);
    const next = nextTaskOf(c.id, store.records);
    const thesis = !!c.thesisOnly;
    return `<article class="course-card" data-id="${esc(c.id)}">
      <div class="cc-head"><span class="tag">${esc(c.category || '课程')}</span><h2>${esc(c.title)}</h2></div>
      <div class="progress"><i style="width:${p.percent}%"></i></div>
      <p class="cc-stat">已完成 ${p.done} / ${p.total} 章（加权 ${p.percent}%）${thesis ? ' · 论文只在论文平台看任务' : ''}</p>
      <p class="cc-next">${thesis ? '下一步：按 36 周节奏推进，任务在论文平台' : next ? '下一步：' + esc(chapterOf(next)?.title || next.title) + ' · ' + esc(chapterOf(next)?.topic || '') : '这门课的任务都完成了'}</p>
      ${thesis ? '' : action('编辑目标', 'editCourse', c.id)}
    </article>`;
  }).join('');
  return `<div class="toolbar">
      ${action('预览重新排期', 'preview', '', 'primary')}${action('新增课程 / 目标', 'newCourse')}
      <span class="meta">进度条按章节重要度（1–5 星）加权</span>
    </div>
    ${settings().confirmed ? '' : `<div class="notice"><b>先确认学期</b><p>学期起点会影响周次与固定日程。</p>${action('开始确认', 'onboard', '', 'primary')}</div>`}
    <div class="course-grid${showAllCourses || s.showAllCourses ? ' all' : ''}">${cards || empty('还没有课程')}</div>
    <div class="toolbar">${courses.length > 5 ? action(`${showAllCourses ? '只看前 5 门' : `展开全部 ${courses.length} 门`}`, 'allCourses') : ''}</div>`;
}

/* ── 复习 / 生活 / 奖励（保留原有功能） ───────────────────── */
function row(t) {
  const c = courseOf(t), ch = chapterOf(t);
  return `<div class="row ${t.done ? 'done' : ''}"><input type="checkbox" data-task="${esc(t.id)}" ${t.done ? 'checked' : ''}>
    <div class="body"><button class="title" data-action="detail" data-id="${esc(t.id)}">${esc(t.title)}</button>
    <div class="meta">${esc(t.date || '未排')} · ${esc(t.category || '')} ${esc(c?.title || '')}${ch ? ' / ' + esc(ch.title) : ''}</div></div>
    ${action('详情', 'detail', t.id)}</div>`;
}
function renderReview() {
  const cards = store.all('card');
  return `<div class="panel"><div class="toolbar"><h2>复习卡片</h2>${action('添加卡片', 'newCard')}${action('导入卡片 JSON', 'importCards')}</div>
    <p class="meta">先看问题，主动回忆，再查看答案。到期后放入今日复习。</p>
    ${cards.map(c => `<div class="row"><div class="body"><h3>${esc(c.front)}</h3><p class="meta">下次 ${esc(c.next || '')} · ${esc(store.get(c.chapterId)?.title || '独立卡片')}</p>
      ${action('查看答案', 'answer', c.id)} ${c.next <= today() ? action('放入今日复习', 'reviewTask', c.id) : ''}</div></div>`).join('') || empty()}</div>`;
}
function renderLife() {
  const bills = store.all('bill').filter(x => x.date?.startsWith(lifeMonth)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const w = store.get('water:' + today())?.value || 0, ex = store.get('exercise:' + today());
  return `<div class="grid"><div>
    <div class="panel"><h2>照顾自己</h2><p>喝水记录 · ${w} 杯（每杯约 250 ml）</p>
      <div class="water">${Array.from({ length: 8 }, (_, i) => action('◉ ' + (i + 1), 'water', String(i + 1), w === i + 1 ? 'active' : '')).join('')}${action('清零', 'water', '0')}</div>
      <p class="meta">按个人需要记录，不自动制定饮水目标。</p>
      ${action(ex?.done ? '✓ 今日运动已记录' : '记录今日运动', 'exercise')}</div>
    <div class="panel"><div class="toolbar"><h2>体重记录</h2>${action('添加记录', 'weight')}</div>
      <p class="meta">仅记录趋势，不自动设定减重目标。</p>
      ${store.all('weight').sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 30).map(x => `<div class="row">${esc(x.date)} · ${esc(x.kg)} kg ${action('删除', 'delete', x.id)}</div>`).join('') || empty()}</div>
  </div><div class="panel"><div class="toolbar"><h2>账单</h2><label>查看月份<input type="month" id="lifeMonth" value="${lifeMonth}"></label>${action('记一笔', 'bill')}</div>
    <p>${lifeMonth} 收入 ${bills.filter(x => x.type === 'in').reduce((s, x) => s + Number(x.amount), 0).toFixed(2)} 元 · 支出 ${bills.filter(x => x.type !== 'in').reduce((s, x) => s + Number(x.amount), 0).toFixed(2)} 元</p>
    ${bills.map(x => `<div class="row"><div class="body">${esc(x.note || x.cat)}<div class="meta">${esc(x.date)} · ${esc(x.cat)}</div></div>${x.type === 'in' ? '+' : '−'}${esc(x.amount)} 元${action('删除', 'delete', x.id)}</div>`).join('') || empty()}</div></div>`;
}
const REWARDS = [['一集番 / 1 小时游戏', 30, 0], ['奶茶一杯', 50, 12], ['外卖改善一顿', 80, 25], ['电影 / 买本书', 120, 45], ['小愿望（画材/鼓棒）', 200, 70], ['月度大奖励', 500, 120]];
function renderRewards() {
  return `<div class="panel hero"><div><h2>${store.balance()} 积分</h2><p>每条任务首次完成 +10。</p>
    <p class="meta">云端模式兑换需联网，并由数据库检查余额。</p></div><div class="flower">✧</div></div>
    <div class="course-grid">${REWARDS.map((r, i) => `<div class="panel"><h3>${r[0]}</h3><p>${r[1]} 分 · ${r[2]} 元</p>${action('兑换', 'redeem', i)}</div>`).join('')}</div>
    <div class="panel"><h2>兑换记录</h2>${store.all('redemption').map(r => `<p>${esc(r.date)} · ${esc(r.name)} · ${r.cost} 分</p>`).join('') || empty()}</div>`;
}

/* ── 设置页 ───────────────────────────────────────────────── */
function renderSettings() {
  const s = settings();
  const cur = document.documentElement.dataset.theme;
  return `<div class="grid"><div>
    <div class="panel"><h2>账号与云端同步</h2>
      <p>${cloud.session ? '已登录：' + esc(cloud.session.user.email) : '本地模式 · 尚未开启跨设备同步'}</p>
      <p class="meta">同一账号在 iPhone / iPad / PC 登录，数据一致；离线先存本机，联网自动同步。</p>
      ${cloud.session ? `<div class="toolbar">${action('同步 / 重试', 'sync')}${action('将本地记录合并到此账号', 'mergeLocal')}${action('退出账号', 'logout')}</div>`
      : `<form data-form="login">${input('邮箱', 'email', '', 'email', 'required autocomplete="username"')}${input('密码', 'password', '', 'password', 'required minlength="6" autocomplete="current-password"')}<button class="primary" name="mode" value="login">登录</button> <button name="mode" value="signup">注册</button></form>`}
    </div>
    <div class="panel"><h2>主题色</h2><p class="meta">存在本机，也会随账号同步。</p>
      <div class="theme-grid">${THEMES.map(t => `<button class="theme-btn${t.key === cur ? ' active' : ''}" data-action="setTheme" data-id="${t.key}"><i class="sw-${t.key}"></i>${t.label}</button>`).join('')}</div>
    </div>
    <div class="panel"><h2>备份与恢复</h2>
      <div class="toolbar">${action('导出备份 JSON', 'export')}${action('导入备份 JSON', 'import')}${action('一键重建课程数据', 'reseed')}</div>
      <p class="meta">导入只补缺失记录，不覆盖已有；课程为空时可一键重建。</p>
      <input id="importFile" type="file" accept="application/json,.json" hidden>
      <p class="meta">本地文件与网站存储相互独立：请在旧页面点“导出备份”，再到本网站导入。</p>
    </div>
  </div><div>
    <div class="panel"><h2>时间与排期</h2>
      ${action('编辑可用时间、休息与容量', 'scheduleSettings')}
      <p>每天 ${s.capacity} 分钟，休息 ${s.break} 分钟。课程时间未知时明确显示“推定”。</p>
      <p class="meta">每天自动补 ${s.dailyFill} 条学习任务；作业只显示 7 天内到期的。</p>
      ${action('重新确认学期', 'onboard')}
    </div>
    <div class="panel"><h2>iPhone / iPad 安装</h2><ol><li>用 Safari 打开部署后的网站。</li><li>点“分享”。</li><li>选择“添加到主屏幕”。</li><li>从主屏幕图标打开；首次联网后即可离线启动。</li></ol></div>
    <div class="panel"><h2>同步冲突</h2>
      ${store.records.filter(x => x.conflict).map(r => `<div class="row"><div class="body">${esc(r.title || r.id)}<p class="meta">本机和云端同时修改，两版都已保留。</p>${action('查看两版并处理', 'resolve', r.id)}</div></div>`).join('') || empty('暂无待处理冲突')}
    </div>
  </div></div>`;
}

/* ── 2 分钟倒计时 ─────────────────────────────────────────── */
function renderFocus() {
  const layer = $('#focus');
  if (!layer) return;
  if (!focusState) { layer.hidden = true; return; }
  layer.hidden = false;
  const t = store.get(focusState.taskId);
  const left = Math.max(0, focusState.left);
  const num = layer.querySelector('.timer-num');
  const title = layer.querySelector('.focus-title');
  const label = layer.querySelector('.focus-label');
  if (num) num.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  if (title) title.textContent = focusState.finished ? '时间到。做完了就勾掉它。' : (t?.title || '');
  if (label) label.textContent = focusState.finished ? '时间到' : `先做 ${focusState.mins} 分钟`;
}
function startFocus(taskId, mins) {
  stopFocus(false);
  focusState = { taskId, mins, left: mins * 60, finished: false, timer: null };
  focusState.timer = setInterval(() => {
    if (!focusState) return;
    focusState.left--;
    if (focusState.left <= 0) { focusState.left = 0; focusState.finished = true; clearInterval(focusState.timer); focusState.timer = null; }
    renderFocus();
  }, 1000);
  renderFocus();
}
function stopFocus(hide = true) {
  if (focusState?.timer) clearInterval(focusState.timer);
  focusState = null;
  const layer = $('#focus');
  if (layer && hide) { layer.hidden = true; }
}

/* ── 任务详情 ─────────────────────────────────────────────── */
async function detail(key) {
  if (!key) return;
  if (String(key).includes('@')) { const [fid, date] = String(key).split('@'); return fixedDetail(fid, date); }
  await cloud.detail(key).catch(() => {});
  const t = store.get(key);
  if (!t) return toast('找不到这条记录');
  const c = courseOf(t), ch = chapterOf(t);
  const g = taskGuide(c, ch || { title: t.title });
  const timeTxt = t.slot ? `${t.slot} ${t.start || ''}${t.end ? '–' + t.end : ''}` : (t.start ? `${t.start}–${t.end}` : '时间待定');
  modal(t.title, `<p><span class="tag">${esc(t.category || '任务')}</span>${esc(c?.title || '自定义')} / ${esc(ch?.title || '未关联章节')}</p>
    <p>${esc(t.date || '待安排')} ${esc(timeTxt)} · ${t.duration || 30} 分钟${t.due ? ' · 截止 ' + esc(t.due) : ''}${t.auto ? ' · 自动补入' : ''}</p>
    ${t.category === '固定课程' ? '' : `<div class="toolbar">${action('开始学习', 'start', key)}${action('查看步骤', 'steps', key)}${action('完成自测', 'selftest', key)}${action('需要再学一次', 'again', key)}</div>
    <h3>今天学什么</h3><p>${esc(ch?.topic || t.title)}</p>
    <h3>先要懂什么</h3><p>${esc(g.prerequisite)}</p>
    <h3>这次的目标</h3><p>${esc(g.objective)}</p>
    <ol class="steps" id="steps">${g.steps.map(x => '<li>' + esc(x) + '</li>').join('')}</ol>
    <h3>参考材料</h3><p>${esc(g.material)}</p>
    <h3>理解例子</h3><p>${esc(g.example)}</p>
    <h3>练习与核对</h3><p>${esc(g.practice)}</p>
    <h3>产出与完成标准</h3><p>${esc(g.output)}</p><p>${esc(g.acceptance)}</p>
    <h3>不会时这样缩小</h3><p>${esc(g.fallback)}</p>`}
    <form data-form="note" data-version="${t.version || 0}" data-id="${esc(key)}"><label>学习笔记 / 问题<textarea name="note">${esc(t.note || '')}</textarea></label><button>保存笔记</button></form>
    <div class="toolbar">${action(t.done ? '取消完成' : '✓ 标为完成', 'toggle', key, 'primary')}${action('修改', 'editTask', key)}${action('延期', 'postpone', key)}${action('删除任务', 'delete', key)}</div>`);
}
function fixedDetail(fid, date) {
  const f = store.get(fid);
  if (!f) return toast('找不到这条固定日程');
  const done = !!store.get(`fix:${fid}:${date}`)?.done;
  modal(f.title, `<p><span class="tag tag-fixed">${esc(f.cat || '固定课程')}</span>${esc(date)} · ${esc(f.slot)} · ${esc(f.start + '–' + f.end)}</p>
    <p>${esc(f.note || '')}</p><p class="meta">固定日程不能拖动、不能删除。想临时调整，请添加一条自己的任务。</p>
    <div class="toolbar">${action(done ? '取消完成' : '✓ 标记完成', 'toggleFix', fid + '@' + date, 'primary')}</div>`);
}

/* ── 表单 ─────────────────────────────────────────────────── */
function taskForm(t = {}) {
  modal(t.id ? '修改任务' : '添加自定义任务', `<form data-form="task" data-version="${t.version || 0}" data-id="${esc(t.id || '')}">
    <div class="form-grid">
      ${input('任务名称', 'title', t.title || '', 'text', 'required maxlength="180"')}
      ${input('日期', 'date', t.date || today(), 'date', 'required')}
      <label>时段<select name="slot"><option value="">不放进时段</option>${SLOTS.map(sl => `<option value="${sl.key}" ${sl.key === t.slot ? 'selected' : ''}>${sl.key} ${sl.start}</option>`).join('')}</select></label>
      ${input('预计分钟', 'duration', t.duration || 30, 'number', 'required min="5" max="240" step="5"')}
      <label>分类<select name="category">${['学习', '作业', '固定课程', '复习', '科研', '生活', '自定义'].map(x => `<option ${x === t.category ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>课程<select name="courseId"><option value="">独立任务</option>${store.all('course').map(c => `<option value="${esc(c.id)}" ${c.id === t.courseId ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select></label>
      <label>章节<select name="chapterId"><option value="">未关联</option>${store.all('chapter').map(c => `<option value="${esc(c.id)}" ${c.id === t.chapterId ? 'selected' : ''}>${esc(store.get(c.courseId)?.title)} / ${esc(c.title)}</option>`).join('')}</select></label>
    </div>
    <p class="meta">时间重叠会提示，但不会禁止保存。</p><button class="primary">保存任务</button></form>`);
}

/* ── 动作分派 ─────────────────────────────────────────────── */
async function handle(name, key) {
  if (['editTask', 'editChapter', 'answer', 'makeCard', 'resolve'].includes(name) && key) await cloud.detail(key).catch(() => {});
  const t = store.get(key);
  switch (name) {
    case 'detail': await detail(key); break;
    case 'fixedDetail': { const [fid, date] = String(key).split('@'); fixedDetail(fid, date); break; }
    case 'close': closeModal(); break;
    case 'newTask': taskForm(); break;
    case 'editTask': taskForm(t || {}); break;

    /* 今日 */
    case 'focus': startFocus(key, settings().focusMinutes); break;
    case 'focusDone': { const fid = focusState?.taskId; stopFocus(); if (fid) { await store.complete(fid, true); render(); await cloud.sync(); toast('已标为完成'); } break; }
    case 'focusMore': { if (!focusState) break; const tid = focusState.taskId; stopFocus(false); startFocus(tid, 10); break; }
    case 'focusStop': stopFocus(); break;
    case 'split': {
      const src = store.get(key);
      if (!src || src.category === '固定课程') break;
      const half = Math.max(10, Math.round((src.duration || 30) / 2));
      const tom = addDays(today(), 1);
      const slot0 = src.slot || freeSlotOn(today());
      const slot1 = freeSlotOn(tom);
      await store.put({ ...src, title: src.title + '（1/2）', duration: half, date: today(), slot: slot0, start: slotStartOf(slot0), end: slotEndOf(slot0, half), locked: false });
      await store.merge([{
        id: id(), kind: 'task', courseId: src.courseId, chapterId: src.chapterId,
        title: src.title.replace(/（\d\/\d）$/, '') + '（2/2）', category: src.category,
        duration: half, date: tom, slot: slot1, start: slotStartOf(slot1), end: slotEndOf(slot1, half),
        order: src.order, done: false, source: 'manual', splitFrom: src.id,
      }]);
      render(); await cloud.sync(); toast('已拆成今天一步、明天一步');
      break;
    }
    case 'toggleFix': { const [fid, date] = String(key).split('@'); await toggleFixed(fid, date); closeModal(); break; }
    case 'delete': if (confirm('删除这条记录？云端会同步删除标记，历史奖励保留。')) { await store.remove(key); closeModal(); render(); await cloud.sync(); } break;

    /* 行程 */
    case 'prevWeek': week = addDays(week, -7); selected = week; render(); break;
    case 'nextWeek': week = addDays(week, 7); selected = week; render(); break;
    case 'thisWeek': week = monday(today()); selected = today(); render(); break;

    /* 学习 */
    case 'allCourses': { showAllCourses = !showAllCourses; await putSetting({ showAllCourses }); render(); break; }
    case 'preview': if (content.length === 0 && !store.all('course').length) return toast('还没有课程数据'); showPreviewModal(planAll(store.all(), settings())); break;
    case 'applyPreview': {
      if (!preview) break;
      for (const x of preview.moves) { const cur = store.get(x.id); if (cur) await store.put({ ...cur, ...x, locked: false }); }
      for (const tid of preview.unplaced) { const cur = store.get(tid); if (cur) await store.put({ ...cur, date: '', slot: '' }); }
      preview = null; closeModal(); render(); await cloud.sync(); toast('排期已应用；排不下的留在章节里');
      break;
    }
    case 'newCourse': case 'editCourse':
      modal(t ? '编辑课程' : '新增课程', `<form data-form="course" data-id="${esc(key)}">
        ${input('名称', 'title', t?.title || '', 'text', 'required')}
        ${input('分类', 'category', t?.category || '课程', 'text', 'list="cats"')}
        <datalist id="cats"><option>期末</option><option>考研</option><option>论文</option><option>兴趣</option><option>课程</option></datalist>
        ${input('开始日期', 'start', t?.start || today(), 'date', 'required')}
        ${input('截止日期', 'deadline', t?.deadline || addDays(today(), 90), 'date', 'required')}
        ${input('每周小任务次数', 'frequency', t?.frequency || 2, 'number', 'min="1" max="21" required')}
        ${input('优先级（1—5）', 'priority', t?.priority || 1, 'number', 'min="1" max="5" required')}
        <button class="primary">保存</button></form>`);
      break;
    case 'onboard': modal('确认学期', `<p>学期起点决定周次、固定日程和考试节点。</p>
      <form data-form="onboard">${input('第一学期第 1 周周一', 'semester', settings().semester, 'date', 'required')}
      <label><input type="checkbox" required> 我核对过学期起点</label><button class="primary">保存</button></form>`); break;

    /* 同步 / 备份 */
    case 'sync': await cloud.sync(); render(); break;
    case 'export': await backup(); toast('备份已下载'); break;
    case 'import': $('#importFile').click(); break;
    case 'mergeLocal': {
      const local = await new Store('local').open();
      try {
        if (!confirm('把本机本地模式数据添加到当前账号？相同 ID 保留账号现有记录。')) break;
        await backup();
        await store.merge(local.records.map(({ version, dirty, conflict, ...r }) => r));
        await cloud.sync(); render(); toast('合并已提交，请检查同步状态');
      } finally { local.close(); }
      break;
    }
    case 'logout': if (confirm('退出将清除本机此账号缓存（含待同步修改）。继续？')) { await cloud.logout(); location.reload(); } break;
    case 'reseed': await reseedData(); break;
    case 'setTheme': { const k = applyTheme(key); await putSetting({ theme: k }); render(); break; }
    case 'scheduleSettings': {
      const s = settings();
      modal('容量与每日补任务', `<form data-form="settings">
        ${input('每天学习容量（分钟）', 'capacity', s.capacity, 'number', 'min="20" max="600" required')}
        ${input('任务之间休息（分钟）', 'break', s.break, 'number', 'min="5" max="60" required')}
        ${input('每天自动补几条', 'dailyFill', s.dailyFill, 'number', 'min="0" max="8" required')}
        ${input('「开始 2 分钟」的分钟数', 'focusMinutes', s.focusMinutes, 'number', 'min="1" max="60" required')}
        <button class="primary">保存</button></form>`); break;
    }
    /* 任务详情里的操作 */
    case 'toggle': await complete(key); await detail(key); break;
    case 'start': await store.put({ ...t, startedAt: new Date().toISOString() }); toast('已记录开始时间。先做完第一小步。'); break;
    case 'steps': { const el = document.getElementById('steps'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); break; }
    case 'selftest': modal('完成自测', `<p>${esc(taskGuide(courseOf(t), chapterOf(t) || { title: t.title }).practice)}</p>
      <form data-form="selftest" data-version="${t.version || 0}" data-id="${esc(key)}"><label>不看资料写下答案或结果，再记录核对发现<textarea name="result" required>${esc(t.selftest || '')}</textarea></label>
      <label><input type="checkbox" required> 我已对照课程资料核对，记录了错误或疑问</label><button class="primary">保存自测</button></form>`); break;
    case 'again': await store.merge([{ id: id(), kind: 'task', courseId: t.courseId, chapterId: t.chapterId, title: t.title + ' · 再学一次', category: t.category, duration: 20, order: t.order, date: addDays(today(), 1), done: false, source: 'manual' }]); toast('已新增明天的巩固任务'); closeModal(); render(); break;
    case 'postpone': modal('延期任务', `<form data-form="postpone" data-id="${esc(key)}">${input('新日期', 'date', addDays(t.date || today(), 1), 'date', 'required')}<button class="primary">确认延期</button><p class="meta">保留笔记和完成记录；延期后不放进时段。</p></form>`); break;

    /* 复习卡片 */
    case 'newCard': case 'makeCard':
      modal('创建复习卡片', `<form data-form="card" data-id="${esc(name === 'makeCard' ? key : '')}">
        ${input('问题（先显示）', 'front', t ? '如何解释 ' + t.title + '？' : '', 'text', 'required')}
        <label>答案 / 核对依据<textarea name="back" required>${esc(t?.selftest || '')}</textarea></label><button class="primary">保存卡片</button></form>`);
      break;
    case 'importCards': modal('导入复习卡片', `<form data-form="cards"><p>格式：{"cards":[{"front":"问题","back":"答案"}]}</p><textarea name="json" required></textarea><button class="primary">校验并导入</button></form>`); break;
    case 'answer': modal(t.front, `<div class="answer">${esc(t.back || '旧卡片未提供答案，请补充。')}</div>
      <p class="meta">想起来了则延后复习，忘了则明天再练。</p>${action('想起来了', 'remember', key)} ${action('忘了，明天再学', 'forgot', key)}`); break;
    case 'reviewTask': await store.merge([{ id: 'review:' + key + ':' + t.next, kind: 'task', cardId: key, chapterId: t.chapterId, courseId: store.get(t.chapterId)?.courseId, title: '复习：' + t.front, date: today(), category: '复习', duration: 20, done: false }]); render(); await cloud.sync(); toast('已加入今日'); break;
    case 'remember': case 'forgot': {
      const taskId = 'review:' + key + ':' + t.next;
      if (!store.get(taskId)) await store.merge([{ id: taskId, kind: 'task', cardId: key, title: '复习：' + t.front, date: today(), category: '复习', duration: 20, done: false }]);
      await complete(taskId, true);
      const stage = name === 'forgot' ? 0 : Math.min((t.stage || 0) + 1, 5);
      await save({ ...t, stage, next: addDays(today(), [1, 2, 4, 7, 15, 30][stage]) });
      closeModal(); break;
    }

    /* 生活 */
    case 'water': await save({ id: 'water:' + today(), kind: 'water', date: today(), value: +key }); break;
    case 'exercise': await save({ id: 'exercise:' + today(), kind: 'exercise', date: today(), done: !store.get('exercise:' + today())?.done }); break;
    case 'weight': modal('记录体重', `<form data-form="weight">${input('日期', 'date', today(), 'date', 'required')}${input('体重 kg', 'kg', '', 'number', 'required min="10" max="500" step="0.1"')}<button class="primary">保存</button></form>`); break;
    case 'bill': modal('记一笔', `<form data-form="bill">${input('日期', 'date', today(), 'date', 'required')}<label>收支<select name="type"><option value="out">支出</option><option value="in">收入</option></select></label>${input('金额（元）', 'amount', '', 'number', 'required min="0.01" step="0.01"')}${input('分类', 'cat', '生活', 'text', 'required')}${input('备注', 'note')}<button class="primary">保存</button></form>`); break;
    case 'redeem': {
      const r = REWARDS[+key]; if (!r) break;
      if (!confirm(`用 ${r[1]} 分兑换「${r[0]}」？`)) break;
      if (cloud.session) {
        if (!navigator.onLine) { toast('离线时请先保存学习，联网后再兑换'); break; }
        const rid = 'redeem:' + id();
        await store.put({ id: 'request:' + rid, kind: 'retry', requestId: rid, reward: +key });
        await cloud.redeem(rid, +key);
        await store.remove('request:' + rid);
      } else {
        if (store.balance() < r[1]) { toast('积分不足'); break; }
        const rid = 'local-redemption:' + id();
        await store.put({ id: rid, kind: 'redemption', name: r[0], cost: r[1], yuan: r[2], date: today() });
        if (r[2]) await store.put({ id: 'bill:' + rid, kind: 'bill', date: today(), type: 'out', cat: '奖', amount: r[2], note: r[0] });
      }
      render(); toast('兑换成功'); break;
    }

    /* 章节 */
    case 'chapterTask': await store.merge([{ id: id(), kind: 'task', courseId: t.courseId, chapterId: t.id, order: t.order, title: t.topic || t.title, category: '学习', duration: 30, date: '', done: false, source: 'plan' }]); render(); await cloud.sync(); break;
    case 'editChapter': modal('编辑章节与学习指导', `<form data-form="chapter" data-version="${t.version || 0}" data-id="${esc(key)}">
      ${['title', 'topic', 'prerequisite', 'objective', 'material', 'example', 'practice', 'output'].map((n, i) => `<label>${['章节名称', '知识点（一次只处理一个）', '前置知识与补基础步骤', '本次目标', '参考材料', '理解例子', '练习与核对方法', '预期产出'][i]}<textarea name="${n}">${esc(t[n] || '')}</textarea></label>`).join('')}
      ${input('重要度 1—5 星（5 星完成一章涨得多）', 'weight', t.weight || 3, 'number', 'min="1" max="5" step="1" required')}
      <button class="primary">保存</button></form>`); break;
    case 'outline': modal('录入、粘贴或导入课程目录', `<p>每行一个章节，支持“章节标题 | 知识点”。追加目录，不删除原章节和历史。</p>
      <form data-form="outline" data-id="${esc(key)}">${input('教材与版本 / 目录来源', 'material', '', 'text', 'required')}
      <label>目录文件（UTF-8 文本）<input type="file" id="outlineFile" accept=".txt,text/plain"></label>
      <textarea name="outline" id="outlineText" required placeholder="第一章 章节标题 | 本次知识点"></textarea><button class="primary">导入并生成任务</button></form>`); break;
    case 'upChapter': case 'downChapter': {
      const cs = chaptersOf(store.records, t.courseId), i = cs.findIndex(x => x.id === key), other = cs[i + (name === 'upChapter' ? -1 : 1)];
      if (other) { await store.put({ ...t, order: other.order }); await store.put({ ...other, order: t.order }); render(); await cloud.sync(); }
      break;
    }

    /* 同步冲突 */
    case 'resolve': modal('处理同时修改', `<h3>本机版本</h3><pre>${esc(JSON.stringify(t, null, 2))}</pre><h3>云端版本</h3><pre>${esc(JSON.stringify(t.conflict.payload, null, 2))}</pre>
      ${action('采用云端版本', 'useRemote', key)}${t.conflict.payload.deleted ? '' : action('保留本机修改', 'useLocal', key)}`); break;
    case 'useRemote': case 'useLocal': {
      download(t, '同步冲突备份-' + hash(key) + '.json');
      const remote = t.conflict;
      await store.transaction([name === 'useRemote' ? { ...remote.payload, version: remote.version, dirty: false } : { ...t, version: remote.version, conflict: undefined, dirty: true, mutation: id() }]);
      closeModal(); await cloud.sync(); render(); break;
    }

    default: break;
  }
}

const slotStartOf = k => slotOf(k)?.start || '';
const slotEndOf = (k, dur) => { const sl = slotOf(k); return sl ? clock(minutes(sl.start) + (dur || 30)) : ''; };

async function toggleFixed(fid, date) {
  const rid = `fix:${fid}:${date}`;
  const f = store.get(fid);
  const cur = store.get(rid);
  if (cur?.done) await store.put({ ...cur, done: false });
  else {
    const done = { id: rid, kind: 'task', title: f?.title || '固定日程', category: '固定课程', date, slot: f?.slot || '', start: f?.start || '', end: f?.end || '', duration: f?.start ? Math.max(5, minutes(f.end) - minutes(f.start)) : 30, done: true, locked: true, source: 'fixed' };
    if (cur) await store.put({ ...cur, done: true }); else await store.merge([done]);
  }
  render(); await cloud.sync();
}

async function reseedData() {
  if (!confirm('用种子数据重建课程与章节？已有任务记录不会删除。')) return;
  await backup();
  await store.merge(content);
  for (const c of content.filter(x => x.kind === 'chapter')) {
    const cur = store.get(c.id);
    if (cur && cur.weight == null) await store.put({ ...cur, weight: c.weight });
  }
  await putSetting({ seedVersion: 4 });
  await refreshAuto();
  render(); await cloud.sync(); toast('课程数据已重建');
}

function showPreviewModal(p) {
  preview = p;
  modal('重新排期预览', `<p>将安排 ${p.moves.length} 项；排不下 ${p.unplaced.length} 项。已完成和已锁定的任务保持原样。</p>
    ${p.unplaced.length ? '<div class="notice">排不下的任务会留在章节里，不会硬挤进同一天。</div>' : ''}
    ${p.moves.map(m => `<p class="meta">${esc(m.date)} ${esc(m.slot)} ${esc(m.start)}–${esc(m.end)} · ${esc(store.get(m.id)?.title || m.id)}</p>`).join('')}
    ${action('应用此排期', 'applyPreview', '', 'primary')}`);
}

/* ── 备份 ─────────────────────────────────────────────────── */
function download(obj, name) {
  const a = document.createElement('a');
  const u = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  a.href = u; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(u), 10000);
}
async function backup() {
  download({ format: 'growth-v4', date: today(), records: store.records.map(({ dirty, conflict, ...r }) => r) }, '学习成长备份-' + today() + '.json');
}
function validateBackup(o) {
  if (o?.format === 'growth-v4') {
    if (!Array.isArray(o.records) || !o.records.every(r => r && typeof r.id === 'string' && typeof r.kind === 'string') || new Set(o.records.map(r => r.id)).size !== o.records.length) throw Error('备份记录格式错误');
    return o.records.map(({ version, mutation, dirty, conflict, ...r }) => r);
  }
  return migrate(o);
}
async function importData(o) {
  const rows = validateRecords(validateBackup(o));
  await backup();
  await store.merge(rows);
  render(); await cloud.sync(); toast(`已合并 ${rows.length} 条；已有 ID 保留原记录，原备份已下载。`);
}

/* ── 事件 ─────────────────────────────────────────────────── */

/* 点击 */
document.addEventListener('click', async e => {
  if (Date.now() - lastDragEnd < 400) return;
  const b = e.target.closest('button');
  if (b?.dataset.page) {
    page = b.dataset.page; location.hash = page; render(); window.scrollTo(0, 0); return;
  }
  if (!b?.dataset.action) return;
  b.disabled = true;
  try { await handle(b.dataset.action, b.dataset.id); }
  catch (err) { toast(err.message || String(err)); }
  finally { b.disabled = false; }
});

/* 勾选 */
document.addEventListener('change', async e => {
  try {
    if (e.target.id === 'lifeMonth') { lifeMonth = e.target.value; render(); }
    else if (e.target.dataset.task) { await complete(e.target.dataset.task, e.target.checked); }
    else if (e.target.dataset.fix) { const [fid, date] = e.target.dataset.fix.split('@'); await toggleFixed(fid, date); }
    else if (e.target.id === 'importFile' && e.target.files[0]) await importData(JSON.parse(await e.target.files[0].text()));
  } catch (err) { toast('未应用：' + (err.message || err)); render(); }
});

/* 表单 */
document.addEventListener('submit', async e => {
  const f = e.target;
  if (!f.dataset.form) return;
  e.preventDefault();
  const button = e.submitter; if (button) button.disabled = true;
  const d = Object.fromEntries(new FormData(f));
  const key = f.dataset.id, t = store.get(key);
  try {
    switch (f.dataset.form) {
      case 'task': {
        if (d.chapterId && store.get(d.chapterId)?.courseId !== d.courseId) throw Error('章节必须属于所选课程');
        const sl = slotOf(d.slot);
        const duration = +d.duration;
        const x = { ...t, ...d, _baseVersion: +f.dataset.version, id: key || id(), kind: 'task', duration, locked: true, done: t?.done || false, source: t?.source || 'manual' };
        if (sl) { x.start = sl.start; x.end = clock(minutes(sl.start) + duration); }
        else { x.start = ''; x.end = ''; }
        await save(x); closeModal(); break;
      }
      case 'note': await save({ ...t, note: d.note, _baseVersion: +f.dataset.version }); toast('笔记已保存'); break;
      case 'selftest': await save({ ...t, selftest: d.result, selftested: true, _baseVersion: +f.dataset.version }); await detail(key); break;
      case 'postpone': await save({ ...t, date: d.date, slot: '', start: '', end: '', locked: false }); closeModal(); break;
      case 'course':
        if (d.deadline < d.start) throw Error('截止日期应晚于开始日期');
        await save({ ...t, ...d, id: key || id(), kind: 'course', frequency: +d.frequency, priority: +d.priority }); closeModal(); break;
      case 'chapter': await save({ ...t, ...d, _baseVersion: +f.dataset.version, weight: d.weight != null ? clamp(+d.weight, 1, 5) : t?.weight }); closeModal(); break;
      case 'weight': await save({ id: id(), kind: 'weight', date: d.date, kg: +d.kg }); closeModal(); break;
      case 'bill': await save({ id: id(), kind: 'bill', date: d.date, type: d.type, amount: +d.amount, cat: d.cat, note: d.note }); closeModal(); break;
      case 'card': await save({ id: id(), kind: 'card', front: d.front, back: d.back, chapterId: t?.chapterId, stage: 0, next: addDays(today(), 1) }); closeModal(); break;
      case 'cards': {
        const o = JSON.parse(d.json);
        if (!Array.isArray(o.cards) || !o.cards.every(x => typeof x.front === 'string' && typeof x.back === 'string')) throw Error('卡片格式错误');
        await backup();
        await store.merge(o.cards.map(x => ({ ...x, id: 'card:' + hash(x.front + '|' + x.back), kind: 'card', stage: 0, next: addDays(today(), 1) })));
        closeModal(); render(); await cloud.sync(); break;
      }
      case 'settings': {
        const s = settings();
        await putSetting({ capacity: +d.capacity, break: +d.break, dailyFill: +d.dailyFill, focusMinutes: +d.focusMinutes });
        closeModal(); render(); await cloud.sync(); toast('设置已保存'); break;
      }
      case 'onboard': {
        if (new Date(d.semester + 'T12:00').getDay() !== 1) throw Error('请选择周一作为学期开始');
        await putSetting({ semester: d.semester, confirmed: true });
        closeModal(); render(); break;
      }
      case 'login': {
        await cloud.login(d.email, d.password, e.submitter?.value === 'signup');
        store.close(); store = await new Store(cloud.session.user.id).open(); cloud.store = store;
        await ensureSeed(); await refreshAuto(); closeModal(); await cloud.sync(); render(); break;
      }
      default: break;
    }
  } catch (err) { toast('未完成：' + (err.message || err)); }
  finally { if (button) button.disabled = false; }
});

async function complete(key, value) {
  const t = store.get(key); if (!t) return;
  const done = value ?? !t.done;
  await store.complete(key, done);
  render();
  if ($('#focus') && !$('#focus').hidden && focusState?.taskId === key && done) stopFocus();
  await cloud.sync();
}

/* 拖动：桌面直接拖，手机长按 350ms。不用原生 HTML5 DnD —— 它会触发 pointercancel 打断手势 */
document.addEventListener('dragstart', e => { if (e.target.closest?.('.ev-draggable')) e.preventDefault(); });
function dragTargetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el ? el.closest('.wg-cell') : null;
}
function clearDropMarks() {
  document.querySelectorAll('.wg-cell.drop-ok').forEach(c => c.classList.remove('drop-ok'));
  document.querySelectorAll('.ev.dragging').forEach(c => c.classList.remove('dragging'));
  document.body.classList.remove('dragging-mode');
}
function armDrag(e) {
  if (!drag) return;
  drag.armed = true;
  drag.el.classList.add('dragging');
  document.body.classList.add('dragging-mode');
  if (e?.pointerId != null) { try { drag.el.setPointerCapture(e.pointerId); } catch { /* 忽略 */ } }
}
document.addEventListener('pointerdown', e => {
  const el = e.target.closest?.('.ev-draggable');
  if (!el || e.button > 0) return;
  drag = { el, pid: e.pointerId, x0: e.clientX, y0: e.clientY, armed: false, target: null, timer: 0 };
  if (e.pointerType === 'mouse') drag.mouse = true;
  else drag.timer = setTimeout(() => armDrag(), 350);
});
document.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = Math.abs(e.clientX - drag.x0), dy = Math.abs(e.clientY - drag.y0);
  if (!drag.armed) {
    if (drag.mouse) { if (Math.hypot(dx, dy) > 5) armDrag(e); }
    else if (Math.hypot(dx, dy) > 10) { clearTimeout(drag.timer); drag = null; }
    return;
  }
  if (e.cancelable) e.preventDefault();
  const cell = dragTargetAt(e.clientX, e.clientY);
  clearDropMarks();
  drag.el.classList.add('dragging');
  document.body.classList.add('dragging-mode');
  if (cell) { cell.classList.add('drop-ok'); drag.target = cell; }
}, { passive: false });
document.addEventListener('pointerup', async () => {
  if (!drag) return;
  const d = drag; drag = null;
  clearTimeout(d.timer);
  const armed = d.armed, cell = d.target;
  clearDropMarks();
  if (!armed) return;
  lastDragEnd = Date.now();
  if (!cell) return;
  const date = cell.dataset.date, slot = cell.dataset.slot;
  const t = store.get(d.el.dataset.id);
  if (!t || (t.date === date && t.slot === slot)) return;
  const sl = slotOf(slot);
  await store.put({ ...t, date, slot, start: sl.start, end: clock(minutes(sl.start) + (t.duration || 30)), locked: false });
  render(); await cloud.sync();
  const s = settings();
  const inst = fixedInstances(store.all('fixed'), s, date, 1);
  const dayTasks = allTasks().filter(x => x.date === date);
  const bad = conflicts([...inst, ...dayTasks]);
  if (bad.has(t.id)) toast('⚠ 这个时段有冲突，已经标出来了');
  else toast('已移动到 ' + shortDate(date) + ' ' + slot);
});
document.addEventListener('pointercancel', () => { if (drag) { clearTimeout(drag.timer); drag = null; clearDropMarks(); } });

/* 顶部与全局 */
$('#close').onclick = closeModal;
$('#sync').onclick = () => handle('sync');
window.addEventListener('online', () => cloud.sync().then(render));
window.addEventListener('offline', () => cloud.statusSet(cloud.session ? '离线待同步' : '本地模式 · 离线可用'));
window.addEventListener('hashchange', () => {
  const p = location.hash.slice(1);
  if (['today', 'week', 'courses', 'review', 'life', 'rewards', 'settings'].includes(p)) { page = p; render(); }
});
window.addEventListener('focus', async () => { store.records = await store.readAll(); await cloud.sync(); render(); });
setInterval(() => { if (!document.hidden) cloud.sync().then(() => { if (!$('#modal').open) render(); }); }, 60000);

/* ── 渲染入口（唯一一处） ─────────────────────────────────── */
const PAGES = { today: ['☀', '今日'], week: ['▦', '行程'], courses: ['▤', '学习'], review: ['◇', '复习'], life: ['♡', '生活'], rewards: ['✧', '奖励'], settings: ['⚙', '设置'] };
function render() {
  $('#nav').innerHTML = Object.entries(PAGES).map(([k, [icon, title]]) => `<button class="${page === k ? 'active' : ''}" data-page="${k}"><span>${icon}</span> ${title}</button>`).join('');
  $('#date').textContent = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  $('#heading').textContent = (PAGES[page] || PAGES.today)[1];
  $('#sync').textContent = cloud.status;
  const body = { today: renderToday, week: renderWeek, courses: renderCourses, review: renderReview, life: renderLife, rewards: renderRewards, settings: renderSettings }[page] || renderToday;
  $('#main').innerHTML = body();
}

/* ── 启动 ─────────────────────────────────────────────────── */
applyTheme(settings().theme);
page = Object.keys(PAGES).includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';
render();
await ensureSeed();
await ensureChapterTasks();
await ensureHomework();
await ensureDaily();
render();
await cloud.sync();
render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(r => {
    r.update();
    /* 只有「本来就已经被旧版本接管」时才提示更新；首次安装不该弹 */
    if (navigator.serviceWorker.controller) {
      r.addEventListener('updatefound', () => {
        r.installing?.addEventListener('statechange', () => { if (r.waiting) toast('新版本已就绪，关闭此应用后重新打开即可更新'); });
      });
    }
  }).catch(e => toast('离线缓存未启用：' + e.message));
}
