import {today,addDays,monday,id,hash,defaults,plan,conflicts,minutes,clock,taskGuide,migrate,validateRecords} from './core.js';
import {Store} from './store.js';import {Cloud} from './cloud.js';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let store=await new Store('local').open(), cloud=new Cloud(store,s=>{$('#sync').textContent=s}),page='today',week=monday(today()),selected=today(),full=false,preview=null,lifeMonth=today().slice(0,7);
const content=await fetch('./app/content.json').then(r=>r.json());
if(cloud.session){store.close();store=await new Store(cloud.session.user.id).open();cloud.store=store;}else if(!store.records.length)await store.merge(content);
const QUOTES=['今天不用很厉害，先开始就好。','慢一点没关系，别停。','你已经比昨天多走了一步。','把小事做完，信心就来了。','状态不好时，只做最小的一件。','允许自己休息，休息也是计划的一部分。','不用和别人比，和上周的自己比。','先完成，再完美。','每天一小步，一年就是一大步。','你不是懒，你只是累了。','做完就停，留点力气给明天。','记录本身就是一种进步。'];
const KNOW=['细胞膜三大功能：分隔、控制物质进出、信息交流。','有氧呼吸三阶段：细胞质基质→线粒体基质→线粒体内膜。','酶的两个特点：高效性、专一性，且需要适宜温度与 pH。','蛋白质基本单位是氨基酸，靠肽键（—CO—NH—）连接。','DNA：脱氧核糖、双链、A/T/G/C；RNA：核糖、单链、A/U/G/C。','主动运输：需要载体、消耗 ATP、可逆浓度。','氨基酸通式：中心碳连 —NH₂、—COOH、—H、—R。','美拉德反应：糖和氨基酸加热产生褐色和香气（烤面包、煎肉）。','淀粉糊化：加热吸水膨胀变黏（勾芡、煮粥）。','锂盐期间多喝水，脱水会让血锂浓度升高。','每天固定时间称重，比每天称好几次更准。','复习时先合上书默想，比反复读有效。'];
function dailyQuote(){const d=new Date();const seed=d.getFullYear()*372+(d.getMonth()+1)*31+d.getDate();return {q:QUOTES[seed%QUOTES.length],k:KNOW[(seed*7)%KNOW.length]}}
function quoteCard(){const x=dailyQuote();return `<div class="panel quote-card"><p class="q">「${esc(x.q)}」</p><p class="meta">知识点 · ${esc(x.k)}</p></div>`}
const settings=()=>({...defaults,...store.get('settings')?.value}),tasks=()=>store.all('task'),course=t=>store.get(t.courseId),chapter=t=>store.get(t.chapterId);
function toast(s){$('#toast').textContent=s;$('#toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').style.display='none',5500)}
function modal(title,html){$('#modalTitle').textContent=title;$('#modalBody').innerHTML=html;if(!$('#modal').open)$('#modal').showModal()}
function close(){$('#modal').close()}
function action(label,name,key='',cls=''){return `<button class="${cls}" data-action="${name}" data-id="${esc(key)}">${label}</button>`}
function empty(text='暂时没有记录'){return `<div class="empty">${text}</div>`}
function input(label,name,value='',type='text',extra=''){return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`}
async function save(r){await store.put(r);render();cloud.sync().then(()=>{if(!$('#modal').open)render()})}
function row(t){const c=course(t),ch=chapter(t);return `<div class="row ${t.done?'done':''}"><input type="checkbox" aria-label="完成 ${esc(t.title)}" data-task="${esc(t.id)}" ${t.done?'checked':''}><div class="body"><button class="title" data-action="detail" data-id="${esc(t.id)}">${esc(t.title)}</button><div class="meta"><span class="tag">${esc(t.category||'待办')}</span>${t.start?esc(t.start+'–'+t.end):'时间待定'} · ${t.duration||30} 分钟${t.inferred?' · 推定时段':''}<br>${esc(c?.title||(t.category==='固定课程'?'固定活动':'自定义任务'))} ${ch?' / '+esc(ch.title):''}</div></div>${action('详情','detail',t.id)}</div>`}
function progress(list){return list.length?Math.round(list.filter(t=>t.done).length/list.length*100):0}
async function loadVisible(){if(page!=='life'||!cloud.session)return;try{await cloud.details(store.all('bill').filter(r=>r.date?.startsWith(lifeMonth)).map(r=>r.id));if(page==='life')render();}catch(e){toast(e.message)}}
function render(){const pages={today:['☀','今日'],week:['▦','行程'],courses:['▤','学习'],review:['◇','复习'],life:['♡','生活'],rewards:['✧','奖励'],settings:['⚙','设置']};$('#nav').innerHTML=Object.entries(pages).map(([key,[icon,title]])=>`<button class="${page===key?'active':''}" data-page="${key}"><span>${icon}</span> ${title}</button>`).join('');$('#date').textContent=new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'});$('#heading').textContent=pages[page][1];$('#sync').textContent=cloud.status;$('#main').innerHTML=({today:renderToday,week:renderWeek,courses:renderCourses,review:renderReview,life:renderLife,rewards:renderRewards,settings:renderSettings})[page]();}
function renderToday(){const list=tasks().filter(t=>t.date===today()),done=list.filter(t=>t.done).length,research=tasks().filter(t=>t.category==='科研'&&t.date>=monday(today())&&t.date<=addDays(monday(today()),6)),rec=list.filter(t=>!t.done&&t.category!=='固定课程').sort((a,b)=>(a.start||'99').localeCompare(b.start||'99'))[0];const overdue=tasks().filter(t=>!t.done&&t.date&&t.date<today());return `${!settings().confirmed?`<div class="notice"><b>先确认日期与目标</b><p>原计划以 2026 年秋季为起点。确认学期、截止日和可用时间后再安排；目前不会自动沿用过期计划。</p>${action('开始确认','onboard','','primary')}</div>`:''}<div class="panel hero"><div><span class="eyebrow">TODAY / 把一小步学明白</span><h2>${rec?'今天先做这一项':'今天，从自己的节奏开始'}</h2><p>${rec?esc(rec.title):'确认目标，选一个知识点，给自己 30 分钟。'}</p>${rec?action('开始学习 →','detail',rec.id,'primary'):action('查看章节','courses','','primary')}</div><div class="flower" aria-hidden="true">✿</div></div>${quoteCard()}<div class="stats"><div class="stat"><small>今日完成率</small><strong>${list.length?Math.round(done/list.length*100):0}%</strong></div><div class="stat"><small>已完成 / 今日任务</small><strong>${done} / ${list.length}</strong></div><div class="stat"><small>可用积分</small><strong>${store.balance()}</strong></div></div><div class="grid"><div><div class="panel"><div class="toolbar"><h2>今日安排</h2>${action('＋ 添加任务','newTask')}</div><p class="meta">所有页面引用同一条任务；喝水、运动单独记录，不计入完成率。</p>${list.filter(t=>t.start).sort((a,b)=>a.start.localeCompare(b.start)).map(row).join('')||empty('没有已定时任务')}<h3>时间待定</h3>${list.filter(t=>!t.start).map(row).join('')||empty('没有待定任务')}</div>${overdue.length?`<div class="panel"><h2>未完成的历史安排 · ${overdue.length}</h2><p>历史保留。可单项延期，或选择未完成任务加入重排。</p>${overdue.slice(0,10).map(row).join('')}</div>`:''}<div class="panel"><h2>每日结算</h2><p>${done} / ${list.length} 项完成；今日首次完成奖励 ${store.all('award').filter(x=>x.date===today()).reduce((n,x)=>n+x.amount,0)} 分。</p><p class="meta">每条任务首次完成 +10 分；取消不扣分，重做不再发分。结算不另发奖励。</p>${action(store.get('settle:'+today())?'已结算 · 查看最新汇总':'确认今日结算','settle')}</div></div><div><div class="panel"><h2>本周科研</h2><p>目标：${esc(store.get('research-week:'+monday(today()))?.goal||'梳理本周最重要的研究问题，形成可供导师审核的材料。')}</p><div class="progress"><i style="width:${progress(research)}%"></i></div><p class="meta">${research.filter(t=>t.done).length} / ${research.length} 个具体步骤完成</p>${research.map(t=>`<div class="meta">${t.done?'✓':'○'} ${esc(t.title)} · ${esc(t.date)}</div>`).join('')||empty('尚未排入科研步骤，请在学习页预览排期。')}${action('修改本周目标','research')}</div>${habitCard()}</div></div>`}
function habitCard(){const w=store.get('water:'+today())?.value||0,ex=store.get('exercise:'+today());return `<div class="panel"><h2>照顾自己</h2><p>喝水记录 · ${w} 杯（每杯约 250 ml）</p><div class="water">${Array.from({length:8},(_,i)=>action('◉ '+(i+1),'water',String(i+1),w===i+1?'active':'')).join('')}${action('清零','water','0')}</div><p class="meta">按个人需要记录，不自动制定饮水目标。</p>${action(ex?.done?'✓ 今日运动已记录':'记录今日运动','exercise')}<p class="meta">选择适合自己的活动，具体训练遵循教练指导。</p></div>`}
function eventStyle(t,list){const group=[t],items=list.filter(x=>x.date===t.date&&x.start);for(let i=0;i<group.length;i++)for(const x of items)if(!group.some(y=>y.id===x.id)&&x.start<group[i].end&&group[i].start<x.end)group.push(x);if(group.length===1)return '';group.sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id));const ends=[],lanes={};for(const x of group){let lane=ends.findIndex(e=>e<=x.start);if(lane<0)lane=ends.length;ends[lane]=x.end;lanes[x.id]=lane;}return 'left:'+lanes[t.id]*100/ends.length+'%;width:'+100/ends.length+'%';}
function renderWeek(){const dates=Array.from({length:7},(_,i)=>addDays(week,i)),list=tasks().filter(t=>dates.includes(t.date)),bad=new Set(conflicts(list));return `<div class="panel"><div class="toolbar">${action('← 上一周','prevWeek')}${action('本周','thisWeek')}${action('下一周 →','nextWeek')}<b>${week} — ${addDays(week,6)}</b>${action(full?'查看当天':'查看整周','fullWeek')}${action('＋ 任务','newTask')}</div><p class="meta">固定课程优先 · 虚线边框 / “⚠ 冲突”表示重叠，点击调整。推定时间保留原时段标签。</p><div class="mobile-dates">${dates.map((d,i)=>action(['一','二','三','四','五','六','日'][i]+'<br>'+d.slice(5),'selectDay',d,selected===d?'active':'')).join('')}</div><div class="week-scroll"><div class="week ${full?'full':''}"><div></div>${dates.map((d,i)=>`<div class="dayhead ${d===today()?'today':''} ${d!==selected?'not-selected':''}">${['周一','周二','周三','周四','周五','周六','周日'][i]}<br>${d.slice(5)} ${d===today()?'· 今天':''}</div>`).join('')}<div class="times">${Array.from({length:17},(_,i)=>`<span style="top:${i*120}px">${String(i+7).padStart(2,'0')}:00</span>`).join('')}</div>${dates.map(d=>`<div class="daycol ${d!==selected?'not-selected':''}">${list.filter(t=>t.date===d&&t.start).map(t=>`<button class="event ${t.category==='固定课程'?'fixed':''} ${t.done?'done':''} ${bad.has(t.id)?'conflict':''}" style="top:${(minutes(t.start)-420)*2}px;height:${Math.max(40,(minutes(t.end)-minutes(t.start))*2)}px;${eventStyle(t,list)}" data-action="detail" data-id="${esc(t.id)}"><b>${esc(t.title)}</b><br>${esc(t.start+'–'+t.end)} · ${esc(t.category)}<br>${bad.has(t.id)?'⚠ 冲突 ':''}${t.done?'✓ 已完成':'○ 未完成'} ${t.inferred?'· 推定':''}</button>`).join('')}</div>`).join('')}</div></div></div><div class="panel"><h2>待安排 · 没有具体时间</h2>${list.filter(t=>!t.start).map(row).join('')||empty()}</div>`}
function renderCourses(){return `<div class="toolbar">${action('预览重新排期','preview','','primary')}${action('新增课程 / 目标','newCourse')}${action('生成本周固定课程','fixedWeek')}<span class="meta">排期范围 ${settings().horizon} 天 · 每天最多 ${settings().capacity} 分钟</span></div><div class="notice">以下均为建议学习大纲，待按教材核对；不是官方目录或考试范围。目录、频次和截止日可逐门修改。</div><div class="course-grid">${store.all('course').map(c=>{const ts=tasks().filter(t=>t.courseId===c.id),chs=store.all('chapter').filter(x=>x.courseId===c.id).sort((a,b)=>a.order-b.order);return `<div class="panel"><span class="tag">${esc(c.category)}</span><h2>${esc(c.title)}</h2><p class="meta">截止 ${esc(c.deadline||'待确认')} · 每周 ${c.frequency||'不限'} 个小任务 · 优先级 ${c.priority||1}</p><div class="progress"><i style="width:${progress(ts)}%"></i></div><p class="meta">${ts.filter(t=>t.done).length}/${ts.length} 个任务完成</p><div class="toolbar">${action('目标设置','editCourse',c.id)}${action('录入 / 导入目录','outline',c.id)}</div>${chs.map(ch=>`<details><summary>${esc(ch.title)} · ${progress(ts.filter(t=>t.chapterId===ch.id))}%</summary><p class="meta">知识点：${esc(ch.topic||ch.title)}</p><div class="toolbar">${action('↑','upChapter',ch.id)}${action('↓','downChapter',ch.id)}${action('编辑知识点与指导','editChapter',ch.id)}</div>${ts.filter(t=>t.chapterId===ch.id).map(row).join('')||action('生成 30 分钟任务','chapterTask',ch.id)}</details>`).join('')}</div>`}).join('')}</div>`}
function renderReview(){const cards=store.all('card');return `<div class="panel"><div class="toolbar"><h2>复习卡片</h2>${action('添加卡片','newCard')}${action('导入卡片 JSON','importCards')}</div><p class="meta">先看问题，主动回忆，再查看答案。完成复习后生成下一次到期任务。</p>${cards.map(c=>`<div class="row"><div class="body"><h3>${esc(c.front)}</h3><p class="meta">下次 ${esc(c.next)} · ${esc(store.get(c.chapterId)?.title||'独立卡片')}</p>${action('查看答案','answer',c.id)} ${c.next<=today()?action('放入今日复习','reviewTask',c.id):''}</div></div>`).join('')||empty()}</div>`}
function renderLife(){const bills=store.all('bill').filter(x=>x.date?.startsWith(lifeMonth)).sort((a,b)=>(b.date||'').localeCompare(a.date||'')),month=bills.filter(x=>x.date?.startsWith(lifeMonth));return `<div class="grid"><div>${habitCard()}<div class="panel"><div class="toolbar"><h2>体重记录</h2>${action('添加记录','weight')}</div><p class="meta">仅记录趋势，不自动设定减重目标或饮食处方。</p>${store.all('weight').filter(x=>x.date?.startsWith(lifeMonth)).sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(x=>`<div class="row">${esc(x.date)} · ${esc(x.kg)} kg ${action('删除','delete',x.id)}</div>`).join('')||empty()}</div></div><div class="panel"><div class="toolbar"><h2>账单</h2><label>查看月份<input type="month" id="lifeMonth" value="${lifeMonth}"></label>${action('记一笔','bill')}</div><p>${lifeMonth} 收入 ${month.filter(x=>x.type==='in').reduce((s,x)=>s+Number(x.amount),0).toFixed(2)} 元 · 支出 ${month.filter(x=>x.type!=='in').reduce((s,x)=>s+Number(x.amount),0).toFixed(2)} 元</p>${bills.map(x=>`<div class="row"><div class="body">${esc(x.note||x.cat)}<div class="meta">${esc(x.date)} · ${esc(x.cat)}</div></div>${x.type==='in'?'+':'−'}${esc(x.amount)} 元${action('删除','delete',x.id)}</div>`).join('')||empty()}</div></div>`}
const rewards=[['一集番 / 1 小时游戏',30,0],['奶茶一杯',50,12],['外卖改善一顿',80,25],['电影 / 买本书',120,45],['小愿望（画材/鼓棒）',200,70],['月度大奖励',500,120]];
function renderRewards(){return `<div class="panel hero"><div><h2>${store.balance()} 积分</h2><p>每条任务首次完成 +10；同一条任务永不重复奖励。</p><p class="meta">云端模式兑换需联网，并由数据库检查余额。离线可学习，联网后再兑换。</p></div><div class="flower">✧</div></div><div class="course-grid">${rewards.map((r,i)=>`<div class="panel"><h3>${r[0]}</h3><p>${r[1]} 分 · ${r[2]} 元</p>${action('兑换','redeem',i)}</div>`).join('')}</div><div class="panel"><h2>兑换记录</h2>${store.all('redemption').map(r=>`<p>${esc(r.date)} · ${esc(r.name)} · ${r.cost} 分</p>`).join('')||empty()}</div>`}
function renderSettings(){return `<div class="grid"><div><div class="panel"><h2>账号与云端同步</h2><p>${cloud.session?'已登录：'+esc(cloud.session.user.email):'本地模式 · 尚未开启跨设备同步'}</p><p class="meta">配置在 app/config.js。只填项目 URL 与 publishable / anon 公钥。</p>${cloud.session?`<div class="toolbar">${action('同步 / 重试','sync')}${action('将本地记录合并到此账号','mergeLocal')}${action('退出账号并清理本机账号缓存','logout')}</div>`:`<form data-form="login">${input('邮箱','email','','email','required autocomplete="username"')}${input('密码','password','','password','required minlength="6" autocomplete="current-password"')}<button class="primary" name="mode" value="login">登录</button> <button name="mode" value="signup">注册</button></form>`}<p class="meta">首次登录打开独立账号缓存；不会使用空云端覆盖本地数据。请主动合并本地记录或导入旧备份。</p></div><div class="panel"><h2>排期设置与时段映射</h2>${action('编辑可用时间、休息和默认映射','scheduleSettings')}<p>每天 ${settings().capacity} 分钟，休息 ${settings().break} 分钟。课程具体时间未知时明确显示“推定”。</p>${action('重新确认目标和日期','onboard')}</div><div class="panel"><h2>iPhone / iPad 安装</h2><ol><li>用 Safari 打开部署后的网站。</li><li>点“分享”（方框向上箭头）。</li><li>选择“添加到主屏幕”，确认名称后添加。</li><li>从主屏幕图标打开；首次联网打开后可离线启动。</li></ol><p class="meta">主屏幕应用与 Safari 的登录或存储可能不同；用同一账号登录。iOS 不一定自动弹出安装提示。</p></div></div><div><div class="panel"><h2>备份、迁移与 AI 计划</h2><div class="toolbar">${action('导出完整备份','export')}${action('下载全部详情供离线使用','cacheOffline')}${action('导入备份 / life-system-v3','import')}${action('迁移当前浏览器旧数据','oldLocal')}${action('导出学习状态','status')}</div><p class="meta">导入前自动下载当前备份；只添加尚不存在的稳定 ID。失败不覆盖现有数据。原始旧备份也会保留在归档中。</p><p class="meta">本地文件与网站存储相互独立：请在旧页面点“导出备份”，再到本网站导入。</p>${action('粘贴 AI 计划并预览','ai')}<p class="meta">AI 内容仅为数据；保留旧任务，匹配已有 ID；新增任务必须关联章节。</p><input id="importFile" type="file" accept="application/json,.json" hidden></div><div class="panel"><h2>同步冲突</h2>${store.records.filter(x=>x.conflict).map(r=>`<div class="row"><div class="body">${esc(r.title||r.id)}<p class="meta">本机和云端同时修改。两版均已保留在本机冲突记录中。</p>${action('查看两版并处理','resolve',r.id)}</div></div>`).join('')||empty('暂无待处理冲突')}</div></div></div>`}
async function detail(key){await cloud.detail(key);const cached=store.get(key);if(cached?.chapterId)await cloud.detail(cached.chapterId);const t=store.get(key);if(!t)return;const c=course(t),ch=chapter(t),g=taskGuide(c,ch||{title:t.title});modal(t.title,`<p><span class="tag">${esc(t.category)}</span>${esc(c?.title||'自定义')} / ${esc(ch?.title||'未关联章节')}</p><p>${esc(t.date||'待安排')} ${esc(t.start||t.slot||'时间待定')} ${t.end?'– '+esc(t.end):''} · ${t.duration} 分钟 ${t.inferred?'（推定，原时段：'+esc(t.slot)+'）':''}</p>${t.legacy?'<div class="notice">保留的旧学习记录。建议关联新章节后继续学习。</div>':''}${t.category==='固定课程'?`<p>${esc(t.note)}</p>`:`<div class="toolbar">${action('开始学习','start',key)}${action('查看步骤','steps',key)}${action('完成自测','selftest',key)}${action('需要再学一次','again',key)}</div><h3>今天学什么</h3><p>${esc(ch?.topic||t.title)}</p><h3>先要懂什么</h3><p>${esc(g.prerequisite)}</p><h3>这次的目标</h3><p>${esc(g.objective)}</p><ol class="steps" id="steps">${g.steps.map(s=>'<li>'+esc(s)+'</li>').join('')}</ol><h3>参考材料</h3><p>${esc(g.material)}</p><h3>理解例子</h3><p>${esc(g.example)}</p><h3>练习与核对</h3><p>${esc(g.practice)}</p><h3>产出与完成标准</h3><p>${esc(g.output)}</p><p>${esc(g.acceptance)}</p><h3>不会时这样缩小</h3><p>${esc(g.fallback)}</p>${t.selftested?'<p class="answer">✓ 已记录自测</p>':''}`}<form data-form="note" data-version="${t.version||0}" data-id="${esc(key)}"><label>学习笔记 / 问题<textarea name="note">${esc(t.note||'')}</textarea></label><button>保存笔记</button></form><div class="toolbar">${action(t.done?'取消完成':'✓ 标为完成','toggle',key,'primary')}${action('修改','editTask',key)}${action('延期','postpone',key)}${ch?action('生成章节复习卡','makeCard',key):''}${action('删除任务','delete',key)}</div>`)}
function taskForm(t={}){modal(t.id?'修改任务':'添加自定义任务',`<form data-form="task" data-version="${t.version||0}" data-id="${esc(t.id||'')}"><div class="form-grid">${input('任务名称','title',t.title||'','text','required maxlength="180"')}${input('日期','date',t.date||today(),'date','required')}${input('开始时间（留空为待定）','start',t.start||'','time')}${input('结束时间','end',t.end||'','time')}${input('预计分钟','duration',t.duration||30,'number','required min="5" max="240" step="5"')}<label>分类<select name="category">${['自定义','学习','科研','固定课程','生活','复习'].map(x=>`<option ${x===t.category?'selected':''}>${x}</option>`).join('')}</select></label><label>课程<select name="courseId"><option value="">独立任务</option>${store.all('course').map(c=>`<option value="${esc(c.id)}" ${c.id===t.courseId?'selected':''}>${esc(c.title)}</option>`).join('')}</select></label><label>章节<select name="chapterId"><option value="">未关联</option>${store.all('chapter').map(c=>`<option value="${esc(c.id)}" ${c.id===t.chapterId?'selected':''}>${esc(store.get(c.courseId)?.title)} / ${esc(c.title)}</option>`).join('')}</select></label></div><p class="meta">手动调整将锁定该任务，普通重排会保留。时间冲突会提示。</p><button class="primary">保存任务</button></form>`)}
async function fixedWeek(days=7,first=week){const s=settings();if(!s.confirmed)throw Error('请先确认学期和目标');const rows=[];for(let n=0;n<days;n++){const date=addDays(first,n),wd=new Date(date+'T12:00').getDay(),wk=Math.floor((new Date(date+'T12:00')-new Date(s.semester+'T12:00'))/604800000)+1;for(const f of store.all('fixed').filter(f=>f.wd===wd&&wk>=f.from&&wk<=f.to)){const match=f.note?.match(/(\d{2}:\d{2})[–—-](\d{2}:\d{2})/);const times=match?[match[1],match[2]]:s.slots[f.slot];rows.push({id:f.id+':'+date,kind:'task',title:f.title,date,courseId:store.all('course').find(c=>c.title===f.title||c.title.startsWith(f.title+'：')||c.title.startsWith(f.title+'（'))?.id||({'无机与分析化学':'g-inorg','有机化学':'g-org','架子鼓课':'g-drum'}[f.title]),category:'固定课程',originalCategory:f.cat,duration:times?minutes(times[1])-minutes(times[0]):30,start:times?.[0]||'',end:times?.[1]||'',slot:f.slot,inferred:!match,note:f.note,locked:true,done:false})}}await store.merge(rows);await cloud.sync();render();}
function download(obj,name){const a=document.createElement('a'),u=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),10000)}
async function backup(){if(cloud.session)await cloud.cacheAll((n,total)=>toast('正在下载完整备份 '+n+'/'+total));download({format:'growth-v4',records:store.records.map(({dirty,conflict,...r})=>r)},'学习成长备份-'+today()+'.json')}
function validateBackup(o){if(o?.format==='growth-v4'){if(!Array.isArray(o.records)||!o.records.every(r=>r&&typeof r.id==='string'&&typeof r.kind==='string')||new Set(o.records.map(r=>r.id)).size!==o.records.length)throw Error('备份记录格式错误');const allowed=['course','chapter','task','fixed','card','weight','redemption','bill','water','exercise','award','opening','setting','archive','research','settlement','retry'];if(!o.records.every(r=>allowed.includes(r.kind)))throw Error('未知数据类型');return o.records.map(({version,mutation,dirty,conflict,...r})=>r)}return migrate(o)}
async function importData(o){const rows=validateRecords(validateBackup(o));if(rows.some(r=>r._partial))throw Error('这是一份不完整的摘要备份，请在原设备导出完整备份');await backup();await store.merge(rows);await store.merge(content);await cloud.sync();render();toast('已合并 '+rows.length+' 条，已有 ID 保留原记录；原备份已下载。')}
function showPreview(p){preview=p;modal('重新排期预览',`<p>将安排 ${p.moves.length} 项；排不下 ${p.unplaced.length} 项。已完成、过去记录和手动锁定的任务保持原样。</p>${p.unplaced.length?'<div class="notice">可减少任务量、降低其他课程频次，或修改目标截止日后重新预览。排不下的任务保留为待安排，不挤进截止日。</div>':''}${p.moves.map(t=>`<p class="meta">${esc(t.date)} ${t.start}–${t.end} · ${esc(t.title)}</p>`).join('')}${p.unplaced.map(t=>`<p class="error">待安排：${esc(t.title)}</p>`).join('')}${action('应用此排期','applyPreview','','primary')} ${action('调整可用时间','scheduleSettings')}`)}
async function handle(name,key){if(['editTask','editChapter','answer','makeCard','resolve'].includes(name)&&key)await cloud.detail(key);const t=store.get(key);switch(name){
case 'courses':page='courses';render();break;
case 'detail':await detail(key);break;
case 'close':close();break;
case 'newTask':taskForm();break;case 'editTask':taskForm(t);break;
case 'toggle':await complete(key);await detail(key);break;
case 'start':await store.put({...t,startedAt:new Date().toISOString()});toast('已记录开始时间。先完成第一小步，30 分钟后休息。');break;
case 'steps':$('#steps')?.scrollIntoView({behavior:'smooth',block:'center'});break;
case 'selftest':modal('完成自测',`<p>${esc(taskGuide(course(t),chapter(t)||{title:t.title}).practice)}</p><form data-form="selftest" data-version="${t.version||0}" data-id="${esc(key)}"><label>不看资料写下答案或结果，再记录核对发现<textarea name="result" required></textarea></label><label><input type="checkbox" required> 我已对照课程资料核对，记录了错误或疑问</label><button class="primary">保存自测</button></form>`);break;
case 'again':await save({id:id(),kind:'task',courseId:t.courseId,chapterId:t.chapterId,title:t.title+' · 再学一次',category:t.category,duration:20,order:t.order,date:addDays(today(),1),done:false});toast('已新增明天的巩固任务，原学习记录保留');close();break;
case 'postpone':modal('延期任务',`<form data-form="postpone" data-id="${esc(key)}">${input('新日期','date',addDays(t.date||today(),1),'date','required')}<button class="primary">确认延期</button><p>保留笔记和完成记录；延期后时间待定。</p></form>`);break;
case 'delete':if(confirm('删除这条记录？云端同步删除标记，历史奖励保留。')){await store.remove(key);close();render();await cloud.sync()}break;
case 'settle':await save({id:'settle:'+today(),kind:'settlement',date:today()});toast('结算已保存，不另发积分');break;
case 'water':await save({id:'water:'+today(),kind:'water',date:today(),value:+key});break;
case 'exercise':await save({id:'exercise:'+today(),kind:'exercise',date:today(),done:!store.get('exercise:'+today())?.done});break;
case 'research':modal('本周科研目标',`<form data-form="research">${input('本周目标','goal',store.get('research-week:'+monday(today()))?.goal||'','text','required')}<button class="primary">保存</button></form>`);break;
case 'prevWeek':week=addDays(week,-7);selected=week;render();break;case 'nextWeek':week=addDays(week,7);selected=week;render();break;case 'thisWeek':week=monday(today());selected=today();render();break;case 'selectDay':selected=key;render();break;case 'fullWeek':full=!full;render();break;
case 'preview':if(!settings().confirmed)throw Error('请先在今日页面确认日期与目标');await fixedWeek(settings().horizon,today());showPreview(plan(store.all(),settings()));break;
case 'applyPreview':{if(!preview)break;for(const x of preview.moves)await store.put(x);for(const x of preview.unplaced)await store.put({...x,date:'',start:'',end:''});preview=null;close();render();await cloud.sync();toast('排期已应用，未排入的任务仍在章节中');break;}
case 'fixedWeek':await fixedWeek();toast('已生成本周固定课程，重复操作不会重复添加');break;
case 'newCourse':case 'editCourse':modal(t?'目标设置':'新增课程 / 目标',`<form data-form="course" data-id="${esc(key)}">${input('名称','title',t?.title||'','text','required')}${input('分类','category',t?.category||'课程')}${input('开始日期','start',t?.start||today(),'date','required')}${input('截止日期','deadline',t?.deadline||addDays(today(),90),'date','required')}${input('每周小任务次数','frequency',t?.frequency||2,'number','min="1" max="21" required')}${input('优先级（1—5，5最高）','priority',t?.priority||1,'number','min="1" max="5" required')}<button class="primary">保存目标</button></form>`);break;
case 'outline':modal('录入、粘贴或导入课程目录',`<p>每行一个章节，支持“章节标题 | 知识点”。追加目录，不删除原章节和历史。真实目录请写明教材名称与版本。</p><form data-form="outline" data-id="${esc(key)}">${input('教材与版本 / 目录来源','material','','text','required')}<label>目录文件（UTF-8 文本）<input type="file" id="outlineFile" accept=".txt,text/plain"></label><textarea name="outline" id="outlineText" required placeholder="第一章 章节标题 | 本次知识点"></textarea><button class="primary">导入并生成任务</button></form>`);break;
case 'upChapter':case 'downChapter':{const cs=store.all('chapter').filter(x=>x.courseId===t.courseId).sort((a,b)=>a.order-b.order),i=cs.findIndex(x=>x.id===key),other=cs[i+(name==='upChapter'?-1:1)];if(other){await store.put({...t,order:other.order});await store.put({...other,order:t.order});for(const x of tasks().filter(x=>x.chapterId===t.id))await store.put({...x,order:other.order});for(const x of tasks().filter(x=>x.chapterId===other.id))await store.put({...x,order:t.order});render();await cloud.sync();}break;}
case 'editChapter':modal('编辑章节与学习指导',`<form data-form="chapter" data-version="${t.version||0}" data-id="${esc(key)}">${['title','topic','prerequisite','objective','material','example','practice','output'].map((n,i)=>`<label>${['章节名称','知识点（一次只处理一个）','前置知识与补基础步骤','本次目标','参考材料','理解例子','练习与核对方法','预期产出'][i]}<textarea name="${n}">${esc(t[n]||'')}</textarea></label>`).join('')}<button class="primary">保存</button></form>`);break;
case 'chapterTask':await save({id:id(),kind:'task',courseId:t.courseId,chapterId:t.id,order:t.order,title:t.topic||t.title,category:'学习',duration:30,date:'',done:false});break;
case 'newCard':case 'makeCard':modal('创建复习卡片',`<form data-form="card" data-id="${esc(name==='makeCard'?key:'')}">${input('问题（先显示）','front',t?'如何解释 '+t.title+'？':'','text','required')}<label>答案 / 核对依据<textarea name="back" required>${esc(t?.selftest||'')}</textarea></label><button class="primary">保存卡片</button></form>`);break;
case 'answer':modal(t.front,`<div class="answer">${esc(t.back||'旧卡片未提供答案，请补充。')}</div><p class="meta">想起来了则延后复习，忘了则明天再练；更新同一轮次记录不会重复加分。</p>${action('想起来了','remember',key)} ${action('忘了，明天再学','forgot',key)}`);break;
case 'reviewTask':await store.merge([{id:'review:'+key+':'+t.next,kind:'task',cardId:key,chapterId:t.chapterId,courseId:store.get(t.chapterId)?.courseId,title:'复习：'+t.front,date:today(),category:'复习',duration:20,done:false}]);render();await cloud.sync();toast('已加入今日安排');break;
case 'remember':case 'forgot':{const taskId='review:'+key+':'+t.next;if(!store.get(taskId))await store.merge([{id:taskId,kind:'task',cardId:key,title:'复习：'+t.front,date:today(),category:'复习',duration:20,done:false}]);await complete(taskId,true);const stage=name==='forgot'?0:Math.min((t.stage||0)+1,5);await save({...t,stage,next:addDays(today(),[1,2,4,7,15,30][stage])});close();break;}
case 'importCards':modal('导入复习卡片',`<form data-form="cards"><p>格式：{"cards":[{"front":"问题","back":"答案"}]}</p><textarea name="json" required></textarea><button class="primary">校验并导入</button></form>`);break;
case 'weight':modal('记录体重',`<form data-form="weight">${input('日期','date',today(),'date','required')}${input('体重 kg','kg','','number','required min="10" max="500" step="0.1"')}<button class="primary">保存</button></form>`);break;
case 'bill':modal('记一笔',`<form data-form="bill">${input('日期','date',today(),'date','required')}<label>收支<select name="type"><option value="out">支出</option><option value="in">收入</option></select></label>${input('金额（元）','amount','','number','required min="0.01" step="0.01"')}${input('分类','cat','生活','text','required')}${input('备注','note')}<button class="primary">保存</button></form>`);break;
case 'redeem':{const r=rewards[+key];if(!r)break;if(!confirm(`用 ${r[1]} 分兑换「${r[0]}」？`))break;const pending=store.all('retry').find(x=>x.reward===+key),rid=pending?.requestId||(cloud.session?'redeem:':'local-redemption:')+id();if(cloud.session){if(!navigator.onLine)throw Error('离线时请先保存学习，联网同步后再兑换');await store.put({id:'request:'+rid,kind:'retry',requestId:rid,reward:+key});await cloud.redeem(rid,+key);await store.remove('request:'+rid)}else{if(store.balance()<r[1])throw Error('积分不足');await store.put({id:rid,kind:'redemption',name:r[0],cost:r[1],yuan:r[2],date:today()});if(r[2])await store.put({id:'bill:'+rid,kind:'bill',date:today(),type:'out',cat:'奖',amount:r[2],note:r[0]});}render();toast('兑换成功');break;}
case 'scheduleSettings':{const s=settings();modal('可用时间与默认时段',`<form data-form="settings">${input('每天学习容量（分钟，不含固定课程）','capacity',s.capacity,'number','min="20" max="600" required')}${input('任务之间休息（分钟）','break',s.break,'number','min="5" max="60" required')}${input('预览未来天数','horizon',s.horizon,'number','min="7" max="180" required')}<h3>每天可学习窗口</h3><p class="meta">可以按一天的起止设置；排期会避开固定课程和休息。</p>${s.windows.map((w,i)=>`<div class="form-grid">${input('周'+['一','二','三','四','五','六','日'][i]+' 开始','w'+i+'a',w[0],'time','required')}${input('结束','w'+i+'b',w[1],'time','required')}</div>`).join('')}<h3>原时段的推定时间映射</h3>${Object.entries(s.slots).map(([k,w],i)=>`<div class="form-grid">${input(k+' 开始','s'+i+'a',w[0],'time','required')}${input('结束','s'+i+'b',w[1],'time','required')}</div>`).join('')}<button class="primary">保存并更新未来推定课程时间</button></form>`);break;}
case 'onboard':modal('确认现有日期与目标',`<p>原文件的日期仅供参考。请先核对学期，再逐门检查目标截止日期；过期目标不会被强行排入今天。</p><form data-form="onboard">${input('学期第一周的周一','semester',settings().semester,'date','required')}<label><input type="checkbox" required> 我已了解需要在“学习 → 目标设置”核对全部目标日期</label><button class="primary">确认学期，查看目标</button></form>`);break;
case 'export':await backup();toast('完整备份已下载');break;
case 'cacheOffline':await cloud.cacheAll((n,total)=>toast('离线保存 '+n+'/'+total));toast('全部记录详情已保存到本机');break;
case 'import':$('#importFile').click();break;
case 'oldLocal':{const raw=localStorage.getItem('life-system-v3');if(!raw)throw Error('这个网站存储中没有旧数据。请从旧页面导出 JSON 再导入。');await importData(JSON.parse(raw));break;}
case 'mergeLocal':{const local=await new Store('local').open();try{if(!confirm('把本机本地模式数据添加到当前账号？相同 ID 保留账号现有记录。'))break;await backup();await store.merge(local.records.map(({version,dirty,conflict,...r})=>r));await cloud.sync();render();toast('合并已提交；请检查同步状态')}finally{local.close()}break;}
case 'sync':await cloud.sync();render();break;
case 'logout':if(confirm('退出前请确认已同步或导出备份。退出将清除本机此账号缓存（包含待同步修改）。继续？')){await cloud.logout();location.reload()}break;
case 'resolve':modal('处理同时修改',`<h3>本机版本</h3><pre>${esc(JSON.stringify(t,null,2))}</pre><h3>云端版本</h3><pre>${esc(JSON.stringify(t.conflict.payload,null,2))}</pre><p>云端已删除的记录不能恢复覆盖；如需恢复，请新建任务。选择前会下载两版备份。</p>${action('采用云端版本','useRemote',key)}${t.conflict.payload.deleted?'':action('保留本机修改，基于云端版本提交','useLocal',key)}`);break;
case 'useRemote':case 'useLocal':{download(t,'同步冲突备份-'+hash(key)+'.json');const remote=t.conflict;await store.transaction([name==='useRemote'?{...remote.payload,version:remote.version,dirty:false}:{...t,version:remote.version,conflict:undefined,dirty:true,mutation:id()}]);close();await cloud.sync();render();break;}
case 'status':download({date:today(),goals:store.all('course'),chapters:store.all('chapter'),tasks:tasks()},'学习状态-'+today()+'.json');break;
case 'ai':modal('AI 计划导入预览',`<p>兼容旧 ai-plan 的 goals[].sessions[]。推荐每项提供 taskId，引用已有章节任务。无 taskId 的新任务须提供 chapterId。不会删除未完成任务。</p><form data-form="ai"><textarea name="json" required placeholder='{"type":"ai-plan","goals":[{"id":"g-eng","sessions":[{"taskId":"g-eng-ch-0-task","date":"2026-11-04","start":"10:00","end":"10:30"}]}]}'></textarea><button class="primary">校验并预览</button></form>`);break;
}}
async function complete(key,value){const t=store.get(key);if(!t)return;const done=value??!t.done;await store.complete(key,done);render();await cloud.sync();render();}
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.page){page=b.dataset.page;location.hash=page;render();window.scrollTo(0,0);await loadVisible();return}if(b.dataset.action){b.disabled=true;try{await handle(b.dataset.action,b.dataset.id)}catch(e){toast(e.message)}finally{b.disabled=false}}});
document.addEventListener('change',async e=>{try{if(e.target.id==='lifeMonth'){lifeMonth=e.target.value;render();await loadVisible();}if(e.target.dataset.task)await complete(e.target.dataset.task,e.target.checked);if(e.target.id==='importFile'&&e.target.files[0])await importData(JSON.parse(await e.target.files[0].text()));if(e.target.id==='outlineFile'&&e.target.files[0])$('#outlineText').value=await e.target.files[0].text();}catch(err){toast('未应用：'+err.message);render()}});
document.addEventListener('submit',async e=>{const f=e.target;if(!f.dataset.form)return;e.preventDefault();const button=e.submitter;if(button)button.disabled=true;const d=Object.fromEntries(new FormData(f)),key=f.dataset.id,t=store.get(key);try{switch(f.dataset.form){
case 'task':{if((d.start&&!d.end)||(!d.start&&d.end)||d.end&&d.end<=d.start)throw Error('请填写有效起止时间');if(d.start&&(d.start<'07:00'||d.end>'23:00'))throw Error('当前时间轴支持 07:00—23:00，请在此范围安排');if(d.chapterId&&store.get(d.chapterId)?.courseId!==d.courseId)throw Error('章节必须属于所选课程');const x={...t,...d,_baseVersion:+f.dataset.version,id:key||id(),kind:'task',duration:+d.duration,locked:true,done:t?.done||false,inferred:false};if(conflicts([...tasks().filter(x=>x.id!==key),x]).includes(x.id)&&!confirm('⚠ 与现有任务冲突，仍要保留供调整？'))break;await save(x);close();break;}
case 'note':await save({...t,note:d.note,_baseVersion:+f.dataset.version});toast('笔记已保存');break;
case 'selftest':await save({...t,selftest:d.result,selftested:true,_baseVersion:+f.dataset.version});await detail(key);break;
case 'postpone':await save({...t,date:d.date,start:'',end:'',locked:false});close();break;
case 'research':await save({id:'research-week:'+monday(today()),kind:'research',goal:d.goal});close();break;
case 'course':if(d.deadline<d.start)throw Error('截止日期应晚于开始日期');await save({...t,...d,id:key||id(),kind:'course',frequency:+d.frequency,priority:+d.priority});close();break;
case 'chapter':await save({...t,...d,_baseVersion:+f.dataset.version});close();break;
case 'outline':{const lines=d.outline.split('\n').map(x=>x.trim()).filter(Boolean);if(!lines.length||lines.length>150)throw Error('请录入 1—150 个章节');const offset=store.all('chapter').filter(x=>x.courseId===key).length;for(const [i,line] of lines.entries()){const [title,topic]=line.split('|'),cid=key+':outline:'+hash(d.material+line);await store.merge([{id:cid,kind:'chapter',courseId:key,title:title.trim(),topic:topic?.trim()||title.trim(),order:offset+i,material:d.material},{id:cid+':task',kind:'task',courseId:key,chapterId:cid,title:topic?.trim()||title.trim(),category:'学习',duration:30,order:offset+i,date:'',done:false}]);}close();render();await cloud.sync();break;}
case 'card':await save({id:id(),kind:'card',front:d.front,back:d.back,chapterId:t?.chapterId,stage:0,next:addDays(today(),1)});close();break;
case 'cards':{const o=JSON.parse(d.json);if(!Array.isArray(o.cards)||!o.cards.every(x=>typeof x.front==='string'&&typeof x.back==='string'))throw Error('卡片格式错误');await backup();await store.merge(o.cards.map(x=>({...x,id:'card:'+hash(x.front+'|'+x.back),kind:'card',stage:0,next:addDays(today(),1)})));close();render();await cloud.sync();break;}
case 'weight':await save({...d,id:id(),kind:'weight',kg:+d.kg});close();break;
case 'bill':await save({...d,id:id(),kind:'bill',amount:+d.amount});close();break;
case 'settings':{const s=settings();s.capacity=+d.capacity;s.break=+d.break;s.horizon=+d.horizon;s.windows=s.windows.map((_,i)=>[d['w'+i+'a'],d['w'+i+'b']]);Object.keys(s.slots).forEach((k,i)=>s.slots[k]=[d['s'+i+'a'],d['s'+i+'b']]);for(const w of [...s.windows,...Object.values(s.slots)])if(w[0]>=w[1]||w[0]<'07:00'||w[1]>'23:00')throw Error('所有窗口须在 07:00—23:00 内，结束晚于开始');await save({id:'settings',kind:'setting',value:s});for(const x of tasks().filter(x=>x.inferred&&!x.done&&x.date>=today())){const w=s.slots[x.slot];if(w)await store.put({...x,start:w[0],end:w[1],duration:minutes(w[1])-minutes(w[0])});}close();render();await cloud.sync();break;}
case 'onboard':if(new Date(d.semester+'T12:00').getDay()!==1)throw Error('请选择周一作为学期开始');await save({id:'settings',kind:'setting',value:{...settings(),semester:d.semester,confirmed:true}});close();page='courses';render();break;
case 'login':{await cloud.login(d.email,d.password,e.submitter?.value==='signup');store.close();store=await new Store(cloud.session.user.id).open();cloud.store=store;close();await cloud.sync();render();break;}
case 'ai':{const o=JSON.parse(d.json);if(o.type!=='ai-plan'||!Array.isArray(o.goals))throw Error('需要 ai-plan 格式');const moves=[];for(const g of o.goals){const c=store.get(g.id)||store.all('course').find(c=>c.title===g.title);if(!c)throw Error('未找到课程 '+g.id);for(const s of g.sessions||[]){const old=store.get(s.taskId),ch=store.get(s.chapterId);if(!old&&!ch)throw Error('新任务须有有效 chapterId；旧格式请先补上章节或 taskId');if(old?.done)continue;if((old?.courseId||ch?.courseId)!==c.id)throw Error('课程与章节不匹配');if(!/^\d{4}-\d{2}-\d{2}$/.test(s.date))throw Error('日期错误');const start=s.start||'',end=s.end||'';if(start&&(!/^\d{2}:\d{2}$/.test(start)||!/^\d{2}:\d{2}$/.test(end)||start>=end||start<'07:00'||end>'23:00'))throw Error('时间错误');moves.push({...old,id:old?.id||'ai:'+hash(c.id+JSON.stringify(s)),kind:'task',courseId:c.id,chapterId:old?.chapterId||ch.id,title:s.title||old?.title||ch.topic,date:s.date,start,end,slot:s.slot||'',duration:start?minutes(end)-minutes(start):30,category:old?.category||'学习',locked:true,done:false});}}
if(new Set(moves.map(x=>x.id)).size!==moves.length)throw Error('同一任务重复出现');const combined=tasks().filter(x=>!moves.some(t=>t.id===x.id)).concat(moves);if(conflicts(combined).some(x=>moves.some(t=>t.id===x)))throw Error('AI 计划有时间冲突，请调整后导入');for(const date of new Set(moves.map(x=>x.date))){const sum=combined.filter(x=>x.date===date&&x.category!=='固定课程').reduce((n,x)=>n+x.duration,0);if(sum>settings().capacity)throw Error(date+' 超出每日容量');}showPreview({moves,unplaced:[]});break;}
}}catch(err){toast('未完成：'+err.message)}finally{if(button)button.disabled=false}});
$('#close').onclick=close;$('#sync').onclick=()=>handle('sync');window.addEventListener('online',()=>cloud.sync().then(render));window.addEventListener('offline',()=>cloud.statusSet(cloud.session?'离线待同步':'本地模式 · 离线可用'));window.addEventListener('focus',async()=>{store.records=await store.readAll();await cloud.sync();render()});setInterval(()=>{if(!document.hidden)cloud.sync().then(async()=>{if(!$('#modal').open){render();await loadVisible();}})},60000);
window.addEventListener('hashchange',()=>{const p=location.hash.slice(1);if(['today','week','courses','review','life','rewards','settings'].includes(p)){page=p;render()}});
page=['today','week','courses','review','life','rewards','settings'].includes(location.hash.slice(1))?location.hash.slice(1):'today';render();await cloud.sync();if(settings().confirmed)await fixedWeek(7,today());for(const c of store.all('card').filter(c=>!c.archived&&c.next<=today()))await store.merge([{id:'review:'+c.id+':'+c.next,kind:'task',cardId:c.id,chapterId:c.chapterId,courseId:store.get(c.chapterId)?.courseId,title:'复习：'+c.front,date:today(),category:'复习',duration:20,done:false}]);render();await cloud.sync();await loadVisible();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').then(r=>{r.update();r.addEventListener('updatefound',()=>{r.installing?.addEventListener('statechange',()=>{if(r.waiting)toast('新版本已就绪，关闭此应用后重新打开即可更新')})})}).catch(e=>toast('离线缓存未启用：'+e.message));

/* ===== 简化版：今日只放今日安排；进度在“学习”；喝水/运动/食谱在“生活” ===== */
const RECIPES=[
 ['鸡蛋+豆浆+全麦面包','米饭半碗+鸡胸100g+两份菜','红薯+豆腐+蔬菜'],
 ['燕麦牛奶+香蕉','杂粮饭+番茄炒蛋+青菜','玉米+清蒸鱼+西兰花'],
 ['全麦三明治+牛奶','米饭半碗+瘦牛肉+炒时蔬','紫薯+鸡蛋羹+凉拌菜'],
 ['鸡蛋+小米粥','荞麦面+鸡丝+青菜','南瓜+豆腐汤+炒青菜'],
 ['酸奶+全麦面包+水果','米饭半碗+鸡腿去皮+两份菜','山药+虾仁+菠菜'],
 ['鸡蛋饼+豆浆','杂粮饭+清蒸鱼+蔬菜','玉米+瘦肉+菌菇'],
 ['牛奶+燕麦+坚果少量','米饭半碗+豆腐+青菜','红薯+鸡蛋+番茄汤']
];
function recipeCard(){const r=RECIPES[(new Date().getDay()+6)%7];return `<div class="panel"><h2>今日推荐食谱</h2><p class="meta">约 1200–1400 kcal，便宜好做；按口味换同类食材。</p><p><b>早餐</b> ${esc(r[0])}</p><p><b>午餐</b> ${esc(r[1])}</p><p><b>晚餐</b> ${esc(r[2])}</p><p class="meta">加餐：一个苹果或无糖酸奶。全天喝水 1.5–2 L。</p></div>`}

habitCard = function(){
  const w=store.get('water:'+today())?.value||0, ex=store.get('exercise:'+today());
  return `<div class="panel"><h2>喝水</h2><p class="meta">${w} / 8 杯（每杯约 250 ml）</p><div class="water">${Array.from({length:8},(_,i)=>action('◉ '+(i+1),'water',String(i+1),w===i+1?'active':'')).join('')}${action('清零','water','0')}</div></div>
  <div class="panel"><h2>运动</h2>${action(ex?.done?'✓ 今日运动已记录':'记录今日运动','exercise')}<p class="meta">强度以能正常说话为准。</p></div>${recipeCard()}`;
};

renderToday = function(){
  const list=tasks().filter(t=>t.date===today());
  const dn=list.filter(t=>t.done).length;
  const award=store.all('award').filter(x=>x.date===today()).reduce((n,x)=>n+x.amount,0);
  const timed=list.filter(t=>t.start).sort((a,b)=>a.start.localeCompare(b.start));
  const untimed=list.filter(t=>!t.start);
  const overdue=tasks().filter(t=>!t.done&&t.date&&t.date<today());
  const all=dn===list.length&&list.length>0;
  return `<div class="panel"><div class="toolbar"><h2>今日安排</h2>${action('＋ 任务','newTask')}</div>
  <p class="today-line">${all?'今天全部完成 🎉':'已完成 '+dn+' / '+list.length} · 今日 +${award} 分 · 连续 ${streakDays()} 天</p>
  ${timed.map(row).join('')||empty('今天没有已定时的任务')}
  ${untimed.length?'<h3>时间待定</h3>'+untimed.map(row).join(''):''}
  </div>
  ${overdue.length?`<details class="panel"><summary>没做完的（${overdue.length}）</summary><p class="meta">可以单项延期，或直接勾掉。</p>${overdue.slice(0,12).map(row).join('')}</details>`:''}`;
};
function streakDays(){const set=new Set(store.all('award').map(a=>a.date));let n=0;const d=new Date();while(set.has(localISO(d))){n++;d.setDate(d.getDate()-1)}return n}
function localISO(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}

renderRewards = function(){
  const settle=store.get('settle:'+today());
  return `<div class="panel hero"><div><h2>${store.balance()} 积分</h2><p>每条任务首次完成 +10；同一条任务永不重复奖励。</p><p class="meta">兑换需联网，由数据库检查余额。</p></div><div class="flower">✧</div></div>
  <div class="reward-grid">${rewards.map((r,i)=>`<div class="panel"><h3>${esc(r[0])}</h3><p>${r[1]} 分</p><p class="meta">${r[2]} 元</p>${action('兑换','redeem',i,'primary')}</div>`).join('')}</div>
  <details class="panel"><summary>每日结算</summary><p class="meta">每条任务首次完成 +10 分；取消不扣分，重做不再发分。</p>${action(settle?'已结算 · 查看最新汇总':'确认今日结算','settle')}</details>
  <details class="panel"><summary>兑换记录</summary>${store.all('redemption').map(r=>`<p>${esc(r.date)} · ${esc(r.name)} · ${r.cost} 分</p>`).join('')||empty()}</details>`;
};

renderWeek = function(){
  const dates=Array.from({length:7},(_,i)=>addDays(week,i));
  const list=tasks().filter(t=>dates.includes(t.date));
  const bad=new Set(conflicts(list));
  return `<div class="panel"><div class="toolbar">${action('← 上一周','prevWeek')}${action('本周','thisWeek')}${action('下一周 →','nextWeek')}${action('＋ 任务','newTask')}</div><p class="meta"><b>${week} — ${addDays(week,6)}</b> · 整周清单，点标题看详情</p>${dates.map((d,i)=>{const day=list.filter(t=>t.date===d).sort((a,b)=>(a.start||'99').localeCompare(b.start||'99'));return `<div class="agenda-day"><div class="dayhead ${d===today()?'today':''}">${['周一','周二','周三','周四','周五','周六','周日'][i]} ${d.slice(5)} ${d===today()?'· 今天':''}</div>${day.map(t=>row(t)+(bad.has(t.id)?'<p class="meta danger">⚠ 与其它安排重叠</p>':'')).join('')||'<p class="meta">空</p>'}</div>`;}).join('')}</div>`;
};

/* ===== 今日：勾选完成 / × 拆成更小再排 ===== */
function withSplit(t){
  const h=row(t), i=h.lastIndexOf('</div>');
  return i<0?h:h.slice(0,i)+`<button class="x-btn" data-split="${esc(t.id)}" title="不想做 / 没做完：拆成更小的步骤">×</button>`+h.slice(i);
}
async function splitTask(key){
  const t=store.get(key);
  if(!t){toast('找不到这条任务');return}
  const baseTitle=String(t.title||'任务').replace(/（\d+\/\d+）$/,'');
  const total=Number(t.duration)||30;
  const parts=total>=60?3:2;
  const per=Math.max(10,Math.round(total/parts/5)*5);
  const rows=[];
  for(let k=0;k<parts;k++){
    const date=addDays(today(),k);
    const rec={
      id:k===0?t.id:(t.id+'-s'+k),
      kind:'task',
      courseId:t.courseId, chapterId:t.chapterId,
      title:baseTitle+'（'+(k+1)+'/'+parts+'）',
      category:t.category||'待办',
      duration:per, order:t.order,
      date, start:t.start||'', end:t.end||'',
      done:false, splitFrom:k===0?undefined:(t.splitFrom||t.id)
    };
    rows.push(rec);
  }
  for(const r of rows)await store.put(r);
  render();
  try{await cloud.sync()}catch(e){}
  toast('已拆成 '+parts+' 小步，从今天起每天一步。做完一步算一步，不着急。');
}
renderToday = function(){
  const list=tasks().filter(t=>t.date===today());
  const dn=list.filter(t=>t.done).length;
  const award=store.all('award').filter(x=>x.date===today()).reduce((n,x)=>n+x.amount,0);
  const timed=list.filter(t=>t.start).sort((a,b)=>a.start.localeCompare(b.start));
  const untimed=list.filter(t=>!t.start);
  const overdue=tasks().filter(t=>!t.done&&t.date&&t.date<today());
  const all=dn===list.length&&list.length>0;
  return `<div class="panel"><div class="toolbar"><h2>今日安排</h2>${action('＋ 任务','newTask')}</div>
  <p class="today-line">${all?'今天全部完成 🎉':'已完成 '+dn+' / '+list.length} · 今日 +${award} 分 · 连续 ${streakDays()} 天</p>
  ${timed.map(withSplit).join('')||empty('今天没有已定时的任务')}
  ${untimed.length?'<h3>时间待定</h3>'+untimed.map(withSplit).join(''):''}
  </div>
  ${overdue.length?`<details class="panel"><summary>没做完的（${overdue.length}）</summary><p class="meta">点 × 可以拆小并重新排到接下来几天。</p>${overdue.slice(0,12).map(withSplit).join('')}</details>`:''}`;
};
document.addEventListener('click',e=>{
  const b=e.target.closest&&e.target.closest('[data-split]');
  if(!b)return;
  e.preventDefault();e.stopImmediatePropagation();
  splitTask(b.getAttribute('data-split'));
},true);

/* ===== 拆小：按章节指导拆成能立刻动手的小步 ===== */
splitTask = async function(key){
  const t=store.get(key);
  if(!t){toast('找不到这条任务');return}
  const total=Number(t.duration)||30;
  const baseTitle=String(t.title||'任务').replace(/（\d+\/\d+）$/,'');
  let steps=[];
  try{
    const g=taskGuide(course(t)||{title:baseTitle},chapter(t)||{title:baseTitle});
    steps=(g.steps||[]).map(x=>String(x).trim()).filter(Boolean);
  }catch(e){}
  if(!steps.length)steps=['先看 5 分钟资料，知道这一步要做什么','动手做一遍，不求完美','核对一遍，把不懂的记下来'];
  const parts=Math.min(steps.length, total>=60?3:2);
  const per=Math.max(10,Math.round(total/parts/5)*5);
  const rows=[];
  for(let k=0;k<parts;k++){
    const date=addDays(today(),k);
    const rec={
      id:k===0?t.id:(t.id+'-s'+k),
      kind:'task', courseId:t.courseId, chapterId:t.chapterId,
      title:baseTitle+'（'+(k+1)+'/'+parts+'）',
      category:t.category||'待办',
      duration:per, order:t.order,
      date, start:k===0?(t.start||''):'', end:k===0?(t.end||''):'',
      note:'这一步：'+steps[k],
      done:false
    };
    rows.push(rec);
  }
  for(const r of rows)await store.put(r);
  render();
  try{await cloud.sync()}catch(e){}
  toast('已拆成 '+parts+' 步，每天一步；每一步只要 '+per+' 分钟，点开能看到具体怎么做。');
};

/* ===== 按重要度加权进度 ===== */
const origCourses = renderCourses;
progress = function(list){
  let tot=0,dn=0;
  for(const t of list){
    const ch=chapter(t);
    const w=Number(t.weight)||Number(ch&&ch.weight)||1;
    tot+=w; if(t.done)dn+=w;
  }
  return tot?Math.round(dn/tot*100):0;
};

function weightPanel(){
  const cs=store.all('course');
  return `<details class="panel"><summary>重要度设置（按考试分值加权）</summary>
  <p class="meta">给每章打星：5 星=必考重点，1 星=了解。进度条会按星数加权，重点章节完成得多，进度涨得快。</p>
  ${cs.map(c=>{
    const chs=store.all('chapter').filter(x=>x.courseId===c.id).sort((a,b)=>a.order-b.order);
    if(!chs.length)return '';
    return `<div class="wgroup"><h3>${esc(c.title)}</h3>${chs.map(ch=>{
      const w=Number(ch.weight)||1;
      return `<div class="wrow"><span class="wt">${esc(ch.title)}</span><span class="stars">${[1,2,3,4,5].map(n=>`<button data-weight="${esc(ch.id)}:${n}" class="${w>=n?'on':''}">★</button>`).join('')}</span></div>`;
    }).join('')}</div>`;
  }).join('')}
  <h3>用 AI 批量设置</h3>
  <p class="meta">让 AI 按考试大纲/真题频次给每章打星，返回 JSON 后粘到这里导入。</p>
  <textarea id="wjson" placeholder='&#123;"type":"chapter-weights","items":[&#123;"chapterId":"g-eng-ch-0","weight":5&#125;]&#125;'></textarea>
  <div class="toolbar"><button class="primary" id="wImport">导入重要度</button><button id="wCopy">复制章节目录</button></div>
  </details>`;
}

renderCourses = function(){
  return origCourses() + weightPanel();
};

document.addEventListener('click',async e=>{
  const b=e.target.closest&&e.target.closest('[data-weight]');
  if(b){
    e.preventDefault();e.stopImmediatePropagation();
    const [cid,n]=b.getAttribute('data-weight').split(':');
    const ch=store.get(cid);
    if(!ch)return;
    const w=Number(n);
    await store.put({...ch,weight:Number(ch.weight)===w?1:w});
    render();try{await cloud.sync()}catch(err){}
    return;
  }
  if(e.target.id==='wCopy'){
    const txt=store.all('chapter').map(c=>c.id+' | '+c.title).join('\n');
    navigator.clipboard?.writeText(txt);toast('章节目录已复制，粘给 AI 打星');return;
  }
  if(e.target.id==='wImport'){
    try{
      const o=JSON.parse(document.getElementById('wjson').value);
      const items=(o.items||o.chapters||[]).filter(x=>x&&x.chapterId);
      let n=0;
      for(const it of items){
        const ch=store.get(it.chapterId);
        if(!ch)continue;
        await store.put({...ch,weight:Math.min(5,Math.max(1,Number(it.weight)||1))});
        n++;
      }
      render();try{await cloud.sync()}catch(err){}
      toast('已导入 '+n+' 章的重要度');
    }catch(err){toast('JSON 格式不对：'+err.message)}
  }
},true);

/* ===== ADHD 友好：一次只做一件 + 2 分钟起步 + 温和反馈 ===== */
let showAllToday=false, fTask=null, fLeft=0, fTimer=null;

function focusBox(){return document.getElementById('focusbox')}

function todayRow(t){
  const h=row(t), i=h.lastIndexOf('</div>');
  const extra=`<button class="mini-btn" data-focus="${esc(t.id)}">2 分钟</button><button class="x-btn" data-split="${esc(t.id)}" title="不想做/没做完：拆小">×</button>`;
  return i<0?h:h.slice(0,i)+extra+h.slice(i);
}

function pickNext(){
  const list=tasks().filter(t=>t.date===today()&&!t.done).sort((a,b)=>(a.start||'99').localeCompare(b.start||'99'));
  return list[0]||null;
}

function startFocus(id,secs){
  const t=store.get(id); if(!t)return;
  fTask=t; fLeft=secs; renderFocus();
  clearInterval(fTimer);
  fTimer=setInterval(()=>{fLeft--;renderFocus();if(fLeft<=0){clearInterval(fTimer);fLeft=0;renderFocus()}},1000);
}

function stopFocus(){clearInterval(fTimer);fTask=null;fLeft=0;const b=focusBox();if(b)b.remove()}

function renderFocus(){
  let b=focusBox();
  if(!b){document.body.insertAdjacentHTML('beforeend','<div id="focusbox" class="focusbox"></div>');b=focusBox()}
  if(!fTask){b.remove();return}
  const m=String(Math.floor(fLeft/60)).padStart(2,'0'),sec=String(fLeft%60).padStart(2,'0');
  b.innerHTML=`<div class="focus-card"><p class="meta">现在只做这一件</p><h3>${esc(fTask.title)}</h3><div class="clock">${m}:${sec}</div>
  <div class="focus-actions"><button class="primary" data-fdone="${esc(fTask.id)}">做完了</button><button data-fmore="${esc(fTask.id)}">再来 10 分钟</button><button data-fclose="1">先到这</button></div>
  <p class="meta">时间到就停，不用愧疚；做 2 分钟也算开始。</p></div>`;
}

renderToday = function(){
  const list=tasks().filter(t=>t.date===today());
  const dn=list.filter(t=>t.done).length;
  const award=store.all('award').filter(x=>x.date===today()).reduce((n,x)=>n+x.amount,0);
  const timed=list.filter(t=>t.start).sort((a,b)=>a.start.localeCompare(b.start));
  const untimed=list.filter(t=>!t.start);
  const all=tasks().filter(t=>t.date===today());
  const next=pickNext();
  const overdue=tasks().filter(t=>!t.done&&t.date&&t.date<today());
  const shownAll=showAllToday?list:list.slice(0,3);
  const hidden=Math.max(0,list.length-3);
  const allDone=dn===list.length&&list.length>0;
  return `<div class="panel focus-now">
    <p class="meta">现在做</p>
    <h2 class="now-title">${allDone?'今天做完了，去休息 🎉':(next?esc(next.title):'今天没有安排')}</h2>
    ${next?`<button class="primary big" data-focus="${esc(next.id)}">开始 2 分钟</button>`:''}
    <p class="today-line">${allDone?'':'已完成 '+dn+' / '+list.length} · 今日 +${award} 分 · 连续 ${streakDays()} 天</p>
  </div>
  <div class="panel"><div class="toolbar"><h2>今天要做</h2>${action('＋ 任务','newTask')}</div>
  ${shownAll.map(todayRow).join('')||empty('今天没有任务')}
  ${hidden>0&&!showAllToday?`<button class="link-btn" id="showAll">还有 ${hidden} 件，全部展开</button>`:''}
  </div>
  ${overdue.length?`<details class="panel"><summary>前几天没做完（${overdue.length}）</summary><p class="meta">不着急：点 × 把它拆小，或直接勾掉。</p>${overdue.slice(0,8).map(todayRow).join('')}</details>`:''}`;
};

document.addEventListener('click',async e=>{
  const t=e.target;
  if(t.id==='showAll'){showAllToday=true;render();return}
  const f=t.closest&&t.closest('[data-focus]');
  if(f){e.preventDefault();e.stopImmediatePropagation();startFocus(f.getAttribute('data-focus'),120);return}
  const done=t.closest&&t.closest('[data-fdone]');
  if(done){e.preventDefault();e.stopImmediatePropagation();
    await store.complete(done.getAttribute('data-fdone'),true);
    stopFocus();render();try{await cloud.sync()}catch(err){}
    toast('完成一件事。这是今天的第 '+(store.all('award').filter(a=>a.date===today()).length)+' 次打勾。');return}
  const more=t.closest&&t.closest('[data-fmore]');
  if(more){e.preventDefault();e.stopImmediatePropagation();startFocus(more.getAttribute('data-fmore'),600);return}
  const cl=t.closest&&t.closest('[data-fclose]');
  if(cl){e.preventDefault();stopFocus();return}
},true);

/* ===== 交互整修：学习页清爽 + 行程周课表 + 导航精简 + 每日自动排学习任务 ===== */
render = function(){
  const pages={today:['☀','今日'],courses:['▤','学习'],week:['▦','行程'],life:['♡','生活'],rewards:['✧','奖励'],settings:['⚙','设置']};
  $('#nav').innerHTML=Object.entries(pages).map(([k,[ic,t]])=>`<button class="${page===k?'active':''}" data-page="${k}"><span>${ic}</span> ${t}</button>`).join('');
  $('#date').textContent=new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'});
  $('#heading').textContent=(pages[page]||pages.today)[1];
  $('#sync').textContent=cloud.status;
  $('#main').innerHTML=({today:renderToday,week:renderWeek,courses:renderCourses,review:renderReview,life:renderLife,rewards:renderRewards,settings:renderSettings})[page]();
};

renderCourses = function(){
  const cs=store.all('course').filter(c=>c.id!=='g-cook');
  let allDone=0,allTot=0;
  cs.forEach(c=>{const ts=tasks().filter(t=>t.courseId===c.id);ts.forEach(t=>{const w=Number(t.weight)||Number(chapter(t)?.weight)||1;allTot+=w;if(t.done)allDone+=w})});
  const totalPct=allTot?Math.round(allDone/allTot*100):0;
  const cards=cs.map(c=>{
    const ts=tasks().filter(t=>t.courseId===c.id);
    const p=progress(ts),dn=ts.filter(t=>t.done).length;
    const chs=store.all('chapter').filter(x=>x.courseId===c.id);
    const next=ts.filter(t=>!t.done).sort((a,b)=>((a.date||'9999')+(a.start||'99')).localeCompare((b.date||'9999')+(b.start||'99')))[0];
    return `<div class="panel course-card">
      <div class="cc-head"><b>${esc(c.title)}</b><span class="cc-pct">${p}%</span></div>
      <div class="progress"><i style="width:${p}%"></i></div>
      <p class="meta">${dn}/${ts.length} 步 · ${chs.length} 章${next?' · 下一步：'+esc(next.title):' · 已完成'}</p>
      ${next?action('下一步 →','detail',next.id,'primary'):''}
    </div>`;
  }).join('');
  return `<div class="panel"><div class="cc-head"><b>总进度</b><span class="cc-pct">${totalPct}%</span></div><div class="progress"><i style="width:${totalPct}%"></i></div><p class="meta">按重要度加权：重点章节完成得多，涨得快。</p><div class="toolbar" style="margin-top:8px"><button data-goto="review">复习卡片</button>${action('新增目标','newCourse')}</div></div>
  <div class="course-list">${cards}</div>
  ${weightPanel()}`;
};

renderWeek = function(){
  const dates=Array.from({length:7},(_,i)=>addDays(week,i));
  const list=tasks().filter(t=>dates.includes(t.date));
  const bad=new Set(conflicts(list));
  const rows=Array.from({length:16},(_,i)=>i+7);
  return `<div class="panel"><div class="toolbar">${action('← 上一周','prevWeek')}${action('本周','thisWeek')}${action('下一周 →','nextWeek')}<b style="margin-left:auto">${week} — ${addDays(week,6)}</b></div>
  <div class="week-scroll"><div class="week-grid">
    <div class="wg-corner"></div>${dates.map((d,i)=>`<div class="wg-head ${d===today()?'today':''}">${['一','二','三','四','五','六','日'][i]}<br><span>${d.slice(5)}</span></div>`).join('')}
    ${rows.map(h=>`<div class="wg-time">${String(h).padStart(2,'0')}:00</div>${dates.map(d=>`<div class="wg-cell ${d===today()?'today':''}">${list.filter(t=>t.date===d&&t.start&&minutes(t.start)>=h*60&&minutes(t.start)<(h+1)*60).map(t=>`<button class="wg-ev ${t.category==='固定课程'?'fixed':''} ${t.done?'done':''} ${bad.has(t.id)?'conflict':''}" data-action="detail" data-id="${esc(t.id)}" style="height:${Math.max(26,(minutes(t.end||'00:00')-minutes(t.start))*0.85)}px"><b>${esc(t.title)}</b><span>${esc(t.start)}</span></button>`).join('')}</div>`).join('')}`).join('')}
  </div></div>
  <p class="meta">左右滑动看整周；点色块看详情。⚠ 表示时间重叠。${list.filter(t=>!t.start).length?'<br>另有 '+list.filter(t=>!t.start).length+' 项时间待定，在今日或学习里看。':''}</p></div>`;
};

document.addEventListener('click',e=>{
  const g=e.target.closest&&e.target.closest('[data-goto]');
  if(g){e.preventDefault();e.stopImmediatePropagation();page=g.getAttribute('data-goto');render();return}
},true);

async function ensureDailyStudy(){
  if(!settings().confirmed)return;
  const todays=tasks().filter(t=>t.date===today()&&t.category!=='固定课程');
  if(todays.length>=3)return;
  const cands=tasks().filter(t=>t.category!=='固定课程'&&!t.done&&(!t.date||t.date>today())&&t.chapterId);
  const wOf=t=>Number(t.weight)||Number(chapter(t)?.weight)||1;
  cands.sort((a,b)=>wOf(b)-wOf(a)||((a.order||0)-(b.order||0)));
  const add=cands.slice(0,3-todays.length);
  for(const t of add)await store.put({...t,date:today(),start:t.start||''});
  if(add.length){render();try{await cloud.sync()}catch(e){}}
}
ensureDailyStudy();

/* ===== 今天能做的都排进来 + 颜色设计 ===== */
const PALETTE=['#b43b70','#7c5cd6','#2f8f6b','#c2703a','#3d7dd8','#b8860b','#c2410c','#0e7490'];
function courseColor(id){const cs=store.all('course');const i=cs.findIndex(c=>c.id===id);return PALETTE[(i<0?0:i)%PALETTE.length]}
function courseColorOf(t){return courseColor(t.courseId)}

ensureDailyStudy = async function(){
  const todays=tasks().filter(t=>t.date===today()&&t.category!=='固定课程');
  const want=4;
  if(todays.length>=want)return;
  const cands=tasks().filter(t=>t.category!=='固定课程'&&!t.done&&(!t.date||t.date>today()));
  const wOf=t=>Number(t.weight)||Number(chapter(t)?.weight)||1;
  cands.sort((a,b)=>wOf(b)-wOf(a)||((a.order||0)-(b.order||0)));
  const add=cands.slice(0,want-todays.length);
  for(const t of add)await store.put({...t,date:today(),start:'',end:''});
  if(add.length){render();try{await cloud.sync()}catch(e){}}
};

renderCourses = function(){
  const cs=store.all('course').filter(c=>c.id!=='g-cook');
  let allDone=0,allTot=0;
  cs.forEach(c=>{const ts=tasks().filter(t=>t.courseId===c.id);ts.forEach(t=>{const w=Number(t.weight)||Number(chapter(t)?.weight)||1;allTot+=w;if(t.done)allDone+=w})});
  const totalPct=allTot?Math.round(allDone/allTot*100):0;
  const cards=cs.map(c=>{
    const ts=tasks().filter(t=>t.courseId===c.id);
    const p=progress(ts),dn=ts.filter(t=>t.done).length;
    const chs=store.all('chapter').filter(x=>x.courseId===c.id);
    const next=ts.filter(t=>!t.done).sort((a,b)=>((a.date||'9999')+(a.start||'99')).localeCompare((b.date||'9999')+(b.start||'99')))[0];
    const col=courseColor(c.id);
    return `<div class="panel course-card" style="border-left:4px solid ${col}">
      <div class="cc-head"><b>${esc(c.title)}</b><span class="cc-pct" style="color:${col}">${p}%</span></div>
      <div class="progress"><i style="width:${p}%;background:${col}"></i></div>
      <p class="meta">${dn}/${ts.length} 步 · ${chs.length} 章${next?' · 下一步：'+esc(next.title):' · 已完成'}</p>
      ${c.id==='g-thesis'?`<p class="meta" style="margin-top:6px">进度以导师协作平台的双向确认为准</p>`:(next?`<button class="primary" style="background:${col};border-color:${col}" data-action="detail" data-id="${esc(next.id)}">下一步 →</button>`:'')}
    </div>`;
  }).join('');
  return `<div class="panel"><div class="cc-head"><b>总进度</b><span class="cc-pct">${totalPct}%</span></div><div class="progress"><i style="width:${totalPct}%"></i></div><p class="meta">按重要度加权；颜色代表不同科目。</p><div class="toolbar" style="margin-top:8px"><button data-goto="review">复习卡片</button>${action('新增目标','newCourse')}</div></div>
  <div class="course-list">${cards}</div>${weightPanel()}`;
};

renderToday = function(){
  const list=tasks().filter(t=>t.date===today());
  const dn=list.filter(t=>t.done).length;
  const award=store.all('award').filter(x=>x.date===today()).reduce((n,x)=>n+x.amount,0);
  const timed=list.filter(t=>t.start).sort((a,b)=>a.start.localeCompare(b.start));
  const untimed=list.filter(t=>!t.start);
  const next=tasks().filter(t=>t.date===today()&&!t.done).sort((a,b)=>(a.start||'99').localeCompare(b.start||'99'))[0]||tasks().filter(t=>!t.done).sort((a,b)=>((a.date||'9999')).localeCompare(b.date||'9999'))[0];
  const allDone=dn===list.length&&list.length>0;
  const rowC=t=>{
    const col=courseColorOf(t);
    return `<div class="row ${t.done?'done':''}"><input type="checkbox" data-task="${esc(t.id)}" ${t.done?'checked':''}>
      <div class="body"><button class="title" data-action="detail" data-id="${esc(t.id)}">${esc(t.title)}</button>
      <div class="meta"><span class="tag" style="background:${col}1a;color:${col}">${esc((course(t)||{}).title||t.category||'任务')}</span>${t.start?esc(t.start+'–'+t.end):'今天随时'}</div></div>
      <button class="mini-btn" data-focus="${esc(t.id)}">2 分钟</button><button class="x-btn" data-split="${esc(t.id)}">×</button></div>`;
  };
  return `<div class="panel focus-now">
    <p class="meta">现在做</p>
    <h2 class="now-title">${allDone?'今天做完了，去休息 🎉':(next?esc(next.title):'今天没有安排')}</h2>
    ${next?`<button class="primary big" data-focus="${esc(next.id)}">开始 2 分钟</button>`:''}
    <p class="today-line">${allDone?'':'已完成 '+dn+' / '+list.length} · 今日 +${award} 分 · 连续 ${streakDays()} 天</p></div>
  <div class="panel"><div class="toolbar"><h2>今天要做</h2>${action('＋ 任务','newTask')}</div>
  ${timed.map(rowC).join('')}
  ${untimed.length?'<h3 style="font-size:13px;color:var(--muted);margin:12px 0 4px">今天的计划（随时做）</h3>'+untimed.map(rowC).join(''):''}
  ${!list.length?empty('今天没有任务'):''}
  </div>`;
};
ensureDailyStudy();

/* ===== 学习页：默认 5 张卡，避免太长 ===== */
let showAllCourses=false;
renderCourses = function(){
  const cs=store.all('course').filter(c=>c.id!=='g-cook');
  let allDone=0,allTot=0;
  cs.forEach(c=>{const ts=tasks().filter(t=>t.courseId===c.id);ts.forEach(t=>{const w=Number(t.weight)||Number(chapter(t)?.weight)||1;allTot+=w;if(t.done)allDone+=w})});
  const totalPct=allTot?Math.round(allDone/allTot*100):0;
  const shown=showAllCourses?cs:cs.slice(0,5);
  const cards=shown.map(c=>{
    const ts=tasks().filter(t=>t.courseId===c.id);
    const p=progress(ts),dn=ts.filter(t=>t.done).length;
    const chs=store.all('chapter').filter(x=>x.courseId===c.id);
    const next=ts.filter(t=>!t.done).sort((a,b)=>((a.date||'9999')+(a.start||'99')).localeCompare((b.date||'9999')+(b.start||'99')))[0];
    const col=courseColor(c.id);
    return `<div class="panel course-card" style="border-left:4px solid ${col}">
      <div class="cc-head"><b>${esc(c.title)}</b><span class="cc-pct" style="color:${col}">${p}%</span></div>
      <div class="progress"><i style="width:${p}%;background:${col}"></i></div>
      <p class="meta">${dn}/${ts.length} 步 · ${chs.length} 章${next?' · 下一步：'+esc(next.title):' · 已完成'}</p>
      ${c.id==='g-thesis'?`<p class="meta" style="margin-top:6px">进度以导师协作平台的双向确认为准</p>`:(next?`<button class="primary" style="background:${col};border-color:${col}" data-action="detail" data-id="${esc(next.id)}">下一步 →</button>`:'')}
    </div>`;
  }).join('');
  return `<div class="panel"><div class="cc-head"><b>总进度</b><span class="cc-pct">${totalPct}%</span></div><div class="progress"><i style="width:${totalPct}%"></i></div><p class="meta">按重要度加权；颜色代表不同科目。</p><div class="toolbar" style="margin-top:8px"><button data-goto="review">复习卡片</button>${action('新增目标','newCourse')}</div></div>
  <div class="course-list">${cards}</div>
  ${cs.length>5&&!showAllCourses?`<button class="link-btn" id="moreCourses">展开全部 ${cs.length} 个目标</button>`:''}
  ${weightPanel()}`;
};
document.addEventListener('click',e=>{
  if(e.target.id==='moreCourses'){e.preventDefault();e.stopImmediatePropagation();showAllCourses=true;render()}
},true);
ensureDailyStudy();

/* ===== 今日只放学习任务，不再重复课表里的课 ===== */
renderToday = function(){
  const isStudy=t=>t.category!=='固定课程'&&t.courseId!=='g-thesis';
  const list=tasks().filter(t=>t.date===today()&&isStudy(t)&&(STUDY_OK.includes(t.courseId)||isHomework(t)));
  const dn=list.filter(t=>t.done).length;
  const award=store.all('award').filter(x=>x.date===today()).reduce((n,x)=>n+x.amount,0);
  const timed=list.filter(t=>t.start).sort((a,b)=>a.start.localeCompare(b.start));
  const untimed=list.filter(t=>!t.start);
  const next=list.filter(t=>!t.done).sort((a,b)=>(a.start||'99').localeCompare(b.start||'99'))[0];
  const allDone=dn===list.length&&list.length>0;
  const rowC=t=>{
    const col=courseColorOf(t);
    return `<div class="row ${t.done?'done':''}"><input type="checkbox" data-task="${esc(t.id)}" ${t.done?'checked':''}>
      <div class="body"><button class="title" data-action="detail" data-id="${esc(t.id)}">${esc(t.title)}</button>
      <div class="meta"><span class="tag" style="background:${col}1a;color:${col}">${esc((course(t)||{}).title||t.category||'任务')}</span>${t.start?esc(t.start+'–'+t.end):'今天随时'}</div></div>
      <button class="mini-btn" data-focus="${esc(t.id)}">2 分钟</button><button class="x-btn" data-split="${esc(t.id)}">×</button></div>`;
  };
  return `<div class="panel focus-now">
    <p class="meta">现在做</p>
    <h2 class="now-title">${allDone?'今天做完了，去休息 🎉':(next?esc(next.title):'今天没有学习任务')}</h2>
    ${next?`<button class="primary big" data-focus="${esc(next.id)}">开始 2 分钟</button>`:''}
    <p class="today-line">${allDone?'':'已完成 '+dn+' / '+list.length} · 今日 +${award} 分 · 连续 ${streakDays()} 天</p></div>
  <div class="panel"><div class="toolbar"><h2>今天要做</h2>${action('＋ 任务','newTask')}</div>
  ${timed.map(rowC).join('')}
  ${untimed.length?'<h3 style="font-size:13px;color:var(--muted);margin:12px 0 4px">今天的计划（随时做）</h3>'+untimed.map(rowC).join(''):''}
  ${!list.length?empty('今天没有学习任务'):''}
  <p class="meta" style="margin-top:8px">课表里的课不放在这里，只在“行程”里看。</p>
  </div>`;
};
ensureDailyStudy();

/* ===== 每日：把任务细分并排进空档 ===== */
let scheduleToday;
const DEF_SLOTS={早:['08:30','10:10'],上午:['10:25','12:05'],下午:['14:00','17:35'],傍晚:['18:30','19:30'],晚上:['19:30','22:00'],睡前:['22:00','22:30']};
function m2(h){if(!h)return null;const a=h.split(':');return (+a[0])*60+(+a[1])}
function h2(m){const h=Math.floor(m/60),x=m%60;return String(h).padStart(2,'0')+':'+String(x).padStart(2,'0')}

function busyToday(){
  const out=[];
  tasks().filter(t=>t.date===today()&&t.start).forEach(t=>{const a=m2(t.start),b=m2(t.end||t.start);if(a!=null&&b!=null&&b>a)out.push([a,b])});
  const wd=new Date().getDay(), slots=settings().slots||DEF_SLOTS;
  store.all('fixed').filter(f=>f.wd===wd).forEach(f=>{
    const s=slots[f.slot]||DEF_SLOTS[f.slot];
    if(s){const a=m2(s[0]),b=m2(s[1]);if(a!=null&&b!=null)out.push([a,b])}
  });
  return out.sort((a,b)=>a[0]-b[0]);
}
function freeWindows(){
  const busy=busyToday();
  const windows=[[8*60,12*60],[13*60,17*60+40],[19*60,22*60]];
  const out=[];
  for(const [ws,we] of windows){
    let cur=ws;
    const blocks=busy.filter(b=>b[1]>ws&&b[0]<we).sort((a,b)=>a[0]-b[0]);
    for(const b of blocks){if(b[0]>cur)out.push([cur,Math.min(b[0],we)]);cur=Math.max(cur,b[1]);if(cur>=we)break}
    if(cur<we)out.push([cur,we]);
  }
  return out.filter(w=>w[1]-w[0]>=15).map(w=>[...w]);
}
function takeSlot(free,dur,gap){
  for(let i=0;i<free.length;i++){
    const w=free[i];
    if(w[1]-w[0]>=dur){const start=w[0];w[0]=start+dur+gap;return start}
  }
  return null;
}

scheduleToday = async function(){
  const list=tasks().filter(t=>t.date===today()&&t.category!=='固定课程'&&!t.start&&!t.done);
  if(!list.length)return;
  const free=freeWindows();
  if(!free.length)return;
  const order=list.sort((a,b)=>(Number(b.weight)||Number(chapter(b)?.weight)||1)-(Number(a.weight)||Number(chapter(a)?.weight)||1));
  for(const t of order){
    let dur=Number(t.duration)||30;
    if(dur>35){
      const parts=dur>60?3:2, per=Math.max(15,Math.round(dur/parts/5)*5), baseTitle=String(t.title).replace(/（\d+\/\d+）$/,'');
      await store.put({...t,title:baseTitle+'（1/'+parts+'）',duration:per});
      for(let k=1;k<parts;k++){
        await store.put({id:t.id+'-p'+k,kind:'task',courseId:t.courseId,chapterId:t.chapterId,title:baseTitle+'（'+(k+1)+'/'+parts+'）',category:t.category,duration:per,order:t.order,date:today(),done:false,note:t.note});
      }
      dur=per;
    }
    const start=takeSlot(free,dur,10);
    if(start==null)break;
    await store.put({...t,start:h2(start),end:h2(start+dur),duration:dur});
  }
  render();try{await cloud.sync()}catch(e){}
};
(async()=>{try{await ensureDailyStudy()}catch(e){};try{await scheduleToday()}catch(e){}})();

/* ===== 论文：按周固定，不参与挑选；截止可行性检查 ===== */
function daysBetween(a,b){return Math.round((new Date(b+'T12:00')-new Date(a+'T12:00'))/86400000)}
function feas(c){
  const ts=tasks().filter(t=>t.courseId===c.id&&!t.done);
  const left=Math.max(0,daysBetween(today(),c.deadline||today()));
  const weeks=Math.max(1,Math.ceil(left/7));
  const need=ts.length?Math.ceil(ts.length/weeks):0;
  const st=need<=4?'ok':need<=7?'warn':'bad';
  const txt=need<=4?'能完成':need<=7?'偏紧':'排不下';
  return {left,weeks,need,st,txt};
}

renderToday = (function(prev){
  return function(){
    const thesis=tasks().filter(t=>t.courseId==='g-thesis'&&!t.done).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    const now=tasks().filter(t=>t.courseId==='g-thesis'&&!t.done&&t.date&&t.date<=today())[0]||thesis[0];
    const base=prev();
    const blockHtml=thesis.length?`<div class="panel thesis-now"><span class="tag">论文 · 按周固定</span>
      <h2 class="now-title" style="font-size:17px">${esc(now?now.title:'本周论文已完成')}</h2>
      <p class="meta">${now?(now.date?'原定 '+esc(now.date)+' · ':'')+'这一步不参与挑选，按周推进；'+esc(now.duration||30)+' 分钟':''}</p>
      ${now?`<button class="primary" data-focus="${esc(now.id)}">现在做</button>`:''}
      </div>`:'';
    return blockHtml+base;
  };
})(renderToday);

ensureDailyStudy = (function(prev){
  return async function(){
    await prev();
    const thesis=tasks().filter(t=>t.courseId==='g-thesis'&&!t.done&&t.date&&t.date<=today());
    for(const t of thesis){if(!t.start)await store.put({...t,date:today()})}
  };
})(ensureDailyStudy);

scheduleToday = (function(prev){
  return async function(){
    const th=tasks().filter(t=>t.courseId==='g-thesis'&&!t.done&&t.date===today()&&!t.start);
    const free=freeWindows();
    for(const t of th){
      const dur=Number(t.duration)||30, start=takeSlot(free,dur,10);
      if(start==null)break;
      await store.put({...t,start:h2(start),end:h2(start+dur)});
    }
    await prev();
  };
})(scheduleToday);

renderCourses = (function(prev){
  return function(){
    let html=prev();
    const cs=store.all('course');
    cs.forEach(c=>{
      const f=feas(c);
      const col=courseColor(c.id);
      const badge=`<span class="feas ${f.st}" style="border-color:${col}">${f.txt}</span>`;
      html=html.replace(`<div class="cc-head"><b>${esc(c.title)}</b>`, `<div class="cc-head"><b>${esc(c.title)}</b>${badge}`);
    });
    return html;
  };
})(renderCourses);

/* ===== 行程：固定课表 + 彩色分类 + 可拖动 ===== */
const CAT_COLORS={
  thesis:{bg:'#f1ebff',bd:'#c9b6f2',tx:'#5b3fa8'},
  course:{bg:'#e8f0ff',bd:'#b6cdf7',tx:'#2f5fae'},
  exam:{bg:'#e6f6ee',bd:'#b3e0c9',tx:'#1f7a52'},
  interest:{bg:'#fdeee3',bd:'#f3c9a8',tx:'#a55a25'},
  life:{bg:'#f1f2f4',bd:'#d8dade',tx:'#61666e'},
  class:{bg:'#eaf1ff',bd:'#c3d6f8',tx:'#2f5fae'}
};
const EXAM_IDS=['g-eng','g-biochem','g-cell','g-politics'];
function colorOf(t){
  if(t.courseId==='g-thesis')return CAT_COLORS.thesis;
  if(t.fixedLike){
    if(t.category==='兴趣')return CAT_COLORS.interest;
    if(t.category==='生活')return CAT_COLORS.life;
    if(t.category==='科研')return CAT_COLORS.thesis;
    return CAT_COLORS.class;
  }
  if(t.category==='固定课程')return CAT_COLORS.class;
  if(t.category==='生活')return CAT_COLORS.life;
  if(t.category==='兴趣')return CAT_COLORS.interest;
  if(EXAM_IDS.includes(t.courseId))return CAT_COLORS.exam;
  if(t.courseId){const c=courseColor(t.courseId);return {bg:c+'1f',bd:c+'66',tx:c}}
  return CAT_COLORS.course;
}
function semWeekOf(d){const s=settings().semester||'2026-09-07';return Math.floor((new Date(d+'T12:00')-new Date(s+'T12:00'))/604800000)+1}
function fixedForDay(d){
  const wd=new Date(d+'T12:00').getDay(), wk=semWeekOf(d), slots=settings().slots||DEF_SLOTS, out=[];
  store.all('fixed').forEach(f=>{
    if(f.wd!==wd||wk<f.from||wk>f.to)return;
    const sp=slots[f.slot]||DEF_SLOTS[f.slot]; if(!sp)return;
    out.push({id:'F:'+f.id+':'+d,title:f.title,date:d,start:sp[0],end:sp[1],category:f.cat,fixedLike:true,note:f.note});
  });
  return out;
}

renderWeek = function(){
  const dates=Array.from({length:7},(_,i)=>addDays(week,i));
  const todayStr=today();
  const rows=Array.from({length:16},(_,i)=>i+7);
  return `<div class="panel"><div class="toolbar">${action('← 上一周','prevWeek')}${action('本周','thisWeek')}${action('下一周 →','nextWeek')}<b style="margin-left:auto">${week} — ${addDays(week,6)}</b></div>
  <p class="meta">蓝色=上课，紫色=论文，绿色=考研，橙色=兴趣，灰色=生活；<b>带锁的不能拖，其余可拖动改时间</b>。</p>
  <div class="week-scroll"><div class="week-grid">
    <div class="wg-corner"></div>${dates.map((d,i)=>`<div class="wg-head ${d===todayStr?'today':''}">${['一','二','三','四','五','六','日'][i]}<br><span>${d.slice(5)}</span></div>`).join('')}
    ${rows.map(h=>`<div class="wg-time">${String(h).padStart(2,'0')}:00</div>${dates.map(d=>{
      const evs=[...fixedForDay(d),...tasks().filter(t=>t.date===d&&t.start&&minutes(t.start)>=h*60&&minutes(t.start)<(h+1)*60)];
      return `<div class="wg-cell ${d===todayStr?'today':''}" data-cell="${d}:${h}">${evs.map(t=>{
        const c=colorOf(t), lock=!!t.fixedLike;
        const hgt=Math.max(26,((m2(t.end||t.start)||(h*60+30))-(m2(t.start)||h*60))*0.8);
        return `<button class="wg-ev ${lock?'locked':''}" data-tid="${esc(t.id)}" data-lock="${lock?1:0}"
          ${lock?'':'draggable="true"'} style="background:${c.bg};border-color:${c.bd};color:${c.tx};height:${hgt}px">
          <b>${esc(t.title)}</b><span>${esc(t.start||'')}</span></button>`;
      }).join('')}</div>`;
    }).join('')}`).join('')}
  </div></div></div>`;
};

/* 拖动：桌面用 HTML5 DnD，iPad 用指针长按拖动 */
let dragId=null,dragLock=false,ghost=null;
document.addEventListener('dragstart',e=>{
  const el=e.target.closest&&e.target.closest('.tt-ev'); if(!el||el.dataset.lock==='1')return;
  dragId=el.dataset.tid; dragLock=false; e.dataTransfer.setData('text/plain',dragId);
},true);
document.addEventListener('dragover',e=>{
  const cell=e.target.closest&&e.target.closest('[data-cell]'); if(cell&&dragId){e.preventDefault();cell.classList.add('dragover')}
},true);
document.addEventListener('dragleave',e=>{
  const cell=e.target.closest&&e.target.closest('[data-cell]'); if(cell)cell.classList.remove('dragover');
},true);
document.addEventListener('drop',async e=>{
  const cell=e.target.closest&&e.target.closest('[data-cell]'); if(!cell||!dragId)return;
  e.preventDefault();cell.classList.remove('dragover');
  const [d,sl]=cell.dataset.cell.split(':');
  const t=store.get(dragId);
  if(t){
    const sp=slotTimes()[sl]||['09:00','09:30'];
    await store.put({...t,date:d,slot:sl,start:sp[0],end:sp[1],locked:false});
    dragId=null;render();try{await cloud.sync()}catch(err){}
  }
},true);

let pressTimer=null,pressing=null,ghostEl=null;
document.addEventListener('pointerdown',e=>{
  const el=e.target.closest&&e.target.closest('.tt-ev');
  if(!el||el.dataset.lock==='1')return;
  pressing={id:el.dataset.tid,x:e.clientX,y:e.clientY,moved:false};
  pressTimer=setTimeout(()=>{
    if(!pressing)return;
    dragId=pressing.id;
    ghostEl=el.cloneNode(true);ghostEl.style.cssText+=';position:fixed;opacity:.85;pointer-events:none;z-index:999;width:'+el.offsetWidth+'px';
    document.body.appendChild(ghostEl);moveGhost(pressing.x,pressing.y);
  },280);
},true);
function moveGhost(x,y){if(!ghostEl)return;ghostEl.style.left=(x-40)+'px';ghostEl.style.top=(y-18)+'px'}
document.addEventListener('pointermove',e=>{
  if(!pressing)return;
  if(Math.abs(e.clientX-pressing.x)>8||Math.abs(e.clientY-pressing.y)>8)pressing.moved=true;
  if(pressing.moved&&!dragId)clearTimeout(pressTimer);
  if(ghostEl)moveGhost(e.clientX,e.clientY);
},true);
document.addEventListener('pointerup',async e=>{
  clearTimeout(pressTimer);
  if(ghostEl){ghostEl.remove();ghostEl=null}
  if(dragId){
    const cell=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-cell]');
    if(cell){
      const [d,sl]=cell.dataset.cell.split(':');
      const t=store.get(dragId);
      if(t){const sp=slotTimes()[sl]||['09:00','09:30'];
        await store.put({...t,date:d,slot:sl,start:sp[0],end:sp[1],locked:false});
        try{await cloud.sync()}catch(err){}
      }
    }
    dragId=null;render();
  }
  pressing=null;
},true);

/* ===== 行程：重写为绝对定位周课表（修重叠/错位/重复） ===== */
const HOUR_PX=46, DAY_START=7*60;
renderWeek = function(){
  const dates=Array.from({length:7},(_,i)=>addDays(week,i));
  const todayStr=today();
  const hours=Array.from({length:15},(_,i)=>i+7);
  return `<div class="panel"><div class="toolbar">${action('← 上一周','prevWeek')}${action('本周','thisWeek')}${action('下一周 →','nextWeek')}<b style="margin-left:auto">${week} — ${addDays(week,6)}</b></div>
  <p class="meta">蓝=上课 <span class="dotc" style="background:#5b8def"></span> 紫=论文 <span class="dotc" style="background:#8b6cd9"></span> 绿=考研 <span class="dotc" style="background:#2fa36b"></span> 橙=兴趣 <span class="dotc" style="background:#d97a3a"></span> 灰=生活 <span class="dotc" style="background:#9aa0a6"></span>；不能拖，其余可拖</p>
  <div class="week-scroll">
    <div class="wg2-head"><div class="wg2-corner"></div>${dates.map((d,i)=>`<div class="wg2-hd ${d===todayStr?'today':''}">${['一','二','三','四','五','六','日'][i]}<br><span>${d.slice(5)}</span></div>`).join('')}</div>
    <div class="wg2-body">
      <div class="wg2-times">${hours.map(h=>`<div class="wg2-t">${String(h).padStart(2,'0')}:00</div>`).join('')}</div>
      ${dates.map(d=>{
        const evs=[];
        fixedForDay(d).forEach(f=>evs.push({...f,lock:true}));
        tasks().filter(t=>t.date===d&&t.start).forEach(t=>{
          const dup=evs.some(f=>f.title===t.title&&f.start===t.start);
          if(!dup)evs.push({...t,lock:false});
        });
        return `<div class="wg2-col ${d===todayStr?'today':''}">
          ${hours.map(h=>`<div class="wg2-line" data-cell="${d}:${h}" style="top:${(h*60-DAY_START)/60*HOUR_PX}px"></div>`).join('')}
          ${evs.map(t=>{
            const st=m2(t.start), en=m2(t.end||t.start)||(st+30);
            const top=(st-DAY_START)/60*HOUR_PX, hgt=Math.max(HOUR_PX*0.5,(en-st)/60*HOUR_PX-2);
            const c=colorOf(t);
            return `<button class="wg2-ev ${t.lock?'locked':''}" data-tid="${esc(t.id)}" data-lock="${t.lock?1:0}" ${t.lock?'':'draggable="true"'}
              style="top:${top}px;height:${hgt}px;background:${c.bg};border-color:${c.bd};color:${c.tx}">
              <b>${esc(t.title)}</b><span>${esc(t.start||'')}${t.end?'–'+esc(t.end):''}</span>
            </button>`;
          }).join('')}
        </div>`;
      }).join('')}
    </div>
  </div></div>`;
};

/* ===== 今日：6 个学习任务 + 作业区；只给专业课/考研排学习 ===== */
const STUDY_OK=['g-eng','g-biochem','g-cell','g-politics','g-inorg','g-org','g-food','g-report','g-dou','g-draw','g-drum'];
const HOMEWORK_IDS=['g-online'];
function isHomework(t){
  if(HOMEWORK_IDS.includes(t.courseId))return true;
  return /作业|报告|实训|网课|实验报告/.test(t.title||'');
}
ensureDailyStudy = async function(){
  const todays=tasks().filter(t=>t.date===today()&&t.category!=='固定课程'&&t.courseId!=='g-thesis');
  const want=6;
  if(todays.length>=want)return;
  const cands=tasks().filter(t=>t.category!=='固定课程'&&t.courseId!=='g-thesis'&&!t.done&&(!t.date||t.date>today())&&!isHomework(t)&&STUDY_OK.includes(t.courseId));
  const wOf=t=>Number(t.weight)||Number(chapter(t)?.weight)||1;
  cands.sort((a,b)=>wOf(b)-wOf(a)||((a.order||0)-(b.order||0)));
  const add=cands.slice(0,want-todays.length);
  for(const t of add)await store.put({...t,date:today(),start:'',end:''});
  if(add.length){render();try{await cloud.sync()}catch(e){}}
};

renderToday = function(){
  const isStudy=t=>t.category!=='固定课程'&&t.courseId!=='g-thesis';
  const list=tasks().filter(t=>t.date===today()&&isStudy(t)&&(STUDY_OK.includes(t.courseId)||isHomework(t)));
  const dn=list.filter(t=>t.done).length;
  const award=store.all('award').filter(x=>x.date===today()).reduce((n,x)=>n+x.amount,0);
  const timed=list.filter(t=>t.start).sort((a,b)=>a.start.localeCompare(b.start));
  const untimed=list.filter(t=>!t.start);
  const next=list.filter(t=>!t.done).sort((a,b)=>(a.start||'99').localeCompare(b.start||'99'))[0];
  const allDone=dn===list.length&&list.length>0;
  const thesis=tasks().filter(t=>t.courseId==='g-thesis'&&!t.done).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const thesisNow=tasks().filter(t=>t.courseId==='g-thesis'&&!t.done&&t.date&&t.date<=today())[0]||thesis[0];
  const hw=tasks().filter(t=>!t.done&&isHomework(t)&&t.date!==today()&&(!t.date||t.date<=addDays(today(),7))).sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')).slice(0,8);
  const rowC=t=>{
    const c=colorOf(t);
    return `<div class="row ${t.done?'done':''}"><input type="checkbox" data-task="${esc(t.id)}" ${t.done?'checked':''}>
      <div class="body"><button class="title" data-action="detail" data-id="${esc(t.id)}">${esc(t.title)}</button>
      <div class="meta"><span class="tag" style="background:${c.bg};color:${c.tx};border:1px solid ${c.bd}">${esc((course(t)||{}).title||t.category||'任务')}</span>${t.start?esc(t.start+'–'+t.end):'今天随时'}</div></div>
      <button class="mini-btn" data-focus="${esc(t.id)}">2 分钟</button><button class="x-btn" data-split="${esc(t.id)}">×</button></div>`;
  };
  return `${thesis.length?`<div class="panel thesis-now"><span class="tag" style="background:#f1ebff;color:#5b3fa8">论文 · 按周固定</span>
    <h2 class="now-title" style="font-size:17px">${esc(thesisNow?thesisNow.title:'本周论文已完成')}</h2>
    ${thesisNow?`<button class="primary" style="background:#8b6cd9;border-color:#8b6cd9" data-focus="${esc(thesisNow.id)}">现在做</button>`:''}</div>`:''}
  <div class="panel focus-now"><p class="meta">现在做</p>
    <h2 class="now-title">${allDone?'今天做完了，去休息 🎉':(next?esc(next.title):'今天没有学习任务')}</h2>
    ${next?`<button class="primary big" data-focus="${esc(next.id)}">开始 2 分钟</button>`:''}
    <p class="today-line">${allDone?'':'已完成 '+dn+' / '+list.length} · 今日 +${award} 分 · 连续 ${streakDays()} 天</p></div>
  <div class="panel"><div class="toolbar"><h2>今天要做</h2>${action('＋ 任务','newTask')}</div>
    ${timed.map(rowC).join('')}
    ${untimed.length?'<h3 class="sec">今天的计划（随时做）</h3>'+untimed.map(rowC).join(''):''}
    ${!list.length?empty('今天没有学习任务'):''}
    <p class="meta" style="margin-top:8px">只安排专业课和考研；其他课只在“作业”里出现。</p></div>
  ${hw.length?`<div class="panel"><h2>作业 / 杂事</h2>
    ${hw.map(t=>{const c=colorOf(t);return `<div class="row"><input type="checkbox" data-task="${esc(t.id)}">
      <div class="body"><button class="title" data-action="detail" data-id="${esc(t.id)}">${esc(t.title)}</button>
      <div class="meta"><span class="tag" style="background:${c.bg};color:${c.tx};border:1px solid ${c.bd}">${esc((course(t)||{}).title||t.category||'任务')}</span>${t.date?esc(t.date):'未排日期'}</div></div></div>`}).join('')}
    <p class="meta">作业不进每日计划，做完勾掉就行。</p></div>`:''}`;
};

/* ===== 行程：时段表格（早/上午/下午/傍晚/晚上/睡前 × 7 天），可拖动 ===== */
const TT_SLOTS=['早','上午','下午','傍晚','晚上','睡前'];
function slotTimes(){return Object.assign({},DEF_SLOTS,settings().slots||{})}
function slotOf(t){
  if(t.slot&&TT_SLOTS.includes(t.slot))return t.slot;
  const st=m2(t.start);
  if(st==null)return '上午';
  const map=slotTimes();
  for(const sl of TT_SLOTS){const r=map[sl];if(!r)continue;const a=m2(r[0]),b=m2(r[1]);if(st>=a-30&&st<b)return sl}
  return st<10*60?'早':st<12*60?'上午':st<17*60?'下午':st<19.5*60?'傍晚':st<22*60?'晚上':'睡前';
}
renderWeek = function(){
  const dates=Array.from({length:7},(_,i)=>addDays(week,i));
  const todayStr=today(), map=slotTimes();
  const cell=(d,sl)=>{
    const evs=[];
    fixedForDay(d).forEach(f=>{if(slotOf(f)===sl)evs.push({...f,lock:true})});
    tasks().filter(t=>t.date===d).forEach(t=>{
      if(slotOf(t)!==sl)return;
      if(evs.some(f=>f.title===t.title&&f.start===t.start))return;
      evs.push({...t,lock:false});
    });
    evs.sort((a,b)=>(a.start||'').localeCompare(b.start||''));
    return `<td class="tt-cell ${d===todayStr?'today':''}" data-cell="${d}:${sl}">${evs.map(t=>{
      const c=colorOf(t);
      return `<button class="tt-ev ${t.lock?'locked':''}" data-tid="${esc(t.id)}" data-lock="${t.lock?1:0}" ${t.lock?'':'draggable="true"'}
        style="background:${c.bg};border-color:${c.bd};color:${c.tx}">
        <b>${esc(t.title)}</b><span>${esc(t.start||'')}</span></button>`;
    }).join('')}</td>`;
  };
  return `<div class="panel"><div class="toolbar">${action('← 上一周','prevWeek')}${action('本周','thisWeek')}${action('下一周 →','nextWeek')}<b style="margin-left:auto">${week} — ${addDays(week,6)}</b></div>
  <p class="meta">固定课程/日程不能拖；其他块可以拖到别的格子改时间。</p>
  <div class="tt-scroll"><table class="tt">
    <thead><tr><th class="tt-th">时段</th>${dates.map((d,i)=>`<th class="${d===todayStr?'today':''}">${['周一','周二','周三','周四','周五','周六','周日'][i]}<br><span>${d.slice(5)}</span></th>`).join('')}</tr></thead>
    <tbody>${TT_SLOTS.map(sl=>`<tr><th class="tt-th">${sl}<br><span>${map[sl]?map[sl][0]+'–'+map[sl][1]:''}</span></th>${dates.map(d=>cell(d,sl)).join('')}</tr>`).join('')}</tbody>
  </table></div></div>`;
};

/* ===== 有期限的作业：按课表自动生成，带截止日，进每日计划 ===== */
const TERM_START='2026-09-07';
function homeworkSpecs(){
  const out=[], t=today();
  for(let wk=1;wk<=16;wk++){
    const mon=addDays(TERM_START,(wk-1)*7), tue=addDays(mon,1), wed=addDays(mon,2);
    if(mon>=t){
      [['note','课堂笔记',25],['hw','手写作业',35],['mind','思维导图',20]].forEach(([suf,name,dur])=>{
        out.push({id:`hw:inorg:${mon}:${suf}`,courseId:'g-inorg',title:`无机化学 · ${name}（${mon.slice(5)}课后）`,date:addDays(mon,7),duration:dur});
      });
    }
    const thu=addDays(mon,3);
    if(wk<=12&&thu>=t)out.push({id:`hw:cai:${thu}`,courseId:'extra-3',title:`中国名菜 · 实训报告（${thu.slice(5)}课后）`,date:addDays(thu,7),duration:40});
    if(wk<=12&&wed>=t)out.push({id:`hw:inno:${wed}`,courseId:'extra-2',title:`创新创业 · 学习通作业（${wed.slice(5)}课后）`,date:addDays(wed,7),duration:30});
  }
  const orgStart=addDays(t,14), orgEnd='2027-01-08';
  const orgSpan=Math.max(1,Math.round((new Date(orgEnd+'T12:00')-new Date(orgStart+'T12:00'))/86400000));
  for(let i=0;i<5;i++){
    const due=addDays(orgStart,Math.round(orgSpan*i/4));
    out.push({id:`hw:org:${i+1}`,courseId:'g-org',title:`有机化学 · 第 ${i+1} 次书面作业`,date:due,duration:45});
  }
  for(let wk=14;wk<=17;wk++){
    const mon=addDays(TERM_START,(wk-1)*7), wed=addDays(mon,2);
    if(wed>=t)out.push({id:`hw:lab:${wed}`,courseId:'extra-0',title:`无机与分析化学实验 · 实训报告（${wed.slice(5)}）`,date:addDays(wed,7),duration:50});
  }
  out.push({id:'hw:lit:1',courseId:'extra-1',title:'文献检索 · 开题报告',date:addDays(t,7),duration:60});
  if('2026-11-06'>=t)out.push({id:'exam:md:2026-11-06',courseId:'extra-4',title:'中国名点 · 实操考试',date:'2026-11-06',duration:120});
  return out;
}
async function ensureHomeworkRecords(){
  const t=today();
  for(const x of store.all('task').filter(x=>x.courseId==='g-cook'&&!x.done&&x.date>=today())){
    await store.put({...x,date:'',start:'',end:''});
  }
  const specs=homeworkSpecs();
  for(const oldRec of store.all('task').filter(x=>x.id&&x.id.startsWith('hw:cook:'))){ if(!oldRec.done)await store.remove(oldRec.id); }
  for(const r of specs){
    if(r.date<t)continue;
    const old=store.get(r.id);
    if(old){ if(r.id.startsWith('hw:org:')&&old.date!==r.date)await store.put({...old,date:r.date}); continue; }
    await store.put({...r,kind:'task',category:'课程',done:false,start:'',end:''});
  }
}

ensureDailyStudy = (function(prev){
  return async function(){
    await prev();
    // 作业：4 天内到期的，优先拉进今天（最多 2 个）
    const t=today(), in4=addDays(t,4);
    const hw=tasks().filter(x=>!x.done&&isHomework(x)&&x.date&&x.date>=t&&x.date<=in4&&x.date!==t);
    const todays=tasks().filter(x=>x.date===t&&x.category!=='固定课程').length;
    let room=Math.max(0,6-todays);
    for(const x of hw.sort((a,b)=>a.date.localeCompare(b.date)).slice(0,Math.min(2,room))){
      await store.put({...x,date:t,start:'',end:''});
    }
    render();try{await cloud.sync()}catch(e){}
  };
})(ensureDailyStudy);

/* 今日：作业也算正常任务，进“今天要做” */
renderToday = (function(prev){
  return function(){
    let html=prev();
    // 把“作业/杂事”里已排进今天的去掉（避免重复）
    return html;
  };
})(renderToday);

(async()=>{try{await ensureHomeworkRecords()}catch(e){};try{await ensureFinalGoalTasks()}catch(e){};try{await ensureDailyStudy()}catch(e){}})();

/* ===== 优先级：期末专业课 > 英语 > 考研专业课 > 政治；难的先排 ===== */
const FINALS=['g-inorg','g-org','g-food'];
const DIFFICULTY={'g-org':3,'g-inorg':2,'g-biochem':2,'g-cell':2,'g-food':1,'g-eng':1,'g-politics':1};
function tierOf(t){
  if(FINALS.includes(t.courseId))return 0;
  if(t.courseId==='g-eng')return 1;
  if(t.courseId==='g-politics')return 3;
  return 2;
}
function prioOf(t){return tierOf(t)*10 - (DIFFICULTY[t.courseId]||1)}

ensureDailyStudy = async function(){
  const t=today();
  const todayTasks=tasks().filter(x=>x.date===t&&x.category!=='固定课程'&&x.courseId!=='g-thesis');
  if(todayTasks.length>=6)return;
  const cands=tasks().filter(x=>x.category!=='固定课程'&&x.courseId!=='g-thesis'&&!x.done&&(!x.date||x.date>t)&&!isHomework(x)&&STUDY_OK.includes(x.courseId));
  const wOf=x=>Number(x.weight)||Number(chapter(x)?.weight)||1;
  cands.sort((a,b)=>prioOf(a)-prioOf(b)||wOf(b)-wOf(a));
  const countBy=cid=>todayTasks.filter(x=>x.courseId===cid).length;
  const picks=[];
  for(const c of cands){
    if(picks.length>=6-todayTasks.length)break;
    const cid=c.courseId;
    if(FINALS.includes(cid)){ if(countBy(cid)>=3)continue; }
    else if(cid==='g-eng'){ if(countBy(cid)>=1)continue; }
    else if(cid==='g-politics'){ if(t<'2027-07-01'||countBy(cid)>=1)continue; }
    else { if(countBy(cid)>=1)continue; }
    picks.push(c);
  }
  for(const x of picks)await store.put({...x,date:t,start:'',end:''});
  if(picks.length){render();try{await cloud.sync()}catch(e){}}
};

/* 每次排时间：难课优先放前面 */
scheduleToday = (function(prev){
  return async function(){
    const list=tasks().filter(x=>x.date===today()&&x.category!=='固定课程'&&!x.start&&!x.done);
    if(list.length&&freeWindows().length){
      const free=freeWindows();
      list.sort((a,b)=>prioOf(a)-prioOf(b));
      for(const x of list){
        let dur=Number(x.duration)||30;
        const st=takeSlot(free,Math.min(dur,30),10);
        if(st==null)break;
        await store.put({...x,start:h2(st),end:h2(st+Math.min(dur,30))});
      }
    }
    if(typeof prev==='function')await prev();
  };
})(scheduleToday);

/* 冲 90 分任务：每门期末课 3 步，12 月底前完成 */
async function ensureFinalGoalTasks(){
  const specs=[];
  const due=['2026-12-13','2026-12-20','2026-12-27'];
  FINALS.forEach(cid=>{
    const c=store.get(cid); if(!c)return;
    const brief=(c.title||'').replace(/[：:].*$/,'');
    const steps=['过一遍课件和重点','做往年题/课后题','背名词解释和简答'];
    steps.forEach((st,i)=>{
      specs.push({id:`goal90:${cid}:${i+1}`,courseId:cid,title:`${brief} · 冲90：${st}`,date:due[i],duration:45,category:'课程'});
    });
  });
  for(const r of specs){
    if(store.get(r.id))continue;
    await store.put({...r,kind:'task',done:false,start:'',end:''});
  }
}
