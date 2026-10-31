'use strict';
/**
 * 本地 HTTP 服务：界面和系统之间的唯一通道。
 * 只监听 127.0.0.1，随机端口，外部访问不到。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const store = require('./store');
const icons = require('./pe-icon');
const scanner = require('./scan');
const launcher = require('./launcher');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PS_DIR = path.join(__dirname, 'ps');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};

/* ---------- 工具 ---------- */
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 4 * 1024 * 1024) { req.destroy(); return; }
      raw += c;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (_) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function sendFile(res, file, mime, cacheSeconds) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { error: '文件不存在' });
    const head = {
      'Content-Type': mime || MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cacheSeconds ? 'public, max-age=' + cacheSeconds : 'no-cache'
    };
    res.writeHead(200, head);
    fs.createReadStream(file).pipe(res);
  });
}

function pickFile(kind) {
  const isImage = kind === 'image';
  const filter = isImage
    ? '图片 (*.jpg;*.jpeg;*.png;*.webp;*.bmp)|*.jpg;*.jpeg;*.png;*.webp;*.bmp|所有文件 (*.*)|*.*'
    : '程序 (*.exe;*.lnk;*.bat;*.cmd)|*.exe;*.lnk;*.bat;*.cmd|所有文件 (*.*)|*.*';
  const title = isImage ? '选择壁纸图片' : '选择要添加的程序';
  const out = path.join(os.tmpdir(), 'gk-pick-' + process.pid + '-' + Date.now() + '.txt');
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(PS_DIR, 'pick-file.ps1'),
        '-Filter', filter, '-Title', title, '-Out', out],
      { windowsHide: true, timeout: 120000 },
      () => {
        let p = '';
        try { p = fs.readFileSync(out, 'utf8').replace(/^\uFEFF/, '').trim(); } catch (_) {}
        try { fs.unlinkSync(out); } catch (_) {}
        resolve(p);
      }
    );
  });
}

/* ---------- 图标 ---------- */
const iconMissCache = new Set();

function ensureIcon(app) {
  const target = path.join(store.ICON_DIR, app.id + '.ico');
  if (fs.existsSync(target)) return target;
  if (iconMissCache.has(app.id)) return null;
  const src = app.iconSource || app.target;
  if (!src) { iconMissCache.add(app.id); return null; }
  const ok = icons.writeIconFor(src, target);
  if (!ok) iconMissCache.add(app.id);
  return ok ? target : null;
}

const ICON_CONCURRENCY = 8;
async function warmIcons(apps) {
  const queue = apps.slice();
  const worker = async () => {
    while (queue.length) {
      const app = queue.shift();
      const target = path.join(store.ICON_DIR, app.id + '.ico');
      if (fs.existsSync(target)) continue;
      await new Promise((r) => setImmediate(r));
      try { ensureIcon(app); } catch (_) {}
    }
  };
  await Promise.all(Array.from({ length: ICON_CONCURRENCY }, worker));
}

