import { invoke } from "@tauri-apps/api/core";
import { demoSnapshot } from "../features/workspace/mockData";
import type { DesktopSnapshot, OpenApiSyncInput, ProxyStatus } from "../types";

let browserSnapshot = cloneSnapshot(demoSnapshot);

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function cloneSnapshot(snapshot: DesktopSnapshot) {
  return JSON.parse(JSON.stringify(snapshot)) as DesktopSnapshot;
}

export async function getDesktopSnapshot() {
  if (isTauriRuntime()) {
    return invoke<DesktopSnapshot>("get_snapshot");
  }

  return browserSnapshot;
}

export async function changeProxyStatus(status: ProxyStatus) {
  if (isTauriRuntime()) {
    return invoke<DesktopSnapshot>("set_proxy_status", { status });
  }

  browserSnapshot = {
    ...browserSnapshot,
    proxyStatus: status,
  };
  return browserSnapshot;
}

export async function startProxy() {
  if (isTauriRuntime()) {
    return invoke<DesktopSnapshot>("start_proxy");
  }

  return changeProxyStatus("running");
}

export async function stopProxy() {
  if (isTauriRuntime()) {
    return invoke<DesktopSnapshot>("stop_proxy");
  }

  return changeProxyStatus("stopped");
}

export async function changeActiveProfile(profileId: string) {
  if (isTauriRuntime()) {
    return invoke<DesktopSnapshot>("set_active_profile", { profileId });
  }

  browserSnapshot = {
    ...browserSnapshot,
    activeProfileId: profileId,
  };
  return browserSnapshot;
}

export async function changeRuleState(ruleId: string, enabled: boolean) {
  if (isTauriRuntime()) {
    return invoke<DesktopSnapshot>("set_rule_enabled", { ruleId, enabled });
  }

  browserSnapshot = {
    ...browserSnapshot,
    profiles: browserSnapshot.profiles.map((profile) => ({
      ...profile,
      rules: profile.rules.map((rule) => {
        if (rule.id === ruleId) {
          return {
            ...rule,
            enabled,
          };
        }

        return rule;
      }),
    })),
  };
  return browserSnapshot;
}

export async function generateCertificate() {
  if (isTauriRuntime()) {
    return invoke<DesktopSnapshot>("generate_certificate");
  }

  browserSnapshot = {
    ...browserSnapshot,
    certificate: {
      generated: true,
      trusted: false,
      fingerprint: "2F:7A:4B:90:CD:11:9E:82",
    },
  };
  return browserSnapshot;
}

export async function syncOpenApi(input: OpenApiSyncInput) {
  if (isTauriRuntime()) {
    return invoke<DesktopSnapshot>("sync_openapi", { request: input });
  }

  browserSnapshot = {
    ...browserSnapshot,
    profiles: browserSnapshot.profiles.map((profile) => {
      if (profile.id === input.profileId) {
        return {
          ...profile,
          apifox: {
            mode: input.mode,
            source: input.sourceUrl,
            mockPrefix: input.mockPrefix,
            selectedTags: input.selectedTags,
          },
        };
      }

      return profile;
    }),
  };
  return browserSnapshot;
}
