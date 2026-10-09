# 应用内更新与版本发布

## 用户操作

在“连接与设置 → 软件更新”或菜单“帮助 → 检查更新…”打开更新窗口。检查后显示当前/新版本、更新说明；点击“下载更新”，查看进度，完成后点击“重启并安装”。也可以稍后再安装；关闭窗口会继续下载，普通退出不会自动安装。

安装时若还在检查课程、下载课件、导出文件或核对下载记录，会提示等待，避免中断正在进行的工作。更新模块不删除学校登录、账号设置、课程索引或课件。应用 ID 和 userData 位置保持不变，NSIS 继续保留应用数据。

- Windows NSIS 安装版：支持下载后重启安装。安装程序保留原有向导，必要时由操作系统提示权限。
- Windows 便携版：支持检查，提供新版下载页入口；用户替换便携 EXE。不会将便携版悄悄改为安装版。
- macOS：配置源后可使用原生更新流程，正式分发必须签名，并提供 DMG + ZIP 和 latest-mac.yml。
- Linux AppImage：配置源后使用 AppImage 更新；本项目 DEB 及非 AppImage 包提供下载页入口，便于按系统包管理方式更新。
- Chrome 扩展：保持原更新方式，隐藏桌面更新设置。

平台规则及安装目标依据 [electron-builder 26 官方更新文档](https://www.electron.build/v26/docs/features/auto-update/)。此轮已完成 Windows 界面/流程测试，未在用户系统执行真实版本覆盖安装，也尚未对真实发布源进行升级验收。

## 当前交付状态

桌面版本为 0.3.2，`desktop/update-source.json` 与 `package.json` 的 build.publish 已固定为 GitHub `siyou-622/BBReader`。更新查询来自本 Fork 的公开 Releases，与原作者的版本发布独立。

已拿到的旧 0.3.1 包没有更新入口，需要先手动安装一次本 Fork 的 0.3.2；之后发布更高版本即可使用窗口更新。真实跨版本覆盖安装仍需在隔离机器验收，不将模拟安装测试描述为真实升级成功。

## 发布者配置（只需首次配置，用户无需填写）

使用你有发布权限的公开 GitHub 仓库，例如：

```sh
node scripts/configure-updates.mjs --github siyou-622/BBReader
```

或自己的 HTTPS 文件服务器：

```sh
node scripts/configure-updates.mjs --url https://YOUR_SERVER/updates/ https://YOUR_SERVER/downloads/
```

替换示例中的账户、仓库或域名。脚本同时设置桌面可见源和 electron-builder publish 配置，重新打包后生效，不执行上传、不创建 Release。禁用：`node scripts/configure-updates.mjs --disable`。

更新源只允许固定的 GitHub owner/repo 或 HTTPS；拒绝包含账号/密码、查询参数的更新目录。更新调用不接受页面传入地址、安装包路径或命令，说明按文本显示。不要将发布令牌、私有凭据写入应用或更新源文件；大众分发使用公开安装包或无需用户令牌的 HTTPS 服务。

## 每次发布

1. 提升 `package.json` 和 `extension/manifest.json` 的版本，保持一致，同时刷新锁文件。版本需高于已发布版本；不允许降级。
2. 配置源后运行原 `npm run desktop:dist`，默认 `--publish never`，只产生本地包。electron-builder 自动写入 resources/app-update.yml，并生成对应平台的 latest*.yml。应用使用此构建配置，无运行时任意改源入口。
3. 发布同一构建的完整资产：Windows 安装版 EXE 与 latest.yml、块映射；Mac DMG、ZIP 与 latest-mac.yml；Linux AppImage 与 latest-linux.yml，以及生成的块映射。便携版和 DEB 可作为额外手动下载包。
4. GitHub 使用标准 `v0.3.2` / `v0.3.3` 形式的标签创建正式 Release，先上传完整资产再发布，附更新说明；generic 服务先上传包，再上传 latest*.yml，避免用户读到尚未上传的安装包。必须发布完整校验信息，不手写或省略清单中的 SHA-512。历史 `desktop-v*` 标签仍可触发构建，但公开自动更新 Release 使用标准 `v*` 标签。
5. 在已安装旧版本的测试机器中验证：检查、下载、安装、重启版本、登录/课程配置和已下载课件保留。验证失败回退不应通过降级覆盖用户数据。

三平台 CI 会保存安装包、latest*.yml 和块映射为构建产物；没有新增自动公开发布行为。正式 Windows 分发建议配置代码签名；macOS 更新必须签名。当前构建没有签名证书，未验证 macOS/Linux 实机更新。

## 新依赖、配置与替代方式

新增运行依赖 `electron-updater` 6.8.9，随安装包提供，用户不需要安装 Node 或额外程序。它处理版本、下载、校验和及平台安装；生产依赖漏洞审计本轮为 0。本项目不绕过校验失败或签名验证，也不预下载/自动安装。

更新源文件和 build.publish 仅用于发布版本查询，与学校登录会话、附件下载路径和索引分离。无需学校额外权限；网络不通可以继续使用旧版本，并重试更新。无更新源或不适用自动安装的包，可按原方式下载新安装包手动升级。

测试：`node --test tests/*.test.js`；运行 `npm run desktop:smoke`。已配置源时自动使用模拟更新器，也可显式设置 `BBREADER_SMOKE_UPDATES=1`；模拟器只记录安装调用，完全不执行安装或访问真实发布服务。禁用发布源且未设置该变量时验证无源提示。真实安装覆盖需要隔离测试环境。
