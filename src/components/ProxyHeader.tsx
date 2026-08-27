import { Copy, Play, Square } from "lucide-react";
import type { ProjectProfile, ProxyStatus } from "../types";

interface ProxyHeaderProps {
  profile: ProjectProfile;
  status: ProxyStatus;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
}

export function ProxyHeader({ profile, status, onStart, onStop }: ProxyHeaderProps) {
  const endpoint = `127.0.0.1:${profile.port}`;
  const running = status === "running";
  const starting = status === "starting";

  return (
    <header className="proxy-header">
      <div>
        <div className="eyebrow">当前项目 / {profile.name}</div>
        <div className="proxy-title-row"><h1>微信开发者工具代理</h1><span className={statusClass(status)}><i />{status}</span></div>
        <p>{statusCopy(status)}</p>
      </div>
      <div className="header-actions">
        <div className="proxy-address"><span>HTTP / HTTPS 代理</span><strong>{endpoint}</strong><button className="copy-button" onClick={() => navigator.clipboard.writeText(endpoint)} title="复制代理地址" type="button"><Copy size={15} /></button></div>
        <button className="command-button" disabled={running || starting} onClick={onStart} type="button"><Play size={16} fill="currentColor" />启动代理</button>
        <button className="stop-button" disabled={!running} onClick={onStop} title="停止代理" type="button"><Square size={15} fill="currentColor" /></button>
      </div>
    </header>
  );
}

function statusCopy(status: ProxyStatus) {
  if (status === "running") return "监听已建立，请将微信开发者工具的代理指向右侧地址。";
  if (status === "starting") return "正在绑定本地回环端口。";
  if (status === "error") return "代理运行失败，请检查端口占用、证书和下方请求错误。";
  return "启动后，命中域名与激活 Tag 的请求会转发到 Apifox Mock。";
}

function statusClass(status: ProxyStatus) {
  if (status === "running") return "status-indicator status-running";
  if (status === "error") return "status-indicator status-error";
  return "status-indicator status-stopped";
}
