# 织影 iPad / iPhone 版

- 构建：GitHub → Actions → build-ios → Run workflow，完成后下载 Artifacts 里的 `Weave-ios`，解压得到 `Weave-ios-unsigned.ipa`（未签名）。
- 安装：爱思助手 → 工具箱 → 「IPA 签名」（用自己的 Apple ID 重签）→ 安装。免费 Apple ID 的签名 7 天过期，到期重新签一次；同时最多 3 个自签应用。
- 播放：`ios/WeaveMpv.swift` 用 MPVKit（libmpv + MoltenVK + VideoToolbox）；画面层放在透明 WKWebView 后面，网页端接口与安卓一致。MPVKit 不可用时自动退回网页播放器。
- 目前未在真机上验证，第一次构建失败请把 Actions 日志里红色那一步的末尾 50 行发回来。
