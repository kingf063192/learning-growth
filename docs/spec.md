# 学习与成长 PWA — 重构设计契约 v4

本文件是唯一契约。凡与本文件冲突的实现，以本文件为准。
原始仓库快照在 `../../_orig/`（只读参考，不要改）。

## 0. 铁律

1. 禁止「追加覆盖函数」式打补丁：同一个 `renderXxx` 只允许定义一次。
2. 不新增构建步骤、不引入框架、不引入付费 API。
3. 只使用 Supabase 现有 URL + publishable key（已在 `app/config.js`）。
4. `/thesis/` 与 `*.sql` 一律不动。
5. 改完必须把 `sw.js` 的 `VERSION` 从 `growth-shell-v2` 改成 `growth-shell-v3`。

## 1. 文件与责任

| 文件 | 责任 |
|---|---|
| `app/core.js` | 纯函数：日期、时段、学期周、排期、冲突、加权进度、作业生成、每日补任务、主题表 |
| `app/content.json` | 种子数据：`course` / `chapter` / `fixed` |
| `app/main.js` | 渲染 + 交互（七个页面） |
| `app/style.css` | 全部样式（6 套主题 + 行程网格 + 响应式） |
| `index.html` | 外壳 |
| `sw.js` | Service Worker，仅版本号 |
| `app/store.js` | IndexedDB（不动） |
| `app/cloud.js` | Supabase 同步（不动） |

## 2. 六个时段（全局唯一来源）

`core.js` 导出 `SLOTS`：

```js
export const SLOTS=[
  {key:'早',   start:'08:30'},
  {key:'上午', start:'10:25'},
  {key:'下午', start:'14:00'},
  {key:'傍晚', start:'18:30'},
  {key:'晚上', start:'19:30'},
  {key:'睡前', start:'22:00'},
];
```

行程页 **行 = 这六个时段**，**列 = 周一…周日**。固定日程与学习任务都用 `slot` 落到格子里。
行标签**只显示 24 小时制时间**（`08:30` / `10:25` / …），不写「早/上午/下午」这类时段名；
格子里的卡片只在**开始时间与行起始时间不一致时**才额外标注时间，一致就不重复写。

## 3. 数据模型（IndexedDB `records`，`kind` 区分）

### 3.1 `course`

```json
{"id":"g-inorg","kind":"course","title":"无机与分析化学","category":"期末",
 "start":"2026-09-07","deadline":"2027-01-08","frequency":3,"priority":5}
```

- `category` ∈ `期末` | `考研` | `论文` | `兴趣` | `课程`
- `priority` 1–5，5 最高（用于排序与每日挑选）
- `thesisOnly:true` 仅论文课使用 → 学习页只显示进度条

### 3.2 `chapter`

```json
{"id":"g-org-ch-0","kind":"chapter","courseId":"g-org","title":"结构基础",
 "topic":"官能团与命名","order":0,"weight":5}
```

- `weight` 必填，1–5 星，5 = 最重要。**进度条按 weight 加权。**

### 3.3 `task`

```json
{"id":"g-org-ch-0-task","kind":"task","courseId":"g-org","chapterId":"g-org-ch-0",
 "title":"官能团与命名","category":"学习","duration":30,"order":0,"date":"","done":false}
```

可选字段：

| 字段 | 说明 |
|---|---|
| `date` | `YYYY-MM-DD`；空串 = 还没排进日历 |
| `due` | 作业截止日 `YYYY-MM-DD` |
| `slot` | 六时段之一；有它才会出现在行程格子里 |
| `start` / `end` | `HH:MM`；拖动后由 slot 推导 |
| `source` | `plan` / `hw` / `manual` |
| `hwKind` | 作业类型：`note`/`mindmap`/`handin`/`report`/`exam`/`proposal`/`online`/`paper` |
| `locked` | `true` = 固定课程实例，不可拖动 |
| `auto` | `true` = 由每日补任务生成 |

### 3.4 `fixed`

```json
{"id":"fixed-mon-inorg","kind":"fixed","wd":1,"slot":"上午","start":"10:25","end":"12:05",
 "title":"无机与分析化学","cat":"固定课程","note":"B107 杨芳","from":1,"to":16}
```

