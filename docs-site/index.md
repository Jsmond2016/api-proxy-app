# Apifox Proxy

Apifox Proxy 是 macOS 桌面代理工具。它让微信开发者工具的指定 HTTP/HTTPS 请求经由本地回环代理，按已同步的接口规则转发到 Apifox Mock，未命中的请求保持透传。

![Apifox Proxy 工作台](/apiproxy.png){.docs-product-shot}

## 从这里开始

- [开始使用](/guide/getting-started)：安装前提、代理边界与首次启动。
- [快速流程](/guide/quick-start)：从创建项目到验证一条 Mock 请求。
- [功能说明](/features/projects)：项目、同步、规则、日志与预设的详细行为。
- [代理与证书](/configuration/proxy-and-ca)：HTTPS 信任和接入微信开发者工具。

## 工作方式

```text
微信开发者工具
  -> 127.0.0.1:<PORT>
  -> host / path / Method / 规则匹配
  -> Apifox Mock 或原始服务
```

应用只监听本机回环地址，不会修改 macOS 全局代理，也不会自动改写微信开发者工具设置。
