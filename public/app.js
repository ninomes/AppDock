'use strict';

/* ==========================================================
   状态
   ========================================================== */
const S = {
  apps: [],
  categories: [],
  settings: {},
  view: localStorage.getItem('gk.viewType') || 'all', // all | recent | frequent | pinned | cat
  filterCat: null,
  query: '',
  selection: new Set(),
  anchorId: null,
  sort: localStorage.getItem('gk.sort') || 'custom',
  mode: localStorage.getItem('gk.mode') || 'grid',
  editing: null,
  dragId: null,
  _wpstamp: 1
};

const $ = (id) => document.getElementById(id);
const listArea = $('listArea');
const content = $('content');

/* ==========================================================
   小工具
   ========================================================== */
async function api(path, opts) {
  const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || ('请求失败 ' + res.status));
  return data;
}
const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body || {}) });

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function letterColors(name) {
  const h = hashStr(name || '?') % 360;
  return {
    bg: `linear-gradient(145deg, hsl(${h} 46% 50%), hsl(${(h + 34) % 360} 44% 34%))`,
    letter: (name || '?').trim().charAt(0).toUpperCase()
  };
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function highlight(text, query) {
  const esc = escapeHtml(text);
  const q = String(query || '').trim();
  if (!q) return esc;
  const terms = q.split(/\s+/).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length) return esc;
  try {
    return esc.replace(new RegExp('(' + terms.join('|') + ')', 'gi'), '<mark>$1</mark>');
  } catch (_) { return esc; }
}

function relTime(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  const day = Math.floor(h / 24);
  if (day < 30) return day + ' 天前';
  const mo = Math.floor(day / 30);
  if (mo < 12) return mo + ' 个月前';
  return Math.floor(mo / 12) + ' 年前';
}

function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
  }, type === 'err' ? 3600 : 2000);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function catName(id) {
  const c = S.categories.find((x) => x.id === id);
  return c ? c.name : '未分类';
}

function subText(app) {
  if (app.launchUri) return app.launchUri;
  return app.target || '';
}

/* ==========================================================
   数据
   ========================================================== */
async function load() {
  const data = await api('/api/state');
  S.apps = data.apps || [];
  S.categories = data.categories || [];
  S.settings = data.settings || {};
  S.sort = S.settings.sort || S.sort;
  applySettings();
  render();
}

/* ==========================================================
   侧栏
   ========================================================== */
const ICONS = {
  all: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></svg>',
  recent: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/></svg>',
  frequent: '<svg viewBox="0 0 24 24"><path d="M13 3.5c.6 3-1.4 4.3-2.7 6-1.4 1.8-2.3 3-2.3 4.9a4 4 0 0 0 8 0c0-1.4-.5-2.4-1.2-3.4-.4 1-1 1.7-1.8 2 .8-3.3 1-6.4 0-9.5z"/></svg>',
  pinned: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>',
  game: '<svg viewBox="0 0 24 24"><path d="M7.5 8h9a4.5 4.5 0 0 1 4.4 5.4l-.7 3.3A2.6 2.6 0 0 1 15.8 18l-1.2-1.6h-5.2L8.2 18a2.6 2.6 0 0 1-4.4-1.3l-.7-3.3A4.5 4.5 0 0 1 7.5 8z"/><path d="M9 12.5h2M10 11.5v2M14.5 12.5h.01M16 13.8h.01"/></svg>',
  app: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M3.5 9h17"/></svg>',
  media: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M10.3 8.9l5 3.1-5 3.1z"/></svg>',
  work: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h7l5 5v12h-12z"/><path d="M13 3.5v5.5h5.5"/></svg>',
  tool: '<svg viewBox="0 0 24 24"><path d="M15.5 4.5a4.8 4.8 0 0 0-6 6L4.5 15.5 8 19l5-5a4.8 4.8 0 0 0 6-6l-2.6 2.6-2.8-2.8z"/></svg>',
  other: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/></svg>'
};

const SMART_VIEWS = [
  { id: 'all', name: '全部应用', icon: 'all' },
  { id: 'recent', name: '最近使用', icon: 'recent' },
  { id: 'frequent', name: '最常使用', icon: 'frequent' },
  { id: 'pinned', name: '置顶', icon: 'pinned' }
];

function renderNav() {
  const counts = {};
  for (const a of S.apps) counts[a.category] = (counts[a.category] || 0) + 1;

  const smartCounts = {
    all: S.apps.length,
    recent: S.apps.filter((a) => a.lastUsed).length,
    frequent: S.apps.filter((a) => a.launches > 0).length,
    pinned: S.apps.filter((a) => a.pinned).length
  };

  $('navSmart').innerHTML = SMART_VIEWS.map((v) => navItem(
    v.id, v.name, smartCounts[v.id], ICONS[v.icon],
    S.view === v.id
  )).join('');

  const cats = S.categories.map((c) => navItem(
    'cat:' + c.id, c.name, counts[c.id] || 0, ICONS[c.id] || ICONS.other,
    S.view === 'cat' && S.filterCat === c.id
  ));
  $('navCats').innerHTML = cats.length ? cats.join('') : '<div class="nav-empty">还没有分类</div>';

  document.querySelectorAll('.nav-item').forEach((el) => {
    el.addEventListener('click', () => {
      const v = el.dataset.id;
      if (v.startsWith('cat:')) {
        S.view = 'cat';
        S.filterCat = v.slice(4);
      } else {
        S.view = v;
        S.filterCat = null;
      }
      S.selection.clear();
      localStorage.setItem('gk.viewType', S.view);
      renderNav();
      renderList();
      updateBatchbar();
      content.scrollTop = 0;
    });
    el.addEventListener('contextmenu', (e) => {
      const v = el.dataset.id;
      if (!v.startsWith('cat:')) return;
      e.preventDefault();
      showCategoryMenu(e.clientX, e.clientY, v.slice(4));
    });
  });
}

function navItem(id, name, count, icon, active) {
  return `<div class="nav-item${active ? ' active' : ''}" data-id="${escapeHtml(id)}" title="${escapeHtml(name)}">
    ${icon}
    <span class="label">${escapeHtml(name)}</span>
    <span class="num">${count}</span>
  </div>`;
}

/* ==========================================================
   取数：过滤 + 搜索 + 排序
   ========================================================== */
function matches(app, terms) {
  if (!terms.length) return true;
  const hay = [
    app.name, app.target || '', app.comment || '',
    (app.tags || []).join(' '), catName(app.category), app.launchUri || ''
  ].join(' ').toLowerCase();
  return terms.every((t) => hay.includes(t));
}

