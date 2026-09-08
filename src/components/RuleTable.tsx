import { Alert, App as AntApp, Button, Drawer, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Spin, Switch, Table, Tooltip } from "antd";
import type { InputRef } from "antd";
import type { TableColumnsType } from "antd";
import { ChevronDown, ChevronUp, Copy, MoveRight, Pencil, Play, Plus, RotateCcw, Search, Trash2, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { RefObject } from "react";
import type { LocalMockResponse, MatchMode, OperationResolution, ProjectProfile, ProxyRule, ResolveOperationInput, RuleInput } from "../types";

interface RuleTableProps {
  disabled: boolean;
  profile: ProjectProfile;
  profiles: ProjectProfile[];
  onDelete: (ruleId: string) => Promise<void>;
  onDeleteMany: (ruleIds: string[]) => Promise<void>;
  onMove: (ruleIds: string[], targetProfileId: string) => Promise<void>;
  onOpenUrl: (url: string) => Promise<void>;
  onResolve: (input: ResolveOperationInput) => Promise<OperationResolution>;
  onSave: (input: RuleInput) => Promise<void>;
  onToggle: (ruleId: string, enabled: boolean) => Promise<void>;
  onToggleGlobal: (enabled: boolean) => Promise<void>;
  onDebugSingle: (ruleId: string) => Promise<void>;
  localResponses: LocalMockResponse[];
}

export function RuleTable(props: RuleTableProps) {
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<ProxyRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [togglingGlobal, setTogglingGlobal] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [movingRuleIds, setMovingRuleIds] = useState<string[]>([]);
  const [targetProfileId, setTargetProfileId] = useState<string>();
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { message } = AntApp.useApp();
  const targetProfiles = props.profiles.filter((profile) => profile.id !== props.profile.id);
  let batchMoveHint: string | undefined;
  if (targetProfiles.length === 0) batchMoveHint = "需要先创建其他 Tab";
  else if (selectedRowKeys.length === 0) batchMoveHint = "请先勾选 Mock 接口";
  let moveDialogTitle = "移动 Mock 接口";
  if (movingRuleIds.length > 1) moveDialogTitle = `批量移动 ${movingRuleIds.length} 个 Mock 接口`;
  useEffect(() => {
    setSelectedRowKeys([]);
    setMovingRuleIds([]);
    setTargetProfileId(undefined);
  }, [props.profile.id]);
  const visible = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    if (!query) return props.profile.rules;
    return props.profile.rules.filter((rule) => `${rule.name} ${rule.method} ${rule.path} ${rule.tags.join(" ")}`.toLowerCase().includes(query));
  }, [keyword, props.profile.rules]);

  async function toggleGlobal(enabled: boolean) {
    if (props.disabled) return;
    setTogglingGlobal(true);
    try {
      await props.onToggleGlobal(enabled);
    } finally {
      setTogglingGlobal(false);
    }
  }

  function startMove(ruleIds: string[]) {
    setMovingRuleIds(ruleIds);
    setTargetProfileId(undefined);
  }

  async function confirmMove() {
    if (!targetProfileId) return;
    setMoving(true);
    try {
      await props.onMove(movingRuleIds, targetProfileId);
      setSelectedRowKeys((current) => current.filter((id) => !movingRuleIds.includes(id)));
      setMovingRuleIds([]);
      setTargetProfileId(undefined);
    } finally {
      setMoving(false);
    }
  }

  async function confirmBatchDelete() {
    setDeleting(true);
    try {
      await props.onDeleteMany(selectedRowKeys);
      setSelectedRowKeys([]);
    } finally {
      setDeleting(false);
    }
  }

  const columns = useMemo<TableColumnsType<ProxyRule>>(() => [
    { title: "Mock 开关", dataIndex: "enabled", width: 96, render: (_, rule) => <Switch aria-label={`切换${rule.name}`} checked={rule.enabled} disabled={props.disabled} onChange={(enabled) => props.onToggle(rule.id, enabled)} size="small" /> },
    { title: "接口信息", dataIndex: "name", width: 380, render: (_, rule) => <div className="rule-info-cell"><div className="rule-name-line"><Tooltip title="复制接口信息"><Button aria-label="复制接口信息" className="row-action rule-copy-action" icon={<Copy size={14} />} onClick={() => { void copyRuleInfo(rule); }} type="text" /></Tooltip>{rule.apifoxWebUrl ? <a className="rule-name-link" href={rule.apifoxWebUrl} onClick={(event) => { event.preventDefault(); void props.onOpenUrl(rule.apifoxWebUrl); }} title="在 Apifox Web 打开接口">{rule.name}</a> : <strong>{rule.name}</strong>}</div><span className="request-cell"><span className={`method-badge method-${rule.method.toLowerCase()}`}>{rule.method}</span><RulePath rule={rule} /></span></div> },
    { title: "Mock 目标", dataIndex: "target", width: 320, render: (_, rule) => <div className="target-cell"><span title={displayMockTarget(rule, props.localResponses)}>{displayMockTarget(rule, props.localResponses)}</span></div> },
    { title: "操作", key: "actions", fixed: "right", width: 164, render: (_, rule) => <RuleActions canMove={targetProfiles.length > 0} globalMockEnabled={props.profile.globalMockEnabled} localResponses={props.localResponses} onDebugSingle={props.onDebugSingle} onDelete={props.onDelete} onEdit={setEditing} onMove={() => startMove([rule.id])} onOpenUrl={props.onOpenUrl} rule={rule} /> },
  ], [props.disabled, props.localResponses, props.onDelete, props.onDebugSingle, props.onOpenUrl, props.onToggle, props.profile, targetProfiles.length]);

  return (
    <section className="rules-section">
      <div className="section-heading">
        <div className="rules-heading-primary"><h2>Mock 接口 <Tooltip title={<div className="mock-help-tooltip"><div>• 全局 Mock 或当前接口开关未开启</div><div>• 真实接口域名或路径前缀不匹配</div><div>• Apifox Method 定义错误，例如 GET 请求定义为 POST</div><div>• 接口路径或匹配方式不一致</div><div>• HTTPS 证书未信任</div></div>}><span className="help-icon" aria-label="Mock 接口不生效排查提示">?</span></Tooltip></h2><Input allowClear className="search-field" placeholder="搜索接口名称、URL 或 Tag" prefix={<Search size={16} />} value={keyword} onChange={(event) => setKeyword(event.target.value)} /></div>
        <div className="rules-tools">
          <div className="global-mock-control"><span>全局 Mock</span><Switch aria-label="全局 Mock 开关" checked={props.profile.globalMockEnabled} disabled={props.disabled} loading={togglingGlobal} onChange={toggleGlobal} /></div>
          <Tooltip title={batchMoveHint}><span><Button disabled={targetProfiles.length === 0 || selectedRowKeys.length === 0} icon={<MoveRight size={15} />} onClick={() => startMove(selectedRowKeys)}>批量移动</Button></span></Tooltip>
          <Button disabled={selectedRowKeys.length === 0} icon={<WandSparkles size={15} />} onClick={() => { void copySimulationPrompt(props.profile.rules.filter((rule) => selectedRowKeys.includes(rule.id)), message); }}>真机模拟</Button>
          <Button className="command-button" icon={<Plus size={16} />} onClick={() => setCreating(true)} type="primary">添加接口</Button>
          <Popconfirm cancelText="取消" description={`将删除已勾选的 ${selectedRowKeys.length} 个 Mock 接口，此操作不可恢复。`} disabled={selectedRowKeys.length === 0 || deleting} okButtonProps={{ danger: true }} okText="确认删除" onConfirm={() => { void confirmBatchDelete(); }} title="确认批量删除 Mock 接口？">
          <Button className="danger-button" danger disabled={selectedRowKeys.length === 0 || deleting} icon={<Trash2 size={16} />} loading={deleting}>批量删除</Button>
          </Popconfirm>
        </div>
      </div>
      <div className="rule-table-wrap">
        <Table<ProxyRule> columns={columns} dataSource={visible} locale={{ emptyText: <Empty description="尚无 Mock 接口。先同步 Apifox Tag，或手动添加接口。" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} pagination={false} rowKey="id" rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys.map(String)) }} scroll={{ x: 1114 }} size="small" />
      </div>
      <RuleDialog key={editing?.id || String(creating)} localResponses={props.localResponses} profile={props.profile} rule={editing} visible={creating || Boolean(editing)} onClose={() => { setCreating(false); setEditing(null); }} onResolve={props.onResolve} onSave={props.onSave} />
      <Modal cancelButtonProps={{ disabled: moving }} cancelText="取消" closable={!moving} confirmLoading={moving} keyboard={!moving} maskClosable={!moving} okButtonProps={{ disabled: !targetProfileId }} okText="确定移动" onCancel={() => setMovingRuleIds([])} onOk={() => { void confirmMove(); }} open={movingRuleIds.length > 0} title={moveDialogTitle}>
        <Form layout="vertical"><Form.Item label="目的 Tab" required><Select autoFocus options={targetProfiles.map((profile) => ({ label: `${profile.name}（${profile.rules.length}）`, value: profile.id }))} placeholder="请选择目的 Tab" value={targetProfileId} onChange={setTargetProfileId} /></Form.Item></Form>
      </Modal>
    </section>
  );
}

