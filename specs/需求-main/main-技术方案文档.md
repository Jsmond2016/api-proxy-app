# 微信开发者工具 Apifox Mock 代理修复 技术方案文档

## 开发分支

`main`

## 方案概览

本方案对应当前 `0.1.30` 的 Tauri 2 桌面代理实现。React 负责项目、在线 Apifox、Tag、Mock 接口、证书和日志工作台；Rust 负责版本化配置、Apifox OpenAPI 导出、规则编译、HTTP/HTTPS 代理、CA 管理和事件推送。参考交互项目为 `/Users/huangjing/Desktop/MyCode/github/api_proxy_tool_ext`，但桌面版不依赖浏览器扩展。

实现按最小可验证增量推进：先建立真实配置和安全状态模型，再接通 Apifox/Tag，再修复代理匹配与实时事件，最后完成 CA、微信开发者工具和打包验收。任何阶段都不得以静态演示数据代替真实结果。

## 代码范围（可选）

| 分类 | 内容 |
| --- | --- |
| 路由 | Tauri 主窗口内部视图，不新增 Web 路由 |
| 代码文件 | 重构 `src/App.tsx`、`src/components/`、`src/lib/desktop.ts`、`src/types.ts`；拆分 `src-tauri/src/commands.rs`、`state.rs`、`apifox.rs`、`proxy/`；新增配置、凭据、证书、事件和测试模块 |
| 关联接口 | Apifox OpenAPI 导出 API、本地 OpenAPI URL、Tauri commands/events、loopback HTTP/HTTPS proxy |
| 功能点 | 项目 CRUD、本地 Token 配置、Tag 同步、规则编译、HTTP/HTTPS MITM、证书信任、实时日志、迁移、E2E 和打包 |

## 总体架构

```text
React 工作台
  ├─ 项目与代理配置
  ├─ Apifox 连接与 Tag 同步
  ├─ 全局 Mock 与规则管理
  ├─ CA / 微信开发者工具接入
  └─ 实时请求日志
          │ Tauri commands + events
          ▼
Rust Application Services
  ├─ ConfigStore（版本化 JSON、原子写入、迁移）
  ├─ Profile Config（包含 Access/Mock Token）
  ├─ ApifoxService（在线 POST / 本地 GET / Tag 解析）
  ├─ RuleService（稳定 ID、同步合并、运行时编译）
  ├─ CertificateService（CA、权限、指纹、信任检测）
  └─ ProxyService（生命周期、HTTP/HTTPS、日志事件）
          │
          ▼
127.0.0.1:<port>  ←  微信开发者工具显式 HTTP/HTTPS 代理
          │
          ├─ 未命中：原始服务透传
          └─ 命中：Apifox Mock（安全附加 Mock Token）
```

## 需求-方案映射

