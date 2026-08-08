# Apifox Proxy Desktop

> 面向微信小程序开发的 Apifox Mock 本地代理桌面应用。

## 项目简介

Apifox Proxy Desktop 使用 Tauri 2 构建 macOS 桌面应用，将微信小程序请求通过本地代理转发到 Apifox Mock。

应用的目标是在不修改小程序业务请求代码的前提下完成 Mock 联调：开发者配置 Apifox OpenAPI 导出地址、Token 和 Mock 地址后，同步接口并生成代理规则；微信开发者工具接入本地代理后，命中规则的请求自动转发到 Apifox Mock，未命中的请求继续透传到原始服务。

## 核心能力

- Tauri 2 + React + TypeScript 桌面工作台。
- 项目档案、代理状态、规则和请求日志管理。
- 拉取 OpenAPI JSON，并按 Tag 筛选接口。
- 根据 OpenAPI `paths` 生成 Apifox Mock 代理规则。
- 支持 `exact`、`contains`、`regex` 三种路径匹配模式。
- 支持本地代理启动、停止和端口占用检测。
- 命中规则后重写目标 URI，并保留 Method、Query 和请求 Body。
- 生成并持久化本地 CA 证书，用于 HTTPS 代理场景。
- 配置和规则写入应用数据目录，Apifox Token 当前仅在同步请求中临时使用。

## 工作流程

```text
配置 Apifox 项目 / Token / OpenAPI 地址
          ↓
同步接口并按 Tag 生成规则
          ↓
配置源域名和拦截路径前缀
          ↓
生成并信任本地 CA 证书
          ↓
微信开发者工具配置 127.0.0.1:8899
          ↓
启动代理并触发小程序请求
          ↓
命中规则转发到 Apifox Mock，未命中请求透传
```

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面容器 | Tauri 2 |
| 前端 | React 19、TypeScript、Vite |
| 原生后端 | Rust |
| HTTP/HTTPS 代理 | hudsucker 0.25 |
| HTTP 客户端 | reqwest |
| 本地状态 | 应用数据目录 JSON |
| 图标 | lucide-react |

## 快速开始

### 环境要求

- macOS
- Node.js
- pnpm 10+
- Rust 工具链
- Tauri 2 所需的 macOS 开发环境

### 安装依赖

```bash
pnpm install
```

### 启动 Web 开发模式

```bash
pnpm dev
```

### 启动 Tauri 桌面开发模式

```bash
pnpm tauri dev
```

### 构建前端

```bash
pnpm build
```

### 构建桌面应用

```bash
pnpm tauri build
```

### 运行源代码约束检查

```bash
pnpm run check:source
```

项目约束如下：

- `.js`、`.ts`、`.tsx` 单文件不超过 500 行。
- 禁止使用三元表达式。
- 样式和配置文件不受 500 行限制。

## 使用说明

推荐使用流程：

1. 创建或选择一个项目档案。
2. 配置源请求域名、拦截路径前缀和代理端口。
3. 填写 Apifox OpenAPI 导出地址、项目 Token 和 Mock 地址前缀。
4. 按需选择 Tag 并同步接口。
5. 检查规则并关闭不需要 Mock 的接口。
6. 生成并信任本地 CA 证书。
7. 在微信开发者工具中配置 `127.0.0.1:8899`。
8. 启动代理并触发小程序请求。
9. 在请求日志中确认请求是否命中规则以及实际 Mock 目标。

详细说明请查看：[应用使用方式文档](specs/tauri-desktop-app/tauri-desktop-app-应用使用方式文档.md)。

## 请求转发示例

假设项目配置如下：

```text
源域名：api.dev.acme.test
拦截前缀：/v1
Mock 前缀：https://m1.apifoxmock.com/m1/981245-0-default
```

原始请求：

```text
GET https://api.dev.acme.test/v1/products?page=1
```

命中规则后转发为：

```text
GET https://m1.apifoxmock.com/m1/981245-0-default/v1/products?page=1
```

请求 Method、Query、Body 和必要请求头保持原始语义。未命中规则时，代理应继续请求原始目标服务。

## 项目结构

```text
.
├── src/                         # React 前端和桌面工作台
│   ├── components/              # 项目、代理、证书、规则、日志组件
│   ├── features/workspace/      # 工作台演示数据
│   └── lib/                    # Tauri 调用和浏览器降级适配
├── src-tauri/
│   ├── src/apifox.rs            # OpenAPI 解析和规则生成
│   ├── src/commands.rs          # Tauri commands
│   ├── src/proxy/               # 本地 HTTP/HTTPS 代理
│   ├── src/state.rs             # 状态持久化和 CA 材料
│   └── src/model.rs             # Rust 数据模型
├── specs/tauri-desktop-app/     # 需求、方案和使用文档
├── scripts/                     # 源代码约束检查脚本
└── package.json
```

## 当前限制

- 当前同步入口是 OpenAPI JSON 导出地址，项目 ID 自动获取导出地址尚未接入。
- 源域名和路径前缀的全局拦截配置仍需继续完善。
- macOS Keychain Token 存储尚未实现。
- CA 自动安装、系统信任状态检查尚未完成。
- 微信开发者工具 HTTPS 端到端联调尚未完成验证。
- 当前阶段不自动修改 macOS 系统代理设置。

## 项目文档

- [需求文档](specs/tauri-desktop-app/tauri-desktop-app-需求文档.md)
- [开发方案文档](specs/tauri-desktop-app/tauri-desktop-app-开发方案文档.md)
- [应用使用方式文档](specs/tauri-desktop-app/tauri-desktop-app-应用使用方式文档.md)

## 开发分支

```text
feature/tauri-desktop-app
```