function currentList() {
  const terms = S.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let list = S.apps.slice();

  if (S.view === 'cat' && S.filterCat) {
    list = list.filter((a) => a.category === S.filterCat);
  }
  if (terms.length) {
    list = list.filter((a) => matches(a, terms));
  } else {
    if (S.view === 'recent') list = list.filter((a) => a.lastUsed);
    if (S.view === 'frequent') list = list.filter((a) => a.launches > 0);
    if (S.view === 'pinned') list = list.filter((a) => a.pinned);
  }

  const mode = (S.view === 'recent') ? 'recent'
    : (S.view === 'frequent') ? 'frequent'
      : (terms.length ? 'custom' : S.sort);

  if (mode === 'name') {
    list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'));
  } else if (mode === 'recent') {
    list.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  } else if (mode === 'frequent') {
    list.sort((a, b) => (b.launches || 0) - (a.launches || 0));
  } else {
    // custom：保持数组顺序（S.apps 里置顶项已在最前）
    const idx = new Map(S.apps.map((a, i) => [a.id, i]));
    list.sort((a, b) => (idx.get(a.id) || 0) - (idx.get(b.id) || 0));
  }

  // 除「最近/最常」这类有明确语义的排序外，置顶项始终在前
  if (mode !== 'recent' && mode !== 'frequent') {
    list = list.filter((a) => a.pinned).concat(list.filter((a) => !a.pinned));
  }
  return list;
}

function viewTitle() {
  if (S.query.trim()) return '搜索结果';
  if (S.view === 'cat') return catName(S.filterCat);
  const v = SMART_VIEWS.find((x) => x.id === S.view);
  return v ? v.name : '全部应用';
}

/* ==========================================================
   渲染
   ========================================================== */
function render() {
  renderNav();
  renderList();
  updateBatchbar();
}

function renderList() {
  const list = currentList();
  $('title').textContent = viewTitle();
  $('count').textContent = list.length ? list.length + ' 个' : '';

  if (!list.length) {
    $('hero').hidden = true;
    listArea.innerHTML = '';
    $('empty').hidden = false;
    $('emptyText').textContent = S.query.trim()
      ? `没有找到「${S.query.trim()}」`
      : (S.view === 'recent' ? '还没有启动过任何应用'
        : S.view === 'frequent' ? '用一阵子之后，这里会列出你最常用的应用'
          : S.view === 'pinned' ? '还没有置顶的应用，右键卡片可以置顶'
            : (S.apps.length ? '这个分类还是空的' : '还没有添加任何应用'));
    $('btnEmptyAdd').textContent = S.apps.length ? '添加应用' : '扫描本机 / 手动添加';
    return;
  }
  $('empty').hidden = true;

  renderHero(list);

  const grouped = S.settings.group !== false && S.view === 'all' && !S.query.trim() && S.sort === 'custom';
  listArea.innerHTML = grouped
    ? groupedHtml(list)
    : `<div class="grid">${list.map((a, i) => cardHtml(a, i, true)).join('')}</div>`;

  // 已缓存 / 已加载完成的图标立刻显示，避免闪一下
  listArea.querySelectorAll('.ico img').forEach((img) => {
    if (img.complete && img.naturalWidth) img.classList.add('loaded');
  });
}

function groupedHtml(list) {
  const buckets = S.categories.map((c) => ({
    id: c.id,
    name: c.name,
    items: list.filter((a) => a.category === c.id)
  }));
  const known = new Set(S.categories.map((c) => c.id));
  const orphan = list.filter((a) => !known.has(a.category));
  if (orphan.length) buckets.push({ id: 'other', name: '其他', items: orphan });

  return buckets.filter((b) => b.items.length).map((b) => `
    <div class="group-block">
      <div class="group-head">
        <h3>${escapeHtml(b.name)}</h3>
        <span class="gnum">${b.items.length}</span>
        <span class="gline"></span>
        <span class="gaction" data-cat="${escapeHtml(b.id)}">只看这类</span>
      </div>
      <div class="grid">${b.items.map((a, i) => cardHtml(a, i, S.mode === 'list')).join('')}</div>
    </div>`).join('');
}

function cardHtml(app, i, showBadge) {
  const lc = letterColors(app.name);
  const sel = S.selection.has(app.id) ? ' selected' : '';
  const delay = Math.min(i, 22) * 9;
  // DOM 顺序即列表视图的视觉顺序：图标 → 名称 → 路径 → 置顶 → 分类
  return `<div class="card${sel}" data-id="${app.id}" draggable="true" style="animation-delay:${delay}ms" title="${escapeHtml(app.name)}">
    <div class="ico">
      <span class="letter" style="background:${lc.bg}">${escapeHtml(lc.letter)}</span>
      <img src="/icon/${app.id}" alt="" loading="lazy">
    </div>
    <div class="name">${highlight(app.name, S.query)}</div>
    <div class="sub">${escapeHtml(subText(app))}</div>
    ${app.pinned ? '<span class="pin"><svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg></span>' : ''}
    ${showBadge ? `<span class="badge">${escapeHtml(catName(app.category))}</span>` : ''}
  </div>`;
}

/* ---------- Hero ---------- */
function renderHero(list) {
  const hero = $('hero');
  if (S.query.trim() || (S.view !== 'all' && S.view !== 'recent')) {
    hero.hidden = true;
    return;
  }
  const recent = list.filter((a) => a.lastUsed).sort((a, b) => b.lastUsed - a.lastUsed)[0];
  const app = recent || list.find((a) => a.pinned) || list[0];
  if (!app) { hero.hidden = true; return; }

  const lc = letterColors(app.name);
  const bits = [catName(app.category)];
  if (app.launches) bits.push('启动 ' + app.launches + ' 次');
  if (app.lastUsed) bits.push(relTime(app.lastUsed));

  hero.hidden = false;
  hero.innerHTML = `
    <div class="hero-ico">
      <span class="letter" style="background:${lc.bg}">${escapeHtml(lc.letter)}</span>
      <img src="/icon/${app.id}" alt="">
    </div>
    <div class="hero-meta">
      <div class="hero-kicker">${recent ? '最近启动' : (app.pinned ? '置顶推荐' : '从这里开始')}</div>
      <h2 class="hero-name">${escapeHtml(app.name)}</h2>
      <div class="hero-sub">${escapeHtml(bits.join(' · '))}</div>
    </div>
    <div class="hero-actions">
      <button class="hero-launch" id="heroLaunch">
        <svg viewBox="0 0 24 24"><path d="M7 4.5l12 7.5-12 7.5z"/></svg>启动
      </button>
      <button class="icon-btn-round${app.pinned ? ' on' : ''}" id="heroPin" title="${app.pinned ? '取消置顶' : '置顶'}">
        <svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>
      </button>
      <button class="icon-btn-round" id="heroMore" title="更多操作">
        <svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/></svg>
      </button>
    </div>`;

  const img = hero.querySelector('img');
  if (img) {
    img.addEventListener('load', () => img.classList.add('loaded'));
    if (img.complete && img.naturalWidth) img.classList.add('loaded');
    img.addEventListener('error', () => img.remove());
  }
  $('heroLaunch').addEventListener('click', () => launchApp(app.id));
  $('heroPin').addEventListener('click', () => togglePin(app.id));
  $('heroMore').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showContextMenu(r.right - 190, r.bottom + 6, app);
  });
}

/* ==========================================================
   卡片事件
   ========================================================== */
document.addEventListener('load', (e) => {
  const t = e.target;
  if (t && t.tagName === 'IMG') t.classList.add('loaded');
}, true);

