import { Alert, Button, Descriptions, Modal } from "antd";
import { FolderOpen, KeyRound, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { CertificateStatus } from "../types";

interface CertificatePanelProps {
  certificate: CertificateStatus;
  onGenerate: () => Promise<void>;
  onOpen: () => Promise<void>;
  onRefresh: () => Promise<void>;
}

export function CertificatePanel(props: CertificatePanelProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button className="config-entry-button" icon={<KeyRound size={15} />} onClick={() => setOpen(true)}>{certificateEntryLabel(props.certificate)}</Button>
      <Modal footer={null} onCancel={() => setOpen(false)} open={open} title="HTTPS 请求拦截证书" width={680}>
        <section className="certificate-modal-content">
          <Alert description="微信开发者工具信任此根证书后，本地代理才能解密 HTTPS 请求、匹配 Mock 接口并转发到 Apifox。" message="HTTPS Mock 必需配置" showIcon type="info" />
          <div className="certificate-modal-status"><div className={iconClass(props.certificate)}><KeyRound size={18} /></div><div className="certificate-copy"><strong>{certificateTitle(props.certificate)}</strong><small>{certificateDetail(props.certificate)}</small></div></div>
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="信任状态">{certificateTrustLabel(props.certificate)}</Descriptions.Item>
            <Descriptions.Item label="SHA-256 指纹">{props.certificate.fingerprint || "尚未生成"}</Descriptions.Item>
            <Descriptions.Item label="证书路径">{props.certificate.certificatePath || "尚未生成"}</Descriptions.Item>
          </Descriptions>
          <div className="certificate-modal-actions">
            <Button icon={<KeyRound size={15} />} onClick={props.onGenerate} type="primary">生成证书</Button>
            <Button disabled={!props.certificate.generated} icon={<FolderOpen size={16} />} onClick={props.onOpen}>打开并导入钥匙串</Button>
            <Button icon={<RefreshCw size={16} />} onClick={props.onRefresh}>刷新信任状态</Button>
          </div>
        </section>
      </Modal>
    </>
  );
}

function certificateTitle(certificate: CertificateStatus) {
  if (certificate.trusted) return "已生成并受系统信任";
  if (certificate.generated) return "已生成，尚未检测到系统信任";
  return "尚未生成";
}

function certificateDetail(certificate: CertificateStatus) {
  if (certificate.fingerprint) return `SHA-256 ${certificate.fingerprint}`;
  return "拦截 HTTPS 前需导入钥匙串并设为始终信任";
}

function iconClass(certificate: CertificateStatus) {
  if (certificate.trusted) return "certificate-icon certificate-icon-trusted";
  return "certificate-icon";
}

function certificateEntryLabel(certificate: CertificateStatus) { if (certificate.trusted) return "HTTPS 证书 · 已信任"; if (certificate.generated) return "HTTPS 证书 · 未信任"; return "配置 HTTPS 证书"; }
function certificateTrustLabel(certificate: CertificateStatus) { if (certificate.trusted) return "已始终信任"; if (certificate.generated) return "待导入或待信任"; return "尚未生成"; }
