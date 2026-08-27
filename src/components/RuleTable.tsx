import { Pencil, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import type { MatchMode, ProjectProfile, ProxyRule, RuleInput } from "../types";

interface RuleTableProps {
  profile: ProjectProfile;
  onDelete: (ruleId: string) => Promise<void>;
  onOpenUrl: (url: string) => Promise<void>;
  onReset: () => Promise<void>;
  onSave: (input: RuleInput) => Promise<void>;
  onToggle: (ruleId: string, enabled: boolean) => Promise<void>;
  onToggleGlobal: (enabled: boolean) => Promise<void>;
}

export function RuleTable(props: RuleTableProps) {
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<ProxyRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProxyRule | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [togglingGlobal, setTogglingGlobal] = useState(false);
  const visible = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    if (!query) return props.profile.rules;
    return props.profile.rules.filter((rule) => `${rule.name} ${rule.method} ${rule.path} ${rule.tags.join(" ")}`.toLowerCase().includes(query));
  }, [keyword, props.profile.rules]);

  async function toggleGlobal() {
    setTogglingGlobal(true);
    try {
      await props.onToggleGlobal(!props.profile.globalMockEnabled);
    } finally {
      setTogglingGlobal(false);
    }
  }

  function remove(rule: ProxyRule) {
    setDeleteTarget(rule);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await props.onDelete(deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  async function confirmReset() {
    setResetting(true);
    try {
      await props.onReset();
      setKeyword("");
      setResetOpen(false);
    } finally {
      setResetting(false);
    }
  }

  return (
    <section className="rules-section">
      <div className="section-heading">
        <div className="rules-heading-primary"><h2>Mock 规则</h2><label className="search-field"><Search size={16} /><input placeholder="搜索名称、路径或 Tag" value={keyword} onChange={(event) => setKeyword(event.target.value)} /></label></div>
        <div className="rules-tools">
          <div className="global-mock-control"><span>全局 Mock</span><button aria-checked={props.profile.globalMockEnabled} aria-label="全局 Mock 开关" className={switchClass(props.profile.globalMockEnabled)} disabled={togglingGlobal} onClick={toggleGlobal} role="switch" title="全局 Mock 开关" type="button"><span /></button></div>
          <button className="command-button" onClick={() => setCreating(true)} type="button"><Plus size={16} />添加规则</button>
          <button className="outline-button" disabled={props.profile.rules.length === 0} onClick={() => setResetOpen(true)} type="button"><RotateCcw size={16} />重置列表</button>
        </div>
      </div>
      <div className="rule-table-wrap">
        <table className="rule-table">
          <thead><tr><th>接口 Mock</th><th>接口</th><th>请求</th><th>匹配</th><th>Mock 目标</th><th>操作</th></tr></thead>
          <tbody>{visible.map((rule) => <RuleRow key={rule.id} rule={rule} onDelete={remove} onEdit={setEditing} onOpenUrl={props.onOpenUrl} onToggle={props.onToggle} />)}</tbody>
        </table>
        <EmptyRules count={visible.length} />
      </div>
      <RuleDialog
        key={editing?.id || String(creating)}
        profile={props.profile}
        rule={editing}
        visible={creating || Boolean(editing)}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSave={props.onSave}
      />
      <DeleteRuleDialog busy={deleting} rule={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} />
      <ResetRulesDialog busy={resetting} open={resetOpen} onCancel={() => setResetOpen(false)} onConfirm={confirmReset} />
    </section>
  );
}

function ResetRulesDialog(props: { busy: boolean; open: boolean; onCancel: () => void; onConfirm: () => Promise<void> }) {
  if (!props.open) return null;
  return (
    <div className="modal-backdrop" role="presentation"><section aria-modal="true" className="modal-panel confirm-panel" role="dialog"><div className="modal-head"><h2>重置规则列表</h2><button className="icon-button" disabled={props.busy} onClick={props.onCancel} type="button"><X size={17} /></button></div><p>将清空当前项目的全部 Mock 规则及已同步 Tag。项目连接、Token、Mock 前缀和全局开关不会改变。</p><div className="modal-actions"><button className="outline-button" disabled={props.busy} onClick={props.onCancel} type="button">取消</button><button className="danger-button" disabled={props.busy} onClick={props.onConfirm} type="button">确认重置</button></div></section></div>
  );
}

function DeleteRuleDialog(props: { busy: boolean; rule: ProxyRule | null; onCancel: () => void; onConfirm: () => Promise<void> }) {
  if (!props.rule) return null;
  return (
    <div className="modal-backdrop" role="presentation"><section aria-modal="true" className="modal-panel confirm-panel" role="dialog"><div className="modal-head"><h2>删除规则</h2><button className="icon-button" onClick={props.onCancel} type="button"><X size={17} /></button></div><p>确定删除“{props.rule.name}”吗？如果它来自 Apifox，后续再次同步相同 Tag 时可以重新生成。</p><div className="modal-actions"><button className="outline-button" disabled={props.busy} onClick={props.onCancel} type="button">取消</button><button className="danger-button" disabled={props.busy} onClick={props.onConfirm} type="button">确认删除</button></div></section></div>
  );
}

function RuleRow(props: { rule: ProxyRule; onDelete: (rule: ProxyRule) => void; onEdit: (rule: ProxyRule) => void; onOpenUrl: (url: string) => Promise<void>; onToggle: (id: string, enabled: boolean) => Promise<void> }) {
  return (
    <tr>
      <td><button aria-label={`切换${props.rule.name}`} className={switchClass(props.rule.enabled)} onClick={() => props.onToggle(props.rule.id, !props.rule.enabled)} type="button"><span /></button></td>
      <td><div className="rule-name-cell"><strong>{props.rule.name}</strong><span>{ruleMeta(props.rule)}</span></div></td>
      <td><div className="request-cell"><span className={`method-badge method-${props.rule.method.toLowerCase()}`}>{props.rule.method}</span><RulePath rule={props.rule} onOpenUrl={props.onOpenUrl} /></div></td>
      <td><span className="match-mode">{props.rule.matchMode} · P{props.rule.priority}</span></td>
      <td><div className="target-cell"><span title={props.rule.target}>{props.rule.target}</span></div></td>
      <td><div className="row-actions"><button className="row-action" onClick={() => props.onEdit(props.rule)} title="编辑规则" type="button"><Pencil size={15} /></button><button className="row-action" onClick={() => props.onDelete(props.rule)} title="删除规则" type="button"><Trash2 size={15} /></button></div></td>
    </tr>
  );
}

function RulePath(props: { rule: ProxyRule; onOpenUrl: (url: string) => Promise<void> }) {
  if (!props.rule.apifoxWebUrl) return <code>{props.rule.path}</code>;
  function open(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    void props.onOpenUrl(props.rule.apifoxWebUrl);
  }
  return <a className="rule-path-link" href={props.rule.apifoxWebUrl} onClick={open} title="在 Apifox Web 打开接口"><code>{props.rule.path}</code></a>;
}

function RuleDialog(props: { visible: boolean; profile: ProjectProfile; rule: ProxyRule | null; onClose: () => void; onSave: (input: RuleInput) => Promise<void> }) {
  const [name, setName] = useState(props.rule?.name || "");
  const [method, setMethod] = useState(props.rule?.method || "GET");
  const [path, setPath] = useState(props.rule?.path || "");
  const [matchMode, setMatchMode] = useState<MatchMode>(props.rule?.matchMode || "exact");
  const [target, setTarget] = useState(props.rule?.target || "");
  const [tags, setTags] = useState(props.rule?.tags.join(", ") || "");
  const [priority, setPriority] = useState(String(props.rule?.priority || 100));
  const [busy, setBusy] = useState(false);
  if (!props.visible) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input: RuleInput = {
      profileId: props.profile.id,
      name,
      method,
      path,
      matchMode,
      target,
      enabled: true,
      tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      priority: Number(priority),
    };
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
    <div className="modal-backdrop" role="presentation"><form className="modal-panel modal-panel-wide" onSubmit={submit}>
      <div className="modal-head"><h2>{ruleDialogTitle(props.rule)}</h2><button className="icon-button" onClick={props.onClose} type="button"><X size={17} /></button></div>
      <div className="form-grid"><label>规则名称<input required value={name} onChange={(event) => setName(event.target.value)} /></label><label>Method<select value={method} onChange={(event) => setMethod(event.target.value)}>{["GET", "POST", "PUT", "PATCH", "DELETE"].map((item) => <option key={item}>{item}</option>)}</select></label></div>
      <div className="form-grid"><label>请求路径<input placeholder="/api/orders/{id}" required value={path} onChange={(event) => setPath(event.target.value)} /></label><label>匹配模式<select value={matchMode} onChange={(event) => setMatchMode(event.target.value as MatchMode)}><option value="exact">exact</option><option value="template">template</option><option value="contains">contains</option><option value="regex">regex</option></select></label></div>
      <label>完整 Mock 目标 URL<input placeholder="https://mock.example.com/api/orders/{id}" required value={target} onChange={(event) => setTarget(event.target.value)} /></label>
      <div className="form-grid"><label>Tags（逗号分隔）<input value={tags} onChange={(event) => setTags(event.target.value)} /></label><label>优先级<input type="number" value={priority} onChange={(event) => setPriority(event.target.value)} /></label></div>
      <div className="modal-actions"><button className="outline-button" onClick={props.onClose} type="button">取消</button><button className="command-button" disabled={busy} type="submit">保存规则</button></div>
    </form></div>
  );
}

function switchClass(enabled: boolean) { if (enabled) return "rule-switch rule-switch-on"; return "rule-switch"; }
function ruleMeta(rule: ProxyRule) { const tags = rule.tags.join(", "); if (tags) return `${rule.source} · ${tags}`; return rule.source; }
function ruleDialogTitle(rule: ProxyRule | null) { if (rule) return "编辑规则"; return "添加自定义规则"; }
function EmptyRules({ count }: { count: number }) { if (count > 0) return null; return <div className="empty-rules">尚无规则。先同步 Apifox Tag，或添加自定义规则。</div>; }
