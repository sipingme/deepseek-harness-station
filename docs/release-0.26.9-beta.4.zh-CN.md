# Station 0.26.9-beta.4

- 桌面启动不再自动打开系统浏览器，覆盖旧 profile 的 `openBrowser: true` 设置，不修改用户配置文件。
- 更新提示点击“立即下载”后直接下载安装包，保存到系统“下载”目录；SHA-256 校验通过后再确认安装，无需查找发布页附件。
- 修复慢网络下载：安装包持续传输时不会因为总下载时间超过 10 分钟而中断；连续 10 分钟没有进展才超时。

旧版 0.1.3 的 GitLab 跳转行为需先安装一次新版才能改变。保存工作并退出旧版后运行安装包，后续可直接在 App 内下载更新。

[直接下载 Windows 安装包](https://github.com/sipingme/deepseek-harness-station/releases/download/v0.26.9-beta.4/DeepSeek-Harness-Station-0.26.9-beta.4-x64-Setup.exe)
