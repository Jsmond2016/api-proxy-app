# GitHub 自动发布与 macOS 打包技术方案

## 1. 文档信息

| 项目 | 内容 |
| --- | --- |
| 状态 | 已实施，待首次远端发布验证 |
| 目标仓库 | `Jsmond2016/api-proxy-app` |
| 当前版本 | `0.1.59` |
| 发布触发 | 向 `main` 推送已同步的版本号记录，或手动推送已校验的 `vX.Y.Z` 标签 |
| 首期交付 | 稳定版与预览版的 macOS Apple Silicon DMG、SHA-256 校验文件、GitHub Release 变更记录与 Assets 下载链接 |

## 2. 目标

开发者在版本提交中同步更新以下四处版本号并推送到 `main`：

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`

GitHub Actions 随后自动完成：

1. 校验四处版本号一致，且相对发布前版本递增。
2. 在远端创建不可变标签 `vX.Y.Z`。
3. 构建并校验 macOS Apple Silicon DMG。
4. 依据本次版本与上一标签间的提交，写入 GitHub Release 变更记录。
5. 上传 DMG 与 SHA-256 文件到该 Release 的 Assets，并在 Release 正文展示两者的直链。

GitHub Release 是用户查看变更和下载安装包的唯一入口。默认只发布稳定版本 `X.Y.Z`；开发者可通过本地快捷命令准备 `X.Y.Z-beta.N`、`X.Y.Z-rc.N` 等预览版本并选择手动打标签。首期不发布 Intel macOS、Windows、Linux，也不实施应用内自动更新。

## 3. 现状与约束

项目已具备本地 macOS 打包能力：`pnpm package:mac` 会构建 Tauri 应用并生成 DMG。版本号由四处文件共同维护，当前没有 GitHub Actions 工作流。

参考项目 `quick-copy-ext` 将 CI 与自动 Release 分离。本项目沿用这种职责划分，但发布触发条件改为“推送版本号记录”，而不是提交信息匹配或手动推送标签。这能让版本文件成为单一、可审查的发布意图来源。

当前 Tauri 配置的 `signingIdentity: "-"` 为 ad-hoc 签名。它可以用于验证自动打包和下载流程，但不能替代 Apple Developer ID 签名与公证；首期下载包可能需要用户在 macOS 安全设置中手动允许打开。

## 4. 发布流程

```text
功能 PR
  -> CI：构建、源码与隐私检查、Rust 测试、文档构建
  -> 合并 main
  -> 版本提交：同步四处版本号
  -> push main
  -> Release workflow：比对版本、自动创建 vX.Y.Z tag
  -> Apple Silicon macOS 构建与 DMG 校验
  -> 自动生成变更记录、创建 GitHub Release
  -> 上传 DMG + .sha256 至 Release Assets
  -> 用户从 Release 页面查看变更并下载
```

普通功能提交不会发版：工作流检测到 `package.json` 的版本未变化时成功退出。稳定版本的版本提交由工作流自动创建标签；预览版本既可由工作流自动创建标签，也允许开发者手动推送匹配标签。版本不一致、版本倒退、目标标签指向错误提交或打包失败时，工作流失败且不会创建新的公开 Release。

### 发布产物命名

| 项目 | 规范 |
| --- | --- |
| Git 标签 | `vX.Y.Z`，例如 `v0.1.60` |
| 预览标签 | `vX.Y.Z-beta.N` 或 `vX.Y.Z-rc.N`，例如 `v0.2.0-beta.1` |
| Release 标题 | `Apifox Proxy vX.Y.Z` |
| macOS DMG | `Apifox-Proxy_X.Y.Z_aarch64.dmg` |
| 校验文件 | `Apifox-Proxy_X.Y.Z_aarch64.dmg.sha256` |
| 下载直链 | `https://github.com/<owner>/<repo>/releases/download/vX.Y.Z/<文件名>` |

首期只使用 Apple Silicon runner，产物仅适用于 Apple Silicon Mac。

### 预览版本与手动标签

为满足开发者手动管理版本的需求，新增两类本地命令：

| 命令 | 行为 | 是否修改 Git 历史 |
| --- | --- | --- |
| `pnpm version:preview beta` | 将四处版本号更新到下一个 `beta` 版本，例如 `0.2.0-beta.1`，并输出预期标签。 | 否 |
| `pnpm version:preview rc` | 将四处版本号更新到下一个 `rc` 版本。 | 否 |
| `pnpm version:tag` | 校验当前 `HEAD` 的四处版本号后，创建本地带注释标签 `v<version>`。 | 仅创建本地 tag |

正确顺序是：运行 `version:preview`，审查并提交四处版本文件，再执行 `version:tag`，最后推送提交和标签。标签必须指向包含相同版本号的提交，不能在修改版本前预先创建。

工作流同时接受两种预览发布入口：

