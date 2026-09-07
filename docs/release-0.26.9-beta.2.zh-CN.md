# Station 0.26.9-beta.2

- 内置 Harness 与配套插件由 `0.1.1-rc.2` 升级至 `0.1.2-rc.1`，Cordis 升级至 `4.0.2`。
- 适配上游异步 profile 初始化和浏览器启动认证；Shell–Host 协议升级至 v2，认证地址仅允许当前 generation 的回环来源。
- 保留启动后及每 6 小时检查更新、用户确认后下载安装的流程。
- GitHub API 不可用时，通过公开 Release Atom 订阅源检查版本，并确认安装包和校验文件存在。
- 手动检查更新失败时提供版本下载页入口。

## 发布要求

运行 `corepack pnpm check`、`corepack pnpm dist:win`，并验证旧版用户目录启动及覆盖安装。
可运行 `node scripts/smoke-packaged.mjs "<旧版解包目录>/DeepSeek Harness Station.exe"`，在隔离目录中先启动旧版再启动新版，检查 profile 启动和用户配置保留。该检查不替代实际会话历史迁移或 NSIS 覆盖安装验证。
发布标签必须为 `v0.26.9-beta.2`，与 package.json 一致。GitHub Release 必须公开（不能是 draft），包含：

- `DeepSeek-Harness-Station-0.26.9-beta.2-x64-Setup.exe`
- `SHA256SUMS.txt`，其中包含该安装包的 SHA-256

旧版检查器依赖上述命名；仅推送 main 或上传 Actions artifact 不会通知已安装用户。
`0.26.9-beta.1` 用户联网且 GitHub API 可用时，会在启动约 10 秒后或后续定时检查时收到更新弹窗，也可从托盘或应用菜单选择“检查更新”。新版本的备用检查源无法追溯修复旧客户端的 API 限流问题。

## 用户升级

在提示中确认下载安装，或从 GitHub Release 下载上述安装器并安装到原目录。
安装器保留现有 appId，且不删除用户数据；Harness 继续使用原有 DSH_HOME 和 profile 配置。
升级前退出当前工作会话。自定义插件与上游 profile API 的兼容性需要按实际配置验证。

当前自动下载器选择 Windows x64 安装包。macOS 仍需从对应的构建产物手动安装；本次没有增加 macOS 自动安装。