- `wd`：0=周日，1=周一 … 6=周六
- `cat` ∈ `固定课程` | `兴趣` | `游戏` | `生活` | `论文`
- `from`/`to`：学期周范围（含端点）
- `start`/`end` 必填精确时间

### 3.5 其它 kind 保持不变

`card` / `weight` / `redemption` / `bill` / `water` / `exercise` / `award` / `opening` / `setting` / `archive` / `research` / `settlement` / `retry` / `hwplan`（新增：作业生成锚点）

## 4. 学期与日期

- 第一学期第 1 周周一：`2026-09-07`（16 周 → 2026-12-25，12/28 起考试）
- 第二学期第 1 周周一：`2027-03-01`（16 周 → 2027-06-18）
- 考研初试：`2027-12-19`
- 期末考完：`2027-01-08`
- 政治开放：`2027-07-01`

`core.js` 导出 `semesterWeek(date, semesterStart)`：返回学期第几周（不在学期内返回 0）。

## 5. 页面与 DOM 契约

五个页面，导航顺序：`今日 / 行程 / 学习 / 生活 / 设置`。

> 变更记录（2026-11-03）：按用户要求取消「复习」页；「奖励」并入「生活」页（同一页里同时有积分/兑换、喝水、账单、体重、兑换记录）。`card` 记录类型仍保留在 `KINDS` 里，老数据只读不丢。

### 5.1 外壳 `index.html`

```html
<html lang="zh-CN" data-theme="blue">
...
<aside>…<nav id="nav"></nav>…</aside>
<div class="shell">
  <header>…<h1 id="heading"></h1></div><button id="sync" class="sync"></button></header>
  <main id="main"></main>
  <footer>…</footer>
</div>
<dialog id="modal">…<div id="modalBody"></div></dialog>
<div id="toast" role="status" aria-live="polite"></div>
<div id="focus" class="focus-layer" hidden>…</div>
```

### 5.2 今日页

```html
<section class="focus-card">
  <div>
    <p class="focus-label">现在做</p>
    <h2 class="focus-title">溶液平衡 · 酸碱平衡</h2>
    <p class="focus-meta">无机与分析化学 · 约 30 分钟</p>
  </div>
  <div class="focus-actions">
    <button class="primary" data-action="focus">开始 2 分钟</button>
    <button data-action="detail" data-id="…">看步骤</button>
  </div>
</section>

<section class="panel">
  <div class="toolbar"><h2>今天要做的</h2><button data-action="newTask">＋ 添加</button></div>
  <p class="meta">…</p>
  <ul class="task-list">
    <li class="task done|overdue" data-id="…">
      <input class="task-check" type="checkbox" data-task="…">
      <div class="task-body">
        <button class="task-title" data-action="detail" data-id="…">标题</button>
        <p class="task-meta"><span class="tag">课程</span> 截止 11-06 · 30 分钟</p>
      </div>
      <div class="task-ops">
        <button class="op" data-action="split" data-id="…" title="拆成两步">×</button>
        <button class="op op-del" data-action="delete" data-id="…">删</button>
      </div>
    </li>
  </ul>
</section>
```

- 只有一个列表，作业也是任务，不分栏。
- 每条：方框 + 标题 + 截止日；逾期加 `.overdue` 并显示「已逾期」。
- 固定课程（`category==='固定课程'`）不显示 `.task-ops`，且不出现在「现在做」里。

### 5.3 行程页

```html
<div class="panel">
  <div class="toolbar">…上一周 / 本周 / 下一周 / 周范围 / 查看整周…</div>
  <div class="legend">
    <span class="legend-item"><i class="swatch sw-fixed"></i>固定课程</span>
    <span class="legend-item"><i class="swatch sw-study"></i>学习任务</span>
    <span class="legend-item"><i class="swatch sw-hobby"></i>兴趣 / 游戏</span>
    <span class="legend-item"><i class="swatch sw-thesis"></i>论文</span>
    <span class="legend-item"><i class="swatch sw-life"></i>生活</span>
  </div>
  <div class="week-scroll">
    <div class="week-grid">
      <div class="wg-corner"></div>
      <div class="wg-head today">周一<br>11-02</div>   × 7
      <div class="wg-rowlabel">08:30</div>              × 6  <!-- 24 小时制，不写时段名 -->
      <div class="wg-cell" data-date="2026-11-02" data-slot="早">
        <button class="ev ev-fixed" data-action="detail" data-id="…">…</button>
        <button class="ev ev-study ev-draggable" draggable="true" data-drag="1" data-id="…">…</button>
      </div>
    </div>
  </div>
</div>
```