/* ---------- 路由 ---------- */
async function handleApi(req, res, urlObj) {
  const p = urlObj.pathname;
  const m = req.method;

  if (p === '/api/state' && m === 'GET') {
    return sendJson(res, 200, store.publicState());
  }

  // 心跳，用来判断窗口是不是还开着
  if (p === '/api/ping') {
    LAST_PONG = Date.now();
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/categories' && m === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, { category: store.addCategory(body.name) });
  }

  let cm;
  if ((cm = p.match(/^\/api\/categories\/([^/]+)$/))) {
    const id = decodeURIComponent(cm[1]);
    if (m === 'PATCH') {
      const body = await readBody(req);
      const c = store.renameCategory(id, body.name);
      if (!c) return sendJson(res, 404, { error: '分类不存在' });
      return sendJson(res, 200, { category: c });
    }
    if (m === 'DELETE') {
      const r = store.removeCategory(id, 'other');
      return sendJson(res, r.ok ? 200 : 404, r);
    }
  }

  if (p === '/api/settings' && m === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, { settings: store.updateSettings(body) });
  }

  if (p === '/api/apps' && m === 'POST') {
    const body = await readBody(req);
    if (!body.target) return sendJson(res, 400, { error: '缺少程序路径' });
    const app = store.addApp({
      target: body.target,
      name: body.name,
      category: body.category,
      args: body.args,
      workdir: body.workdir || path.dirname(body.target),
      iconSource: body.iconSource || body.target,
      tags: body.tags,
      comment: body.comment,
      pinned: body.pinned,
      source: 'manual'
    });
    // 立刻把图标抠出来，避免首屏空白
    ensureIcon(app);
    return sendJson(res, 200, { app });
  }

  // 批量操作：改分类 / 置顶 / 移除
  if (p === '/api/apps/batch' && m === 'POST') {
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (!ids.length) return sendJson(res, 400, { error: '没有选中任何应用' });
    const r = store.batch(ids, body.action, body);
    return sendJson(res, 200, r);
  }

  // 导出配置到数据目录并在资源管理器里定位
  if (p === '/api/export' && m === 'POST') {
    const d = new Date();
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const file = path.join(store.ROOT, 'AppDock-备份-' + stamp + '.json');
    fs.writeFileSync(file, JSON.stringify(store.exportData(), null, 2), 'utf8');
    await launcher.revealInFolder(file);
    return sendJson(res, 200, { ok: true, file });
  }

  // 导入配置
  if (p === '/api/import' && m === 'POST') {
    const body = await readBody(req);
    const r = store.importData(body.data, body.mode === 'replace' ? 'replace' : 'merge');
    return sendJson(res, 200, r);
  }

  // 重建全部图标缓存
  if (p === '/api/icons/rebuild' && m === 'POST') {
    let removed = 0;
    try {
      for (const f of fs.readdirSync(store.ICON_DIR)) {
        try { fs.unlinkSync(path.join(store.ICON_DIR, f)); removed++; } catch (_) {}
      }
    } catch (_) {}
    iconMissCache.clear();
    warmIcons(store.state().apps).catch(() => {});
    return sendJson(res, 200, { ok: true, removed });
  }

  let pm;
  if ((pm = p.match(/^\/api\/apps\/([^/]+)\/pin$/)) && m === 'POST') {
    const app = store.togglePin(pm[1]);
    if (!app) return sendJson(res, 404, { error: '应用不存在' });
    return sendJson(res, 200, { app });
  }

  if (/^\/api\/apps\/[^/]+\/icon$/.test(p) && m === 'POST') {
    const id = p.split('/')[3];
    const body = await readBody(req);
    const app = store.findApp(id);
    if (!app) return sendJson(res, 404, { error: '应用不存在' });
    const target = path.join(store.ICON_DIR, app.id + '.ico');
    const src = body.path || app.target;
    if (!src || !icons.writeIconFor(src, target)) return sendJson(res, 400, { error: '无法从此文件提取图标' });
    iconMissCache.delete(app.id);
    app.iconSource = src;
    store.save();
    return sendJson(res, 200, { ok: true });
  }

  let mm;
  if ((mm = p.match(/^\/api\/apps\/([^/]+)$/))) {
    const id = mm[1];
    if (m === 'PATCH') {
      const body = await readBody(req);
      const app = store.updateApp(id, body);
      if (!app) return sendJson(res, 404, { error: '应用不存在' });
      return sendJson(res, 200, { app });
    }
    if (m === 'DELETE') {
      const ok = store.removeApp(id);
      return sendJson(res, ok ? 200 : 404, { ok });
    }
  }

  if (p === '/api/reorder' && m === 'POST') {
    const body = await readBody(req);
    store.reorder(Array.isArray(body.ids) ? body.ids : []);
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/launch' && m === 'POST') {
    const body = await readBody(req);
    const app = store.findApp(body.id);
    if (!app) return sendJson(res, 404, { error: '应用不存在' });
    const r = await launcher.launch(app, { admin: !!body.admin });
    if (r.ok) store.markUsed(app.id);
    return sendJson(res, r.ok ? 200 : 500, r);
  }

  if (p === '/api/properties' && m === 'POST') {
    const body = await readBody(req);
    const app = store.findApp(body.id);
    if (!app) return sendJson(res, 404, { error: '应用不存在' });
    const r = await launcher.showProperties(app.target);
    return sendJson(res, r.ok ? 200 : 400, r);
  }

  if (p === '/api/copy' && m === 'POST') {
    const body = await readBody(req);
    const r = await launcher.copyToClipboard(body.text || '');
    return sendJson(res, r.ok ? 200 : 400, r);
  }

  if (p === '/api/reveal' && m === 'POST') {
    const body = await readBody(req);
    if (body.id === '__root__') {
      const r = await launcher.revealInFolder(store.DATA_FILE);
      return sendJson(res, r.ok ? 200 : 400, r);
    }
    const app = store.findApp(body.id);
    if (!app) return sendJson(res, 404, { error: '应用不存在' });
    const r = await launcher.revealInFolder(app.target);
    return sendJson(res, r.ok ? 200 : 400, r);
  }

  if (p === '/api/scan' && m === 'POST') {
    const body = await readBody(req);
    const { items, errors } = await scanner.scanAll();
    const s = store.state();
    const seen = new Set(s.apps.map((a) => (a.targetKey || a.target || a.launchUri || '').toLowerCase()));
    const added = [];
    for (const it of items) {
      const key = (it.target || it.launchUri || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const app = {
        id: store.newId(),
        name: it.name,
        target: it.target || '',
        args: it.args || '',
        workdir: it.workdir || '',
        category: it.category || 'app',
        comment: '',
        icon: '',
        iconSource: it.iconSource || it.target || '',
        launchUri: it.launchUri || '',
        source: it.source || 'scan',
        targetKey: key,
        launches: 0,
        lastUsed: 0,
        addedAt: Date.now()
      };
      s.apps.push(app);
      added.push(app);
    }
    if (added.length) store.save();
    if (body.warm !== false) {
      warmIcons(added).catch(() => {});
    }
    return sendJson(res, 200, {
      total: items.length,
      added: added.length,
      errors: errors.length ? errors : undefined
    });
  }

  if (p === '/api/pick' && m === 'POST') {
    const body = await readBody(req);
    const file = await pickFile(body.kind === 'image' ? 'image' : 'program');
    return sendJson(res, 200, { path: file });
  }

  if (p === '/api/env' && m === 'GET') {
    return sendJson(res, 200, {
      root: store.ROOT,
      dataFile: store.DATA_FILE,
      node: process.version,
      platform: process.platform
    });
  }

  if (p === '/api/quit' && m === 'POST') {
    sendJson(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 150);
    return;
  }

  return sendJson(res, 404, { error: '接口不存在' });
}

