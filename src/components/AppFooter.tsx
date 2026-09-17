import type { MouseEvent } from "react";
import { Github } from "lucide-react";
import * as desktop from "../lib/desktop";

const PROJECT_URL = "https://github.com/Jsmond2016/api-proxy-app";
const AUTHOR_URL = "https://github.com/Jsmond2016";

interface AppFooterProps {
  version: string;
}

/** Shows public project attribution without navigating the desktop webview away. */
export function AppFooter({ version }: AppFooterProps) {
  function openExternal(event: MouseEvent<HTMLAnchorElement>) {
    if (!desktop.isDesktopRuntime()) return;
    event.preventDefault();
    void desktop.openExternalUrl(event.currentTarget.href);
  }

  return (
    <footer className="app-footer">
      <span>v{version}</span>
      <span aria-hidden="true" className="app-footer-divider">|</span>
      <a href={PROJECT_URL} onClick={openExternal} rel="noopener noreferrer" target="_blank" title="Apifox Proxy 项目主页">
        <Github aria-hidden="true" size={13} />项目
      </a>
      <span aria-hidden="true" className="app-footer-divider">|</span>
      <a href={AUTHOR_URL} onClick={openExternal} rel="noopener noreferrer" target="_blank" title="Jsmond2016 的 GitHub 主页">作者-Jsmond2016</a>
    </footer>
  );
}
