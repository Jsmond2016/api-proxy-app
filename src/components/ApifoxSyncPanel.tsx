import { Check, ChevronDown, CloudDownload, KeyRound, Link2, Search, Tags } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
    <section className="apifox-sync-panel">
      <div className="apifox-panel-head">
        <div><span>APIFOX OPENAPI</span><strong>连接并同步接口</strong></div>
        <div className="sync-mode" role="group" aria-label="同步模式">
          <button className={modeClass(mode, "online")} onClick={() => { setMode("online"); invalidate(); }} type="button">在线项目</button>
          <button className={modeClass(mode, "local")} onClick={() => { setMode("local"); invalidate(); }} type="button">本地 URL</button>
        </div>
      </div>
      <div className="apifox-form">
        <SourceField localUrl={localUrl} mode={mode} projectId={projectId} setLocalUrl={(value) => { setLocalUrl(value); invalidate(); }} setProjectId={(value) => { setProjectId(value); invalidate(); }} />
        <label><span><Link2 size={13} />Mock 前缀</span><input placeholder="留空则按项目 ID 生成" value={mockPrefix} onChange={(event) => { setMockPrefix(event.target.value); invalidate(); }} /></label>
        <label><span><KeyRound size={13} />Access Token</span><input placeholder="可选" type="password" value={accessToken} onChange={(event) => { setAccessToken(event.target.value); invalidate(); }} /></label>
        <label><span><KeyRound size={13} />Mock Token</span><input placeholder="可选" type="password" value={mockToken} onChange={(event) => setMockToken(event.target.value)} /></label>
        <button className="outline-button" disabled={busy} onClick={validateConnection} type="button">验证连接</button>
      </div>
      <ConnectionResult availableTags={availableTags} busy={busy} selectedTags={selectedTags} validated={validated} onConfirm={confirmTags} onTags={changeTags} />
      <InterfacePreviewPanel busy={busy} preview={preview} onApply={applySync} />
    </section>
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
      <div className="validation-ok"><Check size={15} />连接验证成功，共发现 {props.availableTags.length} 个可选 Tag</div>
      <TagMultiSelect options={props.availableTags} value={props.selectedTags} onChange={props.onTags} />
      <button className="command-button" disabled={disabled} onClick={props.onConfirm} type="button">确认 Tag 并拉取接口</button>
    </div>
  );
}

function TagMultiSelect(props: { options: string[]; value: string[]; onChange: (tags: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const visible = useMemo(() => props.options.filter((tag) => tag.toLowerCase().includes(keyword.toLowerCase())), [keyword, props.options]);
  if (props.options.length === 0) return <div className="tag-empty">OpenAPI 未声明 Tag，将同步全部接口</div>;
  return (
    <div className="tag-dropdown">
      <button className="tag-dropdown-trigger" onClick={() => setOpen(!open)} type="button"><Tags size={14} /><span>{tagSelectionLabel(props.value)}</span><ChevronDown size={14} /></button>
      <TagDropdownMenu keyword={keyword} onKeyword={setKeyword} onClose={() => setOpen(false)} onChange={props.onChange} open={open} options={visible} selected={props.value} />
    </div>
  );
}

function TagDropdownMenu(props: { open: boolean; keyword: string; options: string[]; selected: string[]; onKeyword: (value: string) => void; onChange: (tags: string[]) => void; onClose: () => void }) {
  if (!props.open) return null;
  return (
    <div className="tag-dropdown-menu">
      <label className="tag-dropdown-search"><Search size={14} /><input autoFocus placeholder="搜索 Tag" value={props.keyword} onChange={(event) => props.onKeyword(event.target.value)} /></label>
      <div className="tag-dropdown-options">{props.options.map((tag) => <label key={tag}><input checked={props.selected.includes(tag)} onChange={() => props.onChange(toggleValue(props.selected, tag))} type="checkbox" /><span>{tag}</span></label>)}</div>
      <div className="tag-dropdown-actions"><button onClick={() => props.onChange([])} type="button">清空</button><button onClick={props.onClose} type="button">完成</button></div>
    </div>
  );
}

function InterfacePreviewPanel(props: { preview: ApifoxPreview | null; busy: boolean; onApply: () => Promise<void> }) {
  if (!props.preview) return null;
  return (
    <div className="interface-preview">
      <div className="interface-preview-head"><div><strong>已拉取 {props.preview.selectedOperationCount} 个接口</strong><span>新增 {props.preview.addedCount} · 更新 {props.preview.updatedCount} · 删除 {props.preview.removedCount} · 保留 {props.preview.retainedCount}</span></div><button className="sync-submit" disabled={props.busy} onClick={props.onApply} type="button"><CloudDownload size={15} />确认同步这些接口</button></div>
      <div className="interface-preview-list">{props.preview.interfaces.slice(0, 8).map((item) => <div key={item.id}><span className={`method-badge method-${item.method.toLowerCase()}`}>{item.method}</span><code>{item.path}</code><small>{item.name}</small></div>)}</div>
      <PreviewRemainder total={props.preview.interfaces.length} />
    </div>
  );
}

interface SourceFieldProps { mode: "online" | "local"; projectId: string; localUrl: string; setProjectId: (value: string) => void; setLocalUrl: (value: string) => void; }
function SourceField(props: SourceFieldProps) { if (props.mode === "online") return <label><span><Link2 size={13} />项目 ID</span><input required value={props.projectId} onChange={(event) => props.setProjectId(event.target.value)} /></label>; return <label><span><Link2 size={13} />OpenAPI URL</span><input required value={props.localUrl} onChange={(event) => props.setLocalUrl(event.target.value)} /></label>; }
function toggleValue(values: string[], value: string) { if (values.includes(value)) return values.filter((item) => item !== value); return [...values, value]; }
function modeClass(active: string, button: string) { if (active === button) return "sync-mode-active"; return ""; }
function tagSelectionLabel(tags: string[]) { if (tags.length === 0) return "请选择 Tag"; if (tags.length === 1) return tags[0]; return `已选择 ${tags.length} 个 Tag`; }
function PreviewRemainder({ total }: { total: number }) { if (total <= 8) return null; return <small className="preview-remainder">另有 {total - 8} 个接口将在确认后同步</small>; }
