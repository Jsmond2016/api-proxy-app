# Apifox 代理桌面应用使用方式文档

> 历史归档文档。当前使用与验收步骤请参阅 `specs/需求-main/main-使用与验收文档.md`。

> **编写时间**：2026-08-08；**使用模型**：GPT-5；**用户**：jsmond2016

---

## 1. 文档目的

本文说明如何使用桌面应用将微信小程序的指定接口请求转发到 Apifox Mock，在不修改小程序业务代码的前提下完成接口联调。

核心使用流程如下：

```text
配置 Apifox 项目与 Token
        ↓
拉取 OpenAPI 接口 JSON
        ↓
按 Tag 或全部接口生成 Mock 规则
        ↓
配置源域名和拦截路径前缀
        ↓
微信开发者工具接入本地代理
        ↓
命中规则的请求转发到 Apifox Mock
```

## 2. 使用前准备

### 2.1 Apifox 配置

使用 Apifox 项目同步接口时，需要准备以下信息：

| 配置项 | 说明 |
| --- | --- |
| 项目 ID | Apifox 项目的唯一标识。仅填写项目名称通常不足以定位项目；当前版本将其作为项目配置标识，实际同步仍使用 OpenAPI 导出地址。 |
| 项目 Token | 用于访问项目 OpenAPI 导出数据的访问令牌。 |
| OpenAPI 导出地址 | Apifox 项目对应的 OpenAPI JSON 导出地址。 |
| Mock 地址前缀 | Apifox Mock 服务的基础地址，例如 `https://m1.apifoxmock.com/m1/981245-0-default`。 |

Token 只用于当前同步请求，不应写入请求日志、规则目标地址或配置导出文件。后续版本应使用 macOS Keychain 保存 Token。

当前版本的同步入口是 OpenAPI JSON 导出地址。后续可以根据项目 ID 和 Token 自动生成或获取导出地址，减少手动填写地址的步骤。

### 2.2 微信开发者工具配置

应用不会自动修改 macOS 系统代理设置。启动代理后，需要在微信开发者工具或当前调试环境中显式配置本地代理：

```text
代理地址：127.0.0.1
代理端口：8899
```

只有请求流量实际经过本地代理，应用才可以进行匹配和转发。仅在桌面应用中填写拦截前缀，不会自动拦截未经过代理的请求。

### 2.3 HTTPS 证书

HTTPS 请求需要本地代理终止 TLS 并重新建立连接，因此必须：

1. 在应用中生成本地 CA 证书。
2. 按应用提示将 CA 证书安装到 macOS 信任链。
3. 确认微信开发者工具或对应运行环境允许使用该受信任证书。
4. 再启动代理并进行接口请求验证。

证书默认只写入应用数据目录，应用不会静默修改系统钥匙串或系统代理设置。

## 3. 配置代理项目

每个项目档案代表一组独立的微信小程序联调配置。建议按照以下方式填写：

| 配置项 | 示例 | 作用 |
| --- | --- | --- |
| 项目名称 | 零售小程序 | 在应用中区分不同联调项目。 |
| 源请求域名 | `api.dev.acme.test` | 限制只处理指定后端域名的请求。 |
| 拦截路径前缀 | `/v1` | 限制只处理指定 API 路径前缀。 |
| 代理端口 | `8899` | 本地代理监听端口。 |
| Mock 地址前缀 | `https://m1.apifoxmock.com/m1/981245-0-default` | 命中后拼接为实际 Mock 目标地址。 |

例如，配置源域名 `api.dev.acme.test`、拦截前缀 `/v1` 后，以下请求满足全局拦截范围：

```text
https://api.dev.acme.test/v1/products
https://api.dev.acme.test/v1/orders?page=1
```

以下请求不满足该拦截范围：

```text
https://api.dev.acme.test/health
https://other.dev.acme.test/v1/products
```

## 4. 同步 Apifox 接口

### 4.1 拉取全部接口

1. 选择目标项目档案。
2. 填写 Apifox 项目 ID、Token 和 OpenAPI 导出地址。
3. 填写 Mock 地址前缀。
4. 不选择 Tag，或选择“全部接口”。
5. 执行同步。

应用解析 OpenAPI JSON 中的 `paths` 和 HTTP operation，并为每个接口生成一条本地代理规则。

### 4.2 按 Tag 拉取接口

1. 填写 Apifox 项目和 Token。
2. 获取项目接口 Tag 列表。
3. 选择需要参与联调的 Tag，例如“商品”和“订单”。
4. 执行同步。

只有包含所选 Tag 的接口会生成规则。该方式适合只 Mock 当前开发任务涉及的接口，降低误拦截范围。

### 4.3 规则生成示例

OpenAPI 中的接口：