function RuleActions(props: { rule: ProxyRule; canMove: boolean; globalMockEnabled: boolean; localResponses: LocalMockResponse[]; onDelete: (ruleId: string) => Promise<void>; onEdit: (rule: ProxyRule) => void; onDebugSingle: (ruleId: string) => Promise<void>; onMove: () => void; onOpenUrl: (url: string) => Promise<void> }) {
  const [testing, setTesting] = useState(false);
  const [debugging, setDebugging] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [responseSearch, setResponseSearch] = useState("");
  const [responseMatchIndex, setResponseMatchIndex] = useState(0);
  const responseSearchRef = useRef<InputRef>(null);
  const responseContainerRef = useRef<HTMLPreElement>(null);
  const { message } = AntApp.useApp();
  async function test() {
    if (!props.globalMockEnabled) { void message.warning("全局 Mock 已关闭，请先开启后再测试接口"); return; }
    if (!props.rule.enabled) { void message.warning("请先打开当前接口的 Mock 开关"); return; }
    const localResponse = findLocalResponse(props.rule, props.localResponses);
    if (!localResponse && !props.rule.target) { void message.warning("当前接口未配置 Mock 目标"); return; }
    setTesting(true); setResult(null); setResponseSearch(""); setResponseMatchIndex(0);
    try {
      if (localResponse) {
        await waitForDelay(localResponse.delayMs);
        setResult({ status: localResponse.status, statusText: statusText(localResponse.status), body: formatResponseBody(localResponse.body), error: "" });
      } else {
        const response = await fetch(props.rule.target, { method: props.rule.method });
        const body = await response.text();
        setResult({ status: response.status, statusText: response.statusText, body: formatResponseBody(body), error: "" });
      }
    } catch (reason) { setResult({ status: 0, statusText: "请求失败", body: "", error: errorMessage(reason) }); } finally { setTesting(false); }
  }
  useEffect(() => {
    if (!result) return;
    function focusSearch(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        responseSearchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [result]);
  const matchCount = countResponseMatches(result?.body || "", responseSearch);
  useEffect(() => {
    if (!responseSearch.trim() || matchCount === 0) return;
    const activeMatch = responseContainerRef.current?.querySelector("mark.active-match");
    activeMatch?.scrollIntoView({ block: "center" });
  }, [matchCount, responseMatchIndex, responseSearch]);
  function updateResponseSearch(value: string) {
    setResponseSearch(value);
    setResponseMatchIndex(0);
  }
  function moveResponseMatch(direction: 1 | -1) {
    if (matchCount === 0) return;
    setResponseMatchIndex((current) => {
      const next = current + direction;
      if (next < 0) return matchCount - 1;
      if (next >= matchCount) return 0;
      return next;
    });
  }
  async function debugSingle() {
    setDebugging(true);
    try { await props.onDebugSingle(props.rule.id); } finally { setDebugging(false); }
  }
  let moveTitle = "需要先创建其他 Tab";
  if (props.canMove) moveTitle = "移动接口";
  return <div className="row-actions"><Tooltip title="测试接口"><Button aria-label="测试接口" className="row-action" icon={<Play size={15} />} loading={testing} onClick={test} type="text" /></Tooltip><Tooltip title="仅调试当前接口"><Button aria-label="仅调试当前接口" className="row-action" icon={<span className="debug-single-icon">1</span>} loading={debugging} onClick={debugSingle} type="text" /></Tooltip><Tooltip title="编辑接口"><Button aria-label="编辑接口" className="row-action" icon={<Pencil size={15} />} onClick={() => props.onEdit(props.rule)} type="text" /></Tooltip><Tooltip title={moveTitle}><span><Button aria-label="移动接口" className="row-action" disabled={!props.canMove} icon={<MoveRight size={15} />} onClick={props.onMove} type="text" /></span></Tooltip><Popconfirm cancelText="取消" description="Apifox 接口可在后续同步相同 Tag 时重新生成。" okButtonProps={{ danger: true }} okText="确认删除" onConfirm={() => props.onDelete(props.rule.id)} title={`删除“${props.rule.name}”？`}><Tooltip title="删除接口"><Button aria-label="删除接口" className="row-action" danger icon={<Trash2 size={15} />} type="text" /></Tooltip></Popconfirm><Modal onCancel={() => setResult(null)} open={Boolean(result) || testing} title={`测试接口 · ${props.rule.name}`} width={700} footer={<div className="test-modal-footer"><Button icon={<RotateCcw size={15} />} loading={testing} onClick={() => { void test(); }}>重试</Button><Button disabled={!props.rule.apifoxWebUrl} onClick={() => { if (props.rule.apifoxWebUrl) { void props.onOpenUrl(props.rule.apifoxWebUrl); return; } void message.warning("当前接口没有可用的 Apifox 设置页面链接"); }} type="primary">去 Mock 接口</Button></div>}>{renderTestContent(testing, result, props.rule, responseSearch, updateResponseSearch, responseSearchRef, responseContainerRef, responseMatchIndex, matchCount, moveResponseMatch)}</Modal></div>;
}

interface TestResult { status: number; statusText: string; body: string; error: string }
function renderTestContent(testing: boolean, result: TestResult | null, rule: ProxyRule, responseSearch: string, onSearch: (value: string) => void, responseSearchRef: RefObject<InputRef | null>, responseContainerRef: RefObject<HTMLPreElement | null>, responseMatchIndex: number, matchCount: number, moveResponseMatch: (direction: 1 | -1) => void) { if (testing) return <div className="test-loading"><Spin size="large" /><span>正在发送请求...</span><code>{rule.target}</code></div>; return renderTestResult(result, rule, responseSearch, onSearch, responseSearchRef, responseContainerRef, responseMatchIndex, matchCount, moveResponseMatch); }
function renderTestResult(result: TestResult | null, rule: ProxyRule, responseSearch: string, onSearch: (value: string) => void, responseSearchRef: RefObject<InputRef | null>, responseContainerRef: RefObject<HTMLPreElement | null>, responseMatchIndex: number, matchCount: number, moveResponseMatch: (direction: 1 | -1) => void) { if (!result) return null; let message = result.statusText; let type: "success" | "error" = "error"; if (result.status) message = `${result.status} ${result.statusText}`; if (result.status >= 200 && result.status < 300) type = "success"; return <div className="test-result"><Alert message={message} type={type} showIcon /><div><strong>原始接口</strong><span className="original-url"><code>{rule.method} {rule.path}</code><Tooltip title="复制原始接口"><Button aria-label="复制原始接口" icon={<Copy size={14} />} onClick={() => { void copyOriginalUrl(rule); }} size="small" type="text" /></Tooltip></span></div><div><strong>Mock 地址</strong><code>{rule.target}</code></div>{renderTestPayload(result, responseSearch, onSearch, responseSearchRef, responseContainerRef, responseMatchIndex, matchCount, moveResponseMatch)}</div>; }
function renderTestPayload(result: TestResult, responseSearch: string, onSearch: (value: string) => void, responseSearchRef: RefObject<InputRef | null>, responseContainerRef: RefObject<HTMLPreElement | null>, responseMatchIndex: number, matchCount: number, moveResponseMatch: (direction: 1 | -1) => void) { if (result.error) return <div><strong>错误信息</strong><pre>{result.error}</pre></div>; function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) { if (event.key !== "Enter") return; event.preventDefault(); if (event.shiftKey) moveResponseMatch(-1); else moveResponseMatch(1); } return <div className="response-payload"><div className="response-payload-heading"><strong>响应内容</strong><div className="response-search-tools"><Input ref={responseSearchRef} allowClear onChange={(event) => onSearch(event.target.value)} onKeyDown={handleKeyDown} placeholder="搜索响应内容（Ctrl/Cmd+F）" prefix={<Search size={14} />} value={responseSearch} /><span className="response-match-count">{responseMatchLabel(responseMatchIndex, matchCount)}</span><Tooltip title="上一个匹配"><Button aria-label="上一个匹配" disabled={matchCount === 0} icon={<ChevronUp size={15} />} onClick={() => moveResponseMatch(-1)} size="small" /></Tooltip><Tooltip title="下一个匹配"><Button aria-label="下一个匹配" disabled={matchCount === 0} icon={<ChevronDown size={15} />} onClick={() => moveResponseMatch(1)} size="small" /></Tooltip></div></div><pre ref={responseContainerRef}>{renderSearchableResponse(result.body || "（空响应）", responseSearch, responseMatchIndex)}</pre></div>; }
function renderSearchableResponse(body: string, query: string, activeMatchIndex: number) { if (!query.trim()) return body; const parts = body.split(new RegExp(`(${escapeRegExp(query)})`, "gi")); let matchIndex = 0; return parts.map((part, index) => { if (part.toLowerCase() === query.toLowerCase()) { const currentIndex = matchIndex; matchIndex += 1; return <mark className={matchClassName(currentIndex === activeMatchIndex)} key={`${part}-${index}-${currentIndex}`}>{part}</mark>; } return part; }); }
function matchClassName(active: boolean) { if (active) return "active-match"; return undefined; }
function responseMatchLabel(index: number, count: number) { if (count === 0) return "0 / 0"; return `${index + 1} / ${count}`; }
function countResponseMatches(body: string, query: string) { if (!query.trim()) return 0; return Array.from(body.matchAll(new RegExp(escapeRegExp(query), "gi"))).length; }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function RulePath(props: { rule: ProxyRule }) {
  async function copyPath() {
    try { await navigator.clipboard.writeText(props.rule.path); } catch { return; }
  }
  return <button className="rule-path-copy" onClick={() => { void copyPath(); }} title="复制接口 URL" type="button"><code>{props.rule.path}</code></button>;
}

function RuleDialog(props: { visible: boolean; profile: ProjectProfile; rule: ProxyRule | null; localResponses: LocalMockResponse[]; onClose: () => void; onResolve: (input: ResolveOperationInput) => Promise<OperationResolution>; onSave: (input: RuleInput) => Promise<void> }) {
  const { message } = AntApp.useApp();
  const [name, setName] = useState(props.rule?.name || "");
  const [method, setMethod] = useState(props.rule?.method || "");
  const [path, setPath] = useState(props.rule?.path || "");
  const [matchMode, setMatchMode] = useState<MatchMode | "">(props.rule?.matchMode || "");
  const [target, setTarget] = useState(props.rule?.target || "");
  const [tags, setTags] = useState(props.rule?.tags.join(", ") || "");
  const [priority, setPriority] = useState<number | null>(props.rule?.priority ?? null);
  const [apifoxWebUrl, setApifoxWebUrl] = useState(props.rule?.apifoxWebUrl || "");
  const [localResponseId, setLocalResponseId] = useState<string | null>(props.rule?.localResponseId || null);
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState(false);
  const saveDisabled = !name.trim() || !path.trim() || (!target.trim() && !localResponseId) || !method || !matchMode;

  async function resolveUrl() {
    if (!path.trim()) return;
    setResolving(true);
    try {
      const result = await props.onResolve({ profileId: props.profile.id, url: path, method });
      if (!result.interface) {
        if (result.matchCount > 1) void message.warning(`匹配到 ${result.matchCount} 个接口，请输入更完整的 URL`);
        if (result.matchCount === 0) void message.warning("未找到匹配的接口，请检查 URL 或手动填写其他字段");
        return;
      }
      const resolved = result.interface;
      setPath(resolved.path);
      setName(resolved.name);
      setMethod(resolved.method);
      setMatchMode(resolved.matchMode);
      setTarget(resolved.target);
      setTags(resolved.tags.join(", "));
      setPriority(100);
      setApifoxWebUrl(resolved.apifoxWebUrl);
      void message.success("已从 Apifox 自动填充接口信息");
    } catch (reason) {
      void message.error(errorMessage(reason));
    } finally {
      setResolving(false);
    }
  }

  async function submit() {
    if (!matchMode) return;
    const input: RuleInput = { profileId: props.profile.id, name, method, path: normalizeRulePath(path), matchMode, target, enabled: true, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean), priority: priority ?? 100, apifoxWebUrl, localResponseId };
    if (props.rule) {
      input.id = props.rule.id;
      input.enabled = props.rule.enabled;
    }
    setBusy(true);
    try {
      await props.onSave(input);
      props.onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer destroyOnHidden extra={<Space><Button disabled={busy} onClick={props.onClose}>取消</Button><Button disabled={saveDisabled} loading={busy} onClick={submit} type="primary">{saveButtonLabel(props.rule)}</Button></Space>} onClose={props.onClose} open={props.visible} title={ruleDialogTitle(props.rule)} width={600}>
      <Form layout="vertical" requiredMark={false}>
        <Form.Item extra="输入完整 URL 或接口路径，失焦后将从当前 Apifox 项目自动匹配" label="接口 URL" required><Input placeholder="https://api.example.com/api/orders/{id}" suffix={resolvingIndicator(resolving)} value={path} onBlur={resolveUrl} onChange={(event) => setPath(event.target.value)} /></Form.Item>
        <Form.Item label="接口名称" required><Input placeholder="请输入接口名称" value={name} onChange={(event) => setName(event.target.value)} /></Form.Item>
        <Form.Item label="Mock URL" required><Input placeholder="https://mock.example.com/api/orders/{id}" value={target} onChange={(event) => setTarget(event.target.value)} /></Form.Item>
        <Form.Item label="使用预设响应体"><Switch checked={Boolean(localResponseId)} onChange={(checked) => { if (checked) { setLocalResponseId(props.localResponses[0]?.id || null); return; } setLocalResponseId(null); }} /><Select allowClear disabled={!localResponseId} onChange={setLocalResponseId} options={props.localResponses.map((item) => ({ label: item.name, value: item.id }))} placeholder="选择预设响应" style={{ marginLeft: 12, minWidth: 220 }} value={localResponseId || undefined} /></Form.Item>
        <div className="form-grid"><Form.Item label="请求方式" required><Select placeholder="请选择" value={method || undefined} onChange={setMethod} options={["GET", "POST", "PUT", "PATCH", "DELETE"].map((item) => ({ label: item, value: item }))} /></Form.Item><Form.Item label="匹配方式" required><Select placeholder="请选择" value={matchMode || undefined} onChange={setMatchMode} options={["exact", "template", "contains", "regex"].map((item) => ({ label: item, value: item }))} /></Form.Item></div>
        <div className="form-grid"><Form.Item label="Tags（逗号分隔）"><Input placeholder="选填" value={tags} onChange={(event) => setTags(event.target.value)} /></Form.Item><Form.Item label="优先级"><InputNumber min={0} placeholder="选填" value={priority} onChange={setPriority} /></Form.Item></div>
      </Form>
    </Drawer>
  );
}

function ruleDialogTitle(rule: ProxyRule | null) { if (rule) return "编辑 Mock 接口"; return "添加 Mock 接口"; }
function saveButtonLabel(rule: ProxyRule | null) { if (rule) return "更新"; return "添加"; }
function resolvingIndicator(resolving: boolean) { if (resolving) return <Spin size="small" />; return null; }
function normalizeRulePath(value: string) { try { return new URL(value).pathname; } catch { const path = value.split(/[?#]/)[0].trim(); if (path.startsWith("/")) return path; return `/${path}`; } }
function errorMessage(reason: unknown) { if (reason instanceof Error) return reason.message; return String(reason); }
function formatResponseBody(body: string) { try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; } }
function findLocalResponse(rule: ProxyRule, responses: LocalMockResponse[]) { if (!rule.localResponseId) return null; return responses.find((response) => response.id === rule.localResponseId) || null; }
function displayMockTarget(rule: ProxyRule, responses: LocalMockResponse[]) { const response = findLocalResponse(rule, responses); if (response) return `预设-${response.name}`; return rule.target; }
function statusText(status: number) { return `HTTP ${status}`; }
async function waitForDelay(delay: number) { if (delay <= 0) return; await new Promise<void>((resolve) => { window.setTimeout(resolve, delay); }); }
async function copyOriginalUrl(rule: ProxyRule) { try { await navigator.clipboard.writeText(`${rule.method} ${rule.path}`); } catch { return; } }
async function copyRuleInfo(rule: ProxyRule) {
  const content = [`- ${rule.name}`, `- ${rule.method} ${rule.path}`, `- apifox 地址：${rule.apifoxWebUrl}`].join("\n") + "\n";
  try { await navigator.clipboard.writeText(content); } catch { return; }
}
async function copySimulationPrompt(rules: ProxyRule[], message: ReturnType<typeof AntApp.useApp>["message"]) { const lines = rules.map((rule) => `- 原始接口：${rule.method} ${rule.path}\n  Mock 接口：${rule.target}`).join("\n"); const prompt = `请帮我将当前项目中以下接口的请求 URL 替换为对应的 Mock 接口 URL。\n\n${lines}\n\n限制：只替换 URL 请求地址，不修改请求方法、请求参数、请求体、响应处理、业务逻辑和其他接口代码。\n\n完成后，请在每个替换位置增加注释：TODO: 联调接口待删除。\n禁止提交这些 Mock 接口代码，保留修改在本地工作区，等待人工确认后再提交。`; try { await navigator.clipboard.writeText(prompt); message.success("真机模拟提示词已复制到剪贴板"); } catch { message.error("提示词复制失败，请检查剪贴板权限"); } }
