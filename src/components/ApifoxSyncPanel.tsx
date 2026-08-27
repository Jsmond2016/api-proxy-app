import { Alert, Button, Form, Input, List, Modal, Segmented, Select } from "antd";
import { CloudDownload, KeyRound, Link2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { ApifoxPreview, ApifoxRequest, ProjectProfile } from "../types";

interface ApifoxSyncPanelProps {
  profile: ProjectProfile;
  onSync: (request: ApifoxRequest) => Promise<void>;
  onValidate: (request: ApifoxRequest) => Promise<ApifoxPreview>;
}

export function ApifoxSyncPanel(props: ApifoxSyncPanelProps) {
  const [mode, setMode] = useState(props.profile.apifox.mode);
  const [projectId, setProjectId] = useState(props.profile.apifox.projectId);
  const [localUrl, setLocalUrl] = useState(props.profile.apifox.localOpenapiUrl);
  const [mockPrefix, setMockPrefix] = useState(props.profile.apifox.mockPrefix);
  const [accessToken, setAccessToken] = useState(props.profile.apifox.accessToken);
  const [mockToken, setMockToken] = useState(props.profile.apifox.mockToken);
  const [selectedTags, setSelectedTags] = useState<string[]>(props.profile.syncedTags);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [validated, setValidated] = useState(false);
  const [preview, setPreview] = useState<ApifoxPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setMode(props.profile.apifox.mode);
    setProjectId(props.profile.apifox.projectId);
    setLocalUrl(props.profile.apifox.localOpenapiUrl);
    setMockPrefix(props.profile.apifox.mockPrefix);
    setSelectedTags(props.profile.syncedTags);
    setAvailableTags([]);
    setAccessToken(props.profile.apifox.accessToken);
    setMockToken(props.profile.apifox.mockToken);
    setValidated(false);
    setPreview(null);
  }, [props.profile.id]);

  function request(): ApifoxRequest {
    const value: ApifoxRequest = {
      profileId: props.profile.id,
      mode,
      projectId: projectId.trim(),
      localOpenapiUrl: localUrl.trim(),
      mockPrefix: mockPrefix.trim(),
      selectedTags,
    };
    if (accessToken.trim()) value.accessToken = accessToken.trim();
    if (mockToken.trim()) value.mockToken = mockToken.trim();
    return value;
  }

  function invalidate() {
    setValidated(false);
    setPreview(null);
    setAvailableTags([]);
  }

  async function validateConnection() {
    setBusy(true);
    try {
      const discoveryRequest = request();
      discoveryRequest.selectedTags = [];
      const result = await props.onValidate(discoveryRequest);
      setAvailableTags(result.availableTags);
      setSelectedTags((current) => current.filter((tag) => result.availableTags.includes(tag)));
      if (mode === "online" && !mockPrefix.trim()) {
        setMockPrefix(`https://m1.apifoxmock.com/m1/${projectId.trim()}-0-default`);
      }
      setValidated(true);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  function changeTags(tags: string[]) {
    setSelectedTags(tags);
    setPreview(null);
  }

  async function confirmTags() {
    setBusy(true);
    try {
      setPreview(await props.onValidate(request()));
    } finally {
      setBusy(false);
    }
  }

  async function applySync() {
    if (!preview) return;
    setBusy(true);
    try {
      await props.onSync(request());
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button className="config-entry-button" icon={<RefreshCw size={15} />} onClick={() => setOpen(true)}>{apifoxEntryLabel(props.profile)}</Button>
      <Modal className="apifox-sync-modal" footer={null} onCancel={() => setOpen(false)} open={open} title="连接并同步 Apifox 接口" width={720}>
        <section className="apifox-sync-panel">
          <div className="apifox-panel-head">
            <div><span>APIFOX OPENAPI</span><strong>连接配置</strong></div>
            <Segmented className="sync-mode" onChange={(value) => { setMode(value as "online" | "local"); invalidate(); }} options={[{ label: "在线项目", value: "online" }, { label: "本地 URL", value: "local" }]} value={mode} />
          </div>
          <Form className="apifox-form" layout="vertical" requiredMark={false}>
            <SourceField localUrl={localUrl} mode={mode} projectId={projectId} setLocalUrl={(value) => { setLocalUrl(value); invalidate(); }} setProjectId={(value) => { setProjectId(value); invalidate(); }} />
            <Form.Item label={<span><Link2 size={13} />Mock 前缀</span>}><Input placeholder="留空则按项目 ID 生成" value={mockPrefix} onChange={(event) => { setMockPrefix(event.target.value); invalidate(); }} /></Form.Item>
            <Form.Item label={<span><KeyRound size={13} />Access Token</span>}><Input.Password placeholder="可选" value={accessToken} onChange={(event) => { setAccessToken(event.target.value); invalidate(); }} /></Form.Item>
            <Form.Item label={<span><KeyRound size={13} />Mock Token</span>}><Input.Password placeholder="可选" value={mockToken} onChange={(event) => setMockToken(event.target.value)} /></Form.Item>
            <div className="apifox-form-actions"><Button className="outline-button" loading={busy} onClick={validateConnection}>验证连接</Button></div>
          </Form>
          <ConnectionResult availableTags={availableTags} busy={busy} selectedTags={selectedTags} validated={validated} onConfirm={confirmTags} onTags={changeTags} />
          <InterfacePreviewPanel busy={busy} preview={preview} onApply={applySync} />
        </section>
      </Modal>
    </>
  );
}

interface ConnectionResultProps {
  validated: boolean;
  busy: boolean;
  availableTags: string[];
  selectedTags: string[];
  onTags: (tags: string[]) => void;
  onConfirm: () => Promise<void>;
}

function ConnectionResult(props: ConnectionResultProps) {
  if (!props.validated) return <div className="sync-placeholder">填写连接信息并验证后，再选择需要同步的 Tag。</div>;
  const requiresTag = props.availableTags.length > 0;
  const disabled = props.busy || (requiresTag && props.selectedTags.length === 0);
  return (
    <div className="tag-sync-row">
      <Alert className="validation-ok" message={`连接验证成功，共发现 ${props.availableTags.length} 个可选 Tag`} showIcon type="success" />
      <TagMultiSelect options={props.availableTags} value={props.selectedTags} onChange={props.onTags} />
      <Button className="command-button" disabled={disabled} loading={props.busy} onClick={props.onConfirm} type="primary">确认 Tag 并拉取接口</Button>
    </div>
  );
}

function TagMultiSelect(props: { options: string[]; value: string[]; onChange: (tags: string[]) => void }) {
  if (props.options.length === 0) return <div className="tag-empty">OpenAPI 未声明 Tag，将同步全部接口</div>;
  return <Select allowClear className="tag-dropdown" maxTagCount="responsive" mode="multiple" onChange={props.onChange} options={props.options.map((tag) => ({ label: tag, value: tag }))} placeholder="请选择 Tag" showSearch value={props.value} />;
}

function InterfacePreviewPanel(props: { preview: ApifoxPreview | null; busy: boolean; onApply: () => Promise<void> }) {
  if (!props.preview) return null;
  return (
    <div className="interface-preview">
      <div className="interface-preview-head"><div><strong>已拉取 {props.preview.selectedOperationCount} 个接口</strong><span>新增 {props.preview.addedCount} · 更新 {props.preview.updatedCount} · 删除 {props.preview.removedCount} · 保留 {props.preview.retainedCount}</span></div><Button className="sync-submit" icon={<CloudDownload size={15} />} loading={props.busy} onClick={props.onApply} type="primary">确认同步这些接口</Button></div>
      <List className="interface-preview-list" dataSource={props.preview.interfaces.slice(0, 8)} renderItem={(item) => <List.Item key={item.id}><span className={`method-badge method-${item.method.toLowerCase()}`}>{item.method}</span><code>{item.path}</code><small>{item.name}</small></List.Item>} />
      <PreviewRemainder total={props.preview.interfaces.length} />
    </div>
  );
}

interface SourceFieldProps { mode: "online" | "local"; projectId: string; localUrl: string; setProjectId: (value: string) => void; setLocalUrl: (value: string) => void; }
function SourceField(props: SourceFieldProps) { if (props.mode === "online") return <Form.Item label={<span><Link2 size={13} />项目 ID</span>} required><Input value={props.projectId} onChange={(event) => props.setProjectId(event.target.value)} /></Form.Item>; return <Form.Item label={<span><Link2 size={13} />OpenAPI URL</span>} required><Input value={props.localUrl} onChange={(event) => props.setLocalUrl(event.target.value)} /></Form.Item>; }
function PreviewRemainder({ total }: { total: number }) { if (total <= 8) return null; return <small className="preview-remainder">另有 {total - 8} 个接口将在确认后同步</small>; }
function apifoxEntryLabel(profile: ProjectProfile) { if (profile.syncedTags.length > 0) return `Apifox 接口 · ${profile.rules.filter((rule) => rule.source === "apifox").length} 条`; return "连接 Apifox"; }