| 需求 ID | 开发方案 | 影响范围 | 使用模型 | 验证方式 | 状态 |
| --- | --- | --- | --- | --- | --- |
| R1 | 新增 Project CRUD commands 和编辑表单；删除硬编码演示档案；校验域名、路径前缀和端口；持久化真实项目 | `model/config/commands`、项目侧栏和项目设置组件 | GPT-5 Codex | Rust 配置测试、前端交互测试、重启恢复测试 | 已确认 |
| R2 | `ApifoxService` 按参考项目发送带版本头和 Bearer Token 的在线 POST 导出请求；校验 OpenAPI 并返回 Tag/接口摘要；前端仅暴露在线模式 | `apifox.rs`、Apifox 配置 UI、错误模型 | GPT-5 Codex | mock server 契约测试、错误分支测试、真实账号人工验证 | 已确认 |
| R3 | 使用 Keychain 服务保存每 Profile 的 Access/Mock Token；目标 URL 使用结构化 Query 合并追加 `apifoxToken`；所有输出脱敏 | 新增 `credentials.rs`、`Cargo.toml`、代理改写和配置 UI | GPT-5 Codex | Keychain 读写删除测试、序列化无凭据断言、日志脱敏测试 | 已废弃：由 R15 替代 |
| R4 | 解析 OpenAPI 顶层及 operation tags；提供 Tag 搜索多选和历史；规则以 operation/source ID 稳定标识；同步前计算 diff | `apifox/rules/config`、Tag 同步对话框 | GPT-5 Codex | fixture、diff、刷新保留自定义规则测试 | 已确认：同步策略部分由 R18 替代 |
| R5 | 新增 `activeTags`，与 `syncedTags` 分离；Tag 控件调用 Rust command 原子更新；编译规则时同时判断 active tag 和 rule enabled | 数据模型、RuleService、Tag 控件、状态摘要 | GPT-5 Codex | 多 Tag 激活矩阵测试、切换后即时命中测试 | 已废弃：由 R13 替代 |
| R6 | 匹配管线固定为 host -> pathPrefix -> method -> rule；OpenAPI 模板路径编译为转义后的 segment regex；实现规则 CRUD、优先级和冲突校验 | `proxy/matcher.rs`、`rules.rs`、规则编辑 UI | GPT-5 Codex | 表驱动匹配测试、跨域不命中测试、动态路径和冲突测试 | 已确认 |
| R7 | ProxyService 在 bind 成功后才发布 running；持有真实 JoinHandle/shutdown；错误事件化；改写保留 body/headers/query；未命中透传 | `proxy/runtime.rs`、`proxy/handler.rs`、状态 UI | GPT-5 Codex | 端口冲突、启停、HTTP 命中/透传 E2E、请求语义断言 | 已确认 |
| R8 | CertificateService 生成持久 CA，私钥 `0600`，DER SHA-256 指纹；提供路径、打开导入和刷新钥匙串信任状态；代理启动前展示 CA 诊断 | `certificate.rs`、Tauri opener/commands、证书 UI | GPT-5 Codex | 文件权限、复用/重建、信任检测、HTTPS CONNECT E2E | 已确认 |
| R9 | 增加微信开发者工具接入向导和自检：监听、CA、代理入口流量、目标域名、最近错误；明确手工代理设置 | 接入面板、诊断 commands、使用文档 | GPT-5 Codex | 实机微信开发者工具 HTTP/HTTPS 验收清单 | 已确认 |
| R10 | 代理为每个请求生成独立 correlation ID；事件包含 request_started/completed/failed；前端订阅 Tauri event 并维护有界列表 | `events.rs`、proxy handler、日志 store/UI | GPT-5 Codex | 并发请求关联测试、事件订阅测试、筛选/清空测试 | 已确认 |
| R11 | `schemaVersion` + 显式 migration；运行状态启动时归一为 stopped；原子写入和备份恢复；参考项目 JSON 只导入支持字段 | `config.rs`、`migration.rs`、导入导出 UI | GPT-5 Codex | 各版本 fixture、损坏文件恢复、敏感字段排除测试 | 已确认 |
| R13 | 删除 `ActiveTags` UI、前端回调和对应 command；规则匹配不再读取 `activeTags`，同步得到的 Tag 均参与匹配，仅由规则 `enabled` 控制拦截；兼容加载旧配置但忽略旧 `activeTags` 值 | `ApifoxSyncPanel.tsx`、`App.tsx`、`desktop.ts`、`commands.rs`、`lib.rs`、`proxy/mod.rs`、模型兼容逻辑 | GPT-5 Codex | 匹配回归测试、前端构建、源码约束、旧配置加载测试 | 已确认 |
| R14 | 在 Profile 增加独立 `globalMockEnabled`；新增原子切换 command；代理匹配在 host/path 后、rule 前判断全局状态；规则区用单个 Switch 展示并切换，移除逐条循环批量更新；迁移缺失字段的现有 Profile 为 `true`，新建 Profile 为 `false` | `model.rs`、`state.rs`、`commands.rs`、`lib.rs`、`proxy/mod.rs`、`types.ts`、`desktop.ts`、`App.tsx`、`RuleTable.tsx`、`App.css` | GPT-5 Codex | 迁移默认值、全局关闭透传、逐接口状态保持、前端构建、HTTP/HTTPS E2E | 已确认 |
| R15 | 将 Access/Mock Token 字段迁入 `ApifoxConnection` 并随 Profile JSON 持久化；移除 `keyring` 依赖和 `credentials.rs` 调用；同步请求传入非空值时覆盖配置，留空时复用已存值；代理从 Profile 配置读取并支持运行时热更新；前端初始化及 Profile 切换时回显 | `model.rs`、`commands.rs`、`proxy/mod.rs`、`state.rs`、`Cargo.toml`、`ApifoxSyncPanel.tsx`、`types.ts`、使用文档 | GPT-5 Codex | 配置重载、留空复用、覆盖更新、代理 Query、日志脱敏、无 Keychain API 源码断言、全量构建/E2E | 已确认 |
| R16 | 使用 `url::Url` 结构化生成规则目标：先拼接 path，再合并 `apifoxToken`；同步后遍历所有 Apifox 来源规则刷新 Token 参数；代理改写在合并原请求 Query 后用当前配置 Token 覆盖同名参数；空 Mock Token 时不追加 | `apifox.rs`、`commands.rs`、`proxy/mod.rs`、规则测试和 E2E | GPT-5 Codex | 规则目标后缀、URL 编码、跨 Tag Merge 刷新、旧 Token 覆盖、日志脱敏、HTTP/HTTPS E2E | 已确认 |
| R17 | `.log-stream` 在有数据时固定 `360px` 并内部滚动；无数据使用紧凑 `Empty`，避免空白撑高 | `App.css`、`RequestLogPanel.tsx` | GPT-5 Codex | 前端构建、源码约束、桌面宽度与窄视口布局检查 | 已确认 |
| R18 | 删除前端 `SyncStrategy`，Rust 预览与同步统一执行 Replace：删除旧 Apifox 来源规则后写入本次 Tag 结果，Custom/Imported 规则不变；解析并规范化 `x-run-in-apifox` Web 链接；规则路径使用 Tauri opener 打开浏览器；Mock 接口表格使用 Ant Design Table 自适应高度，长内容换行 | `model.rs`、`apifox.rs`、`commands.rs`、`types.ts`、`ApifoxSyncPanel.tsx`、`RuleTable.tsx`、`App.css` | GPT-5 Codex | Replace 预览/同步测试、自定义规则保留、链接规范化/无效链接测试、前端构建、源码约束、桌面与窄视口人工检查 | 已确认 |
| R19 | 复核现有 `delete_rule` 的共享 snapshot 更新和持久化链路，将操作列扩宽并为两个图标保留稳定尺寸；新增 `clear_rules(profileId)` 原子命令，清空 rules/syncedTags/兼容 activeTags 后持久化，运行中的 handler 因共享 snapshot 立即读取新状态；RuleTable 增加应用内重置确认框并通过统一 `apply` 显示 Toast；标题左侧组合 `h2 + search`，右侧仅保留全局开关、添加和重置，删除 kicker | `commands.rs`、`lib.rs`、`desktop.ts`、`App.tsx`、`RuleTable.tsx`、`App.css`、测试和使用文档 | GPT-5 Codex | 单条删除/全量清空持久化测试、运行态匹配回归、确认框/Toast 源码检查、前端构建和桌面布局检查 | 已确认 |
| R20 | 接入 Ant Design 6 `ConfigProvider` 中文紧凑主题；以 `Button/Input/Select/Switch/Table/Form/Modal/Popconfirm/Tooltip/Alert/Empty/message` 替换手写基础组件；使用 `classnames` 管理状态类名并保留现有布局 CSS | `package.json`、`main.tsx`、`App.tsx`、全部工作台组件、`App.css` | GPT-5 Codex | 前端构建、源码约束、原生控件扫描、桌面与窄视口视觉检查 | 已确认 |
| R21 | `ProxyHeader` 删除重复地址块；新增紧凑配置操作条，使用 `Button` 展示在线 Apifox 连接摘要和 CA 信任摘要；`ApifoxSyncPanel` 与 `CertificatePanel` 改为受控 `Modal`，关闭后保留 Profile 字段回显；`ConnectionGuide` 继续作为唯一代理地址与接入状态区 | `App.tsx`、`ProxyHeader.tsx`、`ApifoxSyncPanel.tsx`、`CertificatePanel.tsx`、`ConnectionGuide.tsx`、`App.css` | GPT-5 Codex | 前端构建、源码约束、弹框开关/回显/操作源码检查、桌面与窄视口布局检查、Rust 回归 | 已确认 |
| R22 | 统一规则区用户文案为“Mock 接口”；新增 `resolve_openapi_operation` 或等价 Tauri command，复用在线/本地 OpenAPI 获取与解析逻辑，按规范化 URL pathname、Method 执行精确优先和唯一模糊匹配并返回规则输入字段；新增接口 Drawer/Modal 以空值初始化，URL 第一项在 blur 时调用解析，唯一命中后回填，歧义/未命中使用 `message` 提示；编辑保持现有值回显 | `apifox.rs`、`commands.rs`、`lib.rs`、`model.rs`、`desktop.ts`、`types.ts`、`RuleTable.tsx`、测试 | GPT-5 Codex | 解析精确/模糊/歧义/未命中/Token 目标测试、前端构建、源码约束、表单初始化与回填交互检查、HTTP/HTTPS 回归 | 已确认 |
| R23 | 将 `ApifoxSyncPanel` 的 Ant Design `Form` 调整为纵向单列，每个字段和验证操作独占一行并收窄弹框宽度；通过桌面 API 读取 Tauri 应用版本，Web 预览使用由 Vite 从 `package.json` 注入的构建期版本回退值，传入 `ProjectSidebar` 后在品牌标题右侧低权重展示；将 `App` 的接入区改为上下两行，第一行保留 `ConnectionGuide`，第二行单独排列 Apifox 与证书入口 | `vite.config.ts`、`desktop.ts`、`App.tsx`、`ProjectSidebar.tsx`、`ApifoxSyncPanel.tsx`、`App.css` | GPT-5 Codex | 前端构建、源码约束、版本来源扫描、桌面与窄视口布局检查、Rust 回归 | 已确认 |
| R24 | 在 `AppState::load` 将所有 Profile 的 `global_mock_enabled` 重置为 `false` 并持久化安全启动状态；Tauri `setup` 完成状态注册后，若存在活动 Profile 则异步启动 loopback listener；将代理启停能力收敛为内部生命周期服务，Profile 创建、切换、活动端口修改和活动 Profile 删除通过统一 restart/ensure-running 流程切换监听，移除 `ensure_proxy_stopped` 对用户配置操作的阻断；`RuleProxyHandler` 继续在 `global_mock_enabled=false` 时直接 miss 并透传，开启后才匹配启用规则；删除 `ProxyHeader` 手动启停按钮和前端 start/stop 回调，改为展示“端口监听中 · 全量透传/按规则 Mock”状态，保留规则区“全局 Mock”Switch 作为唯一业务开关；无 Profile 时保持无监听，绑定失败进入 error 并在初始化/诊断区明确提示；版本升级至 0.1.10 | `state.rs`、`proxy/mod.rs`、`commands.rs`、`lib.rs`、`App.tsx`、`ProxyHeader.tsx`、`ConnectionGuide.tsx`、`RequestLogPanel.tsx`、`desktop.ts`、测试、文档和版本文件 | GPT-5 Codex | Rust 启动自动监听测试、启动强制透传测试、HTTP/HTTPS 透传与 Mock E2E、全局开关状态保持测试、Profile/端口切换自动重启测试、端口冲突错误测试、前端构建与源码约束、0.1.10 DMG 安装验收 | 已确认 |
| R25 | 将 `ApifoxSyncPanel` 收敛为在线项目专用弹框，移除 Local 模式分支和本地 URL 字段；参照 `api_proxy_tool_ext` 的在线配置分区与操作顺序重排 `Form`、Tag 发现/确认和接口预览；Modal 使用独立滚动 body，设置 `overscroll-behavior: contain`、阻止滚轮事件冒泡并在弹框打开时锁定页面滚动，避免外层 workspace 响应滚轮 | `ApifoxSyncPanel.tsx`、`App.tsx`、`App.css`、`types.ts`（如清理 Local 契约）、参考项目交互映射文档 | GPT-5 Codex | 在线模式表单/验证/Tag/预览/同步交互源码检查；Modal 内滚动与页面滚动隔离测试；前端构建、源码约束和桌面窄视口验收 | 已确认 |
| R26 | 在规则表操作列增加测试按钮和测试结果 Modal；测试通过当前规则目标发起请求，展示请求 URL、状态、响应数据和错误；全局关闭时允许“仅调试当前接口”原子开启全局 Mock 并关闭其他规则，复用现有 `onToggle`/`onToggleGlobal` 持久化；测试前检查规则 enabled、target 和当前全局状态，Modal 内部滚动隔离 | `RuleTable.tsx`、`App.tsx`、`App.css`、`types.ts`（仅在测试请求确需时扩展字段） | GPT-5 Codex | 测试按钮/校验/请求结果源码检查；单接口调试状态持久化测试；前端构建、源码约束、Rust 回归和桌面人工验收 | 已确认 |
| R46 | `RuleActions` 在测试结果 Modal 内增加响应搜索状态和 `Ctrl/Cmd+F` 快捷键监听；响应 `<pre>` 设置最大高度和内部滚动，搜索匹配使用安全 React 节点渲染并自动滚动首个匹配 | `RuleTable.tsx`、`App.css` | GPT-5 Codex | 前端构建、源码约束、搜索输入/快捷键源码检查、桌面大响应人工验收 | 已确认 |
| R47 | `RuleActions` 维护响应搜索匹配总数与当前索引；搜索词变化时重置索引并定位首个 `<mark>`，上/下按钮及 Enter/Shift+Enter 按循环索引切换，当前匹配使用独立样式并滚动到可视区域；搜索无结果时导航禁用 | `RuleTable.tsx`、`App.css` | GPT-5 Codex | 前端构建、源码约束、搜索导航/键盘事件源码检查、桌面多匹配响应人工验收 | 已确认 |
| R48 | `Workspace` 在 `activeProfile=null` 时先渲染 `ProjectSidebar`，再展示紧凑空状态；复用既有 `ProfileDialog` 创建流程与 `profiles.length <= 1` 删除保护，不新增后端数据契约 | `App.tsx`、`ProjectSidebar.tsx`、`App.css` | GPT-5 Codex | 空配置首屏源码检查、前端构建、源码约束、创建首个项目人工验收 | 已确认 |
| R49 | 为 `apply` 增加可选静默反馈参数；`Workspace.debugSingle` 的多步 `setGlobalMockEnabled`/`setRuleEnabled` 调用关闭逐步成功 Toast，全部完成后由工作区统一发送一条成功提示；移除 `RuleActions` 对该回调的重复成功/失败提示，错误继续由 `apply` 统一上报 | `App.tsx`、`RuleTable.tsx` | GPT-5 Codex | 复合操作 Toast 调用链检查、前端构建、源码约束、桌面人工点击验证 | 已确认 |
| R51 | 将 `set_global_mock_enabled` 改为异步命令：持久化开关后调用 `proxy::restart_proxy`，停止当前监听、等待端口释放并重新启动；新连接读取最新共享快照，关闭时仍按全局门控透传 | `commands.rs`、`proxy/mod.rs`、`lib.rs`、测试 | GPT-5 Codex | Rust 单测、HTTP/HTTPS 代理回归、前端构建、源码约束和开关切换后重新请求人工验收 | 已确认 |
| R52 | `RuleProxyHandler::should_intercept_connect`/`should_intercept_tls` 改为仅校验活动 Profile 存在并始终建立 MITM；`matching_rule` 继续在请求层检查 `global_mock_enabled`，关闭时返回 miss 并透传；保留 CA 信任诊断和 HTTP/HTTPS 请求日志 | `proxy/mod.rs`、测试、文档 | GPT-5 Codex | Rust 单测、HTTPS 连接复用场景回归、前端构建、源码约束和桌面人工验收 | 已确认 |
| R53 | 为 Tag 多选设置稳定宽度并关闭响应式标签测量；拆分验证、Tag 拉取和同步 loading 状态；在规则接口信息列增加复制图标和三行格式化剪贴板文本 | `ApifoxSyncPanel.tsx`、`RuleTable.tsx`、`App.css`、绑定文档 | GPT-5 Codex | 前端构建、源码约束、长 Tag 视觉检查、loading 状态源码检查、剪贴板文本单测/源码检查 | 已确认 |
| R54 | 新增 `move_rules` Tauri 原子命令，在同一快照内校验源/目标 Profile、规则集合和目标 ID 冲突后完成批量迁移并持久化；规则引用的本地 Mock 响应在目标缺失时复制。`RuleTable` 复用一个目的 Tab Modal，操作列提供单条移动图标，“真机模拟”左侧提供批量移动按钮；其他 Tab 为空时禁用入口 | `commands.rs`、`lib.rs`、`desktop.ts`、`App.tsx`、`RuleTable.tsx`、测试和绑定文档 | GPT-5 Codex | Rust 原子移动单测、前端构建、源码约束、`cargo test`、`cargo fmt --check`、`git diff --check`、桌面人工移动验收 | 已确认 |
| R55 | `create_profile` 在校验新 Profile ID 后读取 `current.profiles.first()`，仅克隆首个 Profile 的 `apifox` 连接对象到新 Profile；`build_profile` 仍初始化空 `synced_tags`/`active_tags`、空规则和关闭的全局 Mock。现有 `ApifoxSyncPanel` 按 Profile ID 变化从 `profile.apifox` 回显，无需新增前端状态或命令契约 | `commands.rs`、测试和绑定文档 | GPT-5 Codex | 新 Profile 连接配置继承/Tag 隔离单测、Rust 全量测试、前端构建、源码约束、格式与差异检查 | 已确认 |
| R56 | Apifox 同步写入 Profile 前，将规则 ID 规范为 `apifox-{profile_id}-{source_operation_id}`，使同一接口在不同 Tab 中具有独立标识，同一 Tab 重复同步仍保持稳定。移动冲突校验兼容旧 ID 与新 ID：先比较 ID，再对 Apifox 来源比较 `source_operation_id`，只阻止目标 Tab 内产生同一接口的第二份规则 | `commands.rs`、测试和绑定文档 | GPT-5 Codex | Profile 级 ID 稳定/隔离测试、跨 Profile 移动业务身份冲突测试、Rust 全量测试、前端构建、源码约束、格式与差异检查 | 已确认 |
| R57 | `ProjectSidebar` 的 `onSelect` 继续复用通用 `apply`，调用时传入 `notifySuccess=false`，关闭成功 Toast；异常处理和诊断记录不变 | `App.tsx` 和绑定文档 | GPT-5 Codex | 切换调用链源码检查、前端构建、源码约束和差异检查 | 已确认 |
| R12 | 建立 Rust 单元/集成、前端测试和本地双 upstream E2E；更新 README/使用文档；构建并校验 arm64 app/dmg | tests、scripts、docs、Tauri bundle | GPT-5 Codex | `pnpm build`、`check:source`、`cargo test`、E2E、codesign、hdiutil | 已确认 |

