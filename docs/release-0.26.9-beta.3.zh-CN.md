# Station 0.26.9-beta.3

- 桌面版在合成用户 profile 后明确关闭 Harness 自动打开系统浏览器，即使已有配置启用了 `openBrowser`，也只打开 App 窗口；用户配置文件无需修改。
- 更新提示只提供“立即下载”和“稍后提醒”。点击立即下载后由 App 下载并验证安装包，不跳转 GitLab 或 GitHub 发布页。
- 安装包保存到系统“下载”目录下的 `DeepSeek Harness Station/<版本>`，下载完成后确认安装，也可保留安装包稍后安装。

较早版本内置的“打开 GitLab 发布页”行为无法远程替换，需要先手动安装一次新版；安装新版后的后续升级直接在 App 中下载。

Windows 安装包：`DeepSeek-Harness-Station-0.26.9-beta.3-x64-Setup.exe`。

GitHub 直达下载：<https://github.com/sipingme/deepseek-harness-station/releases/download/v0.26.9-beta.3/DeepSeek-Harness-Station-0.26.9-beta.3-x64-Setup.exe>
