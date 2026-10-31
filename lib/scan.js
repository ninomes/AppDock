'use strict';
/**
 * 扫描器：找出这台机器上"能启动的东西"。
 * 三个来源：开始菜单快捷方式（覆盖绝大多数已安装软件）、Steam 游戏库、Epic 游戏库。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const PS_DIR = path.join(__dirname, 'ps');

function runPowerShell(scriptName, args, timeout = 90000) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(PS_DIR, scriptName)].concat(args || []),
      { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err && !stdout) return reject(err);
        resolve(stdout || '');
      }
    );
  });
}

function regQuery(key, value) {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', key, '/v', value], { windowsHide: true, encoding: 'buffer' }, (err, stdout) => {
      if (err || !stdout) return resolve('');
      const text = stdout.toString('latin1');
      const m = text.match(/REG_\w+\s+(.+?)\r?\n/);
      resolve(m ? m[1].trim() : '');
    });
  });
}

// 明显不是"想双击打开的应用"的条目
const JUNK = /(uninstall|卸载|帮助|help|read ?me|自述|使用说明|release ?note|更新日志|更新说明|what'?s new|changelog|许可|license|官网|官方网站|website|online help|manual|manual book|手册|repair|修复|诊断|feedback|反馈|教程)/i;

const EXE_BLACKLIST = /(^unins|^uninst|^setup$|^vc_?redist|^dxsetup|^dotnet|crashreport|crashpad|unitycrashhandler|errorreport|^helper$|redist|prereq|^touchup|^elevate|installer|^install$|shipit)/i;

const CATEGORY_RULES = [
  ['game', /游戏|game|lol|league|英雄联盟|王者|原神|崩坏|minecraft|我的世界|steam|epic|battle\.?net|uplay|ubisoft|wegame|valorant|cs2?\b|csgo|dota|刀塔|绝地求生|pubg|apex|永劫|逆水寒|剑网|梦幻西游|穿越火线|\bcf\b|dnf|地下城|魔兽|warcraft|炉石|hearthstone|暗黑|diablo|育碧|steam|gog|epicgames|模拟器|mumu|雷电|夜神/i],
  ['media', /播放|音乐|视频|影音|player|vlc|potplayer|mpc-?hc|spotify|网易云|qq音乐|酷狗|酷我|bilibili|哔哩|爱奇艺|优酷|腾讯视频|芒果|迅雷|idm|下载|kmplayer|foobar|obs|录屏|格式工厂|剪辑|premiere|audition|剪映|抖音|快手|直播/i],
  ['work', /office|word|excel|powerpoint|onenote|outlook|邮件|mail|pdf|acrobat|xmind|mindmaster|notion|印象笔记|typora|obsidian|钉钉|飞书|企业微信|slack|teams|zoom|腾讯会议|石墨|有道|翻译|wps|numbers|pages|keynote|思维导图|票据|财务|erp|crm/i],
  ['tool', /驱动|压缩|解压|winrar|7-?zip|bandizip|360zip|好压|截图|snipaste|输入法|搜狗|百度输入|杀毒|安全|管家|卫士|加速|vpn|clash|远程|teamviewer|anydesk|todesk|everything|listary|utools|quicker|清理|ccleaner|鲁大师|备份|分区|diskgenius|虚拟机|vmware|virtualbox|python|java|git\b|navicat|visual studio|idea|pycharm|postman|docker|终端|terminal|powershell|cmd|控制面板|设置|任务管理器|注册表|设备管理器|计算器|画图|相机|时钟|日历/i],
];

function guessCategory(name, target) {
  const hay = (name || '') + ' ' + (target || '');
  for (const [cat, re] of CATEGORY_RULES) {
    if (re.test(hay)) return cat;
  }
  return 'app';
}

function cleanName(name) {
  return String(name || '')
    .replace(/\.lnk$/i, '')
    .replace(/\s*[-–—]\s*快捷方式$/i, '')
    .replace(/\s*-\s*Shortcut$/i, '')
    .trim();
}

function iconSourceOf(iconLocation, target) {
  const loc = String(iconLocation || '').split(',')[0].trim();
  if (loc && fs.existsSync(loc)) return loc;
  if (target && fs.existsSync(target)) return target;
  return '';
}

/* ---------------- 开始菜单 ---------------- */
async function scanStartMenu() {
  const tmp = path.join(os.tmpdir(), 'gk-lnk-' + process.pid + '-' + Date.now() + '.json');
  try {
    await runPowerShell('resolve-lnk.ps1', ['-Out', tmp]);
  } catch (e) {
    return [];
  }
  let text = '';
  try {
    text = fs.readFileSync(tmp, 'utf8').replace(/^\uFEFF/, '');
  } catch (_) {
    return [];
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }

  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let row;
    try { row = JSON.parse(t); } catch (_) { continue; }
    const name = cleanName(row.name);
    const target = (row.target || '').trim();
    if (!name || !target) continue;              // UWP / 网址类快捷方式没有可执行目标
    if (JUNK.test(name) || JUNK.test(target)) continue;
    if (/unins\d*\.exe$/i.test(target)) continue;
    if (!fs.existsSync(target)) continue;        // 目标已不存在的死链
    out.push({
      name,
      target,
      args: row.args || '',
      workdir: row.workdir || '',
      iconSource: iconSourceOf(row.icon, target),
      category: guessCategory(name, target),
      source: 'startmenu',
      launchUri: ''
    });
  }
  return out;
}

