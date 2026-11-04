/* core.js — 纯函数层：日期、时段、学期、排期、冲突、加权进度、作业生成、每日补任务
 * 约定：所有函数不碰 DOM、不碰 IndexedDB，只做纯计算，方便单测。
 */
export const fmtDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => fmtDate(new Date());
export const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return fmtDate(d); };
export const monday = s => addDays(s, -((new Date(s + 'T12:00:00').getDay() + 6) % 7));
/* wdOf: 0=周一 … 6=周日（与 fixed.wd 的 1=周一/0=周日 不同，注意区分） */
export const wdOf = s => (new Date(s + 'T12:00:00').getDay() + 6) % 7;
export const dateDiff = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
export const id = () => crypto.randomUUID();
export const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(36); };
export const minutes = t => { const [h, m] = String(t || '00:00').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const clock = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ── 六个时段：全局唯一来源。行程页行 = 这六个 ── */
export const SLOTS = [
  { key: '早', start: '08:30', end: '10:10', label: '早' },
  { key: '上午', start: '10:25', end: '12:05', label: '上午' },
  { key: '下午', start: '14:00', end: '17:35', label: '下午' },
  { key: '傍晚', start: '18:30', end: '19:30', label: '傍晚' },
  { key: '晚上', start: '19:30', end: '21:30', label: '晚上' },
  { key: '睡前', start: '22:00', end: '23:00', label: '睡前' },
];
export const SLOT_KEYS = SLOTS.map(s => s.key);
export const slotOf = k => SLOTS.find(s => s.key === k) || null;
export const slotStart = k => slotOf(k)?.start || '09:00';
export const slotEnd = k => slotOf(k)?.end || '09:30';

/* ── 六套主题 ── */
export const THEMES = [
  { key: 'blue', label: '蓝' }, { key: 'cyan', label: '青' }, { key: 'purple', label: '紫' },
  { key: 'orange', label: '橙' }, { key: 'rose', label: '玫' }, { key: 'ink', label: '墨' },
];
export const THEME_KEYS = THEMES.map(t => t.key);

/* ── 默认设置 ── */
export const defaults = {
  confirmed: true,
  seedVersion: 5,
  semester: '2026-09-07',      // 第一学期第 1 周周一
  semester2: '2027-03-01',     // 第二学期第 1 周周一
  examStart: '2026-12-28',     // 期末考试开始
  examEnd: '2027-01-08',       // 期末考完（此后放开考研）
  gradExam: '2027-12-19',      // 考研初试
  politicsStart: '2027-07-01', // 政治开排
  horizon: 28, break: 10, capacity: 150,
  dailyFill: 4,                // 每天自动补几条
  focusMinutes: 2,             // 「开始 2 分钟」
  theme: 'rose',
  showAllCourses: false,
  hwAnchor: '',                // 作业错峰锚点（首次生成时写入 = 今天+14）
  windows: Array.from({ length: 7 }, () => ['07:00', '23:00']),
};

/* ── 学期周号：返回 1..N，不在任何学期内返回 0 ── */
export function semesterWeek(date, s = defaults) {
  let best = 0;
  for (const key of ['semester', 'semester2']) {
    const st = s[key];
    if (!st) continue;
    const w = Math.floor(dateDiff(monday(st), monday(date)) / 7) + 1;
    if (w >= 1 && (best === 0 || w < best)) best = w;
  }
  return best;
}
export const inSemester = (date, s = defaults) => semesterWeek(date, s) >= 1;

/* ── 固定日程展开成「某一天的一条」 ── */
export function fixedInstances(fixedRecords, s, from, days = 7) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const wk = semesterWeek(date, s);
    if (!wk) continue;
    const jsDay = new Date(date + 'T12:00:00').getDay(); // 0=周日
    for (const f of fixedRecords) {
      if (Number(f.wd) !== jsDay) continue;
      const w0 = Number.isFinite(Number(f.from)) ? Number(f.from) : 1;
      const w1 = Number.isFinite(Number(f.to)) ? Number(f.to) : 60;
      if (wk < w0 || wk > w1) continue;
      const instanceId = `fx:${f.id}:${date}`;
      out.push({
        ...f, id: instanceId, kind: 'fixedInstance', fixedId: f.id, instanceId,
        date, locked: true, category: f.cat || '固定课程',
      });
    }
  }
  return out;
}

