import { Button, Empty, Input, Select, Tooltip } from "antd";
import { Activity, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { RequestLog } from "../types";

interface RequestLogPanelProps {
  logs: RequestLog[];
  onClear: () => Promise<void>;
}

export function RequestLogPanel({ logs, onClear }: RequestLogPanelProps) {
  const [status, setStatus] = useState("all");
  const [keyword, setKeyword] = useState("");
  const visible = useMemo(() => logs.filter((log) => {
    if (status !== "all" && log.status !== status) return false;
    return `${log.method} ${log.source} ${log.destination} ${log.ruleName} ${log.stage}`.toLowerCase().includes(keyword.toLowerCase());
  }), [keyword, logs, status]);

  return (
    <section className="request-log-section">
      <div className="section-heading"><div><div className="section-kicker">LIVE TRAFFIC</div><h2>请求记录</h2></div><div className="log-tools">
        <Input className="search-field" placeholder="搜索请求" prefix={<Search size={15} />} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
        <Select aria-label="状态筛选" value={status} onChange={setStatus} options={[{ value: "all", label: "全部状态" }, { value: "matched", label: "已 Mock" }, { value: "passed", label: "透传" }, { value: "failed", label: "失败" }]} />
        <Tooltip title="清空请求记录"><Button aria-label="清空请求记录" className="icon-button" icon={<X size={16} />} onClick={onClear} type="text" /></Tooltip>
      </div></div>
      <div className="log-stream">{visible.map((log) => <LogRow key={log.id} log={log} />)}<EmptyLogs count={visible.length} /></div>
    </section>
  );
}

function LogRow({ log }: { log: RequestLog }) {
  return <article className="log-row" title={`${log.stage} · ${log.id}`}><div className="log-time">{formatTime(log.createdAt)}</div><span className={`method-badge method-${log.method.toLowerCase()}`}>{log.method}</span><div className="log-route"><strong>{log.source}</strong><span>{destination(log)}</span></div><div className="log-rule"><Activity size={15} />{ruleName(log)}</div><span className={statusClass(log.status)}>{statusLabel(log.status)}</span><div className="log-result"><strong>{responseCode(log)}</strong><span>{log.duration}ms</span></div></article>;
}

function formatTime(value: string) { const date = new Date(value); if (Number.isNaN(date.getTime())) return value; return date.toLocaleTimeString("zh-CN", { hour12: false }); }
function destination(log: RequestLog) { if (log.destination) return log.destination; return `阶段：${log.stage}`; }
function ruleName(log: RequestLog) { if (log.ruleName) return log.ruleName; return "未命中"; }
function responseCode(log: RequestLog) { if (log.responseCode !== null) return String(log.responseCode); return "--"; }
function statusClass(status: RequestLog["status"]) { return `log-status log-status-${status}`; }
function statusLabel(status: RequestLog["status"]) { if (status === "matched") return "已 Mock"; if (status === "failed") return "失败"; return "透传"; }
function EmptyLogs({ count }: { count: number }) { if (count > 0) return null; return <Empty className="empty-rules" description="暂无请求。启动代理并在微信开发者工具中配置代理后，这里会实时更新。" image={Empty.PRESENTED_IMAGE_SIMPLE} />; }