- 格子：`data-date` + `data-slot`。拖动放置目标 = `.wg-cell`。
- 事件类：`ev-fixed`（实线）/ `ev-study` / `ev-hobby` / `ev-game` / `ev-thesis` / `ev-life`。
- 用户自己排的学习任务加 `ev-draggable` + `data-drag="1"` + `data-action="detail"`；固定项**不加**。
- **不要**加原生 `draggable="true"`：原生 HTML5 DnD 会触发 `pointercancel`，把手势打断。拖动统一走 Pointer Events（桌面直接拖，手机长按 350ms）。
- 冲突：`.ev.conflict`，并显示 `⚠ 冲突`。
- 拖动中：源元素 `.dragging`，悬停格子 `.drop-ok`。
- 手机长按 350ms 进入拖动。桌面直接 HTML5 drag。

### 5.4 学习页

```html
<div class="course-grid">
  <article class="course-card" data-id="…">
    <div class="cc-head"><span class="tag">期末</span><h2>无机与分析化学</h2></div>
    <div class="progress"><i style="width:42%"></i></div>
    <p class="cc-stat">已完成 5 / 12 章（加权 42%）</p>
    <p class="cc-next">下一步：溶液平衡 · 酸碱平衡</p>
  </article>
</div>
<button data-action="allCourses">展开全部 22 门</button>
```

- 加权进度 = Σ(done 章节 weight) / Σ(全部章节 weight) × 100，四舍五入。
- 默认只显示前 5 张卡，点按钮展开全部。
- 论文课（`thesisOnly`）只显示进度条，不显示任务列表。

### 5.5 设置页

面板顺序：账号与云端同步 / 主题色 / 备份与恢复 / 时间与排期 / 安装说明。

```html
<div class="theme-grid">
  <button class="theme-btn active" data-theme="blue"><i class="sw-blue"></i>蓝</button> × 6
</div>
```

主题 key：`blue` / `cyan` / `purple` / `orange` / `rose` / `ink`。

### 5.6 2 分钟倒计时层

```html
<div id="focus" class="focus-layer" hidden>
  <div class="focus-box">
    <p class="focus-label">先做 2 分钟</p>
    <p class="timer-num">01:59</p>
    <p class="focus-title">…</p>
    <div class="timer-actions">
      <button class="primary" data-action="focusDone">做完了</button>
      <button data-action="focusMore">再来 10 分钟</button>
      <button data-action="focusStop">先到这</button>
    </div>
  </div>
</div>
```

## 6. 样式契约（`style.css` 必须提供）

### 6.1 主题 token

```css
:root{--accent:…;--accent-soft:…;--accent-ink:…;--bg:…;--panel:…;--ink:…;--muted:…;--line:…}
[data-theme=blue]{…}     /* 蓝 */
[data-theme=cyan]{…}     /* 青 */
[data-theme=purple]{…}   /* 紫 */
[data-theme=orange]{…}   /* 橙 */
[data-theme=rose]{…}     /* 玫（默认） */
[data-theme=ink]{…}      /* 墨 */
```

### 6.2 行程配色（固定，不随主题变）

```css
--c-fixed:#dbe9fb; --c-fixed-line:#7aa7e0;   /* 浅蓝 */
--c-study:#dff2e0; --c-study-line:#7bb87f;   /* 浅绿 */
--c-hobby:#fde8cf; --c-hobby-line:#e0a860;   /* 浅橙 */
--c-game:#fde8cf;  --c-game-line:#e0a860;    /* 浅橙 */
--c-thesis:#eae2fb;--c-thesis-line:#a68ce0;  /* 浅紫 */
--c-life:#eef0f2;  --c-life-line:#adb5bd;    /* 浅灰 */
```

### 6.3 必须存在的类

外壳：`aside .brand .aside-note nav nav button nav button.active .shell header h1 h2 h3 .eyebrow .sync main footer .panel .toolbar .meta .empty .notice .tag .row .row.done .grid .stats .stat .hero .flower .form-grid .progress .progress i .steps .answer .error .muted .grid .course-grid`

