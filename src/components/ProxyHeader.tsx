import { Copy, Play, RotateCcw, Square } from "lucide-react";
import type { ProjectProfile, ProxyStatus } from "../types";

interface ProxyHeaderProps {
  profile: ProjectProfile;
  status: ProxyStatus;
  onStart: () => void;
  onStop: () => void;
}

function getStatusCopy(status: ProxyStatus) {
  if (status === "running") {
    return "代理正在监听本机回环地址";
  }

  if (status === "starting") {
    return "正在初始化本地代理";
  }

  if (status === "error") {
    return "端口或证书状态需要处理";
  }

  return "代理未启动，微信开发者工具不会转发请求";
}

function getStatusClassName(status: ProxyStatus) {
  if (status === "running") {
    return "status-indicator status-running";
  }

  if (status === "error") {
    return "status-indicator status-error";
  }

  return "status-indicator status-stopped";
}

export function ProxyHeader({ profile, status, onStart, onStop }: ProxyHeaderProps) {
  const endpoint = `127.0.0.1:${profile.port}`;

  async function copyEndpoint() {
    await navigator.clipboard.writeText(endpoint);
  }

  function startProxy() {
    onStart();
  }

  function stopProxy() {
    onStop();
  }

  return (
    <header className="proxy-header">
      <div>
        <div className="eyebrow">当前工作区 / {profile.name}</div>
        <div className="proxy-title-row">
          <h1>本地联调代理</h1>
          <span className={getStatusClassName(status)}>
            <i />
            {status}
          </span>
        </div>
        <p>{getStatusCopy(status)}</p>
      </div>

      <div className="header-actions">
        <div className="proxy-address">
          <span>代理地址</span>
          <strong>{endpoint}</strong>
          <button className="copy-button" onClick={copyEndpoint} title="复制代理地址" type="button">
            <Copy size={15} strokeWidth={1.8} />
          </button>
        </div>
        <button className="outline-button" onClick={startProxy} type="button">
          <RotateCcw size={16} strokeWidth={1.8} />
          检查服务
        </button>
        <button className="command-button" onClick={startProxy} type="button">
          <Play size={16} fill="currentColor" strokeWidth={1.8} />
          启动代理
        </button>
        <button className="stop-button" onClick={stopProxy} title="停止代理" type="button">
          <Square size={15} fill="currentColor" strokeWidth={1.8} />
        </button>
      </div>
    </header>
  );
}
