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
console.log('resedit OK: icon + version info written to', exePath);