/* ── 冲突：同一天、时间真实重叠。soft=true 的固定日程（如请假去的复诊）不算冲突 ── */
export function conflicts(items) {
  const bad = new Set();
  const list = items.filter(x => x && x.date && x.start && x.end && !x.soft);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.date !== b.date) continue;
      if (a.id === b.id) continue;
      if (a.start < b.end && b.start < a.end) { bad.add(a.instanceId || a.id); bad.add(b.instanceId || b.id); }
    }
  }
  return bad;
}

/* ── 课程 / 章节工具 ── */
export const live = rows => (rows || []).filter(r => r && !r.deleted);
export const byCourse = (rows, cid) => live(rows).filter(r => r.courseId === cid);
export const chaptersOf = (rows, cid) => byCourse(rows, cid).filter(r => r.kind === 'chapter').sort((a, b) => (a.order || 0) - (b.order || 0));
export const tasksOf = (rows, cid) => byCourse(rows, cid).filter(r => r.kind === 'task');
export const chapterWeight = ch => clamp(Math.round(Number(ch?.weight) || 3), 1, 5);

/* ── 加权进度：Σ(章节 weight × 该章任务完成率) / Σ(章节 weight) ── */
export function courseProgress(courseId, records) {
  const chs = chaptersOf(records, courseId);
  const ts = tasksOf(records, courseId);
  let total = 0, got = 0, chDone = 0;
  for (const ch of chs) {
    const w = chapterWeight(ch);
    const list = ts.filter(t => t.chapterId === ch.id);
    total += w;
    if (!list.length) continue;
    const done = list.filter(t => t.done).length;
    got += w * done / list.length;
    if (done === list.length) chDone++;
  }
  return { percent: total ? Math.round(got / total * 100) : 0, done: chDone, total: chs.length, weighted: { got: Math.round(got * 10) / 10, total } };
}

/* 课程的下一条未完成任务 */
export function nextTaskOf(courseId, records) {
  const ts = tasksOf(records, courseId).filter(t => !t.done && t.category !== '作业');
  ts.sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.id).localeCompare(String(b.id)));
  return ts[0] || null;
}

/* 未排期的下一条任务（用于每日补任务） */
export function nextFreeTask(courseId, records) {
  const ts = tasksOf(records, courseId).filter(t => !t.done && t.category !== '作业' && !t.date);
  ts.sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.id).localeCompare(String(b.id)));
  return ts[0] || null;
}

/* ── 每日补 4 条 ──────────────────────────────────────────────
 * 直接给已有章节任务写 date，不复制新任务。
 * 返回：{ date, ids:[taskId], thesis:[], hobby:[] }
 * 配额（期末期 date <= examEnd）：英语 1 + 期末四门 2 + 考研 1 = 4
 * 配额（期末后）：英语 1 + 考研 2 + 政治(2027-07 起) 1
 * 论文不参与每日挑选（每周固定 1 条）；兴趣每周各至少 1 次。
 */
export const EXAM_DIFF = ['g-org', 'g-inorg', 'g-food', 'g-cook']; // 难度优先
export const GRAD_IDS = ['g-biochem', 'g-cell'];
export const HOBBY_IDS = ['g-dou', 'g-draw', 'g-drum'];
const HOBBY_DAY = { 'g-dou': 0, 'g-draw': 2, 'g-drum': 4 }; // 周一/周三/周五

