import { App as AntApp, Empty } from "antd";
import { Monitor } from "lucide-react";
import type { ComponentProps } from "react";
import * as desktop from "../lib/desktop";
import type { DesktopSnapshot, RuleInput } from "../types";
import { ApifoxSyncPanel } from "./ApifoxSyncPanel";
import { CertificatePanel } from "./CertificatePanel";
import { ConnectionGuide } from "./ConnectionGuide";
import { LocalMockPanel } from "./LocalMockPanel";
import { ProjectSidebar } from "./ProjectSidebar";
import { ProxyHeader } from "./ProxyHeader";
import { RequestLogPanel } from "./RequestLogPanel";
import { RuleTable } from "./RuleTable";

interface WorkspaceProps {
  activeProfile: DesktopSnapshot["profiles"][number] | null;
  snapshot: DesktopSnapshot;
  apply: (
    action: Promise<DesktopSnapshot>,
    label: string,
    notifySuccess?: boolean,
  ) => Promise<void>;
  applyProxyTransition: (
    action: Promise<DesktopSnapshot>,
    label: string,
    notifySuccess?: boolean,
  ) => Promise<void>;
  execute: (action: Promise<unknown>, label: string) => Promise<void>;
  validateApifox: typeof desktop.validateApifox;
  projectNavigation: ComponentProps<typeof ProjectSidebar>;
  proxyTransition: boolean;
  appVersion: string;
}

export function Workspace(props: WorkspaceProps) {
  const profile = props.activeProfile;
  const { message } = AntApp.useApp();
  if (!profile)
    return (
      <>
        <ProjectSidebar {...props.projectNavigation} />
        <EmptyWorkspace />
      </>
    );

  const currentProfile = profile;
  async function debugSingle(ruleId: string) {
    await props.applyProxyTransition(
      desktop.setGlobalMockEnabled(currentProfile.id, true),
      "开启全局 Mock",
      false,
    );
    const currentRule = currentProfile.rules.find((rule) => rule.id === ruleId);
    if (currentRule && !currentRule.enabled) {
      await props.apply(
        desktop.setRuleEnabled(currentProfile.id, ruleId, true),
        "开启当前接口 Mock",
        false,
      );
    }
    const otherRules = currentProfile.rules.filter((rule) => rule.id !== ruleId && rule.enabled);
    for (const rule of otherRules) {
      await props.apply(
        desktop.setRuleEnabled(currentProfile.id, rule.id, false),
        "关闭其他接口 Mock",
        false,
      );
    }
    void message.success("已关闭其他接口，仅保留当前接口");
  }

  return (
    <>
      <ProxyHeader
        appVersion={props.appVersion}
        globalMockEnabled={profile.globalMockEnabled}
        profile={profile}
        status={props.snapshot.proxyStatus}
      />
      <ProjectSidebar {...props.projectNavigation} />
      <div className="workspace-grid">
        <ConnectionGuide
          certificate={props.snapshot.certificate}
          hasTraffic={props.snapshot.logs.length > 0}
          profile={profile}
          proxyStatus={props.snapshot.proxyStatus}
        />
        <div className="workspace-config-actions">
          <LocalMockPanel
            profileId={profile.id}
            responses={profile.localResponses}
            onSave={(input) => props.apply(desktop.saveLocalResponse(input), "保存本地 Mock 响应")}
            onDelete={(id) =>
              props.apply(desktop.deleteLocalResponse(profile.id, id), "删除本地 Mock 响应")
            }
          />
          <ApifoxSyncPanel
            key={profile.id}
            profile={profile}
            onSync={(request) => props.apply(desktop.syncApifox(request), "同步 Apifox 接口")}
            onValidate={props.validateApifox}
          />
          <CertificatePanel
            certificate={props.snapshot.certificate}
            onGenerate={() => props.apply(desktop.generateCertificate(), "生成证书")}
            onOpen={() => props.execute(desktop.openCertificate(), "打开证书")}
            onRefresh={() => props.apply(desktop.refreshCertificate(), "刷新证书信任")}
          />
        </div>
      </div>
      <RuleTable
        key={profile.id}
        disabled={props.proxyTransition}
        profiles={props.snapshot.profiles}
        profile={profile}
        localResponses={profile.localResponses}
        onDebugSingle={debugSingle}
        onDelete={(id) => props.apply(desktop.deleteRule(profile.id, id), "删除 Mock 接口")}
        onDeleteMany={(ids) =>
          props.apply(desktop.deleteRules(profile.id, ids), "批量删除 Mock 接口")
        }
        onMove={(ruleIds, targetProfileId) =>
          props.apply(desktop.moveRules(profile.id, targetProfileId, ruleIds), "移动 Mock 接口")
        }
        onOpenUrl={(url) => props.execute(desktop.openExternalUrl(url), "打开 Apifox 接口")}
        onResolve={desktop.resolveApifoxOperation}
        onSave={(input: RuleInput) => props.apply(desktop.saveRule(input), "保存 Mock 接口")}
        onToggle={(id, enabled) =>
          props.apply(desktop.setRuleEnabled(profile.id, id, enabled), "切换接口 Mock")
        }
        onToggleAll={(enabled) =>
          props.apply(desktop.setAllRulesEnabled(profile.id, enabled), "批量切换接口 Mock")
        }
        onToggleGlobal={(enabled) =>
          props.applyProxyTransition(
            desktop.setGlobalMockEnabled(profile.id, enabled),
            "切换全局 Mock",
          )
        }
      />
      <RequestLogPanel
        logs={props.snapshot.logs}
        profiles={props.snapshot.profiles}
        onClear={() => props.apply(desktop.clearLogs(), "清空请求记录")}
        onPreview={desktop.previewMockResponse}
      />
    </>
  );
}

function EmptyWorkspace() {
  return (
    <section className="empty-workspace">
      <Empty
        image={<Monitor size={36} />}
        description={
          <>
            <h1>创建第一个联调项目</h1>
            <p>点击上方“新建项目”按钮，配置小程序真实接口域名和本地代理端口。</p>
          </>
        }
      />
    </section>
  );
}
