# Apifox Proxy 代码清理方案

## 文档目的

本方案针对当前 `0.1.24` 代码库进行遗留代码审计和分阶段清理。目标是降低维护成本、消除已废弃能力的误导、缩小桌面端命令面，并在不改变微信开发者工具代理、Apifox Mock、HTTP/HTTPS 转发和现有配置兼容性的前提下完成整理。

本轮仅输出方案，不直接删除代码。所有删除动作都必须单独提交、可回滚，并在每个阶段完成构建和代理回归。

## 本轮执行范围

用户已确认开始执行。本轮先实施阶段一和阶段二：清理脚手架资源、同步当前 README/历史文档标识、删除前端未使用代理生命周期封装，并仅删除经过引用扫描确认无效的 CSS。阶段三的 Local 兼容迁移和阶段四的 Tauri command 收敛暂不实施，待迁移策略与外部调用边界单独确认。

## 审计基线

| 项目 | 当前结果 |
| --- | --- |
| 分支/版本 | `main` / `0.1.25` |
| 最新提交 | `6199f57 docs: 更新最终需求与技术方案文档` |
| 前端 | React + TypeScript + Ant Design 6 + Vite |
| 桌面端 | Tauri 2 + Rust + hudsucker |
| 代理边界 | loopback `127.0.0.1:<port>`，启动默认透传，全局 Mock 开关控制拦截 |
| 主要验证命令 | `pnpm build`、`pnpm run check:source`、`cargo check --manifest-path src-tauri/Cargo.toml`、`cargo test --manifest-path src-tauri/Cargo.toml` |

## 发现总览

| 编号 | 遗留项 | 证据 | 建议级别 |
| --- | --- | --- | --- |
| C1 | 前端保留未使用的 `startProxy`/`stopProxy` API 封装 | `src/lib/desktop.ts` 导出；当前 UI 不调用，代理由启动和 Profile 生命周期自动管理 | 高 |
| C2 | 在线模式已成为唯一 UI 能力，但 Local 契约仍贯穿前后端 | `ApifoxMode = "online" | "local"`、`localOpenapiUrl`、Rust `ApifoxMode::Local` 和本地 URL 请求分支仍存在 | 中，高兼容风险 |
| C3 | 旧代理启停 command 仍注册给前端 | `commands.rs`、`lib.rs` 注册 `start_proxy`/`stop_proxy`；内部 `ensure_proxy_running` 仍需要底层函数，不能直接整体删除 | 中 |
| C4 | 脚手架资源未使用 | `public/vite.svg` 被 `index.html` favicon 引用，`public/tauri.svg`、`src/assets/react.svg` 未被业务代码引用 | 低 |
| C5 | CSS 混有历史选择器和重复布局规则 | `src/App.css` 约 1280 行，包含 `.project-list`、`.project-item`、`.sidebar-*`、`.sync-mode`、`.match-mode` 等需逐项核对的旧样式 | 中 |
| C6 | 旧文档组仍描述早期分支和 Keychain/Local/手动启停 | `specs/tauri-desktop-app/` 下需求、方案、使用文档与当前 `specs/需求-main/` 不一致 | 中，文档风险 |
| C7 | README 与最终行为存在版本和能力残留 | 仍写 Local OpenAPI、Merge/Replace、旧的 `0.1.11` 产物路径 | 中，交付风险 |
| C8 | Rust 数据结构保留兼容字段，缺少迁移退出标准 | `local_openapi_url`、旧 `active_tags` 等字段需要区分“继续兼容读取”和“可删除” | 中 |
| C9 | 测试与生产代码同文件，测试辅助函数体量较大 | `apifox.rs`、`proxy/mod.rs` 含大量 `#[cfg(test)]` 代码；当前可维护但增加阅读和编译范围 | 低，暂不优先 |
| C10 | 命令/API 命名存在历史别名风险 | `get_snapshot`、`start_proxy`、`stop_proxy` 与“自动监听”最终语义并存 | 低到中 |

## 清理原则

1. 先确认引用关系，再删除文件或字段；不得根据文件名猜测无用代码。
2. 兼容字段先进入迁移观测期，至少覆盖一个可发布版本后再删除。
3. 代理核心代码优先保持行为不变，任何 Rust 代理修改都必须通过 HTTP、HTTPS、透传、Mock Token 和全局开关回归。
4. 历史文档不直接抹除。旧文档应标记为“历史归档”或重定向到 `specs/需求-main/`，避免破坏审计链。
5. 每个清理阶段单独提交，提交信息使用中文，便于回滚和定位回归。

## 分阶段方案

### 阶段一：低风险资源与文档整理

处理 `public/tauri.svg`、`src/assets/react.svg` 等未引用脚手架资源；确认 `index.html` 是否需要保留 `public/vite.svg` favicon，若不需要则改为应用品牌资源或移除引用。同步 README 的版本、在线模式、Replace 同步、自动监听和当前 DMG 路径说明。

对 `specs/tauri-desktop-app/` 三份文档增加“历史归档，当前以 `specs/需求-main/` 为准”标识；不删除历史内容。完成后只应影响静态资源和 Markdown。

验收：`pnpm build`、`git diff --check`；检查构建产物不再引用被删除资源。

### 阶段二：前端死 API 与样式清理

