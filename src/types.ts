export type ApifoxMode = "online" | "local";
export type MatchMode = "exact" | "contains" | "regex" | "template";
export type ProxyStatus = "stopped" | "starting" | "running" | "error";
export type RuleSource = "apifox" | "custom" | "imported";

export interface ApifoxConnection {
  mode: ApifoxMode;
  projectId: string;
  localOpenapiUrl: string;
  mockPrefix: string;
  accessToken: string;
  mockToken: string;
}

export interface ProxyRule {
  id: string;
  source: RuleSource;
  sourceOperationId: string;
  apifoxWebUrl: string;
  name: string;
  method: string;
  path: string;
  matchMode: MatchMode;
  target: string;
  enabled: boolean;
  tags: string[];
  priority: number;
}

export interface ProjectProfile {
  id: string;
  name: string;
  sourceHosts: string[];
  pathPrefix: string;
  port: number;
  apifox: ApifoxConnection;
  syncedTags: string[];
  globalMockEnabled: boolean;
  rules: ProxyRule[];
}

export interface RequestLog {
  id: string;
  createdAt: string;
  method: string;
  source: string;
  destination: string;
  ruleId: string;
  ruleName: string;
  tag: string;
  status: "matched" | "passed" | "failed";
  stage: string;
  responseCode: number | null;
  duration: number;
}

export interface CertificateStatus {
  generated: boolean;
  trusted: boolean;
  fingerprint: string;
  certificatePath: string;
}

export interface DesktopSnapshot {
  schemaVersion: number;
  profiles: ProjectProfile[];
  activeProfileId: string | null;
  proxyStatus: ProxyStatus;
  certificate: CertificateStatus;
  logs: RequestLog[];
}

export interface ProfileInput {
  id?: string;
  name: string;
  sourceHosts: string[];
  pathPrefix: string;
  port: number;
}

export interface ApifoxRequest {
  profileId: string;
  mode: ApifoxMode;
  projectId: string;
  localOpenapiUrl: string;
  mockPrefix: string;
  accessToken?: string;
  mockToken?: string;
  selectedTags: string[];
}

export interface ApifoxPreview {
  availableTags: string[];
  operationCount: number;
  selectedOperationCount: number;
  addedCount: number;
  updatedCount: number;
  removedCount: number;
  retainedCount: number;
  interfaces: InterfacePreview[];
}

export interface InterfacePreview {
  id: string;
  name: string;
  method: string;
  path: string;
  tags: string[];
}

export interface ResolveOperationInput {
  profileId: string;
  url: string;
  method: string;
}

export interface OperationResolution {
  matchCount: number;
  interface: ResolvedInterface | null;
}

export interface ResolvedInterface {
  name: string;
  method: string;
  path: string;
  matchMode: MatchMode;
  target: string;
  tags: string[];
  apifoxWebUrl: string;
}

export interface DiagnosticEntry {
  id: string;
  createdAt: string;
  level: "info" | "success" | "error";
  action: string;
  message: string;
}

export interface RuleInput {
  id?: string;
  profileId: string;
  name: string;
  method: string;
  path: string;
  matchMode: MatchMode;
  target: string;
  enabled: boolean;
  tags: string[];
  priority: number;
  apifoxWebUrl: string;
}