document.addEventListener('error', (e) => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && t.closest('.ico')) t.remove();
}, true);

function cardEl(id) { return listArea.querySelector(`.card[data-id="${id}"]`); }

/** 当前画面上卡片的实际顺序（分组时与数据顺序不同，交互必须按这个来） */
function visibleIds() {
  return Array.from(listArea.querySelectorAll('.card')).map((c) => c.dataset.id);
}

listArea.addEventListener('click', (e) => {
  const act = e.target.closest('.gaction');
  if (act) {
    S.view = 'cat';
    S.filterCat = act.dataset.cat;
    S.selection.clear();
    render();
    content.scrollTop = 0;
    return;
  }
  const card = e.target.closest('.card');
  if (!card) {
    S.selection.clear();
    syncSelection();
    updateBatchbar();
    return;
  }
  const id = card.dataset.id;
  if (e.ctrlKey || e.metaKey) {
    if (S.selection.has(id)) S.selection.delete(id); else S.selection.add(id);
    S.anchorId = id;
  } else if (e.shiftKey && S.anchorId) {
    const ids = visibleIds();
    const a = ids.indexOf(S.anchorId);
    const b = ids.indexOf(id);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      S.selection = new Set(ids.slice(lo, hi + 1));
    }
  } else {
    S.selection = new Set([id]);
    S.anchorId = id;
  }
  syncSelection();
  updateBatchbar();
});

listArea.addEventListener('dblclick', (e) => {
  const card = e.target.closest('.card');
  if (card) launchApp(card.dataset.id);
});

listArea.addEventListener('contextmenu', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  e.preventDefault();
  const app = S.apps.find((a) => a.id === card.dataset.id);
  if (!app) return;
  if (!S.selection.has(app.id)) {
    S.selection = new Set([app.id]);
    S.anchorId = app.id;
    syncSelection();
    updateBatchbar();
  }
  showContextMenu(e.clientX, e.clientY, app);
});

function syncSelection() {
  listArea.querySelectorAll('.card').forEach((c) => {
    c.classList.toggle('selected', S.selection.has(c.dataset.id));
  });
}

/* ---------- 拖拽排序：支持跨分类、多选同拖、拖到分组标题换分类 ---------- */
const DROP = { after: false };

function clearDropMarks() {
  listArea.querySelectorAll('.card').forEach((c) => c.classList.remove('drop-before', 'drop-after'));
  listArea.querySelectorAll('.group-head').forEach((h) => h.classList.remove('drop-head'));
}

listArea.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  // 智能视图的顺序由使用记录决定，拖了也存不住
  if (S.view === 'recent' || S.view === 'frequent') {
    e.preventDefault();
    toast('「最近 / 常用」视图按使用记录排序，不能手动调整', 'warn');
    return;
  }
  // 搜索结果只是过滤快照，顺序无法持久化
  if (S.query.trim()) {
    e.preventDefault();
    toast('请先清空搜索（Esc），再拖动调整顺序', 'warn');
    return;
  }
  // 排序不是「自定义」时拖了也白拖，自动切回来
  if (S.sort !== 'custom') {
    e.preventDefault();
    S.sort = 'custom';
    localStorage.setItem('gk.sort', 'custom');
    saveSettings({ sort: 'custom' });
    $('btnSort').classList.toggle('on', false);
    renderList();
    toast('已切换到「自定义」排序，重新拖动即可调整顺序', 'ok');
    return;
  }
  const id = card.dataset.id;
  // 拖的是多选中的一个 → 整批一起拖，保持相对顺序
  S.dragIds = S.selection.has(id) && S.selection.size > 1
    ? visibleIds().filter((x) => S.selection.has(x))
    : [id];
  S.dragId = id;
  S.dragIds.forEach((x) => { const c = cardEl(x); if (c) c.classList.add('dragging'); });
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
});

listArea.addEventListener('dragend', () => {
  S.dragId = null;
  S.dragIds = null;
  clearDropMarks();
  listArea.querySelectorAll('.card.dragging').forEach((c) => c.classList.remove('dragging'));
});

listArea.addEventListener('dragover', (e) => {
  if (!S.dragId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearDropMarks();
  const head = e.target.closest('.group-head');
  if (head) { head.classList.add('drop-head'); return; }
  const card = e.target.closest('.card');
  if (!card || S.dragIds.includes(card.dataset.id)) return;
  // 插入位置按光标在卡片的前/后半边判断（列表看纵向，网格看横向）
  const rect = card.getBoundingClientRect();
  DROP.after = S.mode === 'list'
    ? e.clientY > rect.top + rect.height / 2
    : e.clientX > rect.left + rect.width / 2;
  card.classList.add(DROP.after ? 'drop-after' : 'drop-before');
});

listArea.addEventListener('drop', async (e) => {
  if (!S.dragId) return;
  e.preventDefault();
  const ids = (S.dragIds || [S.dragId]).slice();
  const moving = ids.map((x) => S.apps.find((a) => a.id === x)).filter(Boolean);
  const movingSet = new Set(ids);
  S.dragId = null;
  S.dragIds = null;

  // 拖到分组标题 = 移入该分类（排在末尾）
  const head = e.target.closest('.group-head');
  if (head) {
    const g = head.querySelector('.gaction');
    const cat = g && g.dataset.cat;
    if (cat) {
      const changed = moving.filter((a) => a.category !== cat);
      changed.forEach((a) => { a.category = cat; });
      const kept = S.apps.filter((a) => !movingSet.has(a.id));
      let last = -1;
      kept.forEach((a, i) => { if (a.category === cat) last = i; });
      kept.splice(last + 1, 0, ...moving);
      S.apps = kept;
      segregatePinned();
      renderList();
      persistOrder();
      for (const a of changed) {
        try { await api('/api/apps/' + a.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: cat }) }); } catch (_) {}
      }
      if (changed.length) toast(`已把 ${changed.length} 个应用移到「${catName(cat)}」分类`, 'ok');
    }
    clearDropMarks();
    listArea.querySelectorAll('.card.dragging').forEach((c) => c.classList.remove('dragging'));
    return;
  }

  const card = e.target.closest('.card');
  clearDropMarks();
  listArea.querySelectorAll('.card.dragging').forEach((c) => c.classList.remove('dragging'));
  if (!card) return;
  const targetId = card.dataset.id;
  if (movingSet.has(targetId)) return;
  const target = S.apps.find((a) => a.id === targetId);
  if (!target) return;

  // 拖到别的分类的卡片上 = 换到那个分类
  const changed = moving.filter((a) => a.category !== target.category);
  changed.forEach((a) => { a.category = target.category; });

  const after = DROP.after;
  const kept = S.apps.filter((a) => !movingSet.has(a.id));
  const to = kept.findIndex((a) => a.id === targetId);
  if (to < 0) return;
  kept.splice(after ? to + 1 : to, 0, ...moving);
  S.apps = kept;
  segregatePinned();
  renderList();
  persistOrder();
  for (const a of changed) {
    try { await api('/api/apps/' + a.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: a.category }) }); } catch (_) {}
  }
  if (changed.length) toast(`已把 ${changed.length} 个应用移到「${catName(target.category)}」分类`, 'ok');
});

