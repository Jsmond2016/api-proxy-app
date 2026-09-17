import { defineConfig } from "vitepress";

export default defineConfig({
  lang: "zh-CN",
  title: "Apifox Proxy",
  description: "面向微信开发者工具的本地 Apifox Mock 代理",
  themeConfig: {
    nav: [
      { text: "指南", link: "/guide/getting-started" },
      { text: "功能", link: "/features/projects" },
      { text: "配置与安全", link: "/configuration/proxy-and-ca" },
      { text: "开发", link: "/development/setup" },
    ],
    sidebar: {
      "/guide/": [
        { text: "指南", items: [{ text: "开始使用", link: "/guide/getting-started" }, { text: "快速流程", link: "/guide/quick-start" }, { text: "常见问题", link: "/guide/faq" }] },
      ],
      "/features/": [
        { text: "功能", items: [{ text: "项目与 Tabs", link: "/features/projects" }, { text: "Apifox 同步", link: "/features/apifox-sync" }, { text: "Mock 接口", link: "/features/mock-rules" }, { text: "本地响应", link: "/features/local-responses" }, { text: "项目预设", link: "/features/project-presets" }, { text: "请求记录", link: "/features/request-logs" }] },
      ],
      "/configuration/": [
        { text: "配置与安全", items: [{ text: "代理与证书", link: "/configuration/proxy-and-ca" }, { text: "信息保护", link: "/configuration/privacy" }, { text: "故障排查", link: "/configuration/troubleshooting" }] },
      ],
      "/development/": [
        { text: "开发", items: [{ text: "本地开发", link: "/development/setup" }, { text: "构建与校验", link: "/development/build" }, { text: "项目结构", link: "/development/architecture" }] },
      ],
    },
    socialLinks: [{ icon: "github", link: "https://github.com/Jsmond2016/api-proxy-app" }],
    footer: { message: "Apifox Proxy", copyright: "作者-Jsmond2016" },
    search: { provider: "local" },
  },
});
