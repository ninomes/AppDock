'use strict';
/**
 * 数据存储层：把用户的书签数据保存在 %APPDATA%\AppDock 下，
 * 程序目录保持干净，重装/换版本不会丢配置。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(process.env.APPDATA || process.env.USERPROFILE || __dirname, 'AppDock');
const LEGACY_ROOT = path.join(process.env.APPDATA || process.env.USERPROFILE || __dirname, 'GameKeeper');
const DATA_FILE = path.join(ROOT, 'data.json');
const ICON_DIR = path.join(ROOT, 'icons');
const WALL_DIR = path.join(ROOT, 'wallpapers');

const DEFAULT_CATEGORIES = [
  { id: 'game', name: '游戏', icon: 'gamepad' },
  { id: 'app', name: '软件', icon: 'grid' },
  { id: 'media', name: '影音', icon: 'play' },
  { id: 'work', name: '办公', icon: 'doc' },
  { id: 'tool', name: '工具', icon: 'wrench' },
  { id: 'other', name: '其他', icon: 'dots' }
];

const DEFAULT_SETTINGS = {
  wallpaper: '',
  wallpaperDim: 0.55,
  glass: true,
  iconSize: 56,
  sort: 'custom',      // custom | name | recent | frequent
  group: true,         // 全部视图下按分类分组
  theme: 'steam',      // steam | midnight | light
  density: 'cozy',     // cozy | compact
  accent: '#66c0f4',
  closeToTray: false
};

const APP_FIELDS = ['name', 'target', 'args', 'workdir', 'category', 'comment', 'tags'];

/** 旧版（GameKeeper）数据目录一键迁移：data.json + 图标 + 壁纸 */
function migrateLegacyData() {
  try {
    if (fs.existsSync(DATA_FILE)) return;
    const oldData = path.join(LEGACY_ROOT, 'data.json');
    if (!fs.existsSync(oldData)) return;
    fs.mkdirSync(ROOT, { recursive: true });
    fs.copyFileSync(oldData, DATA_FILE);
    for (const dir of ['icons', 'wallpapers']) {
      const src = path.join(LEGACY_ROOT, dir);
      const dst = path.join(ROOT, dir);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.cpSync(src, dst, { recursive: true });
      }
    }
  } catch (_) { /* 迁移失败不阻塞启动 */ }
}

