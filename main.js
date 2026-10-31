'use strict';
/**
 * AppDock 入口：起本地服务 + 用一个无地址栏的浏览器窗口当外壳。
 * 不打包 Electron，整体只有几百 KB，启动不到 1 秒。
 */
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const store = require('./lib/store');
const serverMod = require('./lib/server');

const LOG_FILE = path.join(process.env.APPDATA || __dirname, 'AppDock', 'log.txt');
const RUNTIME = path.join(process.env.APPDATA || __dirname, 'AppDock', 'runtime.json');

function log(...args) {
  const line = '[' + new Date().toISOString() + '] ' + args.map(String).join(' ');
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) {}
  if (process.stdout && process.stdout.isTTY) console.log(line);
}

function findBrowser() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch (_) {}
  }
  return '';
}

function openAppWindow(browser, url) {
  const profileDir = path.join(store.ROOT, 'window-profile');
  const args = [
    '--app=' + url,
    '--window-size=1300,880',
    '--user-data-dir=' + profileDir,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter',
    '--disable-background-mode'
  ];
  log('launch browser:', browser, args.join(' '));
  const child = spawn(browser, args, { detached: false, stdio: 'ignore' });
  child.on('error', (e) => log('browser error', e.message));
  child.on('exit', (code) => {
    log('browser exited', code);
    // 窗口关掉后给前端一点时间把数据写完
    setTimeout(() => process.exit(0), 400);
  });
  return child;
}

function openWithDefault(url) {
  log('fallback to default browser');
  spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

async function main() {
  store.ensureDirs();

  // 单实例：已经有一个在跑就直接把窗口叫到前面
  try {
    if (fs.existsSync(RUNTIME)) {
      const rt = JSON.parse(fs.readFileSync(RUNTIME, 'utf8'));
      if (rt && rt.pid && rt.port && pidAlive(rt.pid)) {
        const url = 'http://127.0.0.1:' + rt.port + '/';
        const b = findBrowser();
        if (b) openAppWindow(b, url); else openWithDefault(url);
        setTimeout(() => process.exit(0), 1200);
        return;
      }
    }
  } catch (_) { /* 忽略 */ }

  const { server, port, url } = await serverMod.start();
  log('server listening', url);
  try {
    fs.writeFileSync(RUNTIME, JSON.stringify({ pid: process.pid, port, startedAt: Date.now() }));
  } catch (_) {}

  const browser = findBrowser();
  if (browser) {
    openAppWindow(browser, url);
  } else {
    openWithDefault(url);
    // 没有可控浏览器时靠心跳判断窗口是否还活着
  }

  // 心跳守护：界面关掉后自动收工，不留后台残留进程
  const WATCHDOG_START = Date.now();
  setInterval(() => {
    const last = serverMod.getLastPong();
    const idle = Date.now() - Math.max(last, WATCHDOG_START);
    if (idle > 20000) {
      log('window gone, shutting down');
      try { fs.unlinkSync(RUNTIME); } catch (_) {}
      process.exit(0);
    }
  }, 5000);

  const cleanup = () => {
    try { fs.unlinkSync(RUNTIME); } catch (_) {}
    try { server.close(); } catch (_) {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
  process.on('uncaughtException', (e) => log('uncaught', e.stack || e.message));
}

main().catch((e) => {
  log('FATAL', e.stack || e.message);
  process.exit(1);
});