## 数据模型设计

### 持久化配置

```rust
AppConfig {
  schema_version,
  active_profile_id,
  profiles: Vec<ProjectProfile>,
  tag_history,
}

ProjectProfile {
  id,
  name,
  source_hosts: Vec<String>,
  path_prefix: Option<String>,
  proxy_port: u16,
  apifox: ApifoxConfig,
  synced_tags: Vec<String>,
  active_tags: Vec<String>, // 仅兼容旧 schema，运行时忽略并在同步后镜像 synced_tags
  global_mock_enabled: bool,
  rules: Vec<ProxyRule>,
}

ApifoxConfig {
  mode: Online,
  project_id: Option<String>,
  mock_prefix: String,
  access_token: String,
  mock_token: String,
}

ProxyRule {
  id,
  source: Apifox | Custom | Imported,
  source_operation_id: Option<String>,
  name,
  method,
  path_pattern,
  match_mode,
  target_base,
  enabled,
  tags: Vec<String>,
  priority,
}
```

### 运行时状态

`ProxyStatus`、监听 socket、shutdown channel、JoinHandle、实时请求和瞬时错误不作为可信持久化状态。应用启动时一律从 `stopped` 开始，启动代理成功后由 ProxyService 发布状态事件。

### Token 配置

Access Token 与 Mock Token 作为 `ApifoxConfig` 字符串随 Profile 写入 `desktop-state.json`。表单切换 Profile 或重启后回显；输入非空新值时覆盖，留空时复用已存值。规则和配置可以显示 Token，但请求日志、诊断、Toast 和错误输出必须脱敏。

## Tauri 契约设计

### Commands

| Command | 作用 |
| --- | --- |
| `get_app_snapshot` | 获取脱敏配置、派生证书状态和代理状态 |
| `create_profile` / `update_profile` / `delete_profile` / `set_active_profile` | Profile 生命周期 |
| `validate_apifox_connection` | 获取并校验 OpenAPI，返回摘要和可选 Tag，不落规则 |
| `preview_apifox_sync` / `apply_apifox_sync` | 生成 diff 并按确认策略同步 |
| `create_rule` / `update_rule` / `delete_rule` / `set_rule_enabled` | 规则管理 |
| `set_global_mock_enabled` | 原子更新 Profile 级全局 Mock 门控，不改写逐接口状态 |
| `generate_ca` / `get_ca_status` / `open_ca_certificate` / `regenerate_ca` | CA 生命周期和信任检测 |
| `start_proxy` / `stop_proxy` / `diagnose_proxy` | 代理生命周期和接入诊断 |
| `clear_request_logs` | 清空前端/后端有界日志缓存 |
| `import_reference_config` / `export_safe_config` | 兼容导入与安全导出 |

所有 command 使用结构化错误：`code`、`message`、`detail`、`recoverable`，禁止只返回不可分类字符串。

### Events

| Event | 载荷 |
| --- | --- |
| `proxy://status` | status、port、errorCode、message |
| `proxy://request-started` | correlationId、time、method、脱敏 source、match decision |
| `proxy://request-completed` | correlationId、destination、ruleId、statusCode、duration |
| `proxy://request-failed` | correlationId、stage、safeError、duration |
| `certificate://status` | generated、trusted、fingerprint、certificatePath |

## Apifox 同步设计

### 在线模式

```http
POST https://api.apifox.com/v1/projects/{projectId}/export-openapi?locale=zh-CN
Authorization: Bearer <Access Token>
X-Apifox-Api-Version: 2024-03-28
Content-Type: application/json

{
  "scope": { "type": "ALL" },
  "options": { "includeApifoxExtensionProperties": true },
  "oasVersion": "3.1",
  "exportFormat": "JSON"
}
```

### 本地模式（已废弃）

早期方案曾允许读取用户配置的本地 OpenAPI URL；为与参考项目及当前产品交互保持一致，`0.1.25` 前端已移除 Local 模式入口，在线 Apifox 项目是唯一支持的连接方式。Rust 数据模型保留必要兼容字段时，不得在新 UI 中重新暴露该能力。

### Tag 与同步语义

- `availableTags`：本次 OpenAPI 文档解析结果，不直接持久化为生效范围。
- `syncedTags`：用户选择并已同步进本地规则的数据范围。
- 旧配置中的 `activeTags` 仅为兼容字段，运行时忽略；同步后镜像 `syncedTags`，后续 schema 升级可移除。
- 同步使用稳定 ID：优先 `operationId` 或 Apifox extension API ID，缺失时使用 `METHOD + normalized path` 哈希。
- 同步固定使用 Replace：删除全部旧 Apifox 来源规则后写入本次选中 Tag 的新规则，不保留旧 Apifox 规则的启停状态；Custom/Imported 规则不删除。
- 同步前必须返回新增、更新、删除、保留和冲突数量，用户确认后才能应用。
- Apifox Web 接口页优先取 `x-run-in-apifox` 并移除末尾 `-run`/`-link` 与旧 `/web/` 路径；缺失时仅使用在线项目 ID 与扩展字段中的数字 API ID构造 `https://app.apifox.com/project/{projectId}/apis/api-{apiId}`，无法可靠识别时不渲染链接。

## 代理匹配与改写设计

### 匹配顺序

```text
请求进入 loopback 代理
  -> active Profile 存在
  -> Host 精确匹配 source_hosts（忽略默认端口，域名小写规范化）
  -> Path 满足可选 path_prefix
  -> global_mock_enabled 为 true
  -> Method 匹配
  -> Rule enabled
  -> 按 priority、exact/template/regex/contains 顺序选唯一规则
```

未通过任何条件均透传原目标，并记录明确的未命中阶段。规则冲突在保存/同步时预警，运行时仍使用确定性排序。

### OpenAPI 模板路径

`/users/{id}/orders/{orderId}` 编译为：

```text
^/users/[^/]+/orders/[^/]+/?$
```

静态片段必须正则转义，不允许把 OpenAPI 路径直接当作任意正则执行。

### Mock URL 与 Query

1. 以规则目标的 scheme/authority/path 为目标。
2. 保留目标 URL 已有 Query。
3. 合并原请求 Query；同名普通参数以原请求为准。
4. 同步规则目标显式保存 `apifoxToken`；转发时用当前 Profile 的 Mock Token 覆盖目标或原请求中的旧值。
5. 日志展示 URL 时移除 `apifoxToken` 和敏感参数。
6. 更新 Host header，并移除连接级 hop-by-hop headers；method/body 和必要业务 headers 保持不变。

## 证书与客户端接入设计

- CA 首次按需生成到应用数据目录；证书 `0644`，私钥创建后强制 `0600`。
- 指纹对 DER 证书计算 SHA-256，以冒号分隔大写十六进制展示。
- `open_ca_certificate` 使用系统打开证书，让用户在钥匙串中显式导入；应用不静默获取管理员权限。
- `get_ca_status` 使用 macOS Security Framework 或受控 `security` 查询证书是否存在且被信任，不能用固定布尔值。
- 接入面板展示微信开发者工具需要填写的 host/port、当前监听、CA 信任和最近入口请求。
- HTTPS 验收必须同时覆盖 `curl --proxy` 和微信开发者工具；若客户端启用 certificate pinning，返回明确诊断而不是伪装为规则问题。

## 实时日志设计

- 每个请求创建独立 `correlationId` 和 `Instant`，存入并发安全的 pending map；响应完成后按 ID 关联。
- 后端只保留最多 500 条脱敏摘要，前端同样使用有界 store；默认不持久化 Body 和敏感 Headers。
- 前端在主窗口挂载时订阅 events，在卸载时解除订阅；重新打开窗口时通过 snapshot 获取当前有界摘要。
- 支持按 matched/passed/failed、Tag、ruleId、method 搜索筛选；详情展示匹配阶段和安全错误。

## 配置迁移设计

1. 新配置使用 `schemaVersion`，写入前生成临时文件并原子替换，保留最近一份 `.bak`。
2. 识别当前无版本演示配置：若字段仍为内置演示 ID/域名且没有用户同步证据，则迁移为空项目，不把假规则继续带入。
3. 对用户真实修改过的旧 Profile 做字段映射并要求首次打开确认源域名、路径前缀和凭据。
4. 旧状态中的 `proxyStatus`、演示日志和 `trusted` 不作为新状态来源。
5. 参考项目 JSON 仅导入可映射的 module/API 字段；Token、Cookie、权限点等不进入普通配置。

## 前端工作台调整

