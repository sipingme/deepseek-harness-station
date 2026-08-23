# Windows `.exe` 实施路径

本文定义 DeepSeek Harness Station 从开发态 Electron 项目到可安装 Windows x64 `.exe` 的实施顺序。首个目标是可验证的未签名 NSIS 安装包；代码签名和公开发布属于后续阶段。

## 目标与边界

首个发布产物应为 Windows x64 的 NSIS 安装程序，并同时保留未封装的 smoke 目录：

```text
dist/
  DeepSeek-Harness-Station-<version>-x64-Setup.exe
  win-unpacked/
    DeepSeek Harness Station.exe
```

打包工作必须保持以下架构边界：Electron Shell 只负责应用生命周期和 Host 监管；独立 Node Host 负责完整 Harness 运行时。不得通过修改 DeepSeek Harness 的已发布包或复制其他桌面封装项目的源代码实现打包。

## 阶段 1：使运行时可封装

### 1. 将 profile 组合目录移出安装目录

当前 Host 在已安装的 `@deepseek-ai/dsh` profile 目录内写入 `cordis.yml`。封装后该目录可能位于只读 ASAR 文件或受权限控制的安装位置，不能作为运行时写入目标。

改为为每一个 Host generation 在可写位置创建独立工作目录，例如 Electron 的 `userData` 目录下的 `host-profiles/<generation-id>/`。Host 只读取打包内的已发布 DSH profile 与资源；生成的根配置、临时文件和可变状态都写入这个工作目录。Host 停止后应清理该 generation 目录，异常退出则在下次启动时清理过期目录。

验收条件：将应用放入只读目录后，Host 仍能启动、加载 `web` profile 并正常停止；应用安装目录没有新增或修改文件。

### 2. 明确生产运行时闭包

列出并验证启动所需的文件：

- `lib/shell/main.js`、`lib/shell/supervisor.js`、`lib/host/main.js` 与 `lib/protocol.js`；
- `@deepseek-ai/dsh` 的 package manifest、profile 配置和 Web frontend；
- Host 所需的全部 `@deepseek-ai/*` 生产依赖；
- Electron 自带的 Node 运行时，以及 Host 以 `ELECTRON_RUN_AS_NODE=1` 启动时需要的模块；
- 任何原生 Node-API 模块的 Windows x64 预构建二进制。

对每一项区分是否可在 `app.asar` 中读取，还是必须位于 `app.asar.unpacked` 的物理文件树中。依赖物理路径、动态 `require`、子进程启动或 profile 链接的文件必须 unpack。

验收条件：对一个已打包的目录产物，脚本能逐项验证 ASAR 和 unpacked 树中所需文件均存在，且 Node 能从 unpacked 运行时解析 Host 依赖。

### 3. 处理依赖构建批准

pnpm 当前会因未批准依赖构建脚本而中止 `pnpm check`。在仓库配置中记录并批准实际需要的构建脚本；在原生 Windows x64 环境完成一次干净安装，确认所有原生依赖都使用正确 ABI 的二进制。

验收条件：`corepack pnpm check` 在干净的 Windows x64 工作目录中通过，不需要交互式 `pnpm approve-builds`。

## 阶段 2：加入 Windows 打包配置

### 1. 引入 Electron Builder

将 `electron-builder` 固定为开发依赖，并为 package manifest 增加：

- 唯一且稳定的 `appId`；
- `productName`；
- `directories.output` 和 `directories.buildResources`；
- 生产文件白名单；
- `asar: true` 与精确的 `asarUnpack` 清单；
- Windows x64 的 NSIS target、应用图标和版本化 artifact 名称；
- NSIS 的安装范围、可选安装路径、开始菜单与桌面快捷方式设置。

新增 Windows `.ico` 及源图资源，不使用 Electron 的默认图标作为正式产物图标。

### 2. 新增发布命令

至少提供以下脚本：

```sh
corepack pnpm package:dir
corepack pnpm dist:win
corepack pnpm verify:runtime
corepack pnpm verify:win-installer
```

`dist:win` 的顺序必须是：构建、类型检查、Windows 安全的测试集、运行时闭包校验、NSIS 打包、安装器与未封装 `.exe` 校验。打包命令应拒绝非 Windows 或非 x64 的宿主机，避免未经测试的交叉构建被当成发布产物。

验收条件：在原生 Windows x64 上运行 `corepack pnpm dist:win` 后，生成版本化的 `Setup.exe` 和 `win-unpacked` 目录。

## 阶段 3：产物验证

### 1. 包后校验

将 runtime-closure 检查配置为 Electron Builder 的 `afterPack` hook。检查应至少包括：

- `resources/app.asar` 存在且含有 Shell 入口；
- `resources/app.asar.unpacked` 含有 Host 入口、DSH profile 资源和所有必须的物理依赖；
- Windows 原生模块的 x64 预构建二进制存在；
- 预期的 installer 与 `win-unpacked` 主程序均为有效 PE 文件；
- 产物不包含开发源码、测试、无关构建缓存或平台错误的原生二进制。

### 2. 启动 smoke

在 `win-unpacked` 目录运行应用，验证：

1. Shell 创建单实例锁并启动独立 Host；
2. Host 完成 `web` profile 启动并返回回环地址；
3. Renderer 仅加载该回环来源；
4. 关闭应用后 Host 及其子进程树退出；
5. 第二次启动不会残留旧 generation，也不会依赖开发工作目录。

### 3. 安装与卸载 smoke

在 Windows 测试机上执行安装器，验证当前用户安装、可选提升权限安装、开始菜单/桌面快捷方式、首次启动、升级安装和卸载。卸载必须保留用户 DSH 数据，除非用户明确选择清除。

## 阶段 4：发布准备

在未签名 installer 验证稳定后，再进行以下工作：

- 生成并随包分发第三方许可证与 notices；
- 配置 Authenticode 证书并在 CI 或受控发布机签名；
- 验证签名链、发布者名称与 Windows SmartScreen 行为；
- 建立原生 Windows x64 CI：安装依赖、运行 `check`、构建 installer、运行包后验证并上传工件；
- 制定版本号、发布说明、回滚和更新策略。

未签名 `.exe` 可以用于内部验证，但不应当被描述为面向普通用户的正式发布版本。

## 建议实施顺序

1. 改造 Host 的 profile 工作目录，消除对安装目录写入的依赖。
2. 固化 pnpm 原生依赖构建批准并通过完整 `check`。
3. 加入 Electron Builder、图标与 `package:dir`，实现可检查的 directory 产物。
4. 编写 runtime-closure 与 `afterPack` 验证。
5. 实现 `dist:win`、NSIS 配置和 PE 文件验证。
6. 在原生 Windows x64 上完成启动、安装和卸载 smoke。
7. 最后加入许可证、签名、CI 与公开发布流程。