/** 置顶项保持在最前，与数据层 store.reorder 的规则一致，避免保存后跳位 */
function segregatePinned() {
  S.apps = S.apps.filter((a) => a.pinned).concat(S.apps.filter((a) => !a.pinned));
}

async function persistOrder() {
  try {
    await post('/api/reorder', { ids: S.apps.map((a) => a.id) });
  } catch (err) {
    toast('排序保存失败：' + err.message, 'err');
  }
}

/* ==========================================================
   启动
   ========================================================== */
async function launchApp(id, opts) {
  const app = S.apps.find((a) => a.id === id);
  if (!app) return;
  const card = cardEl(id);
  if (card) card.classList.add('launching');
  try {
    const r = await api('/api/launch', {
      method: 'POST',
      body: JSON.stringify(Object.assign({ id }, opts || {}))
    });
    if (r && r.ok) {
      const i = S.apps.findIndex((a) => a.id === id);
      if (i >= 0) {
        S.apps[i].lastUsed = Date.now();
        S.apps[i].launches = (S.apps[i].launches || 0) + 1;
      }
      if (r.via === 'admin') toast('已请求管理员权限启动');
    }
  } catch (err) {
    toast('启动失败：' + err.message, 'err');
  } finally {
    setTimeout(() => { if (card) card.classList.remove('launching'); }, 450);
  }
}

/* ==========================================================
   右键菜单
   ========================================================== */
let closeOverlayFns = [];

function registerOverlay(close) {
  closeOverlayFns.push(close);
}

function closeAllOverlays() {
  closeOverlayFns.forEach((f) => { try { f(); } catch (_) {} });
  closeOverlayFns = [];
}

function placeFixed(el, x, y, w, h) {
  const ww = w || el.offsetWidth || 190;
  const hh = h || el.offsetHeight || 200;
  el.style.left = Math.max(8, Math.min(x, innerWidth - ww - 8)) + 'px';
  el.style.top = Math.max(8, Math.min(y, innerHeight - hh - 8)) + 'px';
}

function showContextMenu(x, y, app) {
  const menu = $('ctxmenu');
  const multi = S.selection.size > 1 && S.selection.has(app.id);

  if (multi) {
    menu.innerHTML = `
      <div class="ctx-item" data-act="launchMany">
        <svg viewBox="0 0 24 24"><path d="M7 4.5l12 7.5-12 7.5z"/></svg>启动这 ${S.selection.size} 个
      </div>
      <div class="ctx-sep"></div>
      <div class="ctx-item" data-act="pin">
        <svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>全部置顶
      </div>
      <div class="ctx-sep"></div>
      <div class="ctx-item danger" data-act="removeMany">
        <svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V5h6v2M7.5 7l1 12h7l1-12"/></svg>移除这 ${S.selection.size} 个
      </div>`;
  } else {
    menu.innerHTML = `
      <div class="ctx-item" data-act="launch">
        <svg viewBox="0 0 24 24"><path d="M7 4.5l12 7.5-12 7.5z"/></svg>启动<span class="sc">Enter</span>
      </div>
      <div class="ctx-item" data-act="admin">
        <svg viewBox="0 0 24 24"><path d="M12 3.5l7 3v6c0 4.2-3 7.2-7 8.2-4-1-7-4-7-8.2v-6z"/></svg>以管理员身份运行
      </div>
      <div class="ctx-sep"></div>
      <div class="ctx-item" data-act="pin">
        <svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>${app.pinned ? '取消置顶' : '置顶'}
      </div>
      <div class="ctx-item" data-act="edit">
        <svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14 6l4 4"/></svg>编辑<span class="sc">Ctrl+E</span>
      </div>
      <div class="ctx-sep"></div>
      <div class="ctx-item" data-act="reveal">
        <svg viewBox="0 0 24 24"><path d="M4 7.5h6l2 2.5h8v9H4z"/></svg>打开所在位置
      </div>
      <div class="ctx-item" data-act="copy">
        <svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15"/></svg>复制路径
      </div>
      <div class="ctx-item" data-act="props">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 8h.01"/></svg>查看属性
      </div>
      <div class="ctx-sep"></div>
      <div class="ctx-item danger" data-act="delete">
        <svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V5h6v2M7.5 7l1 12h7l1-12"/></svg>从列表移除<span class="sc">Del</span>
      </div>`;
  }

  menu.hidden = false;
  placeFixed(menu, x, y);

  const close = () => { menu.hidden = true; cleanup(); };
  const outside = (ev) => { if (!menu.contains(ev.target)) close(); };
  const onEsc = (ev) => { if (ev.key === 'Escape') close(); };
  const cleanup = () => {
    document.removeEventListener('mousedown', outside);
    document.removeEventListener('keydown', onEsc);
    closeOverlayFns = closeOverlayFns.filter((f) => f !== close);
  };
  setTimeout(() => {
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', onEsc);
  }, 0);
  registerOverlay(close);

  menu.querySelectorAll('.ctx-item').forEach((item) => {
    item.addEventListener('click', async () => {
      const act = item.dataset.act;
      close();
      const ids = Array.from(S.selection);

      if (act === 'launch') launchApp(app.id);
      else if (act === 'launchMany') ids.forEach((id, k) => setTimeout(() => launchApp(id), k * 450));

      else if (act === 'admin') {
        try { await api('/api/launch', { method: 'POST', body: JSON.stringify({ id: app.id, admin: true }) }); }
        catch (err) { toast(err.message, 'err'); }
      } else if (act === 'pin') {
        if (multi) {
          const target = S.apps.find((a) => a.id === app.id);
          await batchDo('pin', { pinned: !(target && target.pinned) });
        } else {
          await togglePin(app.id);
        }
      } else if (act === 'edit') openEditor(app);
      else if (act === 'reveal') revealApp(app);
      else if (act === 'copy') copyPath(app);
      else if (act === 'props') {
        try { await post('/api/properties', { id: app.id }); }
        catch (err) { toast(err.message, 'err'); }
      } else if (act === 'delete') removeApp(app);
      else if (act === 'removeMany') await batchDo('remove', {});
      else if (act === 'editCat') { /* noop */ }
    });
  });
}