1. 开发者只推送预览版本提交到 `main`：工作流自动创建匹配的预览标签和 prerelease Release。
2. 开发者推送预览版本提交及本地创建的匹配标签：标签触发工作流，校验通过后创建 prerelease Release。

稳定版本沿用相同机制，但默认由 `main` 的版本提交自动创建标签；手动标签仅作为受控的补发或人工版本管理入口。

## 5. GitHub 仓库配置

### 5.1 必须配置

1. 确认 `main` 为默认分支，版本记录经 PR 审核后合并。
2. 在 Settings > Actions > General 启用 Actions，并允许工作流读写仓库内容；工作流自身仍显式声明最小权限。
3. 为 `main` 设置分支保护：要求 PR 和 CI 成功，禁止 force push，并限制直接推送。
4. 将仓库设为公开，确保普通用户可访问 Release Assets 下载链接；私有仓库仅授权用户可下载。
5. 创建 `release` Environment，建议只允许 `main` 触发，并按团队要求设置发布审批。

### 5.2 权限与机密信息

首期创建标签、Release 和上传 Assets 只需要 Actions 自带的 `GITHUB_TOKEN`。`release.yml` 显式申请：

```yaml
permissions:
  contents: write
```

日常 CI 只保留 `contents: read`，并且不读取任何发布或 Apple 凭据。来自 fork 的 PR 不能获得发布权限。

当前没有 Apple Developer Program 账号和证书，首期采用 ad-hoc 签名，不配置 Apple secrets。后续升级生产分发时，再在 `release` Environment 配置 Apple Developer ID 和公证凭据；证书、私钥、公司邮箱、内部接口地址均不得写入仓库、Assets、Release 正文或工作流日志。

## 6. 工作流设计

### 6.1 `.github/workflows/ci.yml`

**触发：** `pull_request`、推送至 `main`、手动触发。

**职责：** 在发布前验证应用质量，但不创建标签、Release 或 Assets。

1. 使用 Node 22、pnpm 10、Rust stable。
2. 执行 `pnpm install --frozen-lockfile`、`pnpm build`、`pnpm run check:source`、`pnpm docs:build`。
3. 执行 `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` 和 `cargo test --manifest-path src-tauri/Cargo.toml`。

### 6.2 `.github/workflows/release.yml`

**触发：** `push` 到 `main`、推送 `v*` 标签，以及用于故障恢复的 `workflow_dispatch`。同一工作流支持自动标签和开发者手动标签：

1. `main` push 时，读取本次提交和其父提交的 `package.json` 版本；版本未变时安全退出。
2. `main` 版本变化时，校验当前版本为稳定版本 `X.Y.Z` 或允许的预览版本 `X.Y.Z-beta.N` / `X.Y.Z-rc.N`，并校验四处版本号一致。
3. `main` 版本变化且目标标签不存在时，自动创建 `v<version>` 标签；若标签已存在，必须指向当前提交，否则失败。
4. `v*` tag push 时，checkout 标签源码，校验标签名等于 `v<version>`、标签提交已包含在 `main`、四处版本号一致。
5. 读取最新稳定版或同一预览序列的标签，拒绝版本倒退；已存在同标签 Release 时以幂等方式退出，避免重复上传 Assets。

**并发与权限：**

```yaml
permissions:
  contents: write
concurrency:
  group: release-${{ needs.prepare.outputs.tag }}
  cancel-in-progress: false
```

工作流先通过 `prepare` job 解析最终标签，再以标签为粒度串行发布，避免自动标签和手动标签的两个事件重复创建同一个 Release。`cancel-in-progress: false` 确保版本提交连续推送时，较早的发布不会被中途取消。分支保护应避免在前一个版本尚未发布完成时再合并下一个版本提交。

**单架构发布步骤：**

1. 在 `macos-14` Apple Silicon runner checkout `main` 的版本提交。
2. 重新执行必要的依赖安装、构建和版本一致性校验。
3. 执行 `pnpm package:mac`，保留项目已有的自定义 DMG 制作逻辑。
4. 将产物规范化为 `Apifox-Proxy_X.Y.Z_aarch64.dmg`，执行 `hdiutil verify`。
5. 执行 `shasum -a 256`，生成同名 `.sha256` 文件。
6. 对 `main` 版本提交，使用 GitHub API 在当前提交创建带注释的 `vX.Y.Z` 标签；对手动标签，仅验证其指向。任一校验失败即终止，避免 Release 指向错误源码。
7. 根据“上一发布标签..当前标签”的提交自动生成变更记录；使用 GitHub generated release notes 生成提交归类、贡献者和比较链接。
8. 创建 `Apifox Proxy vX.Y.Z` Release，并上传 DMG 与 `.sha256` 为 Assets；预览版本同时标记为 `prerelease`。
9. 在 Release 正文追加支持范围、SHA-256 校验命令和两个固定格式的下载直链。

建议使用 `gh release create` 完成第 6-9 步，便于在脚本中精确控制标签、正文与 Assets。正文由工作流生成并保存为临时文件，避免 shell 引号或提交内容造成格式问题。

