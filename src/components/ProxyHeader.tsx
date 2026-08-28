import { Badge } from "antd";
import type { ProjectProfile, ProxyStatus } from "../types";

interface ProxyHeaderProps {
  profile: ProjectProfile;
  status: ProxyStatus;
  globalMockEnabled: boolean;
}

export function ProxyHeader({ status, globalMockEnabled }: ProxyHeaderProps) {
  return (
    <header className="proxy-header">
      <div className="proxy-header-content">
        <div className="proxy-title-row"><div className="header-brand"><div className="brand-mark">A</div><div><p className="header-brand-name">APIFOX PROXY</p><p className="header-brand-caption">WECHAT DEVTOOLS</p></div></div><h1>微信开发者工具代理</h1><Badge className={statusClass(status)} status={badgeStatus(status)} text={status} /></div>
        <p>{statusCopy(status, globalMockEnabled)}</p>
      </div>
    </header>
  );
}

function statusCopy(status: ProxyStatus, globalMockEnabled: boolean) {
  if (status === "running" && globalMockEnabled) return "端口监听中，已开启全局 Mock，将按接口开关转发到 Apifox。";
  if (status === "running") return "端口监听中，当前全量透传；开启下方全局 Mock 后才会转发到 Apifox。";
  if (status === "starting") return "正在绑定本地回环端口。";
  if (status === "error") return "代理运行失败，请检查端口占用、证书和下方请求错误。";
  return "代理端口尚未监听，请检查活动项目和端口错误。";
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