删除 `src/lib/desktop.ts` 中没有调用方的 `startProxy`、`stopProxy` 导出，并用 `rg` 确认不存在前端引用。对 `src/App.css` 按组件逐段核对，删除确认无 DOM 使用的旧选择器；优先处理 `.project-list`、`.project-item`、`.sidebar-*`、`.sync-mode` 等历史布局，保留当前 Tabs、Modal、Table、请求日志和证书弹框样式。

不在本阶段修改 Rust command，避免把内部生命周期函数和对外 command 混为一谈。

验收：`pnpm build`、`pnpm run check:source`，并人工检查桌面宽视口、窄视口、弹框滚动、表格空状态和长 URL 换行。

### 阶段三：Local 模式收敛与配置迁移

先确认发布策略：若不再承诺读取 Local OpenAPI，则新增 schema migration，将旧 Local 配置转换为在线配置的空连接状态并给出一次性提示；随后删除前端 `ApifoxMode` 联合类型中的 `local`、`localOpenapiUrl` 表单字段和 Rust `ApifoxMode::Local` 请求分支。若仍需兼容旧用户，则保留 Rust 反序列化兼容层，但禁止新配置写出 Local 字段，并设置明确的移除版本。

该阶段必须覆盖真实用户升级路径，不能直接删字段导致已有配置无法加载。`active_tags` 同理：继续兼容读取但运行时忽略，待 schema 升级窗口结束后再移除。

验收：旧配置 fixture 迁移测试、在线 Apifox 契约测试、Token/Mock Token 回显测试、`cargo test`、前端构建。

### 阶段四：Tauri 命令面收敛

区分“内部代理生命周期函数”和“注册给前端的 command”。确认 `start_proxy`、`stop_proxy` 没有外部调用后，从 `tauri::generate_handler!` 和前端类型封装中移除公开 command；保留 `ensure_proxy_running`、`stop_proxy` 内部实现，或重命名为不易误解的内部函数。

同步检查 `get_snapshot`、诊断和证书命令的调用方，删除没有前端入口且没有测试/内部调用的 command。命令删除必须配套编译失败驱动的全仓引用检查，避免运行时才发现 invoke 名称不一致。

验收：`cargo check`、`cargo test`、`pnpm build`，并验证应用启动自动监听、切换项目重启监听、关闭 Mock 全量透传和关闭应用提醒仍有效。

### 阶段五：结构性重构（可选）

只有在前四阶段稳定后，才考虑将 `apifox.rs`、`proxy/mod.rs` 中的大型测试模块拆到 `tests/` 或独立模块，并将 URL、匹配、日志脱敏等纯函数抽到更小的 Rust 模块。该阶段不以“减少行数”为目标，只有在测试隔离、编译时间或职责边界确实改善时才实施。

## 不建议当前删除的内容

- `active_tags` 等旧配置字段：当前仍承担向后兼容责任，不能只因 UI 已移除就立即删除。
- `ApifoxMode::Local` Rust 解析分支：在完成迁移策略和旧配置测试前保留。
- `proxy::start_proxy`/`stop_proxy` 内部实现：自动监听生命周期仍依赖它们；待 command 与内部函数解耦后再决定是否重命名。
- `DiagnosticPanel`、`CertificatePanel`、`ConnectionGuide`：虽然不是高频入口，但仍属于真实接入、HTTPS 和故障诊断流程。
- `src-tauri/target`：构建缓存不纳入 Git 清理；如需释放磁盘空间应使用 Cargo 清理命令并单独确认，不修改源码仓库。

## 最终验收清单

- `rg` 无前端 `startProxy`/`stopProxy` 死导出，无删除资源引用。
- 新配置和升级旧配置均能启动；在线 Apifox 验证、Tag 同步和 Mock Token 继续可用。
- 全局 Mock 关闭时所有 HTTP/HTTPS 请求透传，打开后仅命中启用接口。
- HTTP、HTTPS CONNECT、动态路径、Query 合并、请求日志和关闭提醒回归通过。
- `pnpm build`、`pnpm run check:source`、`cargo check`、`cargo test`、`cargo fmt --check` 和 `git diff --check` 通过。
- 文档仅保留一个当前权威需求/技术方案入口，历史文档明确归档，不再误导新开发者。

## 建议提交拆分

1. `chore: 清理未使用脚手架资源并同步项目文档`
2. `chore: 删除前端未使用代理生命周期封装`
3. `refactor: 收敛在线 Apifox 配置兼容字段`
4. `refactor: 收敛 Tauri 代理命令注册面`
5. `refactor: 拆分代理模块测试与纯函数（可选）`

## 实施记录

| 日期 | 阶段 | 实际变更 | 验证结果 |
| --- | --- | --- | --- |
| 2026-08-28 | 阶段一 | 移除未使用 `public/tauri.svg`、`public/vite.svg`、`src/assets/react.svg`；移除 Vite favicon，更新 HTML 标题；README 改为在线 Apifox、Replace 和通用版本产物说明；旧 `specs/tauri-desktop-app/` 三份文档增加历史归档提示 | `pnpm build` 通过；构建产物不再引用 Vite favicon |
| 2026-08-28 | 阶段二 | 删除 `src/lib/desktop.ts` 未使用的 `startProxy`/`stopProxy` 导出；删除 `App.css` 中无 JSX 引用的旧 project/sidebar、brand 辅助、sync-mode、match-mode 样式；补充关闭确认和安装型 DMG 打包维护 | `pnpm build`、`pnpm run check:source`、`git diff --check` 通过；`pnpm package:mac` 在授权环境下通过 |
