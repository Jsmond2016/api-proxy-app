export type MatchMode = "exact" | "contains" | "regex";

export type ProxyStatus = "stopped" | "starting" | "running" | "error";

export type RuleStatus = "matched" | "passed" | "failed";

export interface ApifoxConnection {
  mode: "local" | "online";
  source: string;
  mockPrefix: string;
  selectedTags: string[];
}

export interface ProxyRule {
  id: string;
  name: string;
  method: string;
  path: string;
  matchMode: MatchMode;
  target: string;
  enabled: boolean;
  tag: string;
}

export interface ProjectProfile {
  id: string;
  name: string;
  domain: string;
  port: number;
  apifox: ApifoxConnection;
  rules: ProxyRule[];
}

export interface RequestLog {
  id: string;
  createdAt: string;
  method: string;
  source: string;
  destination: string;
  ruleName: string;
  status: RuleStatus;
  responseCode: number;
  duration: number;
}

export interface CertificateStatus {
  generated: boolean;
  trusted: boolean;
  fingerprint: string;
}

export interface DesktopSnapshot {
  profiles: ProjectProfile[];
  activeProfileId: string;
  proxyStatus: ProxyStatus;
  certificate: CertificateStatus;
  logs: RequestLog[];
}

export interface OpenApiSyncInput {
  profileId: string;
  mode: "local" | "online";
  sourceUrl: string;
  mockPrefix: string;
  selectedTags: string[];
  accessToken?: string;
}
