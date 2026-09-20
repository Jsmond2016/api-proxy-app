import {
  Alert,
  App as AntApp,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Select,
  Spin,
  Tooltip,
} from "antd";
import { ArrowRight, Eye, RefreshCw, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { errorMessage, formatResponseBody } from "../lib/format";
import type { MockResponsePreview, ProjectProfile, ProxyRule, RequestLog } from "../types";
import { ResponsePayloadViewer } from "./ResponsePayloadViewer";

interface RequestLogPanelProps {
  logs: RequestLog[];
  profiles: ProjectProfile[];
  onClear: () => Promise<void>;
  onPreview: (logId: string) => Promise<MockResponsePreview>;
}
interface ViewingLog {
  log: RequestLog;
  rule: ProxyRule | null;
}

export function RequestLogPanel(props: RequestLogPanelProps) {
  const [status, setStatus] = useState("matched");
  const [keyword, setKeyword] = useState("");
  const [viewing, setViewing] = useState<ViewingLog | null>(null);
  const [preview, setPreview] = useState<MockResponsePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const { message } = AntApp.useApp();
  const rules = useMemo(() => props.profiles.flatMap((profile) => profile.rules), [props.profiles]);
  const visible = useMemo(
    () =>
      props.logs.filter((log) => {
        if (status !== "all" && log.status !== status) return false;
        return `${log.method} ${log.source} ${log.destination} ${log.ruleName} ${log.stage}`
          .toLowerCase()
          .includes(keyword.toLowerCase());
      }),
    [keyword, props.logs, status],
  );
  const summary = useMemo(
    () => ({
      matched: props.logs.filter((log) => log.status === "matched").length,
      failed: props.logs.filter((log) => log.status === "failed").length,
    }),
    [props.logs],
  );
  function findRule(log: RequestLog) {
    return rules.find((rule) => rule.id === log.ruleId) || null;
  }
  async function loadPreview(log: RequestLog) {
    setPreviewing(true);
    try {
      setPreview(await props.onPreview(log.id));
    } catch (reason) {
      void message.error(errorMessage(reason));
    } finally {
      setPreviewing(false);
    }
  }
  function openPreview(log: RequestLog) {
    setViewing({ log, rule: findRule(log) });
    setPreview(null);
    void loadPreview(log);
  }
  function closePreview() {
    setViewing(null);
    setPreview(null);
  }
  return (
    <section className="request-log-section">
      <div className="section-heading traffic-heading">
        <div>
          <div className="section-kicker">LIVE TRAFFIC</div>
          <div className="traffic-title-row">
            <h2>代理流量</h2>
            <span className="traffic-live">
              <i />
              实时更新
            </span>
            <span className="traffic-summary">已 Mock {summary.matched} 条</span>
            {summary.failed > 0 && <span className="traffic-failed">失败 {summary.failed} 条</span>}
          </div>
        </div>
        <div className="log-tools">
          <Input
            allowClear
            className="search-field"
            placeholder="搜索接口名称或 URL"
            prefix={<Search size={15} />}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Select
            aria-label="状态筛选"
            value={status}
            onChange={setStatus}
            options={[
              { value: "matched", label: "已 Mock" },
              { value: "all", label: "全部状态" },
              { value: "passed", label: "透传" },
              { value: "failed", label: "失败" },
            ]}
          />
          <Tooltip title="清空请求记录">
            <Button
              aria-label="清空请求记录"
              className="icon-button"
              icon={<X size={16} />}
              onClick={() => {
                void props.onClear();
              }}
              type="text"
            />
          </Tooltip>
        </div>
      </div>
      <div className={logStreamClass(visible.length)}>
        {visible.map((log) => (
          <LogRow key={log.id} log={log} onPreview={() => openPreview(log)} />
        ))}
        <EmptyLogs count={visible.length} />
      </div>
      <TrafficDetailDrawer
        item={viewing}
        preview={preview}
        previewing={previewing}
        onClose={closePreview}
        onRefresh={() => {
          if (viewing) void loadPreview(viewing.log);
        }}
      />
    </section>
  );
}

function LogRow(props: { log: RequestLog; onPreview: () => void }) {
  const { log } = props;
  const canPreview = log.status === "matched";
  let previewTitle = "仅已 Mock 的请求可查看响应";
  if (canPreview) previewTitle = "重新请求 Mock 并查看响应";
  return (
    <article className="traffic-row" title={`${log.stage} · ${log.id}`}>
      <time>{formatTime(log.createdAt)}</time>
      <span className={`method-badge method-${log.method.toLowerCase()}`}>{log.method}</span>
      <div className="traffic-request">
        <strong>{ruleName(log)}</strong>
        <code title={log.source}>{log.source}</code>
      </div>
      <ArrowRight aria-hidden className="traffic-arrow" size={16} />
      <div className="traffic-target">
        <span>Mock 转发</span>
        <code title={destination(log)}>{destination(log)}</code>
      </div>
      <div className="traffic-result">
        <span className={statusClass(log.status)}>{statusLabel(log.status)}</span>
        <strong>{responseCode(log)}</strong>
        <small>{log.duration} ms</small>
      </div>
      <Tooltip title={previewTitle}>
        <span>
          <Button
            aria-label="查看 Mock 响应"
            className="log-view-action"
            disabled={!canPreview}
            icon={<Eye size={16} />}
            onClick={props.onPreview}
            type="text"
          />
        </span>
      </Tooltip>
    </article>
  );
}

function TrafficDetailDrawer(props: {
  item: ViewingLog | null;
  preview: MockResponsePreview | null;
  previewing: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  if (!props.item) return null;
  const { log, rule } = props.item;
  let currentRuleName = "对应 Mock 接口已删除";
  if (rule) currentRuleName = rule.name;
  let responseSource = "远程 Mock";
  if (props.preview?.source === "local") responseSource = "本地预设响应";
  return (
    <Drawer
      destroyOnHidden
      extra={
        <Button icon={<RefreshCw size={15} />} loading={props.previewing} onClick={props.onRefresh}>
          重新请求
        </Button>
      }
      onClose={props.onClose}
      open
      title={`Mock 响应 · ${ruleName(log)}`}
      width={760}
    >
      <Descriptions bordered column={1} size="small">
        <Descriptions.Item label="原始请求">
          <code>
            {log.method} {log.source}
          </code>
        </Descriptions.Item>
        <Descriptions.Item label="Mock 转发">
          <code>{destination(log)}</code>
        </Descriptions.Item>
        <Descriptions.Item label="命中接口">{currentRuleName}</Descriptions.Item>
        <Descriptions.Item label="响应来源">{responseSource}</Descriptions.Item>
      </Descriptions>
      <Alert
        className="traffic-replay-note"
        message="响应为当前 Mock 配置的重新请求结果，不携带原请求体和认证信息。"
        showIcon
        type="info"
      />
      <PreviewContent preview={props.preview} previewing={props.previewing} />
    </Drawer>
  );
}

function PreviewContent(props: { preview: MockResponsePreview | null; previewing: boolean }) {
  if (props.previewing)
    return (
      <div className="traffic-preview-loading">
        <Spin />
        <span>正在重新请求 Mock...</span>
      </div>
    );
  if (!props.preview)
    return (
      <Empty
        className="empty-rules"
        description="暂无响应结果"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  return <PreviewResponseBody preview={props.preview} />;
}

function PreviewResponseBody(props: { preview: MockResponsePreview }) {
  const { preview } = props;
  const body = formatResponseBody(preview.body || "（空响应）");
  let statusClassName = "preview-error";
  if (preview.status >= 200 && preview.status < 300) statusClassName = "preview-success";
  return (
    <div className="traffic-preview">
      <div className="traffic-preview-meta">
        <span className={statusClassName}>
          {preview.status} {preview.statusText}
        </span>
        <span>{preview.duration} ms</span>
        {preview.contentType && <span>{preview.contentType}</span>}
      </div>
      {preview.truncated && (
        <Alert message="响应内容超过 512 KB，当前仅展示前半部分。" type="warning" showIcon />
      )}
      <ResponsePayloadViewer key={body} body={body} />
    </div>
  );
}

function formatTime(value: string) {
  const numeric = Number(value);
  const date = new Date(value);
  if (!Number.isNaN(numeric)) return formatDate(new Date(numeric));
  if (Number.isNaN(date.getTime())) return value;
  return formatDate(date);
}
function formatDate(date: Date) {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function logStreamClass(count: number) {
  if (count > 0) return "log-stream traffic-stream has-logs";
  return "log-stream traffic-stream empty";
}
function destination(log: RequestLog) {
  if (log.destination) return log.destination;
  return `未转发（${log.stage}）`;
}
function ruleName(log: RequestLog) {
  if (log.ruleName) return log.ruleName;
  return "未命中接口";
}
function responseCode(log: RequestLog) {
  if (log.responseCode !== null) return String(log.responseCode);
  return "--";
}
function statusClass(status: RequestLog["status"]) {
  return `log-status log-status-${status}`;
}
function statusLabel(status: RequestLog["status"]) {
  if (status === "matched") return "已 Mock";
  if (status === "failed") return "失败";
  return "透传";
}
function EmptyLogs(props: { count: number }) {
  if (props.count > 0) return null;
  return (
    <Empty
      className="empty-rules"
      description="暂无符合条件的代理请求"
      image={Empty.PRESENTED_IMAGE_SIMPLE}
    />
  );
}
