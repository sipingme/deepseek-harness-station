# Station 0.26.9-beta.5

- 安装器改为直接解压到安装目录，减少原先“解压到临时目录后再复制”的重复文件写入；移除运行时不需要的类型声明文件。ZIP 安装包会比之前的 7z 包更大。
- 安装时创建桌面图标和开始菜单入口，重新安装时恢复缺失的快捷方式；App 的“应用”菜单也可重新创建桌面快捷方式。
- 开始菜单的 DeepSeek Harness Station 文件夹增加卸载入口，App 内增加“应用 → 卸载应用…”。Windows“已安装的应用”入口继续保留。
- 卸载只移除程序、快捷方式和卸载登记，保留用户会话、配置和工作区文件。
- 安装测试限制在无已有安装的 CI 账户，验证图标、快捷方式修复、卸载入口和数据保留，并记录安装、重装及卸载耗时。

[直接下载 Windows 安装包](https://github.com/sipingme/deepseek-harness-station/releases/download/v0.26.9-beta.5/DeepSeek-Harness-Station-0.26.9-beta.5-x64-Setup.exe)
