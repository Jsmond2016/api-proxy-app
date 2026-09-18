import { Button, Empty, Tooltip } from "antd";
import { CheckCircle2, CircleAlert, Clipboard, Terminal, Trash2 } from "lucide-react";
import type { DiagnosticEntry, DesktopSnapshot } from "../types";

interface DiagnosticPanelProps {
  entries: DiagnosticEntry[];
  snapshot: DesktopSnapshot;
  onClear: () => void;
}

export function DiagnosticPanel(props: DiagnosticPanelProps) {
  async function copyDiagnostics() {
    const header = `proxy=${props.snapshot.proxyStatus} certificate=${certificateState(props.snapshot)} profiles=${props.snapshot.profiles.length}`;
    const lines = props.entries.map(
      (entry) => `${entry.createdAt} [${entry.level}] ${entry.action}: ${entry.message}`,
    );
    await navigator.clipboard.writeText([header, ...lines].join("\n"));
  }

  return (
    <section className="diagnostic-panel">
      <div className="section-heading">
        <div>
          <div className="section-kicker">OPERATION CONSOLE</div>
          <h2>运行诊断</h2>
        </div>
        <div className="log-tools">
          <span className="diagnostic-runtime">
            代理 {props.snapshot.proxyStatus} · CA {certificateState(props.snapshot)}
          </span>
          <Tooltip title="复制诊断信息">
            <Button
              aria-label="复制诊断信息"
              className="icon-button"
              icon={<Clipboard size={16} />}
              onClick={copyDiagnostics}
              type="text"
            />
          </Tooltip>
          <Tooltip title="清空诊断">
            <Button
              aria-label="清空诊断"
              className="icon-button"
              icon={<Trash2 size={16} />}
              onClick={props.onClear}
              type="text"
            />
          </Tooltip>
        </div>
      </div>
      <div className="diagnostic-stream">
        <EmptyDiagnostics count={props.entries.length} />
        {props.entries.map((entry) => (
          <DiagnosticRow entry={entry} key={entry.id} />
        ))}
      </div>
    </section>
  );
}

function DiagnosticRow({ entry }: { entry: DiagnosticEntry }) {
  return (
    <div className={`diagnostic-row diagnostic-${entry.level}`}>
      <DiagnosticIcon level={entry.level} />
      <time>{entry.createdAt}</time>
      <strong>{entry.action}</strong>
      <span>{entry.message}</span>
    </div>
  );
}

function DiagnosticIcon({ level }: { level: DiagnosticEntry["level"] }) {
  if (level === "error") return <CircleAlert size={15} />;
  if (level === "success") return <CheckCircle2 size={15} />;
  return <Terminal size={15} />;
}

function certificateState(snapshot: DesktopSnapshot) {
  if (snapshot.certificate.trusted) return "已信任";
  if (snapshot.certificate.generated) return "未信任";
  return "未生成";
}

function EmptyDiagnostics({ count }: { count: number }) {
  if (count > 0) return null;
  return (
    <Empty
      className="empty-rules"
      description="尚无操作记录。连接验证、同步和代理操作会在这里显示完整结果。"
      image={Empty.PRESENTED_IMAGE_SIMPLE}
    />
  );
}