function showBlankMenu(x, y) {
  const menu = $('ctxmenu');
  menu.innerHTML = `
    <div class="ctx-item" data-act="add">
      <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>添加应用
    </div>
    <div class="ctx-item" data-act="scan">
      <svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>扫描本机软件
    </div>
    <div class="ctx-item" data-act="newcat">
      <svg viewBox="0 0 24 24"><path d="M4 7.5h6l2 2.5h8v9H4z"/><path d="M15 12v4M13 14h4"/></svg>新建分类
    </div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" data-act="view">
      <svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><rect x="13" y="13" width="7" height="7" rx="1.8"/></svg>切换网格 / 列表
    </div>
    <div class="ctx-item" data-act="sort">
      <svg viewBox="0 0 24 24"><path d="M7 5v14M7 19l-3-3M7 19l3-3"/><path d="M14 7h6M14 12h4.5M14 17h3"/></svg>排序方式
    </div>
    <div class="ctx-item" data-act="group">
      <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>${S.settings.group !== false ? '取消分组' : '按分类分组'}
    </div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" data-act="settings">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.11a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.11A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.11a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.11a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.11a1.7 1.7 0 0 0-1.49 1z"/></svg>设置
    </div>`;
  menu.hidden = false;
  placeFixed(menu, x, y);

  const close = () => { menu.hidden = true; cleanup(); };
  const outside = (ev) => { if (!menu.contains(ev.target)) close(); };
  const cleanup = () => {
    document.removeEventListener('mousedown', outside);
    closeOverlayFns = closeOverlayFns.filter((f) => f !== close);
  };
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
  registerOverlay(close);

  menu.querySelectorAll('.ctx-item').forEach((item) => {
    item.addEventListener('click', () => {
      const act = item.dataset.act;
      close();
      if (act === 'add') openEditor(null);
      if (act === 'scan') runScan(false);
      if (act === 'newcat') $('btnNewCat').click();
      if (act === 'view') $('btnView').click();
      if (act === 'sort') $('btnSort').click();
      if (act === 'group') {
        S.settings.group = S.settings.group === false;
        renderList();
        saveSettings({ group: S.settings.group });
      }
      if (act === 'settings') openDrawer();
    });
  });
}

content.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.card')) return;
  if (e.target.closest('.group-head')) return;
  e.preventDefault();
  showBlankMenu(e.clientX, e.clientY);
});

function showCategoryMenu(x, y, catId) {
  const menu = $('ctxmenu');
  menu.innerHTML = `
    <div class="ctx-item" data-act="rename">
      <svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14 6l4 4"/></svg>重命名分类
    </div>
    <div class="ctx-item danger" data-act="del">
      <svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V5h6v2M7.5 7l1 12h7l1-12"/></svg>删除分类
    </div>`;
  menu.hidden = false;
  placeFixed(menu, x, y);

  const close = () => { menu.hidden = true; cleanup(); };
  const outside = (ev) => { if (!menu.contains(ev.target)) close(); };
  const cleanup = () => {
    document.removeEventListener('mousedown', outside);
    closeOverlayFns = closeOverlayFns.filter((f) => f !== close);
  };
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
  registerOverlay(close);

  menu.querySelectorAll('.ctx-item').forEach((item) => {
    item.addEventListener('click', async () => {
      close();
      if (item.dataset.act === 'rename') {
        const cur = S.categories.find((c) => c.id === catId);
        const name = prompt('新的分类名称', cur ? cur.name : '');
        if (!name || !name.trim()) return;
        try {
          await api('/api/categories/' + catId, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) });
          const c = S.categories.find((x) => x.id === catId);
          if (c) c.name = name.trim();
          render();
          toast('已重命名');
        } catch (err) { toast(err.message, 'err'); }
      }
      if (item.dataset.act === 'del') {
        const n = S.apps.filter((a) => a.category === catId).length;
        if (!confirm(`删除这个分类？\n其中 ${n} 个应用会被移到「其他」，不会被删除。`)) return;
        try {
          await api('/api/categories/' + catId, { method: 'DELETE' });
          S.categories = S.categories.filter((c) => c.id !== catId);
          S.apps.forEach((a) => { if (a.category === catId) a.category = 'other'; });
          if (S.view === 'cat' && S.filterCat === catId) { S.view = 'all'; S.filterCat = null; }
          render();
          toast('分类已删除');
        } catch (err) { toast(err.message, 'err'); }
      }
    });
  });
}

async function togglePin(id) {
  try {
    const r = await post('/api/apps/' + id + '/pin', {});
    const i = S.apps.findIndex((a) => a.id === id);
    if (i >= 0) {
      const wasPinned = S.apps[i].pinned;
      S.apps[i].pinned = r.app.pinned;
      if (r.app.pinned && !wasPinned) {
        const [app] = S.apps.splice(i, 1);
        S.apps.unshift(app);
      }
    }
    render();
    toast(r.app.pinned ? '已置顶' : '已取消置顶');
  } catch (err) { toast(err.message, 'err'); }
}

async function revealApp(app) {
  try { await post('/api/reveal', { id: app.id }); }
  catch (err) { toast(err.message, 'err'); }
}

async function copyPath(app) {
  const text = app.target || app.launchUri || '';
  if (!text) { toast('这个应用没有路径', 'err'); return; }
  try {
    await navigator.clipboard.writeText(text);
    toast('路径已复制');
  } catch (_) {
    try { await post('/api/copy', { text }); toast('路径已复制'); }
    catch (err) { toast('复制失败：' + err.message, 'err'); }
  }
}

async function removeApp(app) {
  if (!confirm(`把「${app.name}」从列表里移除？\n（只是从管家移除，不会卸载程序）`)) return;
  try {
    await api('/api/apps/' + app.id, { method: 'DELETE' });
    S.apps = S.apps.filter((a) => a.id !== app.id);
    S.selection.delete(app.id);
    render();
    toast('已移除');
  } catch (err) {
    toast('移除失败：' + err.message, 'err');
  }
}

/* ==========================================================
   批量操作
   ========================================================== */
function updateBatchbar() {
  const bar = $('batchbar');
  const n = S.selection.size;
  if (n < 2) { bar.hidden = true; return; }
  bar.hidden = false;
  $('batchCount').textContent = '已选 ' + n + ' 项';
}

async function batchDo(action, payload) {
  const ids = Array.from(S.selection);
  if (!ids.length) return;
  try {
    await post('/api/apps/batch', Object.assign({ ids, action }, payload || {}));
    if (action === 'remove') {
      S.apps = S.apps.filter((a) => !S.selection.has(a.id));
      S.selection.clear();
      toast('已移除 ' + ids.length + ' 个');
    } else if (action === 'category') {
      S.apps.forEach((a) => { if (S.selection.has(a.id)) a.category = payload.category; });
      toast('已移动 ' + ids.length + ' 个到「' + catName(payload.category) + '」');
    } else if (action === 'pin') {
      const pin = payload.pinned !== false;
      S.apps.forEach((a) => { if (S.selection.has(a.id)) a.pinned = pin; });
      S.apps = S.apps.filter((a) => a.pinned).concat(S.apps.filter((a) => !a.pinned));
      toast(pin ? '已置顶 ' + ids.length + ' 个' : '已取消置顶');
    }
    render();
  } catch (err) { toast(err.message, 'err'); }
}

$('batchClear').addEventListener('click', () => {
  S.selection.clear();
  syncSelection();
  updateBatchbar();
});

$('batchPin').addEventListener('click', () => {
  const allPinned = Array.from(S.selection).every((id) => {
    const a = S.apps.find((x) => x.id === id);
    return a && a.pinned;
  });
  batchDo('pin', { pinned: !allPinned });
});

$('batchRemove').addEventListener('click', () => {
  if (!confirm(`移除选中的 ${S.selection.size} 个应用？\n（只是从管家移除，不会卸载程序）`)) return;
  batchDo('remove', {});
});

