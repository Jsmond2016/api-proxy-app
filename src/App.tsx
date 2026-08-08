import { useEffect, useMemo, useState } from "react";
import { CertificatePanel } from "./components/CertificatePanel";
import { ApifoxSyncPanel } from "./components/ApifoxSyncPanel";
import { ProjectSidebar } from "./components/ProjectSidebar";
import { ProxyHeader } from "./components/ProxyHeader";
import { RequestLogPanel } from "./components/RequestLogPanel";
import { RuleTable } from "./components/RuleTable";
import {
  changeActiveProfile,
  changeRuleState,
  generateCertificate,
  getDesktopSnapshot,
  startProxy,
  stopProxy,
  syncOpenApi,
} from "./lib/desktop";
import type { DesktopSnapshot, OpenApiSyncInput } from "./types";
import "./App.css";

function App() {
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);

  useEffect(() => {
    void loadSnapshot();
  }, []);

  const activeProfile = useMemo(() => {
    if (!snapshot) {
      return null;
    }

    return snapshot.profiles.find((profile) => profile.id === snapshot.activeProfileId) ?? null;
  }, [snapshot]);

  async function loadSnapshot() {
    const nextSnapshot = await getDesktopSnapshot();
    setSnapshot(nextSnapshot);
  }

  async function handleProfileChange(profileId: string) {
    const nextSnapshot = await changeActiveProfile(profileId);
    setSnapshot(nextSnapshot);
  }

  async function handleProxyStart() {
    const nextSnapshot = await startProxy();
    setSnapshot(nextSnapshot);
  }

  async function handleProxyStop() {
    const nextSnapshot = await stopProxy();
    setSnapshot(nextSnapshot);
  }

  async function handleRuleToggle(ruleId: string, enabled: boolean) {
    const nextSnapshot = await changeRuleState(ruleId, enabled);
    setSnapshot(nextSnapshot);
  }

  async function handleCertificateGeneration() {
    const nextSnapshot = await generateCertificate();
    setSnapshot(nextSnapshot);
  }

  async function handleOpenApiSync(input: OpenApiSyncInput) {
    const nextSnapshot = await syncOpenApi(input);
    setSnapshot(nextSnapshot);
  }

  if (!snapshot || !activeProfile) {
    return <main className="app-loading">正在读取本地联调配置...</main>;
  }

  return (
    <main className="app-shell">
      <ProjectSidebar
        activeProfileId={snapshot.activeProfileId}
        onSelect={handleProfileChange}
        profiles={snapshot.profiles}
      />
      <section className="workspace">
        <ProxyHeader
          onStart={handleProxyStart}
          onStop={handleProxyStop}
          profile={activeProfile}
          status={snapshot.proxyStatus}
        />

        <div className="workspace-grid">
          <CertificatePanel certificate={snapshot.certificate} onGenerate={handleCertificateGeneration} />
          <ApifoxSyncPanel onSync={handleOpenApiSync} profile={activeProfile} />
        </div>

        <RuleTable onToggle={handleRuleToggle} rules={activeProfile.rules} />
        <RequestLogPanel logs={snapshot.logs} />
      </section>
    </main>
  );
}

export default App;
