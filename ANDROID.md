# 安卓版构建

1. 把整个项目上传到 GitHub（和 Windows 版同一个仓库）。
2. 打开仓库 → **Actions** → 左侧选 **build-android** → **Run workflow**。
3. 跑完后（约 20–40 分钟，第一次更久），在这次运行页面最下面的 **Artifacts** 下载 `织影-android`，解压得到 `织影.apk`，发到手机安装。

构建出错时，把失败步骤的日志发过来。尤其是 **Inspect libmpv AAR** 这一步会打印 libmpv 的接口，排错用。

说明：
- 只编译 64 位 ARM（aarch64），绝大多数近几年的手机都是。
- APK 用仓库里的 `android/winemby.keystore` 签名，之后每次更新都能直接覆盖安装。要换签名就换这个文件和工作流里的口令。
