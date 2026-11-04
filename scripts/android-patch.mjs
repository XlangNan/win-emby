// 在 `tauri android init` 生成的安卓工程上打补丁（CI 里自动执行）：
//  1. 允许明文 HTTP（局域网 Emby 图片走 WebView，默认被禁）
//  2. 加 libmpv 依赖
//  3. 放入 MpvBridge.kt / MainActivity.kt（填上探测到的 MPVLib 类名）
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('src-tauri/gen/android/app');
const mpvClass = process.env.MPVLIB_CLASS;
if (!fs.existsSync(root)) throw new Error('找不到 ' + root + '，先执行 tauri android init');
if (!mpvClass) throw new Error('缺少环境变量 MPVLIB_CLASS（libmpv 里 MPVLib 的完整类名）');

// 1. 清单
const mf = path.join(root, 'src/main/AndroidManifest.xml');
let x = fs.readFileSync(mf, 'utf8');
if (/android:usesCleartextTraffic="[^"]*"/.test(x)) x = x.replace(/android:usesCleartextTraffic="[^"]*"/, 'android:usesCleartextTraffic="true"');
else x = x.replace('<application', '<application android:usesCleartextTraffic="true"');
fs.writeFileSync(mf, x);

// 2. 依赖
const gk = fs.existsSync(path.join(root, 'build.gradle.kts')) ? 'build.gradle.kts' : 'build.gradle';
const gp = path.join(root, gk);
let g = fs.readFileSync(gp, 'utf8');
if (!g.includes('dev.jdtech.mpv:libmpv')) {
  const dep = gk.endsWith('.kts') ? '    implementation("dev.jdtech.mpv:libmpv:1.0.0")\n' : "    implementation 'dev.jdtech.mpv:libmpv:1.0.0'\n";
  g = g.replace(/dependencies\s*\{\n/, (m) => m + dep);
}
fs.writeFileSync(gp, g);

// 3. Kotlin 源码
const pkg = (x.match(/package="([^"]+)"/) || [])[1];
const javaRoot = path.join(root, 'src/main/java');
let dir = null;
(function find(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) find(path.join(d, e.name));
    else if (e.name === 'MainActivity.kt') dir = d;
  }
})(javaRoot);
if (!dir) throw new Error('找不到生成的 MainActivity.kt');
const pkgLine = (fs.readFileSync(path.join(dir, 'MainActivity.kt'), 'utf8').match(/^package\s+(\S+)/m) || [])[1];
for (const f of ['MpvBridge.kt', 'MainActivity.kt']) {
  let s = fs.readFileSync(path.resolve('android', f), 'utf8').replace(/^package\s+\S+/m, `package ${pkgLine}`).replace('__MPVLIB__', mpvClass);
  fs.writeFileSync(path.join(dir, f), s);
}
console.log('补丁完成：包名', pkgLine, '，MPVLib =', mpvClass, pkg ? '' : '');