- 首屏是可工作的项目工作台，不展示演示日志；无项目时提供明确创建入口。
- 项目设置使用真实表单；端口、域名和路径有即时校验。
- Apifox 区域拆为“连接配置”和“Tag 同步”，只有验证连接成功后才能选择 Tag。
- Tag 控件清晰区分“同步范围”和“当前生效范围”，生效切换使用 checkbox/segmented controls，不复用纯筛选 tabs。
- 规则表的添加、编辑、批量启停、详情均实现；暂不实现的按钮移除。
- 证书区显示路径、信任状态、打开/刷新/重建操作和风险确认。
- 顶部代理按钮根据真实状态禁用冲突操作；启动失败保留可操作错误。

## 分阶段实施与验证

### 增量 1：配置基线

- 建立新模型、ConfigStore、迁移和 Profile CRUD。
- 验证：配置单测、空状态 UI、重启恢复；不启动代理。

### 增量 2：Apifox 与凭据

- 实现本地 Token 配置、在线/本地连接、Tag 获取、同步预览和稳定规则。
- 验证：本地 mock Apifox 服务契约测试、Token 持久化/脱敏测试、真实 Apifox 人工验证。

### 增量 3：规则与 HTTP 代理

- 实现域名/前缀/模板匹配、逐接口开关、生命周期和 HTTP E2E。
- 验证：本地 upstream + mock server，覆盖命中、跨域不命中、透传、query/body/header。

### 增量 4：HTTPS 与实时事件

- 完成 CA 安全、信任检测、CONNECT、请求 correlation 和 Tauri events。
- 验证：本地 HTTPS upstream、`curl --proxy --cacert`、并发日志关联和 UI 实时刷新。

### 增量 5：微信开发者工具与交付

- 完成接入向导、诊断、真实微信开发者工具验收、文档和打包。
- 验证：至少一个真实源域名的 GET 与 POST、动态路径、命中 Mock、未命中透传；生成并校验 arm64 DMG。

## 测试矩阵

| 层级 | 必测内容 |
| --- | --- |
| Rust 单元 | URL/host 规范化、模板编译、规则优先级、Query 合并、Token 脱敏、迁移、CA 权限 |
| Rust 集成 | Apifox 在线请求契约、本地 OpenAPI、Token 配置重载、配置原子写入 |
| Proxy E2E | HTTP/HTTPS、CONNECT、命中、透传、端口冲突、body/query/header、并发日志 |
| 前端 | Profile 表单、连接错误、Tag 同步、规则操作、event reducer、证书状态 |
| 桌面人工 | 首次启动、钥匙串信任、微信开发者工具代理、真实 Apifox Mock、重启恢复 |
| 打包 | production build、arm64 架构、codesign verify、hdiutil verify、Applications 启动 |

## 技术决策

| 决策项 | 结论 | 原因 | 备选方案 |
| --- | --- | --- | --- |
| 网络拦截方式 | 继续使用 `hudsucker` loopback 显式代理 | 已有基础实现，支持 CONNECT 和动态 CA；符合微信开发者工具可配置代理场景 | VPN/透明代理权限和风险更高，不在本轮范围 |
| Tag 语义 | Tag 只用于同步筛选和规则归类 | 用户不需要 Tag 层级的运行时开关，逐接口开关更直接 | 旧 `activeTags` 字段暂留作配置兼容但不参与匹配 |
| Token 存储 | Profile JSON 字符串 | 用户明确接受本地明文风险，以避免系统授权弹窗并保留表单值 | Keychain 方案已由 R15 废弃 |
| 前后端同步 | Commands 管理配置，Events 推送运行态 | 配置写操作需要明确结果，流量和状态需要实时推送 | 高频轮询延迟高且浪费资源 |
| CA 信任 | 用户显式导入，应用检测状态 | 避免静默管理员操作，保留用户控制 | 自动 `sudo security add-trusted-cert` 权限和回滚风险高 |
| 规则来源 | 稳定来源 ID + source 类型 | 支持安全刷新并保留自定义规则 | 数组序号 ID 会随 OpenAPI 顺序变化 |
| 系统代理 | 不自动修改 | 微信开发者工具可显式配置，避免影响全机流量和异常退出残留 | 自动系统代理需单独设计恢复守护 |

## 风险与回滚

| 风险 | 控制措施 | 回滚方式 |
| --- | --- | --- |
| 配置迁移误删用户规则 | 迁移前备份、识别演示数据、展示迁移摘要 | 恢复 `.bak` 并降级读取旧 schema |
| CA 重建导致客户端不信任 | 默认复用 CA，重建二次确认 | 重新导入旧备份 CA 或新 CA 并刷新信任 |
| 代理错误影响真实请求 | host/path 双重范围、未命中透传、loopback 限制 | 停止代理并移除微信开发者工具代理配置 |
| Token 泄露 | 请求日志和诊断结构化脱敏、禁止 Body/敏感头落盘 | 删除 Profile 配置并在服务端轮换 Token |
| Apifox API 变更 | 请求契约集中封装、版本头、错误码 | 保留本地 OpenAPI URL 模式作为降级路径 |
| 客户端证书固定 | 接入诊断明确识别 | 无法绕过；恢复真实请求透传并关闭代理 |

## 注意事项

- 实施前必须保留并识别当前用户工作树中的 `mise.toml`、`pnpm-workspace.yaml`，不得回退未知修改。
- 不得把演示状态当作默认生产配置，不得用静态日志声称代理成功。
- 不得在 CA 未信任或代理未监听时展示“功能正常”。
- 不得手工拼接 URL 或正则；分别使用 URL parser 和转义后的规则编译器。
- 不得在未完成 HTTP/HTTPS E2E 与微信开发者工具人工验证时产出“可用版”结论。
- 每个增量遵循 Observe -> Plan -> Act -> Verify -> Reflect，并在验证失败后记录真实证据。

## 编码规范

- 所有新增或修改的 `.js`、`.ts`、`.tsx`、`.jsx`、`.mjs` 文件，格式化后单文件不得超过 500 个物理行；超过时按组件、Hook、纯函数或模块职责拆分。
- 代码保持精简，禁止重复代码；可复用的渲染、数据转换或业务逻辑按合理边界抽离。
- 禁止使用三元运算符；条件渲染优先采用 `renderXxx` 函数、哈希映射、`switch`、`if` 或提前返回。
- 禁止反向引用和双向引用。组件、模块和依赖只能从内向外单向引入；通过提取共享下层模块、调整职责边界或依赖注入消除循环依赖与层级反向依赖。

## 代码优化

- 前端移除演示快照和所有无行为按钮，按项目、Apifox、证书、规则、日志和接入诊断拆分组件。
- Rust 使用版本化模型、原子配置写入、稳定 operation ID 和结构化 URL 合并。
- 代理测试直接启动 loopback proxy 与本地 upstream，不以纯匹配单测替代 HTTP/HTTPS 证据。

## 实施记录

