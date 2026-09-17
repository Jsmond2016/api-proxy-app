# 构建与校验

```bash
pnpm build
pnpm run check:source
pnpm docs:build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

`check:source` 同时执行源码规模规则与隐私检查。`docs:build` 会先执行隐私检查，再生成静态文档站。需要本地预览文档时运行：

```bash
pnpm docs:dev
```

macOS 安装包可通过 `pnpm package:mac` 生成；正式交付前仍需使用真实且不公开的联调环境人工验证。
