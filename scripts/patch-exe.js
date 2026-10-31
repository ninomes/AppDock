// 给 SEA 打包出的 exe 换图标 + 写版本信息（纯 JS，resedit）
const fs = require('fs');
const { NtExecutable, NtExecutableResource, Resource, Data } = require('resedit');

const exePath = process.argv[2];
const icoPath = process.argv[3];

const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = NtExecutableResource.from(exe);

// 图标
const ico = Data.IconFile.from(fs.readFileSync(icoPath));
Resource.IconGroupEntry.replaceIconsForResource(
  res.entries,
  1,          // ICON 资源 ID
  1033,       // 语言
  ico.icons.map((i) => i.data)
);

// 版本信息
const vi = Resource.VersionInfo.createEmpty();
vi.setStringValues({ lang: 1033, charset: 1200 }, {
  FileDescription: '应用坞 AppDock',
  ProductName: '应用坞 AppDock',
  CompanyName: 'ninomes',
  LegalCopyright: 'MIT License',
  FileVersion: '1.2.0',
  ProductVersion: '1.2.0'
});
vi.setFileVersion(1, 2, 0, 0);
vi.setProductVersion(1, 2, 0, 0);
vi.outputToResourceEntries(res.entries);

res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));

// 控制台子系统 → GUI 子系统：去掉启动时跟着弹出的 DOS 黑窗
const buf = fs.readFileSync(exePath);
const peOff = buf.readUInt32LE(0x3c);                       // e_lfanew
const subsystemOff = peOff + 4 + 20 + 68;                   // PE签名 + COFF头 + OptionalHeader.Subsystem
if (buf.readUInt32LE(peOff) === 0x00004550) {               // 'PE\0\0'
  buf.writeUInt16LE(2, subsystemOff);                       // IMAGE_SUBSYSTEM_WINDOWS_GUI
  fs.writeFileSync(exePath, buf);
  console.log('subsystem -> GUI，启动不再弹控制台窗口');
}

console.log('resedit OK: icon + version info written to', exePath);