export function dailyPicks(date, records, settings) {
  const s = { ...defaults, ...(settings || {}) };
  const recs = live(records);
  const tasks = recs.filter(r => r.kind === 'task');
  const result = { date, ids: [], thesis: [], hobby: [], quota: {} };
  if (!inSemester(date, s)) return result;

  const weekStart = monday(date);
  const weekEnd = addDays(weekStart, 6);
  const wd = wdOf(date);
  const assignedIn = (cid, from, to) => tasks.some(t => t.courseId === cid && t.date && t.date >= from && t.date <= to);
  const assignedOn = cid => tasks.some(t => t.courseId === cid && t.date === date);
  const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || String(a.id).localeCompare(String(b.id));
  const freeOf = cid => tasks.filter(t => !t.done && t.courseId === cid && t.category !== '作业' && !t.date).sort(byOrder);
  const countOf = cid => result.ids.filter(id => tasks.find(t => t.id === id)?.courseId === cid).length;
  const takeN = (cid, n = 1) => {
    let got = 0;
    for (let k = 0; k < n; k++) {
      const t = freeOf(cid)[countOf(cid)];
      if (!t) break;
      result.ids.push(t.id); got++;
    }
    return got;
  };

  /* ── 配额：期末期 英语1 + 期末四门2 + 考研1；期末后 英语1 + 考研2/3 (+政治1) ── */
  const beforeExam = date <= s.examEnd;
  const politicsOn = date >= s.politicsStart;
  const want = beforeExam
    ? { eng: 1, exam: 2, grad: 1, politics: 0 }
    : { eng: 1, exam: 0, grad: politicsOn ? 2 : 3, politics: politicsOn ? 1 : 0 };
  result.quota = { ...want };

  /* 期末四门：第一槽难度优先（有机>无机>食品工艺>烹饪），第二槽按星期轮换保证四门都覆盖 */
  if (want.exam > 0) {
    const examCount = () => EXAM_DIFF.reduce((n, cid) => n + countOf(cid), 0);
    const first = EXAM_DIFF.find(cid => freeOf(cid).length > countOf(cid) && !assignedOn(cid));
    if (first) takeN(first, 1);
    let guard = 0;
    while (examCount() < want.exam && guard++ < 8) {
      const rest = EXAM_DIFF.filter(cid => freeOf(cid).length > countOf(cid) && !assignedOn(cid));
      if (!rest.length) break;
      takeN(rest[wd % rest.length], 1);
    }
  }

  /* 英语：每天 1 条 */
  if (want.eng > 0 && !assignedOn('g-eng')) takeN('g-eng', want.eng);

  /* 考研：期末期 ≤1，期末后放开到 2—3 */
  let needGrad = want.grad;
  for (let i = 0; needGrad > 0 && i < 8; i++) {
    const cid = GRAD_IDS[i % GRAD_IDS.length];
    if (takeN(cid, 1)) needGrad--;
    else if (takeN(GRAD_IDS[(i + 1) % GRAD_IDS.length], 1)) needGrad--;
    else break;
  }

  /* 政治：2027-07 前一律不排 */
  if (want.politics > 0 && politicsOn && !assignedOn('g-politics')) takeN('g-politics', 1);

  /* 名额没满 → 用当期还没结束的课补齐到 dailyFill（期末考完就不再补期末四门） */
  let guard = 0;
  while (result.ids.length < s.dailyFill && guard++ < 12) {
    const pool = [...(beforeExam ? EXAM_DIFF : []), ...GRAD_IDS].filter(cid => freeOf(cid).length > countOf(cid));
    if (!pool.length) break;
    takeN(pool[guard % pool.length], 1);
  }

  /* 论文：不参与每日挑选，每学期周固定 1 条（周三） */
  if (wd === 2 && !assignedIn('g-thesis', weekStart, weekEnd) && !assignedOn('g-thesis')) {
    if (takeN('g-thesis', 1)) result.thesis.push(result.ids[result.ids.length - 1]);
  }
  /* 兴趣：每周各至少 1 次，错开到周一/周三/周五 */
  for (const cid of HOBBY_IDS) {
    if (assignedIn(cid, weekStart, weekEnd)) continue;
    if (wd !== HOBBY_DAY[cid]) continue;
    if (takeN(cid, 1)) result.hobby.push(result.ids[result.ids.length - 1]);
  }
  return result;
}

/* ── 作业自动生成 ─────────────────────────────────────────────
 * 纯函数：只返回「应该新建」的记录，由 main.js 负责落库。
 * 已存在（含被删除的墓碑）的 id 不会重复生成。
 * 只生成 今天 ≤ 截止 ≤ 今天+21 的，界面上只显示 今天 ≤ 截止 ≤ 今天+7。
 */