| 日期 | 代码或方案变更 | 关联需求 | 使用模型 | 影响 |
| --- | --- | --- | --- | --- |
| 2026-08-27 | 创建 `main` 分支技术方案，完成参考项目与当前实现差距分析、架构设计、迁移和验证规划 | R1-R12 | GPT-5 Codex | 建立后续完整修复的权威方案；尚未修改实现 |
| 2026-08-27 | 用户通过 `ac` 确认 R1-R12 | R1-R12 | GPT-5 Codex | 开始按五个增量实施 |
| 2026-08-27 | 完成 schema v2、演示数据迁移、Profile CRUD、Keychain、Apifox 在线/本地同步、Tag diff/激活和规则管理 | R1-R6、R11 | GPT-5 Codex | 配置与同步工作流改为真实数据闭环 |
| 2026-08-27 | 完成 loopback 生命周期、host-first 匹配、模板改写、Mock Token、CA 安全、信任检测和实时事件日志 | R3、R5-R10 | GPT-5 Codex | HTTP/HTTPS 请求可选择性 Mock 或透传 |
| 2026-08-27 | 重构完整桌面工作台，新增微信开发者工具接入检查、使用与验收文档 | R1-R10、R12 | GPT-5 Codex | 移除旧 UI 原型与无行为入口 |
| 2026-08-27 | 删除原生确认框；项目/规则删除改为应用内确认；Tag 同步改为验证连接、多选下拉、接口 method/path 预览、明确确认四阶段 | R1、R4、R6 | GPT-5 Codex | 修复安装包中点击删除/同步无反馈并对齐参考项目交互 |
| 2026-08-27 | 新增应用内运行诊断控制台，记录 command 开始、成功、失败，支持复制和清空；修复包升级到 0.1.1 | R1-R10、R12 | GPT-5 Codex | 无需打开 WebView 控制台即可定位连接、同步、删除、证书和代理错误 |
| 2026-08-27 | 修复 Merge 误删其他 Tag 规则和新 Tag 未激活；开放所有规则编辑/删除；验证即持久化连接配置；增加全局 Toast；版本升级 0.1.2 | R2-R7、R9-R10、R12 | GPT-5 Codex | 修复跨模块同步与运行态错位，并让所有表单操作有即时反馈 |
| 2026-08-27 | 修复 Mock Token 热更新缺陷：代理运行时与请求处理器共享凭据槽，验证或同步保存 Keychain 后立即更新同一 Profile 的运行实例 | R3、R7 | GPT-5 Codex | 无需重启代理，后续命中请求会携带最新 `apifoxToken`；不改变凭据存储、安全边界或外部契约 |
| 2026-08-27 | 提议移除运行时 Mock 范围整行；确认后同步移除 active Tag 匹配语义，以接口规则开关作为唯一运行时控制 | R5、R13 | GPT-5 Codex | 防止只隐藏 UI 后旧的 inactive Tag 在后台继续阻止拦截 |
| 2026-08-27 | 用户通过 `ac` 确认 R13，开始移除 Tag 运行时激活 UI、命令和匹配条件 | R5、R13 | GPT-5 Codex | R5 被 R13 替代，Tag 只保留同步筛选与规则归类职责 |
| 2026-08-27 | 完成 R13：移除运行时 Mock 范围整行、前后端 active Tag command 和代理匹配条件，旧字段仅作配置兼容 | R5、R13 | GPT-5 Codex | 所有同步规则直接受逐接口开关控制，不再存在隐藏的 Tag 阻断条件 |
| 2026-08-27 | 对照参考项目 `isGlobalEnabled` 提议 R14：用独立全局 Switch 替代两个批量按钮，保留逐接口状态 | R6、R14 | GPT-5 Codex | 修正当前逐条批量更新造成的状态覆盖，等待确认 |
| 2026-08-27 | 用户通过 `ac` 确认 R14，开始实现 Profile 级全局 Mock 门控与单 Switch 交互 | R6、R14 | GPT-5 Codex | 全局状态和逐接口状态独立持久化 |
| 2026-08-27 | 完成 R14：用单一全局 Mock Switch 替换两个批量按钮，代理增加独立门控和 `global-switch` 诊断阶段；现有项目迁移开启，新项目默认关闭；版本升级 0.1.3 | R6、R12、R14 | GPT-5 Codex | 全局切换不再覆盖逐接口状态，交互与参考项目一致 |
| 2026-08-27 | 定位 Keychain 拒绝导致无限加载：`get_snapshot` 启动时主动读取所有凭据，拒绝后 command 失败；前端 `snapshot=null` 分支不渲染错误。计划取消启动时 Keychain 探测，沿用持久化配置标记，并增加初始化失败/重试界面 | R3、R11 | GPT-5 Codex | 应用启动不再触发凭据访问；实际需要 Token 的操作仍由 macOS Keychain 授权保护 |
| 2026-08-27 | 提议 R15：取消 Keychain，将 Access/Mock Token 作为普通 Profile 配置字符串持久化和回显，并保留日志脱敏 | R3、R15 | GPT-5 Codex | 完全消除钥匙串授权路径；明确接受应用数据 JSON 明文风险，等待确认 |
| 2026-08-27 | 用户通过 `ac` 确认 R15，开始移除 Keychain 并迁移 Token 到 Profile 配置 | R3、R15 | GPT-5 Codex | R3 被 R15 替代；继续保持日志和代理目标展示脱敏 |
| 2026-08-27 | 完成 R15 和初始化恢复：Token 改为 Profile JSON 持久化并回显，移除 `keyring` 与凭据模块；启动不再访问 Token 权限；初始化失败可显示原因并重试 | R3、R11、R15 | GPT-5 Codex | 消除 Token 钥匙串授权弹窗和拒绝后无限加载；19 项 Rust 测试通过 |
| 2026-08-27 | 提议 R16：同步规则目标显式携带 `apifoxToken`，Token 更新时刷新全部 Apifox 规则并由运行时当前值兜底覆盖 | R15、R16 | GPT-5 Codex | 修复规则目标缺少鉴权后缀和旧 Token 残留，等待确认 |
| 2026-08-27 | 用户通过 `ac` 确认 R16，开始实现结构化目标 URL 和 Token 刷新 | R15、R16 | GPT-5 Codex | Token 后缀成为规则数据的一部分，运行时仍保留覆盖兜底 |
| 2026-08-27 | 提议 R17：请求记录列表固定 360px 并内部滚动 | R10、R17 | GPT-5 Codex | 防止实时日志无限撑高页面，等待确认 |
| 2026-08-27 | 用户通过 `ac` 确认 R17，开始实现固定日志视口 | R10、R17 | GPT-5 Codex | 请求记录模块不再随日志数量无限增高 |
| 2026-08-27 | 完成 R16：同步目标显式追加 URL 编码的 `apifoxToken`，同步刷新全部 Apifox 规则，运行时当前 Token 覆盖旧值 | R15、R16 | GPT-5 Codex | 修复 Mock 鉴权后缀缺失和 Token 更新残留；Custom/Imported 规则不变 |
| 2026-08-27 | 完成 R17：请求记录视口固定 360px 并内部滚动；版本升级 0.1.5 | R10、R12、R17 | GPT-5 Codex | 实时日志不再无限撑高页面 |
| 2026-08-27 | 提议 R18：同步固定为 Replace，规则表固定高度并让请求/目标换行，请求路径增加 Apifox Web 外链 | R4、R6、R18 | GPT-5 Codex | 移除无实际场景的策略选择，对齐参考项目跳转能力并控制规则表尺寸；等待确认 |
| 2026-08-27 | 用户通过 `ac` 确认 R18，开始实现单一 Replace 契约与规则表交互 | R4、R6、R18 | GPT-5 Codex | 每次同步重建 Apifox 规则并重置其逐接口状态；Custom/Imported 规则不变 |
| 2026-08-27 | 提议 R19：修复被窄列裁切的删除入口，增加清空当前 Profile 全部规则的重置操作，并重排标题与搜索框 | R6、R19 | GPT-5 Codex | 重置属于有确认提示的破坏性操作，保留连接与全局配置；等待确认 |
| 2026-08-27 | 完成 R18：删除同步策略契约，固定 Replace；新增 Apifox Web 地址解析/持久化/系统浏览器跳转；早期实现曾使用 420px 规则表视口 | R4、R6、R18 | GPT-5 Codex | 后续 R33 已改为 Ant Design Table 自适应高度；长 URL 换行，操作列不再裁切删除图标 |
| 2026-08-27 | 用户通过 `ac` 确认 R19，开始实现规则重置命令和标题操作区 | R6、R19 | GPT-5 Codex | 重置范围固定为规则和 Tag，不改变连接、Token、Mock 前缀或全局开关 |
| 2026-08-27 | 完成 R19：注册原子 `clear_rules` 命令和应用内确认框；搜索框移至标题旁，删除 `ROUTING RULES`，添加按钮右侧增加重置入口；操作列扩至 92px | R6、R12、R19 | GPT-5 Codex | 单条删除的两个操作图标完整可见；重置后运行态和持久化状态同时清空规则与 Tag；版本升级 0.1.6 |
| 2026-08-27 | 完成 R20：基础控件全面迁移到 Ant Design 6，接入中文绿色主题和统一 `message` 反馈；Tag 改用多选 Select，规则改用 Table/Switch/Modal/Popconfirm，删除自制 Toast 与手写基础组件 CSS | R12、R20 | GPT-5 Codex | 保持工作台信息架构、固定滚动高度、长 URL 换行和既有业务流程；使用 `classnames`，未引入 TailwindCSS；版本升级 0.1.7 |
| 2026-08-27 | 提议 R21：顶部删除重复代理地址，Apifox 连接与 HTTPS 证书改为低权重按钮和弹框，接入检查保留唯一地址 | R8、R9、R21 | GPT-5 Codex | 主视图减少低频配置占用，让 Mock 规则提前进入首屏；功能、命令和配置契约不变，等待确认 |
| 2026-08-27 | 用户确认 R21；对照参考项目 `ApiFormDrawer`、`findApiInfoFromSwagger` 提议 R22：统一 Mock 接口命名，以 URL 第一项驱动 OpenAPI 唯一接口自动映射 | R6、R21、R22 | GPT-5 Codex | R21 开始实施；R22 涉及新增 OpenAPI 单接口解析契约，等待确认 |
| 2026-08-27 | 完成 R21：删除顶部重复代理地址；Apifox 连接与 HTTPS 证书改为紧凑入口按钮和 Ant Design Modal；接入检查保留唯一地址；证书弹框明确 HTTPS Mock 用途并展示状态、指纹和路径 | R8、R9、R21 | GPT-5 Codex | 主页面配置区收敛为一行，Mock 规则提前进入首屏；Tauri 命令和配置契约不变 |
| 2026-08-27 | 完成 R22：用户文案统一为 Mock 接口；新增/编辑使用参考项目同款右侧 Drawer；新增字段全空且 URL 第一项，失焦后调用 `resolve_apifox_operation`，唯一命中回填名称、路径、Method、匹配方式、Mock URL、Tag 和 Apifox 链接；完整 URL 保存时规范化 pathname | R6、R12、R22 | GPT-5 Codex | 多匹配/未匹配只提示且不覆盖；模板大括号兼容 URL 百分号编码；版本升级 0.1.8 |
| 2026-08-27 | 提议 R23：Apifox 连接表单改为纵向单列；侧栏品牌标题旁展示桌面应用构建版本；Apifox 与证书入口移到接入检查下方独立一行 | R21、R23 | GPT-5 Codex | 仅调整前端布局和版本读取，不改变同步、证书或代理契约；等待确认 |
| 2026-08-27 | 用户通过 `ac` 确认 R23，开始调整连接弹框、侧栏版本展示和接入区层级 | R23 | GPT-5 Codex | 版本以桌面 API 为准，Web 预览使用同一构建版本回退值 |
| 2026-08-27 | 完成 R23：Apifox 连接弹框收窄为 720px，连接来源、Mock 前缀、两个 Token 和验证操作改为纵向单列；侧栏品牌标题右侧展示 Tauri 应用版本，Vite 从 `package.json` 注入预览回退版本；接入检查与 Apifox/HTTPS 证书入口拆分为上下两行 | R12、R21、R23 | GPT-5 Codex | 不改变连接、同步、证书和代理回调；Tag 验证区允许换行；版本升级 0.1.9 |
| 2026-08-27 | 提议 R24：应用在有活动 Profile 时自动监听代理端口，每次启动强制关闭全局 Mock 并透传；规则区全局 Switch 成为唯一 Mock 开关，顶部移除手动启停；Profile 与端口变化自动切换 listener | R7、R9、R14、R21、R24 | GPT-5 Codex | 解决应用已打开但端口未监听导致微信开发者工具全请求失败的问题；涉及启动默认值和监听生命周期变更，等待确认 |
| 2026-08-28 | 用户通过 `ac` 确认 R24，开始实现自动监听与安全透传启动 | R24 | GPT-5 Codex | 自动监听与用户配置命令解耦；HTTPS 透传通过 handler 的 CONNECT/TLS 拦截策略实现 |
| 2026-08-28 | 完成 R24：应用启动自动监听活动 Profile；启动时重置全局 Mock 为关闭；Profile 创建/切换/编辑/删除自动重启或停止监听；HTTPS 关闭 Mock 时直通 CONNECT/TLS；移除顶部手动启停 UI | R7、R9、R14、R21、R24 | GPT-5 Codex | 新增运行实例端口标识和安全启动测试；版本升级 0.1.10 |
| 2026-08-28 | 提议 R25：在线模式专用 Apifox 弹框与滚轮隔离 | R21、R22、R23、R25 | GPT-5 Codex | 仅改变前端配置交互与滚动容器，不改变 Apifox API、Token 或代理契约；等待确认 |
| 2026-08-28 | 用户通过 `ac` 确认 R25，开始实施在线模式弹框和滚轮隔离 | R25 | GPT-5 Codex | 前端固定在线请求契约；保留 Rust `mode` 字段兼容性并传空本地 URL |
| 2026-08-28 | 完成 R25：移除 Local 模式选择和本地 URL 字段；在线项目、Mock 前缀、两个 Token、验证、Tag 选择、预览和同步按参考项目顺序呈现；Modal 内容及外层统一阻止滚轮冒泡，打开时锁定 body 滚动 | R21、R22、R23、R25 | GPT-5 Codex | 不改变同步 API、Token 传递和既有 Profile 配置回显 |
| 2026-08-28 | 提议 R26：Mock 接口测试与仅调试当前接口 | R26 | GPT-5 Codex | 新增规则操作入口和调试状态联动，等待用户确认 |
| 2026-08-28 | 用户通过 `ac` 确认 R26 并完成实现 | R26 | GPT-5 Codex | 测试请求和单接口调试均复用现有规则持久化命令；前端验证通过 |
| 2026-08-28 | 提议 R27：在 Mock 接口标题旁增加不生效排查 Tooltip | 用户发现 Apifox 接口 Method 定义错误会导致请求透传，希望将全局开关、接口开关、域名/路径、Method 和 HTTPS 证书等常见问题集中提示；等待确认 | R27 | GPT-5 Codex |
| 2026-08-28 | 用户通过 `ac` 确认 R27，并补充 R28：测试请求全局门控与结果弹框增强 | R27、R28 | GPT-5 Codex | 测试操作复用全局 Mock 状态校验；响应内容格式化并增加 Mock 跳转/关闭操作 |
| 2026-08-28 | 完成 R27-R28 | R27、R28 | GPT-5 Codex | Mock 接口标题增加排查 Tooltip；测试按钮受全局 Mock 开关约束；测试弹框增加格式化响应、请求信息、错误信息及 Mock 跳转/关闭操作 |
| 2026-08-31 | 补充 R28 测试弹框重试 | R28 | GPT-5 Codex | 在测试结果 Modal footer 中复用现有测试请求函数增加“重试”按钮；点击后保持弹框打开，清空旧结果并重新请求当前 Mock 目标，加载期间按钮显示 loading 并避免重复提交 |
| 2026-08-28 | 提议 R29：移除左侧菜单并以 Tabs 管理多个联调项目 | 用户要求参考项目的单主面板交互；将项目导航、创建、编辑、删除迁移到主面板顶部 Tabs，保留当前 Profile 切换时的代理监听生命周期和规则数据联动；等待确认 | R29 | GPT-5 Codex |
| 2026-08-28 | 用户通过 `ac` 确认并完成 R29 | R29 | GPT-5 Codex | `ProjectSidebar` 改为顶部 Tabs 项目栏，单列主面板承载所有工作区；新增、编辑、删除入口和项目切换命令保持不变 |
| 2026-08-28 | 提议 R30：测试弹框“去 Mock 接口”改跳 Apifox 配置页 | 当前按钮误用 `rule.target`，会打开 Mock 请求地址；改用 `rule.apifoxWebUrl`，无可靠链接时禁用按钮并提示 | R30 | GPT-5 Codex |
| 2026-08-28 | 完成 R30 | R30 | GPT-5 Codex | 测试弹框按钮改用 `apifoxWebUrl` 跳转 Apifox 接口设置页；无链接时禁用并保留提示 |
| 2026-08-28 | 提议 R31：测试弹框增加原始接口复制和按钮顺序调整 | 在测试详情中显示 `method + path` 原始接口并使用 Clipboard API 复制；通过 Modal `okButtonProps`、`cancelButtonProps` 和 footer 布局实现“去 Mock 接口”左、“关闭”右 | R31 | GPT-5 Codex |
| 2026-08-28 | 用户通过 `ac` 确认 R31，并补充确认 R32 | R31、R32 | GPT-5 Codex | 同步实施测试弹框信息/按钮调整，以及 Mock 接口标题间距、配置按钮主题色和右对齐布局 |
| 2026-08-28 | 完成 R31-R32 | R31、R32 | GPT-5 Codex | 测试弹框增加原始接口复制并调整按钮顺序；配置入口隐藏数量、突出 Apifox 主按钮并右对齐；规则标题与表格间距固定为 16px |
| 2026-08-28 | 完成 R33-R35 | R33、R34、R35 | GPT-5 Codex | 移除规则表固定高度；请求记录默认已 Mock 并显示完整日期时间；新增勾选接口生成真机模拟 AI 提示词并复制到剪贴板 |
| 2026-08-28 | 用户通过 `ac` 确认并完成 R36-R38 | R36-R38 | GPT-5 Codex | 真机模拟提示词增加删除 TODO 与禁止提交约束；请求记录空状态改为紧凑展示；代理标题移到 Tabs 前并移除当前项目提示 |
| 2026-08-28 | 提议 R39：优化顶部品牌层级、Tooltip 换行和规则区按钮视觉 | 调整 `ProxyHeader`/项目导航的结构与背景，使用 Tooltip React 内容实现分点提示，统一 Apifox/添加接口主按钮和重置危险按钮样式，并扩大搜索框最小宽度 | R39 | GPT-5 Codex |
| 2026-08-28 | 提议 R40：合并规则表接口信息与请求列 | `RuleTable` 仅保留接口信息、Mock 目标、操作等必要列；接口信息单元格复用 URL 外链，按名称和 `method + path` 两行布局；匹配模式/优先级仍保留在编辑数据中但不在表格单独展示 | R40 | GPT-5 Codex |
| 2026-08-28 | 提议 R41：恢复顶部标题背景并移除品牌副标题 | 为 `proxy-header` 增加浅色背景/边界层级，删除 `WECHAT DEVTOOLS` 文案，修正 R39 视觉回归 | R41 | GPT-5 Codex |
| 2026-08-28 | 提议 R42：顶部标题改回深色主题 | 当前标题背景误用浅色；改用接近 `#1C2620` 的深色背景，并调整标题、品牌和状态文字颜色以满足可读性 | R42 | GPT-5 Codex |
| 2026-08-28 | 完成 R42 | R42 | GPT-5 Codex | 顶部标题背景恢复为 `#1C2620` 深色主题，品牌标识和代理标题使用高对比浅色；WECHAT DEVTOOLS 未恢复 |
| 2026-08-28 | 用户通过 `ac` 确认并完成 R43 | R43 | GPT-5 Codex | 版本号从项目导航迁回代理标题右侧；运行状态从标题内容中抽离并固定在右侧 |
| 2026-08-28 | 提议 R44：移除静态项目标题并保证至少一个真实项目 Tab | 删除 `project-tabs-title` 展示；在删除项目入口禁用最后一个项目的删除操作，并在后端删除命令增加最后项目保护，确保始终存在可选项目 | R44 | GPT-5 Codex |
| 2026-08-28 | 提议 R45：关闭应用前增加代理还原提醒 | 在 Tauri 窗口关闭事件中拦截关闭动作，使用应用内确认对话框提醒用户还原微信开发者工具代理设置；确认后允许关闭，取消则保持应用运行 | R45 | GPT-5 Codex |
| 2026-08-28 | 完成 R45 | R45 | GPT-5 Codex | 使用 Tauri `onCloseRequested` 拦截桌面窗口关闭，Ant Design Modal 展示代理还原路径；确认后放行窗口关闭，网页预览不注册监听 |
| 2026-08-28 | 修复 R45 关闭确认后窗口未退出 | R45 | GPT-5 Codex | 保存 `onCloseRequested` 注销函数；确认时先解除监听再调用 `Window.close()`，避免重复拦截；关闭失败恢复监听并展示错误，取消仍保持窗口运行 |
| 2026-08-28 | 完成 R44 | R44 | GPT-5 Codex | 移除静态项目标题；最后一个项目 Tab 的删除入口禁用，`delete_profile` 后端命令同步拒绝删除最后项目 |
| 2026-08-28 | 完成 R41 | R41 | GPT-5 Codex | 代理标题恢复浅色背景卡片层级；APIFOX PROXY 仅保留品牌文案并移除 WECHAT DEVTOOLS 副标题 |
| 2026-08-28 | 完成 R40 | R40 | GPT-5 Codex | 删除请求/匹配独立列，接口信息列按中文名称与 Method+URL 两行展示，保留 URL 外链 |
| 2026-08-28 | 用户通过 `ac` 确认并完成 R39 | R39 | GPT-5 Codex | 品牌文案并入代理标题行，项目 Tabs 改为浅色背景；Tooltip 分点换行；搜索框扩宽；Apifox/重置按钮分别统一主色/危险色 |

