import { Badge, Button, Tooltip } from "antd";
import { Play, Square } from "lucide-react";
import type { ProjectProfile, ProxyStatus } from "../types";

interface ProxyHeaderProps {
  profile: ProjectProfile;
  status: ProxyStatus;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
}

export function ProxyHeader({ profile, status, onStart, onStop }: ProxyHeaderProps) {
  const running = status === "running";
  const starting = status === "starting";

  return (
    <header className="proxy-header">
      <div>
        <div className="eyebrow">当前项目 / {profile.name}</div>
        <div className="proxy-title-row"><h1>微信开发者工具代理</h1><Badge className={statusClass(status)} status={badgeStatus(status)} text={status} /></div>
        <p>{statusCopy(status)}</p>
      </div>
      <div className="header-actions">
        <Button className="command-button" disabled={running || starting} icon={<Play size={16} fill="currentColor" />} loading={starting} onClick={onStart} type="primary">启动代理</Button>
        <Tooltip title="停止代理"><Button aria-label="停止代理" className="stop-button" danger disabled={!running} icon={<Square size={15} fill="currentColor" />} onClick={onStop} /></Tooltip>
      </div>
    </header>
  );
}

function statusCopy(status: ProxyStatus) {
  if (status === "running") return "监听已建立，请按下方接入检查配置微信开发者工具。";
  if (status === "starting") return "正在绑定本地回环端口。";
  if (status === "error") return "代理运行失败，请检查端口占用、证书和下方请求错误。";
  return "启动后，命中域名与激活 Tag 的请求会转发到 Apifox Mock。";
}

function statusClass(status: ProxyStatus) {
  if (status === "running") return "status-indicator status-running";
  if (status === "error") return "status-indicator status-error";
  return "status-indicator status-stopped";
}

function badgeStatus(status: ProxyStatus) {
  if (status === "running") return "success" as const;
  if (status === "error") return "error" as const;
  if (status === "starting") return "processing" as const;
  return "default" as const;
}
