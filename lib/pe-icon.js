'use strict';
/**
 * 从 Windows 可执行文件里直接抠出图标。
 *
 * 原理：exe 的图标藏在 PE 资源段里，类型 RT_GROUP_ICON(14) 是一张"图标目录"，
 * 真正像素数据在 RT_ICON(3) 里。把目录和像素重新打包成标准 .ico，
 * 浏览器（Chromium 内核）可以直接渲染，而且是 256x256 的原始清晰度。
 *
 * 纯手写 PE 解析，不依赖任何 npm 包。
 */
const fs = require('fs');
const path = require('path');

const RT_ICON = 3;
const RT_GROUP_ICON = 14;

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  let read = 0;
  try {
    read = fs.readSync(fd, b, 0, len, pos);
  } catch (_) {
    return null;
  }
  return read === len ? b : b.slice(0, read);
}

function listDir(buf, off) {
  if (off + 16 > buf.length) return [];
  const named = buf.readUInt16LE(off + 12);
  const ids = buf.readUInt16LE(off + 14);
  const total = named + ids;
  const out = [];
  for (let i = 0; i < total; i++) {
    const e = off + 16 + i * 8;
    if (e + 8 > buf.length) break;
    const nameField = buf.readUInt32LE(e);
    const offField = buf.readUInt32LE(e + 4);
    out.push({
      id: nameField & 0x80000000 ? -1 : nameField & 0xffff,
      sub: !!(offField & 0x80000000),
      off: offField & 0x7fffffff
    });
  }
  return out;
}

function dataEntry(buf, off) {
  if (off + 16 > buf.length) return null;
  return {
    rva: buf.readUInt32LE(off),
    size: buf.readUInt32LE(off + 4)
  };
}

/** 解析 PE，返回 {resBuf, resRva} 或 null */
function loadResourceSection(filePath) {
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const st = fs.fstatSync(fd);
    if (st.size < 0x200) return null;
    const head = readAt(fd, 0, 0x1000);
    if (!head || head.readUInt16LE(0) !== 0x5a4d) return null; // "MZ"

    const peOff = head.readUInt32LE(0x3c);
    if (peOff + 0x100 > head.length) return null;
    if (head.readUInt32LE(peOff) !== 0x00004550) return null; // "PE\0\0"

    const numSections = head.readUInt16LE(peOff + 6);
    const optSize = head.readUInt16LE(peOff + 20);
    const optOff = peOff + 24;
    const magic = head.readUInt16LE(optOff);
    const is64 = magic === 0x20b;
    if (!is64 && magic !== 0x10b) return null;

    const ddOff = optOff + (is64 ? 112 : 96);
    const resDirOff = ddOff + 2 * 8; // 数据目录第 3 项 = 资源表
    if (resDirOff + 8 > head.length) return null;
    const resRva = head.readUInt32LE(resDirOff);
    const resSize = head.readUInt32LE(resDirOff + 4);
    if (!resRva || !resSize) return null;

    const secOff = optOff + optSize;
    let rawOffset = 0;
    for (let i = 0; i < numSections; i++) {
      const s = secOff + i * 40;
      if (s + 40 > head.length) break;
      const vsize = head.readUInt32LE(s + 8);
      const va = head.readUInt32LE(s + 12);
      const rawSize = head.readUInt32LE(s + 16);
      const rawPtr = head.readUInt32LE(s + 20);
      const span = Math.max(vsize, rawSize);
      if (resRva >= va && resRva < va + span) {
        rawOffset = rawPtr + (resRva - va);
        break;
      }
    }
    if (!rawOffset) return null;

    const limit = Math.min(resSize, 64 * 1024 * 1024, st.size - rawOffset);
    if (limit <= 0) return null;
    const buf = readAt(fd, rawOffset, limit);
    if (!buf || buf.length < 16) return null;
    return { buf, resRva };
  } catch (_) {
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (_) {} }
  }
}

function groupEntries(res, resRva) {
  const root = listDir(res.buf, 0);
  const groupType = root.find((e) => e.id === RT_GROUP_ICON && e.sub);
  if (!groupType) return null;

  const groups = listDir(res.buf, groupType.off).filter((g) => g.sub);
  if (!groups.length) return null;

  // 优先按 ID 升序取第一个图标组（通常就是主图标）
  const pick = groups.slice().sort((a, b) => (a.id < 0 ? 1 : 0) - (b.id < 0 ? 1 : 0) || a.id - b.id)[0];
  const langs = listDir(res.buf, pick.off).filter((l) => !l.sub);
  if (!langs.length) return null;
  const de = dataEntry(res.buf, langs[0].off);
  if (!de) return null;
  const start = de.rva - resRva;
  if (start < 0 || start + de.size > res.buf.length) return null;
  return res.buf.slice(start, start + de.size);
}