$('batchMove').addEventListener('click', (e) => {
  const menu = $('batchCatMenu');
  if (!menu.hidden) { menu.hidden = true; return; }
  menu.innerHTML = S.categories.map((c) =>
    `<div class="ctx-item" data-cat="${escapeHtml(c.id)}">${escapeHtml(c.name)}</div>`
  ).join('');
  menu.hidden = false;
  const r = e.currentTarget.getBoundingClientRect();
  menu.style.left = Math.min(r.left, innerWidth - 190) + 'px';
  menu.style.top = Math.max(8, r.top - menu.offsetHeight - 8) + 'px';
  menu.querySelectorAll('.ctx-item').forEach((it) => {
    it.addEventListener('click', () => {
      menu.hidden = true;
      batchDo('category', { category: it.dataset.cat });
    });
  });
  const close = () => { menu.hidden = true; document.removeEventListener('mousedown', outside); };
  const outside = (ev) => { if (!menu.contains(ev.target) && ev.target !== $('batchMove')) close(); };
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
  registerOverlay(close);
});

/* ==========================================================
   编辑器
   ========================================================== */
function fillCategorySelect(selected) {
  $('fCategory').innerHTML = S.categories.map((c) =>
    `<option value="${escapeHtml(c.id)}"${c.id === selected ? ' selected' : ''}>${escapeHtml(c.name)}</option>`
  ).join('');
}

function openEditor(app) {
  S.editing = app || null;
  $('modalTitle').textContent = app ? '编辑应用' : '添加应用';
  $('modalDelete').hidden = !app;
  $('fName').value = app ? app.name : '';
  $('fTarget').value = app ? app.target : '';
  $('fArgs').value = app ? (app.args || '') : '';
  $('fTags').value = app ? (app.tags || []).join(', ') : '';
  $('fComment').value = app ? (app.comment || '') : '';
  $('fPinned').checked = app ? !!app.pinned : false;
  fillCategorySelect(app ? app.category : (S.view === 'cat' ? S.filterCat : 'app'));
  $('editorHint').textContent = app ? '' : '提示：也可以直接把 .exe 文件拖进窗口';

  const img = $('editorIconImg');
  const letter = $('editorIconLetter');
  if (app) {
    img.src = '/icon/' + app.id + '?t=' + Date.now();
    img.hidden = false;
    letter.hidden = true;
  } else {
    img.hidden = true;
    img.removeAttribute('src');
    letter.hidden = false;
    letter.textContent = 'A';
  }
  $('modalMask').hidden = false;
  setTimeout(() => $('fName').focus(), 60);
}

$('editorIconImg').addEventListener('error', function () {
  this.hidden = true;
  $('editorIconLetter').hidden = false;
});

function closeEditor() {
  $('modalMask').hidden = true;
  S.editing = null;
}

$('btnPickExe').addEventListener('click', async () => {
  try {
    const r = await post('/api/pick', { kind: 'program' });
    if (!r.path) return;
    $('fTarget').value = r.path;
    if (!$('fName').value.trim()) {
      const base = r.path.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
      $('fName').value = base;
      $('editorIconLetter').textContent = letterColors(base).letter;
    }
  } catch (err) { toast(err.message, 'err'); }
});

$('btnPickIcon').addEventListener('click', async () => {
  try {
    const r = await post('/api/pick', { kind: 'program' });
    if (!r.path) return;
    if (!S.editing) { toast('先保存应用，再单独换图标'); return; }
    await post('/api/apps/' + S.editing.id + '/icon', { path: r.path });
    const img = $('editorIconImg');
    img.src = '/icon/' + S.editing.id + '?t=' + Date.now();
    img.hidden = false;
    $('editorIconLetter').hidden = true;
    toast('图标已更新');
  } catch (err) { toast(err.message, 'err'); }
});

$('modalSave').addEventListener('click', async () => {
  const name = $('fName').value.trim();
  const target = $('fTarget').value.trim();
  const category = $('fCategory').value;
  const args = $('fArgs').value;
  const comment = $('fComment').value;
  const pinned = $('fPinned').checked;
  const tags = $('fTags').value.split(/[,，]/).map((t) => t.trim()).filter(Boolean);

  if (!target) { $('editorHint').textContent = '请先选择或填写程序路径'; return; }
  if (!name) { $('editorHint').textContent = '给这个应用起个名字'; return; }

  try {
    if (S.editing) {
      const r = await api('/api/apps/' + S.editing.id, {
        method: 'PATCH',
        body: JSON.stringify({ name, target, category, args, comment, tags, pinned })
      });
      const i = S.apps.findIndex((a) => a.id === S.editing.id);
      if (i >= 0) S.apps[i] = Object.assign(S.apps[i], r.app);
      toast('已保存');
    } else {
      const r = await post('/api/apps', { target, name, category, args, comment, tags, pinned });
      S.apps.push(r.app);
      toast('已添加');
    }
    closeEditor();
    render();
  } catch (err) {
    $('editorHint').textContent = err.message;
  }
});

$('modalDelete').addEventListener('click', () => {
  if (S.editing) { const app = S.editing; closeEditor(); removeApp(app); }
});
$('modalCancel').addEventListener('click', closeEditor);
$('modalClose').addEventListener('click', closeEditor);
$('modalMask').addEventListener('mousedown', (e) => { if (e.target === $('modalMask')) closeEditor(); });

/* ==========================================================
   设置
   ========================================================== */
const ACCENTS = ['#66c0f4', '#6fa8ff', '#a78bfa', '#3ddc97', '#ffb454', '#ff7a8a'];

const THEMES = [
  { id: 'steam', name: '深灰蓝', bg: '#0a0d12', side: '#131922', card: '#1e2733', accent: '#66c0f4' },
  { id: 'midnight', name: '午夜紫', bg: '#09080f', side: '#161222', card: '#241d38', accent: '#a78bfa' },
  { id: 'light', name: '浅色', bg: '#eef1f6', side: '#f8fafd', card: '#ffffff', accent: '#2b7fd4' }
];