Release 正文示例：

```markdown
## 变更记录

<GitHub 自动生成的本版本提交摘要>

## 下载

- [macOS Apple Silicon DMG](https://github.com/<owner>/<repo>/releases/download/vX.Y.Z/Apifox-Proxy_X.Y.Z_aarch64.dmg)
- [SHA-256 校验文件](https://github.com/<owner>/<repo>/releases/download/vX.Y.Z/Apifox-Proxy_X.Y.Z_aarch64.dmg.sha256)

仅支持 Apple Silicon Mac。下载后可执行：`shasum -a 256 -c Apifox-Proxy_X.Y.Z_aarch64.dmg.sha256`。
```

Release 创建后，Assets 直链按 GitHub 的固定下载地址可用，无需自建对象存储或额外域名配置。

## 7. 需要新增或调整的仓库文件

| 文件 | 变更 |
| --- | --- |
| `.github/workflows/ci.yml` | PR 与 `main` 的质量检查。 |
| `.github/workflows/release.yml` | 版本检测、自动标签、macOS 打包、生成 Release 变更记录和上传 Assets。 |
| `scripts/verify-release-version.mjs` | 比对四处版本，验证 SemVer、版本递增和标签可创建性。 |
| `scripts/version.mjs` | 提供稳定版、`beta`、`rc` 版本号更新，以及只对已提交版本创建本地 tag 的快捷命令。 |
| `scripts/package-mac.mjs` | 保留主流程；补充可指定目标架构和标准产物路径的参数，供 CI 使用。 |
| `README.md` | 增加最新 Release 下载入口、Apple Silicon 支持说明、安装提示和校验命令。 |

`CHANGELOG.md` 不作为首期发布前置条件。GitHub Release 正文即版本变更记录，能同时满足在线查看、API 获取和与 Assets 同页展示；后续若确实需要仓库内变更日志，再由版本 PR 人工维护，工作流只校验该版本段存在而不自动提交。

## 8. 签名与公证策略

| 阶段 | 签名方式 | 用户体验 | 准入条件 |
| --- | --- | --- |
| Phase 1 | ad-hoc (`-`) | 可下载，首次打开可能需在系统设置中放行。 | 当前采用；无 Apple 凭据，用于验证自动发布链路。 |
| Phase 2 | Developer ID Application | 显示发布者身份。 | 已在 `release` Environment 配置证书。 |
| Phase 3 | Developer ID + notarization + stapling | 通常可直接安装。 | 已配置公证凭据并通过真实安装验收。 |

Tauri 的 App Store 外 macOS 分发应采用 Developer ID 签名与公证。首期 ad-hoc 包不能视为生产级信任链路。[Tauri macOS 签名与公证文档](https://v2.tauri.app/distribute/sign/macos/)

## 9. 验收标准

1. 推送普通功能提交到 `main` 时，Release 工作流成功退出，不产生标签或 Release。
2. 推送稳定或预览版本记录到 `main` 时，远端自动产生对应 `v<version>` 标签和同名 Release。
3. 标签指向版本提交，四处版本号、Release 标题和 Assets 文件名完全一致。
4. Release 正文包含本版本的自动变更记录、DMG 直链、`.sha256` 直链和 Apple Silicon 支持说明。
5. Release Assets 仅包含 `Apifox-Proxy_<version>_aarch64.dmg` 与其 `.sha256` 文件；预览版 Release 显示 prerelease 状态。
6. `hdiutil verify` 通过；下载后执行 `shasum -a 256 -c` 通过。
7. CI 与 Release 日志、Release 正文、README 和 Assets 不包含 Token、私钥、内部接口 URL、内部域名或公司敏感信息。
8. 打包或 Release 失败时不生成公开 Release；已创建标签但发布失败时保留失败状态供排查，修复后通过受控的手动重跑继续发布，不改写既有标签。

## 10. 实施顺序

1. 完成 GitHub 仓库可见性、Actions 写权限、`main` 分支保护和 `release` Environment 配置。
2. 新增 CI、版本一致性检查及 PR 验证。
3. 实现 `version:preview` 与 `version:tag` 快捷命令，并以 `beta` 版本验证手动标签和自动标签两条发布入口。
4. 新增 `main` 版本变化触发的 Release workflow，先以一个新的预览版本验证自动标签、DMG 和 Assets 下载。
5. 补充 README 下载说明，确认 Release 正文中的下载链接和校验命令可用。
6. 获得 Apple Developer Program 资格后，配置 Developer ID 签名和公证，将 Phase 1 过渡包升级为生产分发包。

## 11. 待确认事项

1. 首期无 Apple Developer Program 账号和证书，采用 Phase 1 ad-hoc 包作为过渡。
2. 仓库将由维护者手动设为公开，确保用户可以下载 Release Assets。
3. 默认发布稳定版本；支持 `beta`、`rc` 预览版本，且允许开发者按约束手动创建和推送对应标签。
