import { Alert, App as AntApp, Button, Modal, Popconfirm, Spin, Tooltip } from "antd";
import { Copy, MoveRight, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { errorMessage, formatResponseBody } from "../lib/format";
import type { LocalMockResponse, ProxyRule } from "../types";
import { ResponsePayloadViewer } from "./ResponsePayloadViewer";

interface RuleActionsProps {
  rule: ProxyRule;
  canMove: boolean;
  globalMockEnabled: boolean;
  localResponses: LocalMockResponse[];
  onDelete: (ruleId: string) => Promise<void>;
  onEdit: (rule: ProxyRule) => void;
  onDebugSingle: (ruleId: string) => Promise<void>;
  onMove: () => void;
  onOpenUrl: (url: string) => Promise<void>;
}

interface TestResult {
  status: number;
  statusText: string;
  body: string;
  error: string;
}

export function RuleActions(props: RuleActionsProps) {
  const [testing, setTesting] = useState(false);
  const [debugging, setDebugging] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const { message } = AntApp.useApp();

  async function test() {
    if (!props.globalMockEnabled) {
      void message.warning("全局 Mock 已关闭，请先开启后再测试接口");
      return;
    }
    if (!props.rule.enabled) {
      void message.warning("请先打开当前接口的 Mock 开关");
      return;
    }
    const localResponse = findLocalResponse(props.rule, props.localResponses);
    if (!localResponse && !props.rule.target) {
      void message.warning("当前接口未配置 Mock 目标");
      return;
    }
    setTesting(true);
    setResult(null);
    try {
      if (localResponse) {
        await waitForDelay(localResponse.delayMs);
        setResult({
          status: localResponse.status,
          statusText: `HTTP ${localResponse.status}`,
          body: formatResponseBody(localResponse.body),
          error: "",
        });
      } else {
        const response = await fetch(props.rule.target, { method: props.rule.method });
        const body = await response.text();
        setResult({
          status: response.status,
          statusText: response.statusText,
          body: formatResponseBody(body),
          error: "",
        });
      }
    } catch (reason) {
      setResult({ status: 0, statusText: "请求失败", body: "", error: errorMessage(reason) });
    } finally {
      setTesting(false);
    }
  }

  async function debugSingle() {
    setDebugging(true);
    try {
      await props.onDebugSingle(props.rule.id);
    } finally {
      setDebugging(false);
    }
  }

  let moveTitle = "需要先创建其他 Tab";
  if (props.canMove) moveTitle = "移动接口";
  return (
    <div className="row-actions">
      <Tooltip title="测试接口">
        <Button
          aria-label="测试接口"
          className="row-action"
          icon={<Play size={15} />}
          loading={testing}
          onClick={test}
          type="text"
        />
      </Tooltip>
      <Tooltip title="仅调试当前接口">
        <Button
          aria-label="仅调试当前接口"
          className="row-action"
          icon={<span className="debug-single-icon">1</span>}
          loading={debugging}
          onClick={debugSingle}
          type="text"
        />
      </Tooltip>
      <Tooltip title="编辑接口">
        <Button
          aria-label="编辑接口"
          className="row-action"
          icon={<Pencil size={15} />}
          onClick={() => props.onEdit(props.rule)}
          type="text"
        />
      </Tooltip>
      <Tooltip title={moveTitle}>
        <span>
          <Button
            aria-label="移动接口"
            className="row-action"
            disabled={!props.canMove}
            icon={<MoveRight size={15} />}
            onClick={props.onMove}
            type="text"
          />
        </span>
      </Tooltip>
      <Popconfirm
        cancelText="取消"
        description="Apifox 接口可在后续同步相同 Tag 时重新生成。"
        okButtonProps={{ danger: true }}
        okText="确认删除"
        onConfirm={() => props.onDelete(props.rule.id)}
        title={`删除“${props.rule.name}”？`}
      >
        <Tooltip title="删除接口">
          <Button
            aria-label="删除接口"
            className="row-action"
            danger
            icon={<Trash2 size={15} />}
            type="text"
          />
        </Tooltip>
      </Popconfirm>
      <Modal
        footer={
          <div className="test-modal-footer">
            <Button
              icon={<RotateCcw size={15} />}
              loading={testing}
              onClick={() => {
                void test();
              }}
            >
              重试
            </Button>
            <Button
              disabled={!props.rule.apifoxWebUrl}
              onClick={() => {
                if (props.rule.apifoxWebUrl) {
                  void props.onOpenUrl(props.rule.apifoxWebUrl);
                  return;
                }
                void message.warning("当前接口没有可用的 Apifox 设置页面链接");
              }}
              type="primary"
            >
              去 Mock 接口
            </Button>
          </div>
        }
        onCancel={() => setResult(null)}
        open={Boolean(result) || testing}
        title={`测试接口 · ${props.rule.name}`}
        width={700}
      >
        <TestContent result={result} rule={props.rule} testing={testing} />
      </Modal>
    </div>
  );
}

function TestContent(props: { testing: boolean; result: TestResult | null; rule: ProxyRule }) {
  if (props.testing)
    return (
      <div className="test-loading">
        <Spin size="large" />
        <span>正在发送请求...</span>
        <code>{props.rule.target}</code>
      </div>
    );
  if (!props.result) return null;

  let message = props.result.statusText;
  let type: "success" | "error" = "error";
  if (props.result.status) message = `${props.result.status} ${props.result.statusText}`;
  if (props.result.status >= 200 && props.result.status < 300) type = "success";
  return (
    <div className="test-result">
      <Alert message={message} type={type} showIcon />
      <div>
        <strong>原始接口</strong>
        <span className="original-url">
          <code>
            {props.rule.method} {props.rule.path}
          </code>
          <Tooltip title="复制原始接口">
            <Button
              aria-label="复制原始接口"
              icon={<Copy size={14} />}
              onClick={() => {
                void copyOriginalUrl(props.rule);
              }}
              size="small"
              type="text"
            />
          </Tooltip>
        </span>
      </div>
      <div>
        <strong>Mock 地址</strong>
        <code>{props.rule.target}</code>
      </div>
      <TestPayload result={props.result} />
    </div>
  );
}

function TestPayload({ result }: { result: TestResult }) {
  if (result.error)
    return (
      <div>
        <strong>错误信息</strong>
        <pre>{result.error}</pre>
      </div>
    );
  const body = result.body || "（空响应）";
  return <ResponsePayloadViewer key={body} body={body} />;
}

function findLocalResponse(rule: ProxyRule, responses: LocalMockResponse[]) {
  if (!rule.localResponseId) return null;
  return responses.find((response) => response.id === rule.localResponseId) || null;
}

async function waitForDelay(delay: number) {
  if (delay <= 0) return;
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, delay);
  });
}

async function copyOriginalUrl(rule: ProxyRule) {
  try {
    await navigator.clipboard.writeText(`${rule.method} ${rule.path}`);
  } catch {
    return;
  }
}
