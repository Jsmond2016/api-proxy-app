import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  ApifoxPreview,
  ApifoxRequest,
  DesktopSnapshot,
  ProfileInput,
  OperationResolution,
  ResolveOperationInput,
  RequestLog,
  RuleInput,
} from "../types";

export function isDesktopRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

export const buildVersion = __APP_VERSION__;

export async function getAppVersion() {
  if (!isDesktopRuntime()) {
    return buildVersion;
  }
  try {
    return await getVersion();
  } catch {
    return buildVersion;
  }
}

function desktopRequired(): never {
  throw new Error("该功能需要在 Apifox Proxy 桌面应用中运行。");
}

export async function getDesktopSnapshot() {
  if (!isDesktopRuntime()) {
    return emptySnapshot();
  }
  return invoke<DesktopSnapshot>("get_snapshot");
}

export async function createProfile(input: ProfileInput) {
  return invokeDesktop("create_profile", { input });
}

export async function updateProfile(input: ProfileInput) {
  return invokeDesktop("update_profile", { input });
}

export async function deleteProfile(profileId: string) {
  return invokeDesktop("delete_profile", { profileId });
}

export async function setActiveProfile(profileId: string) {
  return invokeDesktop("set_active_profile", { profileId });
}

export async function validateApifox(request: ApifoxRequest) {
  if (!isDesktopRuntime()) {
    return desktopRequired();
  }
  return invoke<ApifoxPreview>("validate_apifox", { request });
}

export async function syncApifox(request: ApifoxRequest) {
  return invokeDesktop("sync_apifox", { request });
}

export async function resolveApifoxOperation(input: ResolveOperationInput) {
  if (!isDesktopRuntime()) {
    return desktopRequired();
  }
  return invoke<OperationResolution>("resolve_apifox_operation", { input });
}

export async function saveRule(input: RuleInput) {
  return invokeDesktop("save_rule", { input });
}

export async function deleteRule(profileId: string, ruleId: string) {
  return invokeDesktop("delete_rule", { profileId, ruleId });
}

export async function clearRules(profileId: string) {
  return invokeDesktop("clear_rules", { profileId });
}

export async function setRuleEnabled(profileId: string, ruleId: string, enabled: boolean) {
  return invokeDesktop("set_rule_enabled", { profileId, ruleId, enabled });
}

export async function setGlobalMockEnabled(profileId: string, enabled: boolean) {
  return invokeDesktop("set_global_mock_enabled", { profileId, enabled });
}

export async function generateCertificate() {
  return invokeDesktop("generate_certificate");
}

export async function refreshCertificate() {
  return invokeDesktop("refresh_certificate");
}

export async function openCertificate() {
  if (!isDesktopRuntime()) {
    return desktopRequired();
  }
  return invoke<void>("open_certificate");
}

export async function openExternalUrl(url: string) {
  if (!isDesktopRuntime()) {
    return desktopRequired();
  }
  return openUrl(url);
}

export async function clearLogs() {
  return invokeDesktop("clear_logs");
}

export async function startProxy() {
  return invokeDesktop("start_proxy");
}

export async function stopProxy() {
  return invokeDesktop("stop_proxy");
}

export async function subscribeProxyEvents(
  onSnapshot: (snapshot: DesktopSnapshot) => void,
  onRequest: (log: RequestLog) => void,
) {
  if (!isDesktopRuntime()) {
    return () => undefined;
  }
  const unlistenSnapshot = await listen<DesktopSnapshot>("proxy://snapshot", (event) => {
    onSnapshot(event.payload);
  });
  const unlistenRequest = await listen<RequestLog>("proxy://request", (event) => {
    onRequest(event.payload);
  });
  return () => {
    unlistenSnapshot();
    unlistenRequest();
  };
}

function invokeDesktop(command: string, args?: Record<string, unknown>) {
  if (!isDesktopRuntime()) {
    return desktopRequired();
  }
  return invoke<DesktopSnapshot>(command, args);
}

function emptySnapshot(): DesktopSnapshot {
  return {
    schemaVersion: 2,
    profiles: [],
    activeProfileId: null,
    proxyStatus: "stopped",
    certificate: {
      generated: false,
      trusted: false,
      fingerprint: "",
      certificatePath: "",
    },
    logs: [],
  };
}
