# 信息保护

公开源码、文档、截图、测试夹具和构建产物不得包含真实 Access Token、Mock Token、Authorization、Cookie、私钥、会话标识、真实业务域名、内部 API 路径、项目编号或公司/客户名称。

使用以下占位符编写示例：

| 数据 | 占位示例 |
| --- | --- |
| 源站 | `api.example.test` |
| Mock 地址 | `https://mock.example.test/<PROJECT_ID>/orders` |
| 凭据 | `<ACCESS_TOKEN>`、`<MOCK_TOKEN>` |
| 响应内容 | `<REDACTED>` |

运行所必需的第三方公共服务根地址可以保留在实现层，但不能与真实项目数据或凭据组合。执行 `pnpm run check:privacy` 可在本地检查高置信度凭据、内部域名和已知历史演示标识。