/* ---------------- Steam ---------------- */
async function findSteamRoot() {
  const candidates = [];
  const p = await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath');
  if (p) candidates.push(p.replace(/\//g, '\\'));
  const p2 = await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath');
  if (p2) candidates.push(p2.replace(/\//g, '\\'));
  candidates.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam', 'D:\\Steam', 'E:\\Steam');
  return candidates.find((c) => c && fs.existsSync(path.join(c, 'steamapps'))) || '';
}

function parseVdfPaths(file) {
  const out = [];
  try {
    const text = fs.readFileSync(file, 'utf8');
    const re = /"path"\s+"([^"]+)"/gi;
    let m;
    while ((m = re.exec(text)) !== null) out.push(m[1].replace(/\\\\/g, '\\'));
  } catch (_) {}
  return out;
}

function findGameExe(dir, depth = 2) {
  const found = [];
  const walk = (d, lv) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (lv < depth && !/^(redist|_commonredist|support|engine|thirdparty|__installer|directx)/i.test(e.name)) walk(full, lv + 1);
      } else if (/\.exe$/i.test(e.name) && !EXE_BLACKLIST.test(e.name)) {
        let size = 0;
        try { size = fs.statSync(full).size; } catch (_) {}
        found.push({ file: full, size, name: e.name });
      }
    }
  };
  walk(dir, 0);
  found.sort((a, b) => b.size - a.size);
  return found[0] ? found[0].file : '';
}

async function scanSteam() {
  try {
    const root = await findSteamRoot();
    if (!root) return [];
    const libs = new Set([root]);
    const vdf = path.join(root, 'steamapps', 'libraryfolders.vdf');
    for (const p of parseVdfPaths(vdf)) libs.add(p);

    const out = [];
    for (const lib of libs) {
      const appsDir = path.join(lib, 'steamapps');
      let files = [];
      try { files = fs.readdirSync(appsDir).filter((f) => /^appmanifest_.*\.acf$/i.test(f)); } catch (_) { continue; }
      for (const f of files) {
        let text = '';
        try { text = fs.readFileSync(path.join(appsDir, f), 'utf8'); } catch (_) { continue; }
        const appid = (text.match(/"appid"\s+"(\d+)"/i) || [])[1];
        const name = (text.match(/"name"\s+"([^"]+)"/i) || [])[1];
        const installdir = (text.match(/"installdir"\s+"([^"]+)"/i) || [])[1];
        if (!appid || !name) continue;
        if (/^(Steamworks|Steam Linux|Proton|SteamVR)/i.test(name)) continue;
        const gameDir = installdir ? path.join(appsDir, 'common', installdir) : '';
        const exe = gameDir ? findGameExe(gameDir) : '';
        out.push({
          name,
          target: exe || '',
          args: '',
          workdir: gameDir,
          iconSource: exe,
          category: 'game',
          source: 'steam',
          launchUri: 'steam://rungameid/' + appid,
          appid
        });
      }
    }
    return out;
  } catch (_) {
    return [];
  }
}

/* ---------------- Epic ---------------- */
async function scanEpic() {
  const file = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'UnrealEngineLauncher', 'LauncherInstalled.dat');
  if (!fs.existsSync(file)) return [];
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return []; }
  const list = Array.isArray(data.InstallationList) ? data.InstallationList : [];
  const out = [];
  for (const item of list) {
    const appName = item.AppName || '';
    const loc = item.InstallLocation || '';
    if (!appName || !loc) continue;
    if (/unreal|UE_|EpicGamesLauncher|Launcher/i.test(appName)) continue;
    if (!fs.existsSync(loc)) continue;
    const exe = findGameExe(loc, 2);
    out.push({
      name: appName.replace(/^[A-Za-z0-9]+$/, '') || path.basename(loc),
      target: exe || '',
      args: '',
      workdir: loc,
      iconSource: exe,
      category: 'game',
      source: 'epic',
      launchUri: 'com.epicgames.launcher://apps/' + appName + '?action=launch&silent=true'
    });
  }
  return out;
}

/* ---------------- 汇总 ---------------- */
async function scanAll() {
  const results = await Promise.allSettled([scanStartMenu(), scanSteam(), scanEpic()]);
  let items = [];
  const errors = [];
  results.forEach((r) => {
    if (r.status === 'fulfilled') items = items.concat(r.value);
    else errors.push(String(r.reason && r.reason.message || r.reason));
  });
  // 按目标去重，开始菜单优先
  const seen = new Set();
  const final = [];
  for (const it of items) {
    const key = (it.target || it.launchUri || it.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    final.push(it);
  }
  final.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  return { items: final, errors };
}

module.exports = { scanAll, scanStartMenu, scanSteam, scanEpic, guessCategory };
