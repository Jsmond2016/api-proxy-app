# 支持配置本地mock响应体 开发方案文档

## 开发分支

`feature/支持配置本地mock响应体`

## 方案概览

在现有 Tauri + React + hudsucker 代理链路中增加 Profile 级本地响应预设，并让 ProxyRule 可选引用预设。规则命中时在 `handle_request` 返回 `RequestOrResponse::Response`，否则沿用现有 URL 改写转发。

## 代码范围（可选）

| 分类 | 内容 |
| --- | --- |
| 路由 | 无（Tauri 桌面应用） |
| 代码文件 | `src/types.ts`、`src/App.tsx`、`src/components/RuleTable.tsx`、`src-tauri/src/model.rs`、`src-tauri/src/commands.rs`、`src-tauri/src/proxy/mod.rs`、测试和本目录文档 |
| 关联接口 | Tauri 本地响应预设与规则 CRUD commands、hudsucker handler |
| 功能点 | 本地响应预设 CRUD、规则绑定、直接响应、日志与持久化迁移 |

## 需求-方案映射

| 需求 ID | 开发方案 | 影响范围 | 使用模型 | 验证方式 | 状态 |
| --- | --- | --- | --- | --- | --- |
| R1 | `ProjectProfile.localResponses` 持久化；新增/编辑弹框和 Tauri CRUD command，使用稳定 ID | `model.rs`、`commands.rs`、`types.ts`、`App.tsx` | GPT-5 Codex | Rust 序列化/CRUD 测试、前端构建 | 已确认 |
| R2 | `ProxyRule.localResponseId` 可选字段；规则编辑表单增加开关和预设 Select，保存时校验引用存在 | `model.rs`、`commands.rs`、`RuleTable.tsx` | GPT-5 Codex | 规则保存/回显测试、前端源码检查 | 已确认 |
| R3 | 匹配后构造状态码、Content-Type 和 Body；延时在代理 handler 异步执行；本地响应单独完成日志 | `proxy/mod.rs`、测试 | GPT-5 Codex | HTTP/HTTPS 本地响应 E2E、未命中透传回归、延时和状态码断言 | 已确认 |

## 技术决策

| 决策项 | 结论 | 原因 | 备选方案 |
| --- | --- | --- | --- |
| 响应存储层级 | Profile 级预设，规则只保存 ID | 多个接口可复用；避免规则重复存储响应体 | 规则内嵌响应体：难以复用且编辑成本高 |
| 直接响应位置 | hudsucker `handle_request` 返回 Response | 无需额外端口；HTTP/HTTPS 共用现有 MITM | 启动独立 Mock HTTP 服务：多一层路由和生命周期 |
| 响应格式 | UTF-8 文本，默认 `application/json` | 满足粘贴 JSON 的主要场景并保持实现简单 | 首版解析/执行响应脚本：范围和安全风险过大 |

## 注意事项

保持旧配置可加载；缺失字段使用空列表/None 默认值；响应体不进入日志；HTTPS 继续依赖本地 CA 信任；限制延时和响应体大小，避免阻塞代理。

## 编码规范

- 所有新增或修改的 `.js`、`.ts`、`.tsx`、`.jsx`、`.mjs` 文件，格式化后单文件不得超过 500 个物理行；超过时按组件、Hook、纯函数或模块职责拆分。
- 代码保持精简，禁止重复代码；可复用的渲染、数据转换或业务逻辑按合理边界抽离。
- 禁止使用三元运算符；条件渲染优先采用 `renderXxx` 函数、哈希映射、`switch`、`if` 或提前返回。
- 禁止反向引用和双向引用。组件、模块和依赖只能从内向外单向引入；通过提取共享下层模块、调整职责边界或依赖注入消除循环依赖与层级反向依赖。

## 代码优化

无。

## 实施记录

| 日期 | 代码或方案变更 | 关联需求 | 使用模型 | 影响 |
| --- | --- | --- | --- |
| 2026-08-31 | 创建开发方案文档并经用户确认 | R1-R3 | GPT-5 Codex | 开始实施本地响应预设、规则绑定和代理直接响应 |
| 2026-08-31 | 完成本地响应预设、规则引用和代理直接响应 | R1-R3 | GPT-5 Codex | 新增 Tauri CRUD、React 双层弹框、规则开关/下拉和 hudsucker 本地 Response；兼容旧配置 |
| 2026-08-31 | 修复编辑 ID 丢失并增加复制按钮 | R1 | GPT-5 Codex | 编辑提交强制沿用原 ID；复制清空 ID、名称追加 `-copy` 后复用新增保存流程 |

## 验证结果

| 日期 | 验证项 | 结果 | 说明 |
| --- | --- | --- | --- |
| 2026-08-31 | 需求与方案评审 | 已通过 | 用户回复 `ac` |
| 2026-08-31 | `pnpm run check:source` | 通过 | 源码约束通过 |
| 2026-08-31 | `pnpm build`、`cargo fmt --check`、`cargo check` | 通过 | 前后端构建与格式检查通过 |
| 2026-08-31 | `cargo test` | 部分通过 | 25/27 通过；2 个网络 E2E 因沙箱禁止绑定回环端口失败 |
| 2026-08-31 | 版本升级与打包准备 | 已完成 | 应用版本由 0.1.36 升至 0.1.37 |
| 2026-08-31 | macOS `.app/.dmg` 打包 | 通过 | 生成 `src-tauri/target/release/bundle/macos/Apifox Proxy.app` 与 `Apifox Proxy_0.1.37_aarch64.dmg`；DMG 5.2M，`hdiutil verify` 通过，SHA-256 `2621c25319a58e01cf1ffcab3675cc359c58ebc43fa6aaf6fda1041d67dfe22d` |