export const HW_RULES = [
  { courseId: 'g-inorg', kind: 'weekly', wd: 1, from: 1, to: 16, dueOffset: 7, items: [{ key: 'note', name: '课堂笔记', min: 20 }, { key: 'mindmap', name: '思维导图', min: 20 }, { key: 'handin', name: '手写作业', min: 25 }] },
  { courseId: 'extra-3', kind: 'weekly', wd: 4, from: 1, to: 12, dueOffset: 7, items: [{ key: 'report', name: '实训报告', min: 30 }] },
  { courseId: 'extra-2', kind: 'weekly', wd: 3, from: 1, to: 12, dueOffset: 7, items: [{ key: 'online', name: '学习通作业', min: 20 }] },
  { courseId: 'extra-0', kind: 'weekly', wd: 3, from: 14, to: 17, dueOffset: 7, items: [{ key: 'report', name: '实验实训报告', min: 30 }] },
  { courseId: 'extra-5', kind: 'once', due: '2026-11-06', items: [{ key: 'exam', name: '结业实操考试', min: 60 }] },
  { courseId: 'extra-1', kind: 'once', dueAnchor: 0, items: [{ key: 'proposal', name: '开题报告', min: 45 }] },
  { courseId: 'g-org', kind: 'spread', count: 5, items: [{ key: 'handin', name: '书面作业', min: 30 }] },
];
export const HW_LOOKAHEAD = 21;   // 生成窗口（天）
export const HW_SHOW = 7;         // 显示窗口（天）

export function hwTasks(date, records, settings) {
  const s = { ...defaults, ...(settings || {}) };
  const recs = live(records);
  const courses = recs.filter(r => r.kind === 'course');
  const courseTitle = cid => courses.find(c => c.id === cid)?.title || cid;
  const exists = new Set((records || []).map(r => r && r.id)); // 含墓碑：删过的不会再生成
  const out = [];
  const add = (tid, o) => { if (!tid || exists.has(tid) || out.some(x => x.id === tid)) return; out.push({ id: tid, kind: 'task', category: '作业', source: 'hw', date: '', done: false, ...o }); };
  const anchor = s.hwAnchor || addDays(date, 14);
  const semStart = monday(s.semester);
  const horizonEnd = addDays(date, HW_LOOKAHEAD);

  const weekDate = (w, wd) => addDays(addDays(semStart, (w - 1) * 7), wd === 0 ? 6 : wd - 1);

  for (const rule of HW_RULES) {
    const title = courseTitle(rule.courseId);
    const tag = rule.courseId.replace(/^extra-/, 'x');
    if (rule.kind === 'weekly') {
      for (let w = rule.from; w <= rule.to; w++) {
        const classDate = weekDate(w, rule.wd);
        const due = addDays(classDate, rule.dueOffset);
        if (due < date || due > horizonEnd) continue;
        for (const it of rule.items) {
          add(`hw:${tag}:${classDate}:${it.key}`, {
            title: `${title} · ${it.name}`, courseId: rule.courseId, duration: it.min,
            due, hwKind: it.key, hwDate: classDate,
          });
        }
      }
    } else if (rule.kind === 'once') {
      const due = rule.due || addDays(anchor, rule.dueAnchor || 0);
      if (due < date || due > horizonEnd) continue;
      for (const it of rule.items) {
        add(`hw:${tag}:${it.key}`, {
          title: `${title} · ${it.name}`, courseId: rule.courseId, duration: it.min,
          due, hwKind: it.key, hwDate: due,
        });
      }
    } else if (rule.kind === 'spread') {
      /* 错峰：从锚点到期末考完均分，绝不堆在最后一天 */
      const startAt = anchor, endAt = s.examEnd;
      const n = rule.count, span = Math.max(n - 1, 1);
      for (let i = 0; i < n; i++) {
        const due = addDays(startAt, Math.round(dateDiff(startAt, endAt) * i / span));
        if (due < date || due > horizonEnd) continue;
        for (const it of rule.items) {
          add(`hw:${tag}:${i + 1}`, {
            title: `${title} · ${it.name} ${i + 1}/${n}`, courseId: rule.courseId,
            duration: it.min, due, hwKind: it.key, hwOrder: i + 1,
          });
        }
      }
    }
  }
  return out;
}

/* 有机 5 次作业的截止日预览（设置页/测试用） */
export function orgDueDates(settings) {
  const s = { ...defaults, ...(settings || {}) };
  const startAt = s.hwAnchor || addDays(today(), 14);
  const n = 5;
  return Array.from({ length: n }, (_, i) => addDays(startAt, Math.round(dateDiff(startAt, s.examEnd) * i / (n - 1))));
}

