# Tauri Desktop App 开发方案文档

> 历史归档文档。当前 `main` 分支以 `specs/需求-main/main-技术方案文档.md` 为唯一权威技术方案来源。

## 开发分支
`feature/tauri-desktop-app`

## 方案概览

应用采用 Tauri 2：React/TypeScript 前端提供紧凑的联调工作台；Rust 后端承担配置、Apifox 拉取、证书管理和本地代理。最终代理仅监听 `127.0.0.1:8899`。微信开发者工具通过显式代理或系统代理接入，HTTPS 场景使用本地根证书完成 TLS 终止和规则重写。

当前实现切片先完成 Tauri 工程、工作台、前后端状态命令和工程约束检查。真实网络监听、证书、OpenAPI 和持久化在下一切片实现。

## 需求-方案映射

| 需求 ID | 开发方案 | 影响范围 | 验证方式 | 状态 |
| ------- | -------- | -------- | -------- | ---- |
| R1 | Tauri 2、Vite、React、TypeScript 工程；配置 macOS 窗口 | 根目录、`src/`、`src-tauri/` | `pnpm build`、`cargo check`、`pnpm tauri dev` | 已验证 |
| R2 | 定义 ProjectProfile、ApifoxConfig、ProxyRule；追加应用数据目录 JSON 存储 | 前端数据层、Rust 配置命令 | 配置跨 AppState 重载保留 | 部分实现 |
| R3 | Rust 使用 reqwest 拉取本地或在线 OpenAPI，解析 paths/tags | `src-tauri/src/apifox.rs` | OpenAPI fixture 导入 | 部分实现 |
| R4 | 规则表展示、启停命令；后续追加增删改和导入转换 | `src/components/RuleTable.tsx`、Rust commands | OpenAPI 转换为规则、规则启停 | 部分实现 |
| R5 | Rust 管理代理任务、端口检测、启动/停止 | `src-tauri/src/proxy/` | 端口监听与释放 | 已实现，待端到端验证 |
| R6 | 基于 `hudsucker` 处理 CONNECT、动态证书和本地 CA | 代理、证书服务 | `curl -x` 信任 CA 后访问 HTTPS | 部分实现，待信任验证 |
| R7 | 工作台展示代理地址、状态和证书入口，不自动修改系统网络设置 | `ProxyHeader`、`CertificatePanel` | 可复制地址，状态与 Rust 同步 | 部分实现 |
| R8 | RuleMatcher 处理 method 与三种路径匹配；转发时保留 method/path/query/body/必要头 | `src-tauri/src/proxy/` | 单元测试覆盖匹配和 URI 重写 | 已实现，待端到端验证 |
| R9 | 日志面板与 Mock 筛选；后续由 Tauri event 推送环形日志 | `RequestLogPanel`、代理事件 | 演示日志可见和筛选 | 部分实现 |
| R10 | JSON 配置和 `keyring` Keychain 凭据服务，日志头脱敏 | 配置、凭据服务 | Token 不出现在日志与导出 | 待开发 |
| R11 | 导入参考项目 ModuleConfig/ApiConfig 子集，导出无凭据配置 | 导入导出服务 | 导入 `example-config.json` | 待开发 |
| R12 | AST 检查三元表达式并检查源文件行数；按功能拆分模块 | `scripts/check-source-limits.mjs` | `pnpm check:source` | 已验证 |

## 技术决策

- 使用 Tauri 2 + React 19 + Vite + lucide-react，工作台采用高密度、工程化的操作布局。
- Rust 状态使用 `Mutex<DesktopSnapshot>` 统一服务 Tauri commands；持久化会替换为应用数据目录配置服务。
- 真实 HTTPS MITM 不自行实现，使用成熟的 `hudsucker` 库；仅监听 loopback。
- Apifox Token 计划使用 macOS Keychain 保存，普通配置与导出文件均不保存 Token。
- 编码约束通过 TypeScript AST 扫描，避免以正则误判可选链和 TypeScript 类型。
- 配置持久化使用应用数据目录内的原子 JSON 写入；同步请求仅在内存中携带 Apifox 访问令牌，当前阶段不写入配置或日志。
- OpenAPI 导入先支持标准 `paths` 结构和 Tag 筛选，将 HTTP 方法转换为 `ProxyRule`；在线 Apifox 项目导出在调用方提供完整导出 URL 后复用同一解析器。
- 代理阶段固定使用 `hudsucker 0.25` 的 Rustls 与 rcgen CA 实现；根证书只写入应用数据目录，系统信任动作保持显式且不自动执行。

## 实施记录

| 日期 | 代码或方案变更 | 关联需求 | 影响 |
| ---- | -------------- | -------- | ---- |
| 2026-08-08 | 创建并确认需求与技术方案 | R1-R12 | 进入实现阶段 |
| 2026-08-08 | 初始化 Tauri React 工程和 macOS 窗口配置 | R1 | 建立可编译桌面应用骨架 |
| 2026-08-08 | 创建项目侧栏、代理状态、证书、规则和日志工作台组件 | R4、R7、R9 | 形成可交互 UI 垂直切片 |
| 2026-08-08 | 创建 Rust DesktopSnapshot 状态与 Tauri commands | R4、R5、R7 | 前端可调用原生状态命令 |
| 2026-08-08 | 添加文件规模与三元表达式检查脚本 | R12 | 自动执行编码规则 |
| 2026-08-08 | 重建被脚手架覆盖的规格文档 | R1-R12 | 消除文档漂移 |
| 2026-08-08 | 启动 Tauri 开发应用并确认原生进程持续运行 | R1 | 验证 macOS 原生窗口启动链路 |
| 2026-08-08 | 源规则检查排除 `dist/` 构建产物 | R12 | 避免将第三方压缩包误判为业务源码 |
| 2026-08-08 | 实现应用数据目录配置写入与 OpenAPI 同步命令 | R2、R3、R4 | 进入编译与离线解析测试阶段 |
| 2026-08-08 | 验证配置重载、Tag 筛选和 Mock 目标生成 | R2、R3、R4 | 3 个 Rust 单元测试通过 |
| 2026-08-08 | 接入 hudsucker 本地代理、规则匹配和 URI 重写 | R5、R8 | 代理控制命令、三种匹配模式和查询参数保留完成 |
| 2026-08-08 | 接入持久化本地 CA 与真实启动/停止命令 | R6、R7 | 前端按钮已调用 Rust 生命周期命令，证书材料落盘复用 |

## 验证结果

- `pnpm run check:source` 通过：源文件行数和三元表达式均符合约束。
- `pnpm build` 通过：React/TypeScript 生产构建成功。
- `cargo check` 通过：Tauri 后端命令与状态模型编译成功。
- `pnpm tauri dev` 已启动：Vite 服务与 `target/debug/tauri-app` 原生进程持续运行。
- `cargo test` 通过：OpenAPI Tag 筛选、Mock 目标生成和配置持久化测试均通过。
- 尚未验证：真实 HTTP/HTTPS 请求端到端转发、根证书系统信任、微信开发者工具接入和在线 Apifox 拉取。
