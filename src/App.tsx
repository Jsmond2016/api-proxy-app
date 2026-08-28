import { Alert, App as AntApp, Button, Empty, Spin } from "antd";
import { AlertCircle, Monitor } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ComponentProps } from "react";
import { ApifoxSyncPanel } from "./components/ApifoxSyncPanel";
import { CertificatePanel } from "./components/CertificatePanel";
import { ConnectionGuide } from "./components/ConnectionGuide";
import { DiagnosticPanel } from "./components/DiagnosticPanel";
import { ProjectSidebar } from "./components/ProjectSidebar";
import { ProxyHeader } from "./components/ProxyHeader";
import { RequestLogPanel } from "./components/RequestLogPanel";
import { RuleTable } from "./components/RuleTable";
import * as desktop from "./lib/desktop";
import type { ApifoxRequest, DesktopSnapshot, DiagnosticEntry, RequestLog, RuleInput } from "./types";
import "./App.css";

function App() {
  const { message } = AntApp.useApp();
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  const [appVersion, setAppVersion] = useState(desktop.buildVersion);

  useEffect(() => {
    let unsubscribe: () => void = () => undefined;
    void loadSnapshot();
    void desktop.getAppVersion().then(setAppVersion);
    void desktop.subscribeProxyEvents(setSnapshot, mergeRequestLog).then((stop) => { unsubscribe = stop; }).catch((reason) => { showError(reason); recordDiagnostic("error", "事件订阅", errorMessage(reason)); });
    return () => unsubscribe();
  }, []);

  async function loadSnapshot() {
    setInitializing(true);
    setError("");
    try {
      setSnapshot(await desktop.getDesktopSnapshot());
      recordDiagnostic("success", "应用启动", "本地配置读取成功");
    } catch (reason) {
      showError(reason);
      recordDiagnostic("error", "应用启动", errorMessage(reason));
    } finally {
      setInitializing(false);
    }
  }

  const activeProfile = useMemo(() => {
    if (!snapshot || !snapshot.activeProfileId) return null;
    return snapshot.profiles.find((profile) => profile.id === snapshot.activeProfileId) || null;
  }, [snapshot]);

  function showError(reason: unknown) {
    setError(errorMessage(reason));
  }

  function recordDiagnostic(level: DiagnosticEntry["level"], action: string, message: string) {
    const entry: DiagnosticEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      level,
      action,
      message,
    };
    setDiagnostics((current) => [entry, ...current].slice(0, 100));
  }

  function notify(level: "success" | "error", title: string, detail: string) {
    void message.open({ type: level, content: `${title}：${detail}` });
  }

  function mergeRequestLog(log: RequestLog) {
    setSnapshot((current) => {
      if (!current) return current;
      const logs = [log, ...current.logs.filter((item) => item.id !== log.id)].slice(0, 500);
      return { ...current, logs };
    });
  }

  async function apply(action: Promise<DesktopSnapshot>, label: string) {
    setError("");
    recordDiagnostic("info", label, "操作已开始");
    try {
      setSnapshot(await action);
      recordDiagnostic("success", label, "操作成功");
      notify("success", label, "操作成功");
    } catch (reason) {
      showError(reason);
      recordDiagnostic("error", label, errorMessage(reason));
      notify("error", label, errorMessage(reason));
      throw reason;
    }
  }

  async function validateApifox(request: ApifoxRequest) {
    setError("");
    recordDiagnostic("info", "Apifox 连接/接口解析", "请求已开始");
    try {
      const preview = await desktop.validateApifox(request);
      recordDiagnostic("success", "Apifox 连接/接口解析", `成功：${preview.selectedOperationCount} 个接口，${preview.availableTags.length} 个 Tag`);
      notify("success", "Apifox 连接成功", `发现 ${preview.availableTags.length} 个 Tag、${preview.operationCount} 个接口`);
      return preview;
    } catch (reason) {
      showError(reason);
      recordDiagnostic("error", "Apifox 连接/接口解析", errorMessage(reason));
      notify("error", "Apifox 连接失败", errorMessage(reason));
      throw reason;
    }
  }

  async function execute(action: Promise<unknown>, label: string) {
    setError("");
    recordDiagnostic("info", label, "操作已开始");
    try {
      await action;
      recordDiagnostic("success", label, "操作成功");
      notify("success", label, "操作成功");
    } catch (reason) {
      showError(reason);
      recordDiagnostic("error", label, errorMessage(reason));
      notify("error", label, errorMessage(reason));
      throw reason;
    }
  }

  if (!snapshot) return <InitializationState busy={initializing} error={error} onRetry={loadSnapshot} />;

  return (
    <main className="app-shell">
      <section className="workspace">
        <RuntimeNotice />
        <ErrorBanner error={error} onClose={() => setError("")} />
        <Workspace
          activeProfile={activeProfile}
          snapshot={snapshot}
          apply={apply}
          execute={execute}
          appVersion={appVersion}
          projectNavigation={{ activeProfileId: snapshot.activeProfileId, disabled: snapshot.proxyStatus === "starting", profiles: snapshot.profiles, onCreate: (input) => apply(desktop.createProfile(input), "创建项目"), onDelete: (id) => apply(desktop.deleteProfile(id), "删除项目"), onSelect: (id) => apply(desktop.setActiveProfile(id), "切换项目"), onUpdate: (input) => apply(desktop.updateProfile(input), "更新项目") }}
          validateApifox={validateApifox}
        />
        <DiagnosticPanel entries={diagnostics} onClear={() => setDiagnostics([])} snapshot={snapshot} />
      </section>
    </main>
  );
}

