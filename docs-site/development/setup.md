# 本地开发

项目使用 pnpm、Vite、React、Tauri 与 Rust。进入仓库后安装依赖：

```bash
mise install
pnpm install
```

启动桌面应用：

```bash
pnpm tauri dev
```

单独启动网页预览只能检查界面；网络代理、本地配置和证书能力需要 Tauri 桌面进程。