/* ── 排期预览：把没日期的任务填进空的 (date, slot) 格子 ── */
export function planAll(records, settings, start = today()) {
  const s = { ...defaults, ...(settings || {}) };
  const recs = live(records);
  const tasks = recs.filter(r => r.kind === 'task');
  const courses = recs.filter(r => r.kind === 'course');
  const fixed = recs.filter(r => r.kind === 'fixed');

  const cand = tasks.filter(t => !t.done && !t.date && t.category !== '固定课程' && t.source !== 'hw').sort((a, b) => {
    const ca = courses.find(c => c.id === a.courseId) || {}, cb = courses.find(c => c.id === b.courseId) || {};
    return (cb.priority || 1) - (ca.priority || 1) || String(ca.deadline || '9999').localeCompare(String(cb.deadline || '9999')) || (a.order || 0) - (b.order || 0);
  });

  const occupied = new Set();
  /* 每日容量只统计「要自己学的任务」，固定课程不占学习容量，只占格子 */
  const daily = {};
  for (const t of tasks) {
    if (!t.date || t.category === '固定课程') continue;
    daily[t.date] = (daily[t.date] || 0) + (t.duration || 30);
  }
  for (const t of tasks) if (t.date && t.slot) occupied.add(t.date + '|' + t.slot);
  for (const f of fixedInstances(fixed, s, start, s.horizon)) occupied.add(f.date + '|' + f.slot);

  const moves = [], unplaced = [];
  for (const t of cand) {
    const c = courses.find(x => x.id === t.courseId) || {};
    const dur = t.duration || 30;
    let placed = false;
    for (let n = 0; n < s.horizon && !placed; n++) {
      const date = addDays(start, n);
      if (date < (c.start || start) || date > (c.deadline || '9999-12-31')) continue;
      if (!inSemester(date, s)) continue;
      if ((daily[date] || 0) + dur > s.capacity) continue;
      for (const sl of SLOTS) {
        if (occupied.has(date + '|' + sl.key)) continue;
        const begin = minutes(sl.start);
        const end = begin + dur;
        if (end > minutes(sl.end) + 120) continue; // 不硬塞
        occupied.add(date + '|' + sl.key);
        daily[date] = (daily[date] || 0) + dur;
        moves.push({ id: t.id, date, slot: sl.key, start: sl.start, end: clock(end) });
        placed = true; break;
      }
    }
    if (!placed) unplaced.push(t.id);
  }
  return { moves, unplaced };
}

/* ── 任务学习指导（保留原有语义，缺省生成） ── */
export function taskGuide(course, chapter) {
  const p = chapter?.topic || chapter?.title || '这个知识点';
  return {
    prerequisite: chapter?.prerequisite || '能读懂本节关键词；不懂时先用 5 分钟写出 3 个生词并查讲义。',
    objective: chapter?.objective || `能用自己的话说明「${p}」，并完成一个小作品或练习。`,
    steps: [
      `第 1 步 · 5 分钟：回忆前置知识，写下对「${p}」的一个问题。`,
      `第 2 步 · 15 分钟：阅读对应讲义，边读边画关系图；只处理这一个知识点。`,
      `第 3 步 · 10 分钟：合上材料完成练习，再对照材料用另一种颜色订正。`,
    ],
    material: chapter?.material || '本课程课堂讲义或教材对应小节；版本与页码待补充。',
    example: chapter?.example || `把「${p}」放进一个具体场景：先写输入条件，再写处理过程，最后写结果。`,
    practice: chapter?.practice || `不看资料，解释「${p}」的含义，写一个例子和一个容易混淆的情况。`,
    output: chapter?.output || '一张概念图＋一个例子＋订正记录。',
    acceptance: '能脱离材料讲解核心概念，完成练习并核对；不会的地方已标注。仅计时不算完成。',
    fallback: '缩小到一个术语：查定义→用自己的话复述→举一个例子。仍不会就记下问题，下次先补基础。',
  };
}

