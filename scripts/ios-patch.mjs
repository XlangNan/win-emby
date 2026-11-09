// 在 `tauri ios init` 生成的 Xcode 工程（XcodeGen 的 project.yml）上打补丁（CI 里自动执行）：
//  1. 放入 Swift / ObjC 源文件（mpv 桥）
//  2. 加 MPVKit 的 Swift Package 依赖
//  3. Info.plist：后台音频、允许明文 HTTP（局域网 Emby）、本地网络说明、支持横竖屏
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const apple = path.resolve('src-tauri/gen/apple');
if (!fs.existsSync(apple)) throw new Error('找不到 ' + apple + '，先执行 tauri ios init');
const ymlPath = path.join(apple, 'project.yml');
let y = fs.readFileSync(ymlPath, 'utf8');
console.log('──── project.yml（原始） ────\n' + y + '\n────────────────────────────');

// 1. 源文件
const sources = path.join(apple, 'Sources', 'WeaveExt');
fs.mkdirSync(sources, { recursive: true });
for (const f of ['WeaveMpv.swift', 'WeaveLoad.m']) fs.copyFileSync(path.resolve('ios', f), path.join(sources, f));

// 2. MPVKit 依赖：找到 iOS 应用 target 的 dependencies 段，插入一项
const lines = y.split('\n');
const tIdx = lines.findIndex((l) => /^ {2}\S+_iOS:\s*$/.test(l));
if (tIdx < 0) throw new Error('project.yml 里没找到 *_iOS target');
let dIdx = -1;
for (let i = tIdx + 1; i < lines.length; i++) {
  if (/^ {2}\S/.test(lines[i]) && !/^ {3}/.test(lines[i])) break; // 下一个 target
  if (/^ {4}dependencies:\s*$/.test(lines[i])) { dIdx = i; break; }
}
if (dIdx < 0) lines.splice(tIdx + 1, 0, '    dependencies:', '      - package: MPVKit', '        product: MPVKit');
else lines.splice(dIdx + 1, 0, '      - package: MPVKit', '        product: MPVKit');
y = lines.join('\n');
if (/^packages:\s*$/m.test(y)) y = y.replace(/^packages:\s*$/m, 'packages:\n  MPVKit:\n    url: https://github.com/mpvkit/MPVKit\n    from: 0.39.0');
else y += '\npackages:\n  MPVKit:\n    url: https://github.com/mpvkit/MPVKit\n    from: 0.39.0\n';
fs.writeFileSync(ymlPath, y);
console.log('已加入 MPVKit 依赖');

// 3. Info.plist
let plist = null;
(function find(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'build' || e.name === 'Pods') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) find(p);
    else if (e.name === 'Info.plist' && !plist) plist = p;
  }
})(apple);
if (!plist) throw new Error('找不到 Info.plist');
const pb = (cmd) => { try { execFileSync('/usr/libexec/PlistBuddy', ['-c', cmd, plist], { stdio: 'pipe' }); } catch { /* 已存在等，忽略 */ } };
pb('Delete :UIBackgroundModes'); pb('Add :UIBackgroundModes array'); pb('Add :UIBackgroundModes:0 string audio');
pb('Delete :NSAppTransportSecurity'); pb('Add :NSAppTransportSecurity dict'); pb('Add :NSAppTransportSecurity:NSAllowsArbitraryLoads bool true');
pb('Delete :NSLocalNetworkUsageDescription'); pb('Add :NSLocalNetworkUsageDescription string 用于连接局域网里的 Emby / 音乐服务器');
pb('Delete :UIFileSharingEnabled'); // 不开放文件共享
pb('Delete :UIRequiresFullScreen'); pb('Add :UIRequiresFullScreen bool true');
console.log('已修改 Info.plist：', plist);
console.log(execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print', plist]).toString());
