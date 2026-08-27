import { FolderOpen, KeyRound, RefreshCw } from "lucide-react";
import type { CertificateStatus } from "../types";

interface CertificatePanelProps {
  certificate: CertificateStatus;
  onGenerate: () => Promise<void>;
  onOpen: () => Promise<void>;
  onRefresh: () => Promise<void>;
}

export function CertificatePanel(props: CertificatePanelProps) {
  return (
    <section className="certificate-panel">
      <div className={iconClass(props.certificate)}><KeyRound size={18} /></div>
      <div className="certificate-copy">
        <span>HTTPS 根证书</span>
        <strong>{certificateTitle(props.certificate)}</strong>
        <small title={props.certificate.certificatePath}>{certificateDetail(props.certificate)}</small>
      </div>
      <button className="outline-button certificate-button" onClick={props.onGenerate} type="button"><KeyRound size={15} />生成 / 读取</button>
      <button className="icon-button" disabled={!props.certificate.generated} onClick={props.onOpen} title="打开证书并导入钥匙串" type="button"><FolderOpen size={16} /></button>
      <button className="icon-button" onClick={props.onRefresh} title="刷新信任状态" type="button"><RefreshCw size={16} /></button>
    </section>
  );
}

function certificateTitle(certificate: CertificateStatus) {
  if (certificate.trusted) return "已生成并受系统信任";
  if (certificate.generated) return "已生成，尚未检测到系统信任";
  return "尚未生成";
}

function certificateDetail(certificate: CertificateStatus) {
  if (certificate.fingerprint) return `SHA-256 ${certificate.fingerprint}`;
  return "HTTPS 请求需要导入并始终信任此 CA";
}

function iconClass(certificate: CertificateStatus) {
  if (certificate.trusted) return "certificate-icon certificate-icon-trusted";
  return "certificate-icon";
}