## 当前交付基线

- 版本：`0.1.25`，本次为遗留代码清理与关闭确认修复维护版本。
- 已实现并完成代码级验证：项目 Tabs/CRUD、在线 Apifox Tag Replace 同步、Mock Token、HTTP/HTTPS 代理、全局与单接口 Mock 门控、规则测试/编辑/删除/重置、实时请求记录、真机模拟提示词、Ant Design 工作台和关闭提醒。
- 明确边界：仅支持在线 Apifox 模式；不自动修改微信开发者工具或 macOS 系统代理；不绕过证书固定；真实微信开发者工具和真实 Apifox 账号仍需用户按使用与验收文档人工验收。

## 验证结果

| 日期 | 验证项 | 结果 | 说明 |
| --- | --- | --- | --- |
| 2026-08-27 | Rust 单元与代理 E2E | 通过 | `cargo test`：12 passed；包含跨 Tag Merge 保留、无 Apifox 扩展字段 OpenAPI、目录 Tag 过滤、真实 HTTP 转发和 HTTPS CONNECT + 动态 CA + TLS upstream |
| 2026-08-27 | 前端构建与源码约束 | 通过 | `pnpm build`、`pnpm run check:source` 通过，无三元表达式且 TS/TSX 单文件小于 500 行 |
| 2026-08-27 | Rust 编译 | 通过 | `cargo check --manifest-path src-tauri/Cargo.toml` 通过 |
| 2026-08-27 | Mock Token 运行时热更新 | 通过 | `cargo test --manifest-path src-tauri/Cargo.toml`：14 passed；新增同 Profile 热更新隔离与后续请求 Query 携带 Token 回归测试，HTTP/HTTPS E2E 均通过 |
| 2026-08-27 | R13 Tag 运行时范围移除 | 通过 | `cargo test`：14 passed；`pnpm build`、`pnpm run check:source`、`cargo check`、`cargo fmt --check`、`git diff --check` 通过 |
| 2026-08-27 | R14 全局 Mock Switch | 通过 | `cargo test`：17 passed；覆盖全局关闭透传且逐接口状态保持、旧项目迁移开启、新项目默认关闭；HTTP/HTTPS E2E 通过 |
| 2026-08-27 | R15-R17 Token、同步目标与日志视口 | 通过 | `cargo test`：21 passed；`pnpm build`、`pnpm run check:source`、`cargo check`、`cargo fmt --check`、`git diff --check` 通过 |
| 2026-08-27 | R18 固定 Replace、规则表与 Apifox Web 外链 | 通过 | `cargo test`：22 passed；包含 Replace 保留 Custom、链接规范化/兜底、真实 HTTP 与 HTTPS E2E；`pnpm build`、`pnpm run check:source`、`cargo check` 通过 |
| 2026-08-27 | R19 规则删除、重置与标题布局 | 通过 | `cargo test`：23 passed；覆盖重置仅清空规则/Tag 且保留连接、Token、Mock 前缀和全局开关；HTTP/HTTPS E2E 通过；`pnpm build`、`pnpm run check:source`、`cargo check`、`cargo fmt --check`、`git diff --check` 通过 |
| 2026-08-27 | 0.1.1 本地安装包 | 通过 | arm64；ad-hoc hardened runtime 签名通过 `codesign --verify --deep --strict`；DMG 通过 `hdiutil verify`；SHA-256 `c02919475f4b10e788419906455b2cc670a2fe330d3285d9c458dd96041f1c1f` |
| 2026-08-27 | 0.1.2 本地安装包 | 通过 | arm64；ad-hoc hardened runtime 签名通过；DMG 通过 `hdiutil verify`；SHA-256 `a04510ec4cd141342b8df3be069af515abe4e2f3f73f619558f53125c2c11387` |
| 2026-08-27 | 0.1.3 本地安装包 | 通过 | arm64，包内版本 0.1.3；ad-hoc 签名通过 `codesign --verify --deep --strict`；DMG 通过 `hdiutil verify`；SHA-256 `ec223284932894b56a47bbb8de016b095aa018632ed0f7428a4d102a69f22aaf` |
| 2026-08-27 | 0.1.5 本地安装包 | 通过 | arm64，包内版本 0.1.5；ad-hoc 签名通过 `codesign --verify --deep --strict`；DMG 通过 `hdiutil verify`；SHA-256 `6fd8db567ef767958490691f3926497a6843ac099d9c6874dfe090ee0cc62d59` |
| 2026-08-27 | 0.1.6 本地安装包 | 通过 | arm64，包内版本 0.1.6；ad-hoc 签名通过 `codesign --verify --deep --strict`；DMG 通过 `hdiutil verify`；SHA-256 `79663b903ad5b7b9f9a713859bef5f70e0384fef1d8325e8e0c7589ca2b73999` |
| 2026-08-27 | R20 Ant Design UI 迁移 | 通过（自动视觉检查受限） | `pnpm build`、`check:source`、原生基础控件与自制 Toast/Modal/Switch 源码扫描通过；Rust 23 项测试、`cargo check`、`cargo fmt --check` 通过；当前浏览器连接不可用，且系统存在同 bundle ID 的已安装版与构建版，未自动操作旧版窗口 |
| 2026-08-27 | R21 低频配置弹框化 | 通过 | `pnpm build`、`pnpm run check:source`、`git diff --check` 通过；源码确认顶部重复地址和常驻配置面板已移除，Apifox/证书入口、弹框与既有操作回调完整保留 |
| 2026-08-27 | R22 Mock 接口命名与 URL 自动映射 | 通过 | Rust 26 项测试全部通过，覆盖完整 URL、模板路径、精确/唯一模糊/歧义/未命中、Apifox 链接保存和 HTTP/HTTPS E2E；`pnpm build`、`check:source`、`cargo check`、`cargo fmt --check`、`git diff --check` 通过 |
| 2026-08-27 | 0.1.8 本地安装包 | 通过 | arm64，包内短版本与构建版本均为 0.1.8；ad-hoc 签名通过 `codesign --verify --deep --strict`；DMG 通过 `hdiutil verify`；SHA-256 `785abd938df0c221f7ea1b466bd5cf203d5c32f5345a0e45b7ee9e6fb9bf9896`；macOS 未授予 Computer Use 权限，未执行自动截图和桌面点击验收 |
| 2026-08-27 | 0.1.7 本地安装包 | 通过 | arm64，包内短版本与构建版本均为 0.1.7；ad-hoc 签名通过 `codesign --verify --deep --strict`；DMG 通过 `hdiutil verify`；SHA-256 `bad3ffb9ff5437fcb1061c26e74ed7c3bfcc79fca2a9742cd1598ec4cdbfd3fd` |
| 2026-08-27 | R23 连接配置布局与应用版本展示 | 通过（自动视觉检查受限） | `pnpm build`、`pnpm run check:source`、`cargo check`、`cargo fmt --check`、`git diff --check` 通过；Rust 26 项测试全部通过，包含 HTTP/HTTPS E2E；源码确认表单单列、配置入口分行、版本来自 Tauri API 和构建注入；本地预览运行于 `http://127.0.0.1:1420/`，当前无可用浏览器连接，未执行自动截图与点击验收 |
| 2026-08-27 | 0.1.9 本地安装包 | 通过 | arm64，DMG 内 `.app` 短版本与构建版本均为 0.1.9；ad-hoc 签名通过 `codesign --verify --deep --strict`；DMG 通过 `hdiutil verify`；SHA-256 `fae70368fa1c9576edccb721f32c6773c5b62eef438b0af7907919e5896358f5` |
| 2026-08-28 | R24 自动监听与安全透传 | 通过 | Rust 27 项测试全部通过；`pnpm build`、`pnpm run check:source`、`cargo check`、`cargo fmt --check`、`git diff --check` 通过；新增启动重置全局 Mock 测试，HTTP/HTTPS E2E 回归通过 |
| 2026-08-28 | R25 在线弹框与滚轮隔离 | 通过（自动视觉检查受限） | `pnpm build`、`pnpm run check:source`、`cargo check`、`cargo fmt --check`、`git diff --check` 通过；当前无可用浏览器连接，未执行自动截图与滚轮人工验收 |
| 2026-08-28 | R26 Mock 接口测试与单接口调试 | 通过（自动视觉检查受限） | `pnpm build`、`pnpm run check:source`、`git diff --check` 通过；当前无可用浏览器连接，未执行桌面点击和真实 Mock 请求人工验收 |
| 2026-08-28 | 0.1.23 最终交付基线 | 通过 | 最新 DMG 为 `src-tauri/target/release/bundle/dmg/Apifox Proxy_0.1.23_aarch64.dmg`；`hdiutil verify` 通过，SHA-256 `d452af3b8ba71e94e5ac1ad80729c05bfd9eb7b8d299e7cecb6acbda135e6007`；代码级验证沿用前述构建、源码检查、Rust 检查和 E2E 证据 |
| 2026-08-28 | 0.1.25 关闭确认与安装包修复 | 通过 | 确认关闭前注销 `onCloseRequested` 监听再调用 `Window.close()`；`pnpm package:mac` 使用 staging 目录和 `/Applications` 入口生成安装型 DMG；`hdiutil verify` 通过，SHA-256 `38e501bda60a369e3b5df3350ba12049ce65bb9ed100b35c0bc93c6b668c9f9e` |
| 2026-08-28 | 0.1.26 修复窗口关闭 ACL | 通过构建验证 | 主窗口 capability 增加 `core:window:allow-close`，保留确认后注销监听再关闭逻辑；DMG 已生成并通过 `hdiutil verify`，SHA-256 `73b577be3a9c4ed84346d5bf77ad18e9b1524b58b4841641817309493fb388e1`；仍需用户在打包应用中人工点击关闭确认窗口退出 |
| 2026-08-28 | 0.1.27 测试响应搜索交付包 | 通过 | `pnpm package:mac` 成功生成安装型 DMG；`hdiutil verify` 通过，SHA-256 `5be412c58e7a916aab60601f2d1a9fa630c0575ebd9e9a535b9c6cd975408e07` |
| 2026-08-28 | 0.1.28 响应搜索多匹配导航交付包 | 通过 | `pnpm package:mac` 成功生成安装型 DMG；`hdiutil verify` 通过，SHA-256 `6556fdf8b425b904ef7770d9213cc603bf922ece4588fef467c820d729baef41` |
| 2026-08-28 | 0.1.29 无项目创建入口修复交付包 | 通过 | `pnpm package:mac` 成功生成安装型 DMG；`hdiutil verify` 通过，SHA-256 `719b3009f3242e94202615f0e378a53b78dfdefb3fab69f9c91cdbf323cc736a` |
| 2026-08-28 | 0.1.30 复合操作单次反馈修复交付包 | 通过 | `pnpm package:mac` 成功生成安装型 DMG；`hdiutil verify` 通过，SHA-256 `5afda4579c0833276e6e2f321bef313c63c582b64a869ef53d0e3b39880db846` |
| 2026-08-28 | 0.1.32 全局 Mock 切换重建连接修复包 | 通过 | `pnpm package:mac` 成功生成安装型 DMG；`hdiutil verify` 通过，SHA-256 `0509ae921a6f6d53bc97ef34e85bc433b72b34e2d03e0df651e81178c47445dd` |
| 2026-08-28 | 0.1.33 HTTPS 隧道常驻 MITM 修复包 | 通过 | `pnpm package:mac` 成功生成安装型 DMG；`hdiutil verify` 通过，SHA-256 `889e66d8bdd93a9d1554c976f2e6c44f2f565f25971940d5879d2370b5253ab1` |
| 2026-08-29 | 0.1.34 移除自定义响应体并优化体积 | 通过 | `pnpm package:mac` 成功生成安装型 DMG；启用 Rust release 体积优化后 DMG 为 5,459,586 bytes，`hdiutil verify` 通过，SHA-256 `3bb5b923c0e464c5184f02df933af7d41ec5800c4d3c0dc46f29359a0e380f5d` |
| 2026-08-29 | 0.1.35 发布包 | 通过 | `pnpm package:mac` 成功生成安装型 DMG；DMG 为 5,459,680 bytes，`hdiutil verify` 通过，SHA-256 `a3d837b645e8e4e87dec582ff206122affcd3829a1e5f929c0da9596ccf18c65` |
| 2026-08-31 | 0.1.36 重试 Mock 测试交付包 | 通过 | `pnpm run package:mac` 成功生成安装型 DMG；DMG 为 5,460,077 bytes，`hdiutil verify` 通过，SHA-256 `b01621098dd67f0931ac0045fb41c581a8462c0bffa97b37097d6028a0261071`；未配置 Apple 公证凭据，保持本地签名未公证 |
| 2026-08-28 | 完成 R46 测试响应搜索与弹框操作调整 | 通过构建验证 | 测试弹框移除重复“关闭”按钮，“去 Mock 接口”固定右侧；响应内容增加搜索框、`Ctrl/Cmd+F` 聚焦、匹配高亮、首个匹配自动滚动和 420px 内部滚动；`pnpm build`、`pnpm run check:source`、`git diff --check` 通过 |
| 2026-08-28 | 完成 R47 响应搜索多匹配导航 | 通过构建验证 | 增加匹配计数、当前命中高亮、上/下循环导航及 Enter/Shift+Enter 快捷键；关键词变化重置到首个匹配；`pnpm build`、`pnpm run check:source`、`git diff --check` 通过 |
| 2026-08-28 | 用户通过 `ac` 确认并完成 R48 无项目创建入口修复 | 通过构建验证 | 空配置时 `Workspace` 提前返回导致项目 Tabs/新建按钮不渲染；调整为空状态仍渲染项目导航，复用现有创建弹框；`pnpm build`、`pnpm run check:source`、`git diff --check` 通过 |
| 2026-08-28 | 用户通过 `ac` 确认并完成 R49 复合操作单次反馈 | 通过构建验证 | `apply` 支持静默成功反馈；仅调试当前接口的内部开关步骤不再逐条弹 Toast，全部成功后只提示一次；按钮移除重复反馈；`pnpm build`、`pnpm run check:source`、`git diff --check` 通过 |
| 2026-08-28 | 完成 R51 全局 Mock 切换重建 HTTPS 连接 | 通过构建与 Rust 检查 | 全局开关命令改为异步，持久化后重启当前代理监听并等待端口释放，确保客户端建立新 HTTPS 隧道；`cargo check`、`pnpm build`、`pnpm run check:source`、`git diff --check` 通过 |
| 2026-08-28 | 完成 R52 HTTPS 隧道常驻 MITM | 通过全量测试与构建 | CONNECT/TLS 拦截改为按活动项目常驻，Mock 开关仅在请求层门控；关闭时保持解密后透传，开启后可处理复用连接中的后续请求；`cargo test` 27 passed、`pnpm build`、`pnpm run check:source`、`git diff --check` 通过 |
| 2026-08-31 | R53 Tag/Loading/接口信息复制修复 | 通过构建验证 | `pnpm build`、`pnpm run check:source`、`cargo check`、`git diff --check` 通过；长 Tag 视觉和剪贴板内容仍需桌面人工验收 |
| 2026-09-03 | R54 Mock 接口跨 Tab 单条与批量移动 | 通过（自动视觉检查受限） | `cargo test --manifest-path src-tauri/Cargo.toml` 29 项通过，覆盖批量移动、本地响应依赖复制和目标 ID 冲突原子回滚；`pnpm build`、`pnpm run check:source`、`cargo check`、`cargo fmt --check`、`git diff --check` 通过；当前无可用浏览器实例，移动弹框与桌面持久化交互待人工验收 |
| 2026-09-03 | R55 新建 Tab 继承 Apifox 配置 | 通过 | `cargo test --manifest-path src-tauri/Cargo.toml` 30 项通过，新增测试覆盖首个 Tab 的项目 ID、Mock 前缀和两个 Token 继承，以及 `syncedTags`/`activeTags` 保持为空；`pnpm build`、`pnpm run check:source`、`cargo check`、`cargo fmt --check`、`git diff --check` 通过 |
| 2026-09-03 | R56 Mock 接口按 Tab 隔离 | 通过 | `cargo test --manifest-path src-tauri/Cargo.toml` 32 项通过，覆盖同一 Profile ID 稳定、不同 Profile ID 隔离，以及 Profile 级 ID 下目标 Tab 同一 Apifox operation 移动冲突；`pnpm build`、`pnpm run check:source`、`cargo check`、`cargo fmt --check`、`git diff --check` 通过；`mspecify review --only-new` 因当前环境未安装 `mspecify` 未执行 |
| 2026-09-03 | R57 Tab 切换静默成功 | 通过 | Tab 切换调用 `apply(..., false)`，成功 Toast 已关闭，异常提示和诊断记录保持不变；`pnpm build`、`pnpm run check:source`、`git diff --check` 通过 |
| 2026-08-31 | 用户通过 `ac` 确认并完成 R53 | R53 | GPT-5 Codex | Tag Select 固定 420px 宽度且使用固定标签数量；验证、拉取、同步 loading 独立；接口信息复制包含源 URL、方法路径和 Apifox 地址 |
| 2026-09-03 | 完成 R54 Mock 接口跨 Tab 移动 | R54 | GPT-5 Codex | 单条和批量入口复用目的 Tab 弹框；后端整批原子移动，目标冲突时不改动源数据，本地 Mock 响应依赖复制到目标；保留 Apifox 来源与后续 Replace 同步语义 |
| 2026-09-03 | 完成 R55 新建 Tab 继承 Apifox 配置 | R55 | GPT-5 Codex | 创建新 Profile 时复制当前首个 Profile 的 Apifox 连接配置；Tag、规则、全局开关和本地响应继续按 Tab 隔离 |
| 2026-09-03 | 完成 R56 Mock 接口按 Tab 隔离 | R56 | GPT-5 Codex | Apifox 同步规则 ID 增加 Profile 作用域；不同 Tab 可保存同一接口，同一 Tab 重复同步 ID 稳定；移动判重继续按 Apifox operation 约束目标 Tab 内重复 |
| 2026-09-03 | 完成 R57 Tab 切换静默成功 | R57 | GPT-5 Codex | 切换 Tab 成功时不再弹 Toast；失败反馈和运行诊断继续保留 |
| 2026-08-31 | 版本升级 | 已完成 | 应用版本由 0.1.39 升至 0.1.40 |
| 2026-08-31 | 版本升级 | 已完成 | 应用版本由 0.1.40 升至 0.1.41 |
| 2026-09-03 | 版本升级 | 已完成 | 应用版本由 0.1.41 升至 0.1.42 |
| 2026-09-03 | 0.1.42 Mock 接口跨 Tab 移动交付包 | 通过 | `pnpm package:mac` 成功生成安装型 DMG；包内短版本与构建版本均为 0.1.42；ad-hoc 深度签名和 `hdiutil verify` 通过；DMG 为 5,481,459 bytes，SHA-256 `bee29cb3b683ce4b1ef411a0aec1ea7781e70c395482ba17baa15c91f5f9c4cd`；未配置 Apple 公证凭据 |
| 2026-09-03 | 版本升级 | 已完成 | 应用版本由 0.1.42 升至 0.1.43 |
| 2026-09-03 | 0.1.43 新建 Tab 继承 Apifox 配置交付包 | 通过 | `pnpm package:mac` 成功生成安装型 DMG；包内短版本与构建版本均为 0.1.43；ad-hoc 深度签名和 `hdiutil verify` 通过；DMG 为 5,477,394 bytes，SHA-256 `20d983cb900984da264b98a1ec1cc5e1e686425b81909bccc7fa29fb2c0b54ee`；未配置 Apple 公证凭据 |
| 2026-09-03 | 版本升级 | 已完成 | 应用版本由 0.1.43 升至 0.1.44 |
| 2026-09-03 | 0.1.44 Mock 接口按 Tab 隔离交付包 | 通过 | `pnpm package:mac` 成功生成安装型 DMG；包内短版本与构建版本均为 0.1.44；ad-hoc 深度签名和 `hdiutil verify` 通过；DMG 为 5,485,304 bytes，SHA-256 `7d00bd30d91b8c3d306801a68e17084a8577f0e0f67be8355cc9c0f326fcf12b`；未配置 Apple 公证凭据 |
| 2026-09-03 | 版本升级 | 已完成 | 应用版本由 0.1.44 升至 0.1.45 |
| 2026-09-03 | 0.1.45 Tab 切换静默成功交付包 | 通过 | `pnpm package:mac` 成功生成安装型 DMG；包内短版本与构建版本均为 0.1.45；ad-hoc 深度签名和 `hdiutil verify` 通过；DMG 为 5,485,406 bytes，SHA-256 `03416d90db5e11abcf0812d44440050946c8fc269b04639544995836a79516c4`；未配置 Apple 公证凭据 |
| 2026-08-27 | 0.1.9 用户安装验收 | 通过 | 用户确认验证通过并要求提交当前实现 |
| 2026-08-27 | 微信开发者工具真实项目人工验收 | 待用户执行 | 需要用户的真实源域名、Apifox 项目、Token 和微信开发者工具环境；按 `main-使用与验收文档.md` 验收 |
# R20 Ant Design UI 迁移方案