function hexA(hex, a) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return `rgba(102,192,244,${a})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}

function applySettings() {
  const s = S.settings;
  const root = document.documentElement;
  root.dataset.theme = s.theme || 'steam';
  root.dataset.density = s.density === 'compact' ? 'compact' : 'cozy';
  root.style.setProperty('--icon-size', (s.iconSize || 56) + 'px');
  root.style.setProperty('--dim', String(s.wallpaperDim == null ? .55 : s.wallpaperDim));
  root.style.setProperty('--accent', s.accent || '#66c0f4');
  root.style.setProperty('--accent-soft', hexA(s.accent || '#66c0f4', .15));
  document.body.classList.toggle('glass-on', !!s.glass);

  if (s.wallpaper) {
    document.body.classList.add('has-wallpaper');
    root.style.setProperty('--wallpaper', `url("/wallpaper?v=${S._wpstamp}")`);
  } else {
    document.body.classList.remove('has-wallpaper');
    root.style.removeProperty('--wallpaper');
  }
  $('app').dataset.view = S.mode;
}

const saveSettings = debounce(async (patch) => {
  try { await post('/api/settings', patch); } catch (_) { toast('设置保存失败', 'err'); }
}, 220);

function themeCardsHtml() {
  return THEMES.map((t) => `
    <div class="theme-card${(S.settings.theme || 'steam') === t.id ? ' on' : ''}" data-theme="${t.id}">
      <div class="theme-preview" style="background:${t.bg}">
        <div class="tp-side" style="background:${t.side}"></div>
        <div class="tp-main" style="background:${t.side}">
          <span class="tp-dot" style="background:${t.card}"></span>
          <span class="tp-dot" style="background:${t.card}"></span>
          <span class="tp-dot" style="background:${t.accent}"></span>
        </div>
      </div>
      <div class="tname">${t.name}</div>
    </div>`).join('');
}

function openDrawer() {
  const s = S.settings;
  $('themes').innerHTML = themeCardsHtml();
  $('rngDim').value = Math.round((s.wallpaperDim == null ? .55 : s.wallpaperDim) * 100);
  $('valDim').textContent = Math.round((s.wallpaperDim == null ? .55 : s.wallpaperDim) * 100) + '%';
  $('rngIcon').value = s.iconSize || 56;
  $('valIcon').textContent = s.iconSize || 56;
  $('chkGlass').checked = !!s.glass;
  $('chkCompact').checked = s.density === 'compact';
  $('chkGroup').checked = s.group !== false;
  $('swatches').innerHTML = ACCENTS.map((c) =>
    `<span class="swatch${(s.accent || '#66c0f4') === c ? ' on' : ''}" data-c="${c}" style="background:${c}"></span>`
  ).join('');
  api('/api/env').then((e) => { $('dataPath').textContent = e.dataFile; }).catch(() => {});
  $('drawerMask').hidden = false;
}

function closeDrawer() { $('drawerMask').hidden = true; }

$('btnSettings').addEventListener('click', openDrawer);
$('drawerClose').addEventListener('click', closeDrawer);
$('drawerMask').addEventListener('mousedown', (e) => { if (e.target === $('drawerMask')) closeDrawer(); });

$('themes').addEventListener('click', (e) => {
  const card = e.target.closest('.theme-card');
  if (!card) return;
  S.settings.theme = card.dataset.theme;
  const t = THEMES.find((x) => x.id === card.dataset.theme);
  if (t) { S.settings.accent = t.accent; }
  applySettings();
  $('themes').innerHTML = themeCardsHtml();
  $('swatches').innerHTML = ACCENTS.map((c) =>
    `<span class="swatch${(S.settings.accent) === c ? ' on' : ''}" data-c="${c}" style="background:${c}"></span>`
  ).join('');
  saveSettings({ theme: S.settings.theme, accent: S.settings.accent });
});

$('rngDim').addEventListener('input', (e) => {
  const v = parseInt(e.target.value, 10);
  $('valDim').textContent = v + '%';
  S.settings.wallpaperDim = v / 100;
  applySettings();
  saveSettings({ wallpaperDim: v / 100 });
});

$('rngIcon').addEventListener('input', (e) => {
  const v = parseInt(e.target.value, 10);
  $('valIcon').textContent = v;
  S.settings.iconSize = v;
  applySettings();
  saveSettings({ iconSize: v });
});

$('chkGlass').addEventListener('change', (e) => {
  S.settings.glass = e.target.checked;
  applySettings();
  saveSettings({ glass: e.target.checked });
});

$('chkCompact').addEventListener('change', (e) => {
  S.settings.density = e.target.checked ? 'compact' : 'cozy';
  applySettings();
  saveSettings({ density: S.settings.density });
});

$('chkGroup').addEventListener('change', (e) => {
  S.settings.group = e.target.checked;
  renderList();
  saveSettings({ group: e.target.checked });
});

$('swatches').addEventListener('click', (e) => {
  const sw = e.target.closest('.swatch');
  if (!sw) return;
  S.settings.accent = sw.dataset.c;
  applySettings();
  saveSettings({ accent: sw.dataset.c });
  $('swatches').querySelectorAll('.swatch').forEach((x) => x.classList.toggle('on', x === sw));
});

$('btnWallpaper').addEventListener('click', async () => {
  try {
    const r = await post('/api/pick', { kind: 'image' });
    if (!r.path) return;
    S.settings.wallpaper = r.path;
    S._wpstamp = Date.now();
    applySettings();
    saveSettings({ wallpaper: r.path });
    toast('壁纸已更换');
  } catch (err) { toast(err.message, 'err'); }
});

$('btnWallpaperClear').addEventListener('click', () => {
  S.settings.wallpaper = '';
  applySettings();
  saveSettings({ wallpaper: '' });
});

$('btnOpenData').addEventListener('click', async () => {
  try { await post('/api/reveal', { id: '__root__' }); } catch (_) {}
});

$('btnExport').addEventListener('click', async () => {
  try {
    const r = await post('/api/export', {});
    toast('已导出到 ' + r.file.split(/[\\/]/).pop());
  } catch (err) { toast('导出失败：' + err.message, 'err'); }
});

$('btnImport').addEventListener('click', () => $('fileImport').click());

$('fileImport').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const mode = confirm('合并到现有列表？\n\n确定 = 合并（只补充新的）\n取消 = 覆盖（清空后导入）') ? 'merge' : 'replace';
    const r = await post('/api/import', { data, mode });
    await load();
    toast(`导入完成，新增 ${r.added} 个，跳过 ${r.skipped} 个`);
  } catch (err) {
    toast('导入失败：' + err.message, 'err');
  }
});

$('btnRebuild').addEventListener('click', async () => {
  try {
    const r = await post('/api/icons/rebuild', {});
    toast(`已清理 ${r.removed} 个图标，正在重建…`);
    setTimeout(() => renderList(), 2600);
  } catch (err) { toast(err.message, 'err'); }
});

$('btnRescan').addEventListener('click', () => runScan(true));
$('btnScan').addEventListener('click', () => runScan(false));

async function runScan(fromDrawer) {
  const btn = $('btnScan');
  btn.classList.add('busy');
  if (fromDrawer) $('btnRescan').textContent = '扫描中…';
  try {
    const r = await post('/api/scan', {});
    if (r.added > 0) {
      toast(`扫描完成，新增 ${r.added} 个应用`);
      await load();
    } else {
      toast(`扫描完成，没有发现新的应用（共找到 ${r.total} 个）`);
    }
    if (r.errors && r.errors.length) toast('部分来源扫描失败', 'err');
  } catch (err) {
    toast('扫描失败：' + err.message, 'err');
  } finally {
    btn.classList.remove('busy');
    if (fromDrawer) $('btnRescan').textContent = '立即扫描';
  }
}

/* ==========================================================
   顶栏 / 排序
   ========================================================== */
$('btnAdd').addEventListener('click', () => openEditor(null));
$('btnEmptyAdd').addEventListener('click', () => {
  if (!S.apps.length) runScan(false); else openEditor(null);
});

$('btnView').addEventListener('click', () => {
  S.mode = S.mode === 'grid' ? 'list' : 'grid';
  localStorage.setItem('gk.mode', S.mode);
  applySettings();
});

const SORTS = [
  { id: 'custom', name: '自定义顺序' },
  { id: 'name', name: '名称 A → Z' },
  { id: 'recent', name: '最近使用' },
  { id: 'frequent', name: '最常使用' }
];

$('btnSort').addEventListener('click', (e) => {
  const menu = $('sortMenu');
  if (!menu.hidden) { menu.hidden = true; return; }
  menu.innerHTML = SORTS.map((s) =>
    `<div class="ctx-item${S.sort === s.id ? ' on' : ''}" data-sort="${s.id}">${s.name}</div>`
  ).join('');
  menu.hidden = false;
  const r = e.currentTarget.getBoundingClientRect();
  menu.style.left = Math.min(r.left, innerWidth - 180) + 'px';
  menu.style.top = (r.bottom + 6) + 'px';
  $('btnSort').classList.toggle('on', S.sort !== 'custom');

  const close = () => { menu.hidden = true; document.removeEventListener('mousedown', outside); };
  const outside = (ev) => { if (!menu.contains(ev.target) && !e.currentTarget.contains(ev.target)) close(); };
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
  registerOverlay(close);

  menu.querySelectorAll('.ctx-item').forEach((it) => {
    it.addEventListener('click', () => {
      S.sort = it.dataset.sort;
      localStorage.setItem('gk.sort', S.sort);
      saveSettings({ sort: S.sort });
      $('btnSort').classList.toggle('on', S.sort !== 'custom');
      close();
      renderList();
    });
  });
});

$('btnNewCat').addEventListener('click', async () => {
  const name = prompt('新分类名称，比如「开发工具」「设计」');
  if (!name || !name.trim()) return;
  try {
    const r = await post('/api/categories', { name: name.trim() });
    S.categories.push(r.category);
    renderNav();
    toast('分类已创建');
  } catch (err) { toast(err.message, 'err'); }
});

$('search').addEventListener('input', debounce((e) => {
  S.query = e.target.value;
  S.selection.clear();
  renderList();
  updateBatchbar();
}, 80));

$('search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.target.value = ''; S.query = ''; renderList(); e.target.blur(); }
  if (e.key === 'Enter') {
    const first = currentList()[0];
    if (first) launchApp(first.id);
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const first = currentList()[0];
    if (first) {
      S.selection = new Set([first.id]);
      S.anchorId = first.id;
      syncSelection();
      updateBatchbar();
      e.target.blur();
    }
  }
});

/* ==========================================================
   快捷键面板
   ========================================================== */
const KEYS = [
  ['打开搜索', ['Ctrl', 'F']],
  ['快速聚焦搜索', ['/']],
  ['启动选中项', ['Enter']],
  ['上下左右移动选择', ['↑', '↓', '←', '→']],
  ['多选（切换）', ['Ctrl', '点击']],
  ['连续多选', ['Shift', '点击']],
  ['全选', ['Ctrl', 'A']],
  ['编辑选中项', ['Ctrl', 'E']],
  ['移除选中项', ['Del']],
  ['切换网格 / 列表', ['Ctrl', 'G']],
  ['打开设置', ['Ctrl', ',']],
  ['快捷键说明', ['?']],
  ['关闭弹窗 / 清空选择', ['Esc']]
];

function openKeys() {
  $('keysBody').innerHTML = KEYS.map(([label, keys]) =>
    `<div class="key-row"><span>${escapeHtml(label)}</span><span class="kx">${keys.map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join('')}</span></div>`
  ).join('');
  $('keysMask').hidden = false;
}
function closeKeys() { $('keysMask').hidden = true; }

$('btnShortcuts').addEventListener('click', openKeys);
$('keysClose').addEventListener('click', closeKeys);
$('keysMask').addEventListener('mousedown', (e) => { if (e.target === $('keysMask')) closeKeys(); });

/* ==========================================================
   全局键盘
   ========================================================== */
const inField = () => /input|select|textarea/i.test(document.activeElement.tagName);

function moveSelection(delta) {
  const ids = visibleIds();
  if (!ids.length) return;
  let i = ids.indexOf(Array.from(S.selection).pop());
  if (i < 0) i = delta > 0 ? -1 : 0;
  i = Math.max(0, Math.min(ids.length - 1, i + delta));
  S.selection = new Set([ids[i]]);
  S.anchorId = ids[i];
  syncSelection();
  updateBatchbar();
  const card = cardEl(ids[i]);
  if (card) card.scrollIntoView({ block: 'nearest' });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('keysMask').hidden) return closeKeys();
    if (!$('modalMask').hidden) return closeEditor();
    if (!$('drawerMask').hidden) return closeDrawer();
    if (!$('ctxmenu').hidden || !$('sortMenu').hidden || !$('batchCatMenu').hidden) {
      closeAllOverlays();
      return;
    }
    S.selection.clear();
    syncSelection();
    updateBatchbar();
    return;
  }

  if (inField()) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    $('search').focus();
    $('search').select();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
    e.preventDefault();
    $('btnView').click();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === ',') {
    e.preventDefault();
    openDrawer();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    S.selection = new Set(currentList().map((a) => a.id));
    syncSelection();
    updateBatchbar();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
    const id = Array.from(S.selection)[0];
    const app = S.apps.find((a) => a.id === id);
    if (app) { e.preventDefault(); openEditor(app); }
    return;
  }
  if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
    e.preventDefault();
    openKeys();
    return;
  }
  if (e.key === '/' && !inField()) {
    e.preventDefault();
    $('search').focus();
    return;
  }

  if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); moveSelection(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); moveSelection(-1); }
  else if (e.key === 'Enter') {
    const id = Array.from(S.selection)[0];
    if (id) { e.preventDefault(); launchApp(id); }
  } else if (e.key === 'Delete') {
    const ids = Array.from(S.selection);
    if (!ids.length) return;
    e.preventDefault();
    if (ids.length > 1) {
      if (confirm(`移除选中的 ${ids.length} 个应用？`)) batchDo('remove', {});
    } else {
      const app = S.apps.find((a) => a.id === ids[0]);
      if (app) removeApp(app);
    }
  }
});

/* ==========================================================
   拖入 exe 添加
   ========================================================== */
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', async (e) => {
  if (e.target.closest('.card')) return;
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files || []);
  const exe = files.find((f) => /\.(exe|lnk|bat|cmd)$/i.test(f.name));
  if (!exe) return;
  const p = exe.path;
  if (!p) { toast('浏览器没有暴露文件路径，请用「添加」按钮选择', 'err'); return; }
  openEditor(null);
  $('fTarget').value = p;
  $('fName').value = exe.name.replace(/\.[^.]+$/, '');
});

/* ==========================================================
   心跳
   ========================================================== */
setInterval(() => { fetch('/api/ping').catch(() => {}); }, 4000);

/* ==========================================================
   启动
   ========================================================== */
load().then(() => {
  $('btnSort').classList.toggle('on', S.sort !== 'custom');
}).catch((err) => {
  document.body.innerHTML = '<div style="padding:40px;color:#f88;font-family:sans-serif">加载失败：' + escapeHtml(err.message) + '</div>';
});