let LAST_PONG = Date.now();

function handler(req, res) {
  const urlObj = new URL(req.url, 'http://127.0.0.1');

  if (urlObj.pathname.startsWith('/api/')) {
    handleApi(req, res, urlObj).catch((e) => {
      try { sendJson(res, 500, { error: String(e && e.message || e) }); } catch (_) {}
    });
    return;
  }

  if (urlObj.pathname.startsWith('/icon/')) {
    const id = decodeURIComponent(urlObj.pathname.slice(6)).replace(/\.ico$/, '');
    const app = store.findApp(id);
    if (!app) return sendJson(res, 404, { error: '应用不存在' });
    const target = path.join(store.ICON_DIR, app.id + '.ico');
    if (fs.existsSync(target)) return sendFile(res, target, 'image/x-icon', 86400);
    // 还没生成就当场抠一次，用户点开就能看到图标
    ensureIcon(app);
    if (fs.existsSync(target)) return sendFile(res, target, 'image/x-icon', 86400);
    return sendJson(res, 404, { error: '无图标' });
  }

  if (urlObj.pathname === '/wallpaper') {
    const s = store.state();
    const wp = s.settings.wallpaper;
    if (wp && fs.existsSync(wp)) return sendFile(res, wp, null, 300);
    return sendJson(res, 404, { error: '未设置壁纸' });
  }

  // 静态资源
  let rel = urlObj.pathname === '/' ? '/index.html' : urlObj.pathname;
  rel = decodeURIComponent(rel);
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: '禁止访问' });
  sendFile(res, file, null, 0);
}

function start() {
  return new Promise((resolve, reject) => {
    store.ensureDirs();
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      // 启动后悄悄补齐缺失的图标，不阻塞界面
      setTimeout(() => {
        try {
          const missing = store.state().apps.filter(
            (a) => !fs.existsSync(path.join(store.ICON_DIR, a.id + '.ico'))
          );
          if (missing.length) warmIcons(missing).catch(() => {});
        } catch (_) {}
      }, 400);
      resolve({ server, port, url: 'http://127.0.0.1:' + port + '/' });
    });
  });
}

module.exports = { start, getLastPong: () => LAST_PONG };
