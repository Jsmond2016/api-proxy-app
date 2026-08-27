import { CheckCircle2, Circle, Copy } from "lucide-react";
import type { CertificateStatus, ProjectProfile, ProxyStatus } from "../types";

interface ConnectionGuideProps {
  certificate: CertificateStatus;
  profile: ProjectProfile;
  proxyStatus: ProxyStatus;
  hasTraffic: boolean;
}

export function ConnectionGuide(props: ConnectionGuideProps) {
  const endpoint = `127.0.0.1:${props.profile.port}`;
  return (
    <section className="connection-guide">
      <div><span className="section-kicker">WECHAT DEVTOOLS</span><strong>接入检查</strong></div>
      <GuideCheck ready={props.certificate.trusted} text="CA 已导入并设为始终信任" />
      <GuideCheck ready={props.proxyStatus === "running"} text="本地代理端口正在监听" />
      <GuideCheck ready={props.hasTraffic} text="已收到微信开发者工具流量" />
      <div className="guide-endpoint"><span>在微信开发者工具代理设置中填写</span><code>{endpoint}</code><button className="copy-button" onClick={() => navigator.clipboard.writeText(endpoint)} title="复制" type="button"><Copy size={14} /></button></div>
    </section>
  );
}

function GuideCheck({ ready, text }: { ready: boolean; text: string }) {
  if (ready) return <div className="guide-check guide-ready"><CheckCircle2 size={16} /><span>{text}</span></div>;
  return <div className="guide-check"><Circle size={16} /><span>{text}</span></div>;
}