```text
GET /v1/products
```

生成的 Mock 目标：

```text
https://m1.apifoxmock.com/m1/981245-0-default/v1/products
```

如果原始请求包含查询参数：

```text
https://api.dev.acme.test/v1/products?page=1
```

转发目标应保留查询参数：

```text
https://m1.apifoxmock.com/m1/981245-0-default/v1/products?page=1
```

请求的 Method、Body 和必要请求头也应保持原始语义。

## 5. 请求拦截与转发规则

### 5.1 全局拦截范围

应用应先根据源请求域名和路径前缀判断请求是否属于当前代理项目：

```text
源域名匹配 && 路径前缀匹配
```

例如：

```text
源域名：api.dev.acme.test
路径前缀：/v1
```

则所有符合以下条件的请求都进入规则匹配：

```text
请求域名等于 api.dev.acme.test
请求路径以 /v1 开头
```

### 5.2 规则匹配顺序

请求进入拦截范围后，按以下字段匹配规则：

1. HTTP Method，例如 `GET`、`POST`。
2. 路径匹配模式：`exact`、`contains` 或 `regex`。
3. 当前项目中规则是否启用。
4. 当前请求是否已经命中其他更高优先级规则。

建议规则优先级为：

```text
exact > regex > contains
```

### 5.3 命中规则

命中规则后，代理只改写请求目标，不修改小程序业务代码：

```text
原始请求：
GET https://api.dev.acme.test/v1/products?page=1

Mock 请求：
GET https://m1.apifoxmock.com/m1/981245-0-default/v1/products?page=1
```

转发过程中应保留：

- HTTP Method
- Path
- Query 参数
- Request Body
- 必要请求头

目标 Host 应更新为 Mock 服务 Host，避免 TLS 和 HTTP Host 不一致。

### 5.4 未命中规则

请求经过代理但未命中任何启用规则时，应保持原目标透传：

```text
未命中 Mock 规则 → 请求原始后端接口
```

这样可以只对指定接口进行 Mock，其余接口继续访问开发环境真实服务。

## 6. 联调操作流程

### 6.1 推荐流程

1. 启动桌面应用。
2. 创建或选择微信小程序项目档案。
3. 配置源域名、拦截路径前缀和代理端口。
4. 配置 Apifox 项目、Token、OpenAPI 地址和 Mock 前缀。
5. 按需选择 Tag 并同步接口。
6. 检查规则列表，关闭不需要 Mock 的规则。
7. 生成并信任本地 CA 证书。
8. 在微信开发者工具中配置 `127.0.0.1:8899`。
9. 启动本地代理。
10. 在小程序中触发目标请求。
11. 在请求日志中确认命中规则、Mock 目标、响应状态和耗时。

### 6.2 验证请求

可以使用以下请求确认代理链路：

```bash
curl --proxy http://127.0.0.1:8899 \
  --cacert ./apifox-proxy-ca.pem \
  "https://api.dev.acme.test/v1/products?page=1"
```

实际证书路径以应用展示路径为准。验证前需要确保测试域名和 Mock 服务可访问。

## 7. 当前实现状态

当前版本已经具备：

- Tauri 2 + React 桌面应用基础工程。
- Apifox OpenAPI JSON 拉取和 Token 临时传递。
- OpenAPI `paths` 解析和 Tag 筛选。
- Mock 规则生成和规则启停。
- 本地代理启动、停止和端口校验。
- `exact`、`contains`、`regex` 路径匹配。
- Mock URI 重写和查询参数保留。
- 本地 CA 生成、持久化和指纹展示。

仍需继续完善：

- 源请求域名和路径前缀的全局拦截配置。
- 规则优先级和重复规则处理。
- macOS Keychain Token 存储。
- CA 安装、信任状态检查和用户引导。
- 微信开发者工具 HTTPS 端到端验证。
- 未命中请求透传的端到端测试。

## 8. 常见问题

### 为什么配置了前缀却没有拦截请求？

通常是请求没有经过本地代理。请确认微信开发者工具配置了 `127.0.0.1:8899`，并确认代理状态为运行中。

### 为什么 HTTPS 请求失败？

请确认本地 CA 已安装并信任，同时检查微信开发者工具是否使用了不同的网络环境或证书校验策略。

### 为什么某个接口没有转到 Mock？

依次检查源域名、路径前缀、HTTP Method、规则路径、Tag 筛选结果以及规则启用状态。

### 未命中的请求会被阻断吗？

设计上不会。未命中规则的请求应透传到原始目标；如果透传失败，应通过请求日志显示具体失败原因。
# 历史归档说明

> 本文档对应早期桌面版原型。当前使用与验收步骤请参阅 `specs/需求-main/main-使用与验收文档.md`。