/* ── 旧格式迁移 ── */
export function migrate(old) {
  if (!old || typeof old !== 'object' || !Array.isArray(old.goals) || !Array.isArray(old.fixed)) throw Error('不是有效的 life-system-v3 备份');
  if (!old.goals.every(g => g && typeof g.id === 'string' && typeof g.title === 'string' && Array.isArray(g.sessions) && g.sessions.every(t => t && typeof t.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date)))) throw Error('目标或学习记录格式错误');
  const out = [], put = (kind, key, x) => out.push({ ...x, id: 'legacy:' + kind + ':' + key, kind });
  put('archive', 'original', { raw: old });
  for (const g of old.goals) {
    out.push({ id: g.id, kind: 'course', title: g.title, category: g.cat, start: g.start, deadline: g.deadline, frequency: g.perWeek || 2, priority: 1 });
    for (const s of g.sessions) put('task', s.id, { ...s, courseId: g.id, legacyCredited: !!s.done, duration: 30, category: g.cat, legacy: true, locked: true, slot: s.slot });
  }
  for (const f of old.fixed) { if (!f || typeof f.id !== 'string' || typeof f.title !== 'string' || !Number.isInteger(f.wd)) throw Error('固定课程格式错误'); out.push({ ...f, id: 'fixed-' + f.id, kind: 'fixed' }); }
  for (const [key, done] of Object.entries(old.fixedDone || {})) {
    if (!done) continue;
    const i = key.indexOf(':'), f = old.fixed.find(x => x.id === key.slice(0, i)), wk = key.slice(i + 1);
    if (f && /^\d{4}-\d{2}-\d{2}$/.test(wk)) { const date = addDays(wk, (f.wd + 6) % 7); out.push({ id: 'fixed-' + f.id + ':' + date, kind: 'task', title: f.title, category: '固定课程', slot: f.slot, date, duration: 30, locked: true, done: true, legacyCredited: true }); }
  }
  for (const [k, list] of Object.entries({ card: old.cards || [], weight: old.weights || [], redemption: old.redeemed || [] })) {
    if (!Array.isArray(list)) throw Error(k + ' 格式错误');
    list.forEach((v, i) => { if (!v || typeof v !== 'object') throw Error(k + ' 格式错误'); put(k, v.id || hash(JSON.stringify(v)) + ':' + i, v); });
  }
  for (const [k, obj] of Object.entries({ bill: old.bills || {}, water: old.water || {}, exercise: old.exercise || {} })) {
    if (!obj || typeof obj !== 'object') throw Error(k + ' 格式错误');
    Object.entries(obj).forEach(([key, v]) => { if (k === 'water' || k === 'exercise') out.push({ id: k + ':' + key, kind: k, date: key, value: v, done: k === 'exercise' && Array.isArray(v) ? v.length > 0 : undefined }); else put(k, key, typeof v === 'object' ? v : { date: key, value: v }); });
  }
  for (const x of [...(old.tasks || []), ...(old.custom || [])]) {
    if (!x || typeof x.title !== 'string') throw Error('待办格式错误');
    if (/服药|喝水|运动|记账|专业课|课程作业/.test(x.title)) continue;
    put('task', x.id || hash(x.title), { title: x.title, date: x.doneDate || today(), done: x.doneDate === today(), duration: 20, category: '生活', locked: true });
  }
  put('opening', 'balance', { amount: (Number(old.points) || 0) + (old.redeemed || []).reduce((n, r) => n + (Number(r.cost) || 0), 0) });
  put('setting', 'profile', { height: old.height, target: old.target });
  return out;
}

export const KINDS = ['course', 'chapter', 'task', 'fixed', 'card', 'weight', 'redemption', 'bill', 'water', 'exercise', 'award', 'opening', 'setting', 'archive', 'research', 'settlement', 'retry', 'hwplan'];

