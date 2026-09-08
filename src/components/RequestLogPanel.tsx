import { Button, Descriptions, Empty, Input, Modal, Select, Tooltip } from "antd";
import { Activity, Eye, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { ProjectProfile, ProxyRule, RequestLog } from "../types";

interface RequestLogPanelProps { logs: RequestLog[]; profiles: ProjectProfile[]; onClear: () => Promise<void>; onOpenUrl: (url: string) => Promise<void> }

export function RequestLogPanel(props: RequestLogPanelProps) {
  const [status, setStatus] = useState("matched");
  const [keyword, setKeyword] = useState("");
  const [viewing, setViewing] = useState<{ log: RequestLog; rule: ProxyRule } | null>(null);
  const visible = useMemo(() => props.logs.filter((log) => { if (status !== "all" && log.status !== status) return false; return `${log.method} ${log.source} ${log.destination} ${log.ruleName} ${log.stage}`.toLowerCase().includes(keyword.toLowerCase()); }), [keyword, props.logs, status]);
  const rules = useMemo(() => props.profiles.flatMap((profile) => profile.rules.map((rule) => ({ profile, rule }))), [props.profiles]);
  function findRule(log: RequestLog) { return rules.find((item) => item.rule.id === log.ruleId) || null; }
  function viewLog(log: RequestLog) { const match = findRule(log); if (match) setViewing({ log, rule: match.rule }); }
  return <section className="request-log-section"><div className="section-heading"><div><div className="section-kicker">LIVE TRAFFIC</div><h2>请求记录</h2></div><div className="log-tools"><Input className="search-field" placeholder="搜索请求" prefix={<Search size={15} />} value={keyword} onChange={(event) => setKeyword(event.target.value)} /><Select aria-label="状态筛选" value={status} onChange={setStatus} options={[{ value: "all", label: "全部状态" }, { value: "matched", label: "已 Mock" }, { value: "passed", label: "透传" }, { value: "failed", label: "失败" }]} /><Tooltip title="清空请求记录"><Button aria-label="清空请求记录" className="icon-button" icon={<X size={16} />} onClick={props.onClear} type="text" /></Tooltip></div></div><div className={logStreamClass(visible.length)}>{visible.map((log) => { const rule = findRule(log); return <LogRow key={log.id} log={log} canView={Boolean(rule) && log.status === "matched"} onView={() => viewLog(log)} />; })}<EmptyLogs count={visible.length} /></div><RuleViewer item={viewing} onClose={() => setViewing(null)} onOpenUrl={props.onOpenUrl} /></section>;
}

function LogRow(props: { log: RequestLog; canView: boolean; onView: () => void }) { const log = props.log; return <article className="log-row" title={`${log.stage} · ${log.id}`}><div className="log-time">{formatTime(log.createdAt)}</div><span className={`method-badge method-${log.method.toLowerCase()}`}>{log.method}</span><div className="log-route"><strong>{log.source}</strong><span>{destination(log)}</span></div><div className="log-rule"><Activity size={15} />{ruleName(log)}</div><span className={statusClass(log.status)}>{statusLabel(log.status)}</span><div className="log-result"><strong>{responseCode(log)}</strong><span>{log.duration}ms</span></div><Tooltip title={props.canView ? "查看 Mock 接口" : "对应 Mock 接口已不存在"}><span><Button aria-label="查看 Mock 接口" className="log-view-action" disabled={!props.canView} icon={<Eye size={15} />} onClick={props.onView} type="text" /></span></Tooltip></article>; }

function RuleViewer(props: { item: { log: RequestLog; rule: ProxyRule } | null; onClose: () => void; onOpenUrl: (url: string) => Promise<void> }) { const item = props.item; if (!item) return null; const rule = item.rule; return <Modal open onCancel={props.onClose} title={`查看 Mock 接口 · ${rule.name}`} footer={<Button onClick={props.onClose}>关闭</Button>} width={700}><Descriptions bordered column={1} size="small"><Descriptions.Item label="接口 URL"><code>{rule.method} {rule.path}</code></Descriptions.Item><Descriptions.Item label="接口名称">{rule.name}</Descriptions.Item><Descriptions.Item label="Mock URL"><code>{rule.target || "未配置"}</code></Descriptions.Item><Descriptions.Item label="预设响应体">{rule.localResponseId ? "已配置预设响应" : "未使用预设"}</Descriptions.Item><Descriptions.Item label="请求方式">{rule.method}</Descriptions.Item><Descriptions.Item label="匹配方式">{rule.matchMode}</Descriptions.Item><Descriptions.Item label="Tags">{rule.tags.join(", ") || "无"}</Descriptions.Item><Descriptions.Item label="优先级">{rule.priority}</Descriptions.Item><Descriptions.Item label="Mock 开关">{rule.enabled ? "已开启" : "已关闭"}</Descriptions.Item><Descriptions.Item label="Apifox Web URL">{rule.apifoxWebUrl ? <a href={rule.apifoxWebUrl} onClick={(event) => { event.preventDefault(); void props.onOpenUrl(rule.apifoxWebUrl); }}>打开接口</a> : "无"}</Descriptions.Item></Descriptions></Modal>; }

function formatTime(value: string) { const numeric = Number(value); const date = Number.isNaN(numeric) ? new Date(value) : new Date(numeric); if (Number.isNaN(date.getTime())) return value; const pad = (part: number) => String(part).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`; }
function logStreamClass(count: number) { if (count > 0) return "log-stream has-logs"; return "log-stream empty"; }
function destination(log: RequestLog) { if (log.destination) return log.destination; return `阶段：${log.stage}`; }
function ruleName(log: RequestLog) { if (log.ruleName) return log.ruleName; return "未命中"; }
function responseCode(log: RequestLog) { if (log.responseCode !== null) return String(log.responseCode); return "--"; }
function statusClass(status: RequestLog["status"]) { return `log-status log-status-${status}`; }
function statusLabel(status: RequestLog["status"]) { if (status === "matched") return "已 Mock"; if (status === "failed") return "失败"; return "透传"; }
function EmptyLogs(props: { count: number }) { if (props.count > 0) return null; return <Empty className="empty-rules" description="暂无请求。应用打开并在微信开发者工具中配置代理后，这里会实时更新。" image={Empty.PRESENTED_IMAGE_SIMPLE} />; }
