# 项目结构

```text
src/                 React 工作台与桌面调用封装
src/components/      项目、规则、证书、日志等界面组件
src-tauri/src/       代理、状态、Apifox 解析与 Tauri commands
docs-site/           VitePress 用户与开发文档
specs/               需求、方案和历史验收记录
scripts/             构建、发布与本地质量检查
```

Rust 层拥有配置解析、状态持久化、端口生命周期、证书和请求转发；React 层负责表单、工作台状态与用户反馈。前端不直接写本地状态文件，所有写操作通过受控 Tauri command 完成。

请求日志是运行时数据，不会写回配置文件。配置写入采用临时文件和备份策略，避免中途失败留下半成品状态。