今日：`.focus-card .focus-label .focus-title .focus-meta .focus-actions .task-list .task .task.done .task.overdue .task-check .task-body .task-title .task-meta .task-ops .op .op-del .badge-overdue`

行程：`.week-scroll .week-grid .wg-corner .wg-head .wg-head.today .wg-rowlabel .wg-cell .wg-cell.drop-ok .ev .ev-fixed .ev-study .ev-hobby .ev-game .ev-thesis .ev-life .ev.done .ev.conflict .ev-draggable .ev.dragging .legend .legend-item .swatch .sw-fixed .sw-study .sw-hobby .sw-game .sw-thesis .sw-life`

学习：`.course-card .cc-head .cc-stat .cc-next .course-grid .course-grid.all`

设置：`.theme-grid .theme-btn .theme-btn.active`

计时：`.focus-layer .focus-box .timer-num .timer-actions`

### 6.4 响应式

- `≥1080px`：侧栏常驻 238px，行程 7 列全宽
- `720–1079px`：侧栏 200px
- `<720px`：侧栏变底部/顶部横向滚动导航；行程横向滚动，首列粘住（`position:sticky;left:0`）；今日页单列
- 所有触控目标 ≥ 44px

## 7. 作业自动生成规则（`core.js` 的 `homeworkTasks(date, records, settings)`）

| 课程 id | 生成内容 | 时机 | 截止 |
|---|---|---|---|
| `g-inorg` | 3 条：课堂笔记/思维导图/手写作业 | 每次周一课后 | 下周一上课前 |
| `g-org` | 书面作业 5 次 | 每 2 节课 | 从今天+14 到 2027-01-08 **均分** |
| `extra-3` 中国名菜 | 实训报告 1 条 | 每次周四课后（≤12 周） | 下周四上课前 |
| `extra-5` 中国名点 | 结业实操考试 1 条 | 一次性 | `2026-11-06` |
| `extra-0` 无机实验 | 实训报告 1 条 | **第 14 周开课后**，每次课后 | 下周三 |
| `extra-1` 文献检索 | 开题报告 1 条 | 一次性 | 今天+14 |
| `extra-2` 创新创业 | 学习通作业 1 条 | 每次周三课后（≤12 周） | 下周三上课前 |
| `extra-4` 形势与政策 | **不生成** | — | — |

硬性：

1. 稳定 id，例如 `hw:inorg:2026-11-02:note`、`hw:org:3`。同一条只生成一次。
2. 未开课不生成（无机实验 < 第 14 周；形势与政策 < 第 13 周）。
3. 只生成并显示 `今天 ≤ due ≤ 今天+7` 的作业。
4. 生成的作业 `category:'作业'`，`date` = 该做的日子（课后当天），`due` = 截止日。
5. 手动可删、可加（删除后不再自动重建 → 记 `hwplan` 墓碑）。

## 8. 每日补 4 条（`core.js` 的 `dailyPicks(date, records, settings)`）

在学期内的每一天，给今日补 **4 条**，来源是各课程已有的 `chapterId` 任务（直接给它们写 `date`，**不要复制新任务**）：

| 轨道 | 配额（期末期，date ≤ 2027-01-08） | 配额（期末后） |
|---|---|---|
| 英语 `g-eng` | 1 | 1 |
| 期末四门 `g-org` `g-inorg` `g-food` `g-cook` | 2 | 0 |
| 考研 `g-biochem` `g-cell` | 1（12/28 前每天最多 1） | 2 |
| 政治 `g-politics` | 0 | 1（且仅 `date ≥ 2027-07-01`） |

- 期末四门按难度取：**有机 > 无机 > 食品工艺 > 烹饪**，第二槽按星期轮换以保证四门都覆盖。
- 已排过日期的任务不再重复排；当天已有的自动任务先算数。
- 论文：**不参与每日挑选**，每学期周固定给 1 条（周三）。
- 兴趣（`g-dou` `g-draw` `g-drum`）：**每周各至少 1 次**，未满足则补。

## 9. 验收（第 9 节清单，必须逐条自测）

见 `../docs/acceptance.md`。