function ensureDirs() {
  migrateLegacyData();
  for (const d of [ROOT, ICON_DIR, WALL_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

function emptyState() {
  return {
    version: 2,
    categories: DEFAULT_CATEGORIES.slice(),
    apps: [],
    settings: Object.assign({}, DEFAULT_SETTINGS),
    updatedAt: Date.now()
  };
}

let cache = null;

function normalizeApp(app) {
  if (!app.id) app.id = newId();
  if (!app.category) app.category = 'other';
  if (!Array.isArray(app.tags)) app.tags = [];
  app.pinned = !!app.pinned;
  app.launches = Number(app.launches) || 0;
  app.lastUsed = Number(app.lastUsed) || 0;
  if (!app.targetKey) app.targetKey = String(app.target || app.launchUri || '').toLowerCase();
  return app;
}

function load() {
  if (cache) return cache;
  ensureDirs();
  let data = null;
  try {
    if (fs.existsSync(DATA_FILE)) {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    // 数据损坏时留一份备份，避免用户数据被静默清空
    try {
      if (fs.existsSync(DATA_FILE)) {
        fs.copyFileSync(DATA_FILE, DATA_FILE + '.broken-' + Date.now());
      }
    } catch (_) { /* ignore */ }
  }
  if (!data || typeof data !== 'object') data = emptyState();
  data.categories = Array.isArray(data.categories) && data.categories.length ? data.categories : DEFAULT_CATEGORIES.slice();
  data.apps = Array.isArray(data.apps) ? data.apps : [];
  data.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
  for (const app of data.apps) normalizeApp(app);
  // 置顶项统一排到最前，保证数组顺序即展示顺序
  const pinned = data.apps.filter((a) => a.pinned);
  if (pinned.length) data.apps = pinned.concat(data.apps.filter((a) => !a.pinned));
  cache = data;
  return cache;
}

function save() {
  if (!cache) return;
  cache.updatedAt = Date.now();
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

function state() {
  return load();
}

function publicState() {
  const s = load();
  return {
    categories: s.categories,
    apps: s.apps,
    settings: s.settings
  };
}

function findApp(id) {
  return load().apps.find((a) => a.id === id) || null;
}

function addApp(input) {
  const s = load();
  const target = String(input.target || '').trim();
  if (!target) throw new Error('缺少程序路径');
  const app = normalizeApp({
    id: newId(),
    name: (input.name || path.basename(target).replace(/\.[^.]+$/, '')).trim(),
    target,
    args: input.args || '',
    workdir: input.workdir || '',
    category: input.category || 'other',
    comment: input.comment || '',
    tags: Array.isArray(input.tags) ? input.tags : [],
    icon: input.icon || '',
    iconSource: input.iconSource || target,
    source: input.source || 'manual',
    targetKey: target.toLowerCase(),
    pinned: !!input.pinned,
    launches: 0,
    lastUsed: 0,
    addedAt: Date.now()
  });
  if (app.pinned) s.apps.unshift(app); else s.apps.push(app);
  save();
  return app;
}

function updateApp(id, patch) {
  const app = findApp(id);
  if (!app) return null;
  for (const f of APP_FIELDS) {
    if (patch[f] !== undefined) app[f] = String(patch[f]);
  }
  if (patch.tags !== undefined && Array.isArray(patch.tags)) app.tags = patch.tags.map(String);
  if (patch.target !== undefined) app.targetKey = String(patch.target).toLowerCase();
  if (patch.pinned !== undefined) app.pinned = !!patch.pinned;
  save();
  return app;
}

function removeApp(id) {
  const s = load();
  const i = s.apps.findIndex((a) => a.id === id);
  if (i < 0) return false;
  s.apps.splice(i, 1);
  save();
  return true;
}

function togglePin(id) {
  const s = load();
  const i = s.apps.findIndex((a) => a.id === id);
  if (i < 0) return null;
  const app = s.apps[i];
  app.pinned = !app.pinned;
  if (app.pinned) {
    s.apps.splice(i, 1);
    s.apps.unshift(app);
  }
  save();
  return app;
}

function reorder(ids) {
  const s = load();
  const map = new Map(s.apps.map((a) => [a.id, a]));
  const ordered = [];
  for (const id of ids) {
    const app = map.get(id);
    if (app) { ordered.push(app); map.delete(id); }
  }
  for (const app of map.values()) ordered.push(app);
  // 置顶项始终保持在最前，保证拖拽结果与展示一致
  s.apps = ordered.filter((a) => a.pinned).concat(ordered.filter((a) => !a.pinned));
  save();
  return true;
}

function markUsed(id) {
  const app = findApp(id);
  if (!app) return;
  app.launches = (app.launches || 0) + 1;
  app.lastUsed = Date.now();
  save();
}

function updateSettings(patch) {
  const s = load();
  s.settings = Object.assign({}, s.settings, patch || {});
  save();
  return s.settings;
}

function addCategory(name) {
  const s = load();
  const id = 'c_' + newId().slice(0, 6);
  s.categories.push({ id, name: String(name).trim() || '新分类', icon: 'grid' });
  save();
  return s.categories[s.categories.length - 1];
}

function renameCategory(id, name) {
  const s = load();
  const c = s.categories.find((x) => x.id === id);
  if (!c) return null;
  c.name = String(name || '').trim() || c.name;
  save();
  return c;
}

function removeCategory(id, fallback) {
  const s = load();
  const i = s.categories.findIndex((x) => x.id === id);
  if (i < 0) return { ok: false, error: '分类不存在' };
  s.categories.splice(i, 1);
  const to = fallback || 'other';
  let moved = 0;
  for (const app of s.apps) {
    if (app.category === id) { app.category = to; moved++; }
  }
  save();
  return { ok: true, moved };
}

/** 批量：改分类 / 置顶 / 移除 */
function batch(ids, action, payload) {
  const s = load();
  const set = new Set(ids || []);
  let n = 0;
  if (action === 'remove') {
    const before = s.apps.length;
    s.apps = s.apps.filter((a) => !set.has(a.id));
    n = before - s.apps.length;
  } else if (action === 'category') {
    for (const a of s.apps) {
      if (set.has(a.id)) { a.category = payload.category || 'other'; n++; }
    }
  } else if (action === 'pin') {
    const pin = payload.pinned !== false;
    for (const a of s.apps) {
      if (set.has(a.id)) { a.pinned = pin; n++; }
    }
    if (pin) s.apps = s.apps.filter((a) => set.has(a.id)).concat(s.apps.filter((a) => !set.has(a.id)));
  }
  save();
  return { ok: true, count: n };
}

/**
 * 把同一个程序（按真实目标路径）的重复项合并掉，保留最早添加的那条的排序位置。
 */
function dedupe() {
  const s = load();
  const seen = new Set();
  const keep = [];
  for (const app of s.apps) {
    const key = (app.targetKey || app.target || '').toLowerCase();
    if (!key) { keep.push(app); continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    keep.push(app);
  }
  const removed = s.apps.length - keep.length;
  if (removed > 0) { s.apps = keep; save(); }
  return removed;
}

/** 导出为可读 JSON */
function exportData() {
  const s = load();
  return {
    app: 'AppDock',
    version: 2,
    exportedAt: new Date().toISOString(),
    categories: s.categories,
    settings: s.settings,
    apps: s.apps.map((a) => ({
      name: a.name,
      target: a.target,
      args: a.args || '',
      workdir: a.workdir || '',
      category: a.category,
      comment: a.comment || '',
      tags: a.tags || [],
      iconSource: a.iconSource || '',
      launchUri: a.launchUri || '',
      source: a.source || 'manual',
      pinned: !!a.pinned,
      launches: a.launches || 0,
      lastUsed: a.lastUsed || 0
    }))
  };
}

/**
 * 导入：mode = merge（默认，按路径去重补充）| replace（覆盖整个列表）
 */
function importData(payload, mode) {
  if (!payload || !Array.isArray(payload.apps)) throw new Error('文件格式不正确');
  const s = load();
  if (mode === 'replace') {
    s.apps = [];
  }
  if (Array.isArray(payload.categories) && payload.categories.length) {
    const have = new Set(s.categories.map((c) => c.id));
    for (const c of payload.categories) {
      if (!c || !c.id || !c.name) continue;
      if (have.has(c.id)) continue;
      s.categories.push({ id: c.id, name: c.name, icon: c.icon || 'grid' });
      have.add(c.id);
    }
  }
  const seen = new Set(s.apps.map((a) => (a.targetKey || a.target || a.launchUri || '').toLowerCase()));
  let added = 0;
  let skipped = 0;
  for (const raw of payload.apps) {
    if (!raw || (!raw.target && !raw.launchUri)) { skipped++; continue; }
    const key = String(raw.target || raw.launchUri || '').toLowerCase();
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    s.apps.push(normalizeApp({
      id: newId(),
      name: String(raw.name || path.basename(String(raw.target || ''))).trim() || '未命名',
      target: String(raw.target || ''),
      args: String(raw.args || ''),
      workdir: String(raw.workdir || ''),
      category: s.categories.some((c) => c.id === raw.category) ? raw.category : 'other',
      comment: String(raw.comment || ''),
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      iconSource: String(raw.iconSource || raw.target || ''),
      launchUri: String(raw.launchUri || ''),
      source: String(raw.source || 'import'),
      targetKey: key,
      pinned: !!raw.pinned,
      launches: Number(raw.launches) || 0,
      lastUsed: Number(raw.lastUsed) || 0,
      addedAt: Date.now()
    }));
    added++;
  }
  if (mode === 'replace') {
    // 覆盖导入时设置与分类也一起还原
    if (payload.settings) s.settings = Object.assign({}, s.settings, payload.settings);
  }
  save();
  return { added, skipped, total: s.apps.length };
}

function iconPathFor(seed) {
  const h = crypto.createHash('md5').update(String(seed).toLowerCase()).digest('hex').slice(0, 16);
  return path.join(ICON_DIR, h + '.ico');
}

module.exports = {
  ROOT, DATA_FILE, ICON_DIR, WALL_DIR,
  ensureDirs, state, publicState, save,
  findApp, addApp, updateApp, removeApp, togglePin, reorder, markUsed,
  updateSettings, addCategory, renameCategory, removeCategory, batch,
  dedupe, exportData, importData, newId, iconPathFor, load
};