function iconImage(res, resRva, id) {
  const root = listDir(res.buf, 0);
  const iconType = root.find((e) => e.id === RT_ICON && e.sub);
  if (!iconType) return null;
  const items = listDir(res.buf, iconType.off);
  const item = items.find((e) => e.id === id);
  if (!item || !item.sub) return null;
  const langs = listDir(res.buf, item.off).filter((l) => !l.sub);
  if (!langs.length) return null;
  const de = dataEntry(res.buf, langs[0].off);
  if (!de) return null;
  const start = de.rva - resRva;
  if (start < 0 || start + de.size > res.buf.length) return null;
  return res.buf.slice(start, start + de.size);
}

/**
 * @param {string} filePath
 * @returns {Buffer|null} 标准 .ico 内容
 */
function extractIcon(filePath) {
  // 本身就是 .ico，直接透传（浏览器会自己挑合适尺寸）
  if (/\.ico$/i.test(filePath)) {
    try {
      const buf = fs.readFileSync(filePath);
      if (buf.length > 32 && buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1) return buf;
    } catch (_) {}
    return null;
  }
  const res = loadResourceSection(filePath);
  if (!res) return null;
  const grp = groupEntries(res, res.resRva);
  if (!grp || grp.length < 6) return null;

  const count = grp.readUInt16LE(4);
  let best = null;
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 14;
    if (e + 14 > grp.length) break;
    const w = grp[e] || 256;
    const h = grp[e + 1] || 256;
    const planes = grp.readUInt16LE(e + 4);
    const bitCount = grp.readUInt16LE(e + 6);
    const bytes = grp.readUInt32LE(e + 8);
    const nId = grp.readUInt16LE(e + 12);
    const area = w * h;
    if (!best || area > best.area) {
      best = { w, h, planes: planes || 1, bitCount: bitCount || 32, bytes, nId, area };
    }
  }
  if (!best) return null;

  const img = iconImage(res, res.resRva, best.nId);
  if (!img || img.length < 16) return null;

  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);       // reserved
  header.writeUInt16LE(1, 2);       // type = icon
  header.writeUInt16LE(1, 4);       // count
  header[6] = best.w >= 256 ? 0 : best.w;
  header[7] = best.h >= 256 ? 0 : best.h;
  header[8] = 0;                    // palette
  header[9] = 0;
  header.writeUInt16LE(best.planes, 10);
  header.writeUInt16LE(best.bitCount, 12);
  header.writeUInt32LE(img.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, img]);
}

/** 顺便读一下版本信息里的产品名，比文件名靠谱 */
function readVersionInfo(filePath) {
  const out = { name: '', company: '', version: '' };
  try {
    const st = fs.statSync(filePath);
    const sz = Math.min(st.size, 8 * 1024 * 1024);
    const fd = fs.openSync(filePath, 'r');
    const buf = readAt(fd, 0, sz);
    fs.closeSync(fd);
    if (!buf) return out;
    // 版本资源以 UTF-16LE 存放，粗暴但有效地抓取固定字段
    const text = buf.toString('utf16le');
    const grab = (key) => {
      const i = text.indexOf(key);
      if (i < 0) return '';
      const rest = text.slice(i + key.length);
      const m = rest.match(/[\u0020-\u007e\u4e00-\u9fa5]{2,60}/);
      return m ? m[0].trim() : '';
    };
    out.company = grab('CompanyName');
    out.name = grab('ProductName') || grab('FileDescription');
    out.version = grab('ProductVersion');
  } catch (_) { /* ignore */ }
  return out;
}

/**
 * 带缓存地取图标；返回 {file, buf} 或 null。
 * 缓存策略：以源文件路径 + 修改时间做 key，程序升级后自动刷新。
 */
function getIconCached(filePath, iconDir, cacheKey) {
  const crypto = require('crypto');
  let stamp = 0;
  try { stamp = fs.statSync(filePath).mtimeMs || 0; } catch (_) { return null; }
  const h = crypto.createHash('md5').update((cacheKey || filePath).toLowerCase() + '|' + Math.round(stamp)).digest('hex').slice(0, 20);
  const target = path.join(iconDir, h + '.ico');
  if (fs.existsSync(target)) {
    try {
      const buf = fs.readFileSync(target);
      if (buf.length > 32) return { file: target, buf };
    } catch (_) { /* 重新生成 */ }
  }
  const ico = extractIcon(filePath);
  if (!ico) return null;
  try { fs.writeFileSync(target, ico); } catch (_) {}
  return { file: target, buf: ico };
}

/** 把 exe/.lnk 的图标存成一个固定名字的 ico（供"添加应用"时用） */
function writeIconFor(filePath, destPath) {
  const ico = extractIcon(filePath);
  if (!ico) return false;
  try {
    fs.writeFileSync(destPath, ico);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { extractIcon, getIconCached, writeIconFor, readVersionInfo };
