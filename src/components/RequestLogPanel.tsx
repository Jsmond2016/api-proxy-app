import { Activity, ChevronDown, Filter, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { RequestLog } from "../types";

interface RequestLogPanelProps {
  logs: RequestLog[];
}

function getLogStatusClass(status: RequestLog["status"]) {
  if (status === "matched") {
    return "log-status log-status-matched";
  }

  if (status === "failed") {
    return "log-status log-status-failed";
  }

  return "log-status log-status-passed";
}

function getStatusLabel(status: RequestLog["status"]) {
  if (status === "matched") {
    return "已 Mock";
  }

  if (status === "failed") {
    return "失败";
  }

  return "透传";
}

export function RequestLogPanel({ logs }: RequestLogPanelProps) {
  const [showOnlyMocked, setShowOnlyMocked] = useState(false);
  const visibleLogs = useMemo(() => {
    if (showOnlyMocked) {
      return logs.filter((log) => log.status === "matched");
    }

    return logs;
  }, [logs, showOnlyMocked]);

  return (
    <section className="request-log-section">
      <div className="section-heading">
        <div>
          <div className="section-kicker">LIVE TRAFFIC</div>
          <h2>请求记录</h2>
        </div>
        <div className="log-tools">
          <button className="filter-button" onClick={() => setShowOnlyMocked(!showOnlyMocked)} type="button">
            <Filter size={15} strokeWidth={1.8} />
            仅 Mock
          </button>
          <button className="icon-button" title="清空请求记录" type="button">
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className="log-stream">
        {visibleLogs.map((log) => (
          <article className="log-row" key={log.id}>
            <div className="log-time">{log.createdAt}</div>
            <span className={`method-badge method-${log.method.toLowerCase()}`}>{log.method}</span>
            <div className="log-route">
              <strong>{log.source}</strong>
              <span>{log.destination}</span>
            </div>
            <div className="log-rule">
              <Activity size={15} strokeWidth={1.8} />
              {log.ruleName}
            </div>
            <span className={getLogStatusClass(log.status)}>{getStatusLabel(log.status)}</span>
            <div className="log-result">
              <strong>{log.responseCode}</strong>
              <span>{log.duration}ms</span>
            </div>
            <button className="row-action" title="展开请求详情" type="button">
              <ChevronDown size={16} strokeWidth={1.8} />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
