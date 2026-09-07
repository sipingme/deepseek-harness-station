# Station 0.26.9-beta.7

- 安装器直接解压到安装目录，减少临时解压后再次复制的文件写入，移除 1,200 个不需要的类型声明文件。安装包约 157 MiB，比此前的 7z 安装包更大。
- 安装后创建桌面图标和开始菜单入口，重装可恢复已删除的图标；App 内也可通过“应用 → 创建桌面快捷方式”修复。
- 开始菜单的 Station 文件夹增加“卸载 Uninstall”入口，App 内增加“应用 → 卸载应用…”，同时保留 Windows“已安装的应用”入口。
- 卸载移除程序和快捷方式，保留会话、配置和工作区文件。
- 安装测试使用同一成品、同一安装脚本与独立的应用 GUID、程序名、注册信息和快捷方式，避免影响已安装的正式版；测试覆盖安装、图标恢复、卸载清理和用户数据保留。

[直接下载 Windows 安装包](https://github.com/sipingme/deepseek-harness-station/releases/download/v0.26.9-beta.7/DeepSeek-Harness-Station-0.26.9-beta.7-x64-Setup.exe)
