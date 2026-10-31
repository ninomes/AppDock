'use strict';
/**
 * 启动器：把点击变成真正的进程启动。
 * 覆盖 5 种情况：普通 exe、快捷方式 .lnk、协议链接（steam://、https://）、
 * 需要管理员权限的 exe、以及用户主动选择的「以管理员身份运行」。
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/** 把 "a b --c=\"d e\"" 拆成参数数组，照顾引号 */
function splitArgs(str) {
  const out = [];
  if (!str) return out;
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
  }
  return out;
}

function isUri(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:\\/i.test(target);
}

function trySpawn(file, args, opts) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok, err) => {
      if (done) return;
      done = true;
      resolve({ ok, error: err ? String(err.message || err) : null });
    };
    let child;
    try {
      child = spawn(file, args, Object.assign({ detached: true, stdio: 'ignore', windowsHide: false }, opts));
    } catch (e) {
      return finish(false, e);
    }
    child.on('error', (e) => finish(false, e));
    // 进程成功创建后 status 会变成 running；700ms 内没报错就认为启动成功
    setTimeout(() => finish(true, null), 700);
    if (child.pid) {
      try { child.unref(); } catch (_) {}
    }
  });
}

/** 用 PowerShell 的 Start-Process -Verb RunAs 拉起 UAC */
function runAsAdmin(target, args) {
  const psArg = args && args.length
    ? ' -ArgumentList ' + args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',')
    : '';
  const cmd = `Start-Process -FilePath '${target.replace(/'/g, "''")}'${psArg} -Verb RunAs`;
  return trySpawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', cmd], { windowsHide: true });
}

async function openUri(uri) {
  return trySpawn('rundll32.exe', ['url.dll,FileProtocolHandler', uri], { windowsHide: true });
}

/**
 * @param {{target:string,args?:string,workdir?:string,launchUri?:string}} app
 * @param {{admin?:boolean}} [options]
 */
async function launch(app, options) {
  const opts0 = options || {};
  const target = (app.target || '').trim();
  const args = splitArgs(app.args || '');

  // 用户显式要求管理员权限
  if (opts0.admin) {
    if (app.launchUri && !target) return openUri(app.launchUri);
    if (!target) return { ok: false, error: '没有配置程序路径' };
    const r = await runAsAdmin(target, args);
    return r.ok ? { ok: true, via: 'admin' } : r;
  }

  if (app.launchUri) {
    const r = await openUri(app.launchUri);
    if (r.ok) return { ok: true, via: 'protocol' };
    return r;
  }
  if (!target) return { ok: false, error: '没有配置程序路径' };

  // 网址 / 协议
  if (isUri(target)) {
    return openUri(target);
  }

  // 快捷方式交给资源管理器用 ShellExecute 处理，兼容性最好
  if (/\.lnk$/i.test(target)) {
    if (!fs.existsSync(target)) return { ok: false, error: '快捷方式不存在：' + target };
    const r = await trySpawn('explorer.exe', [target]);
    return r.ok ? { ok: true, via: 'shell' } : r;
  }

  // 普通程序
  if (/\.(exe|com|bat|cmd)$/i.test(target) && !fs.existsSync(target)) {
    return { ok: false, error: '程序不存在：' + target };
  }
  const cwd = app.workdir || path.dirname(target);
  const first = await trySpawn(target, args, { cwd });
  if (first.ok) return { ok: true, via: 'spawn' };

  // 拒绝访问（一般是清单要求管理员）→ 走 UAC
  if (/EACCES|EPERM|740|denied|拒绝/i.test(first.error || '')) {
    const r = await runAsAdmin(target, args);
    if (r.ok) return { ok: true, via: 'admin' };
    return r;
  }
  return first;
}

/** 在资源管理器里定位文件 */
function revealInFolder(target) {
  if (!target) return Promise.resolve({ ok: false, error: '无路径' });
  if (isUri(target)) return Promise.resolve({ ok: false, error: '这不是本地文件' });
  if (!fs.existsSync(target)) return Promise.resolve({ ok: false, error: '文件已不存在' });
  return trySpawn('explorer.exe', ['/select,', target]);
}

/** 打开系统的「属性」对话框 */
function showProperties(target) {
  if (!target) return Promise.resolve({ ok: false, error: '无路径' });
  if (isUri(target)) return Promise.resolve({ ok: false, error: '这不是本地文件' });
  if (!fs.existsSync(target)) return Promise.resolve({ ok: false, error: '文件已不存在' });
  const esc = target.replace(/'/g, "''");
  const cmd = `Start-Process -FilePath 'rundll32.exe' -ArgumentList 'shell32.dll,ShellExec_RunDLL','properties','${esc}'`;
  return trySpawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', cmd], { windowsHide: true });
}

/** 把文本写进系统剪贴板 */
function copyToClipboard(text) {
  const esc = String(text || '').replace(/'/g, "''");
  return trySpawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', `Set-Clipboard -Value '${esc}'`], { windowsHide: true });
}

module.exports = { launch, revealInFolder, showProperties, copyToClipboard, splitArgs };