function InitializationState(props: { busy: boolean; error: string; onRetry: () => Promise<void> }) {
  if (props.busy) return <main className="app-loading"><Spin tip="正在读取本地配置..." size="large"><div className="loading-space" /></Spin></main>;
  return (
    <main className="app-loading"><section className="initialization-error"><AlertCircle size={28} /><h1>应用初始化失败</h1><p>{props.error}</p><Button type="primary" onClick={props.onRetry}>重试</Button></section></main>
  );
}

interface WorkspaceProps {
  activeProfile: DesktopSnapshot["profiles"][number] | null;
  snapshot: DesktopSnapshot;
  apply: (action: Promise<DesktopSnapshot>, label: string) => Promise<void>;
  execute: (action: Promise<unknown>, label: string) => Promise<void>;
  validateApifox: typeof desktop.validateApifox;
  projectNavigation: ComponentProps<typeof ProjectSidebar>;
  appVersion: string;
}

function Workspace(props: WorkspaceProps) {
  const profile = props.activeProfile;
  if (!profile) return <EmptyWorkspace />;
  const currentProfile = profile;
  async function debugSingle(ruleId: string) {
    await props.apply(desktop.setGlobalMockEnabled(currentProfile.id, true), "开启全局 Mock");
    const currentRule = currentProfile.rules.find((rule) => rule.id === ruleId);
    if (currentRule && !currentRule.enabled) {
      await props.apply(desktop.setRuleEnabled(currentProfile.id, ruleId, true), "开启当前接口 Mock");
    }
    const otherRules = currentProfile.rules.filter((rule) => rule.id !== ruleId && rule.enabled);
    for (const rule of otherRules) {
      await props.apply(desktop.setRuleEnabled(currentProfile.id, rule.id, false), "关闭其他接口 Mock");
    }
  }
  return (
    <>
      <ProxyHeader appVersion={props.appVersion} globalMockEnabled={profile.globalMockEnabled} profile={profile} status={props.snapshot.proxyStatus} />
      <ProjectSidebar {...props.projectNavigation} />
      <div className="workspace-grid">
        <ConnectionGuide certificate={props.snapshot.certificate} hasTraffic={props.snapshot.logs.length > 0} profile={profile} proxyStatus={props.snapshot.proxyStatus} />
        <div className="workspace-config-actions">
          <ApifoxSyncPanel profile={profile} onSync={(request) => props.apply(desktop.syncApifox(request), "同步 Apifox 接口")} onValidate={props.validateApifox} />
          <CertificatePanel certificate={props.snapshot.certificate} onGenerate={() => props.apply(desktop.generateCertificate(), "生成证书")} onOpen={() => props.execute(desktop.openCertificate(), "打开证书")} onRefresh={() => props.apply(desktop.refreshCertificate(), "刷新证书信任")} />
        </div>
      </div>
      <RuleTable profile={profile} onDebugSingle={debugSingle} onDelete={(id) => props.apply(desktop.deleteRule(profile.id, id), "删除 Mock 接口")} onOpenUrl={(url) => props.execute(desktop.openExternalUrl(url), "打开 Apifox 接口")} onReset={() => props.apply(desktop.clearRules(profile.id), "重置 Mock 接口列表")} onResolve={desktop.resolveApifoxOperation} onSave={(input: RuleInput) => props.apply(desktop.saveRule(input), "保存 Mock 接口")} onToggle={(id, enabled) => props.apply(desktop.setRuleEnabled(profile.id, id, enabled), "切换接口 Mock")} onToggleGlobal={(enabled) => props.apply(desktop.setGlobalMockEnabled(profile.id, enabled), "切换全局 Mock")} />
      <RequestLogPanel logs={props.snapshot.logs} onClear={() => props.apply(desktop.clearLogs(), "清空请求记录")} />
    </>
  );
}

function EmptyWorkspace() {
  return <section className="empty-workspace"><Empty image={<Monitor size={36} />} description={<><h1>创建第一个联调项目</h1><p>点击左侧项目标题旁的新增图标，配置小程序真实接口域名和本地代理端口。</p></>} /></section>;
}

function RuntimeNotice() {
  if (desktop.isDesktopRuntime()) return null;
  return <Alert className="runtime-notice" message="当前为网页预览，网络代理、本地配置和证书功能只在打包后的桌面应用中可用。" showIcon type="warning" />;
}

function ErrorBanner({ error, onClose }: { error: string; onClose: () => void }) {
  if (!error) return null;
  return <Alert className="error-banner" closable message={error} onClose={onClose} showIcon type="error" />;
}

function errorMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

export default App;