## 目标与边界

- 使用 Ant Design 6 统一基础交互组件，保留现有页面信息架构、绿色品牌色、紧凑桌面布局和业务流程。
- 使用 `ConfigProvider` 集中设置中文 locale、主色、圆角、控件尺寸和字体；Lucide 图标继续作为按钮图标使用。
- 使用 `classnames` 组合业务状态类名。TailwindCSS 已获准使用，但本轮不引入，避免迁移期间并存两套新的样式约束；现有布局 CSS 继续负责工作台网格、固定高度和业务内容换行。
- 不修改 Tauri command、Rust 代理、配置结构、Apifox 同步协议和请求转发语义。

## 组件映射

| 现有实现 | Ant Design 实现 | 保持项 |
| --- | --- | --- |
| 原生按钮与图标按钮 | `Button`、`Tooltip` | 命令层级、图标、禁用与 loading 状态 |
| 原生输入框、数字框、下拉框 | `Input`、`InputNumber`、`Select`、`Segmented` | 字段文案、回显、校验和 Tag 选择流程 |
| 手写开关 | `Switch` | 全局 Mock 与单接口启停语义 |
| 原生表格 | `Table` | Mock 接口表格自适应高度、固定列宽、长 URL 换行和操作列；请求记录单独使用 360px 内部滚动视口 |
| 手写遮罩弹窗与确认框 | `Modal`、`Popconfirm` | 创建/编辑/删除/重置的确认流程 |
| 自制 Toast | `App.useApp()` / `message` | 所有成功和失败反馈，错误内容脱敏 |
| 手写空状态与状态标签 | `Empty`、`Alert`、`Badge`、`Tag` | 紧凑信息展示和原有状态语义 |

## 实施与验证

1. 在应用入口接入 `ConfigProvider` 与 `App` 上下文，定义紧凑绿色主题。
2. 依次迁移全局反馈、侧栏与运行控制、Apifox 同步、规则管理、请求日志、证书与诊断模块。
3. 清理被替代的手写基础控件、Modal、Switch、Table 和 Toast CSS，仅保留布局与业务展示样式。
4. 每个增量执行 TypeScript/Vite 构建和源码规范检查；完成后验证桌面与窄窗口布局、下拉层、弹窗、固定滚动区和长 URL 换行。
5. 全量验证前端构建、Rust 单测/检查、Tauri 安装包构建及 DMG 完整性。
