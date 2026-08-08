import { ArrowUpRight, Check, KeyRound, ShieldAlert } from "lucide-react";
import type { CertificateStatus } from "../types";

interface CertificatePanelProps {
  certificate: CertificateStatus;
  onGenerate: () => void;
}

function CertificateIcon({ trusted }: { trusted: boolean }) {
  if (trusted) {
    return <Check size={18} strokeWidth={2} />;
  }

  return <ShieldAlert size={18} strokeWidth={2} />;
}

function getCertificateTitle(certificate: CertificateStatus) {
  if (certificate.trusted) {
    return "根证书已受信任";
  }

  if (certificate.generated) {
    return "等待在钥匙串中设为始终信任";
  }

  return "尚未生成本地根证书";
}

export function CertificatePanel({ certificate, onGenerate }: CertificatePanelProps) {
  return (
    <section className="certificate-panel">
      <div className="certificate-icon">
        <CertificateIcon trusted={certificate.trusted} />
      </div>
      <div className="certificate-copy">
        <span>HTTPS 解密状态</span>
        <strong>{getCertificateTitle(certificate)}</strong>
        <small>指纹 {certificate.fingerprint}</small>
      </div>
      <button className="outline-button certificate-button" onClick={onGenerate} type="button">
        <KeyRound size={16} strokeWidth={1.8} />
        生成证书
      </button>
      <button className="icon-button certificate-link" title="查看证书安装说明" type="button">
        <ArrowUpRight size={16} strokeWidth={1.8} />
      </button>
    </section>
  );
}