export function validateRecords(rows) {
  if (!Array.isArray(rows) || rows.length > 50000) throw Error('记录数量或格式不正确');
  const ids = new Set();
  const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d + 'T12:00').valueOf());
  for (const r of rows) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id || ids.has(r.id) || !KINDS.includes(r.kind)) throw Error('记录 ID 或类型不正确');
    ids.add(r.id);
    if (r.deleted) continue;
    if (['course', 'chapter', 'task', 'fixed'].includes(r.kind) && (typeof r.title !== 'string' || !r.title.trim())) throw Error('课程、章节或任务缺少标题');
    if (r.kind === 'task') {
      if (!Number.isFinite(r.duration) || r.duration < 1 || r.duration > 1440) throw Error('任务时长不正确');
      if (r.date && !validDate(r.date)) throw Error('任务日期错误');
      if (r.due && !validDate(r.due)) throw Error('作业截止日期错误');
      if ((r.start && !r.end) || (!r.start && r.end) || r.start && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.end) || r.start >= r.end)) throw Error('任务起止时间错误');
      if (r.slot && !SLOT_KEYS.includes(r.slot)) throw Error('任务时段不正确');
    }
    if (r.kind === 'chapter' && r.weight != null && !(Number(r.weight) >= 1 && Number(r.weight) <= 5)) throw Error('章节重要度必须是 1—5');
    if (r.kind === 'fixed' && r.slot && !SLOT_KEYS.includes(r.slot)) throw Error('固定日程时段不正确');
    if (r.kind === 'card' && (typeof r.front !== 'string' || typeof r.back !== 'string')) throw Error('卡片缺少问题或答案');
    for (const field of r.kind === 'weight' ? ['kg'] : (r.kind === 'bill' || r.kind === 'award' || r.kind === 'opening') ? ['amount'] : r.kind === 'redemption' ? ['cost'] : []) {
      if (!Number.isFinite(Number(r[field])) || Number(r[field]) < 0) throw Error('记录数值错误');
    }
    if (r.kind === 'weight' && !validDate(r.date)) throw Error('体重日期错误');
  }
  return rows;
}

/* ── 记录级自动合并（同步用，纯函数） ───────────────────────
 * 背景：两台设备都改过同一条记录时，服务端只能回「冲突」。
 * 这里按记录逐字段三方合并：只有同一个字段两边都改成了不同的值，才需要人看一眼；
 * 其余情况两边都能留下，不必逐条确认。
 * version / mutation / dirty 等只是同步元数据，不参与内容比较。 */
export const VOLATILE_KEYS = ['version', 'mutation', 'dirty', 'conflict', 'updatedAt', '_baseVersion', '_base', '_merge', '_partial'];
/* 去掉同步元数据，只留真正的记录内容（发给云端的就是这份） */
export const payloadOnly = r => {
  const o = {};
  for (const k of Object.keys(r || {})) if (!VOLATILE_KEYS.includes(k) && r[k] !== undefined) o[k] = r[k];
  return o;
};
export const samePayload = (a, b) => {
  if (!a || !b) return false;
  const ka = Object.keys(a).filter(k => !VOLATILE_KEYS.includes(k) && a[k] !== undefined).sort();
  const kb = Object.keys(b).filter(k => !VOLATILE_KEYS.includes(k) && b[k] !== undefined).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]));
};
/* 派生记录：由程序补出来的积分、余额、每日补任务等，重算即可，不必让用户选。
   用户自己编辑的课程 / 章节 / 任务不在此列，不会被云端版本覆盖。 */
export const isDerivedRecord = r => !!r && (r.auto === true
  || ['award', 'opening', 'redemption'].includes(r.kind)
  || /^(award|fix|seed|opening):/.test(String(r.id || '')));
/* 三方合并：base = 上一次同步成功的版本，local = 本机，remote = 云端。
   返回 { merged, fields }：merged 是合并后的内容，fields 是「两边都改过、取了本机」的字段名。 */
export function mergePayloads(base, local, remote) {
  const b = payloadOnly(base || {}), l = payloadOnly(local || {}), r = payloadOnly(remote || {});
  const merged = {}, fields = [];
  const keys = [...new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])];
  const j = v => JSON.stringify(v);
  for (const k of keys) {
    const lv = l[k], rv = r[k], bv = b[k];
    if (j(lv) === j(rv)) { if (lv !== undefined) merged[k] = lv; continue; }
    const localChanged = j(lv) !== j(bv), remoteChanged = j(rv) !== j(bv);
    if (localChanged && !remoteChanged) { if (lv !== undefined) merged[k] = lv; continue; }
    if (remoteChanged && !localChanged) { if (rv !== undefined) merged[k] = rv; continue; }
    /* 两边都改：本机优先，但记下来，汇总里能看出哪几条需要复核 */
    fields.push(k);
    if (lv !== undefined) merged[k] = lv;
  }
  return { merged, fields };
}
