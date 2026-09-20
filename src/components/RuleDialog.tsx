import {
  App as AntApp,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Switch,
} from "antd";
import { useState } from "react";
import { errorMessage } from "../lib/format";
import type {
  LocalMockResponse,
  MatchMode,
  OperationResolution,
  ProjectProfile,
  ProxyRule,
  ResolveOperationInput,
  RuleInput,
} from "../types";

interface RuleDialogProps {
  visible: boolean;
  profile: ProjectProfile;
  rule: ProxyRule | null;
  localResponses: LocalMockResponse[];
  onClose: () => void;
  onResolve: (input: ResolveOperationInput) => Promise<OperationResolution>;
  onSave: (input: RuleInput) => Promise<void>;
}

export function RuleDialog(props: RuleDialogProps) {
  const { message } = AntApp.useApp();
  const [name, setName] = useState(props.rule?.name || "");
  const [method, setMethod] = useState(props.rule?.method || "");
  const [path, setPath] = useState(props.rule?.path || "");
  const [matchMode, setMatchMode] = useState<MatchMode | "">(props.rule?.matchMode || "");
  const [target, setTarget] = useState(props.rule?.target || "");
  const [tags, setTags] = useState(props.rule?.tags.join(", ") || "");
  const [priority, setPriority] = useState<number | null>(props.rule?.priority ?? null);
  const [apifoxWebUrl, setApifoxWebUrl] = useState(props.rule?.apifoxWebUrl || "");
  const [localResponseId, setLocalResponseId] = useState<string | null>(
    props.rule?.localResponseId || null,
  );
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState(false);
  const saveDisabled =
    !name.trim() || !path.trim() || (!target.trim() && !localResponseId) || !method || !matchMode;

  async function resolveUrl() {
    if (!path.trim()) return;
    setResolving(true);
    try {
      const result = await props.onResolve({ profileId: props.profile.id, url: path, method });
      if (!result.interface) {
        if (result.matchCount > 1)
          void message.warning(`匹配到 ${result.matchCount} 个接口，请输入更完整的 URL`);
        if (result.matchCount === 0)
          void message.warning("未找到匹配的接口，请检查 URL 或手动填写其他字段");
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
    const input: RuleInput = {
      profileId: props.profile.id,
      name,
      method,
      path: normalizeRulePath(path),
      matchMode,
      target,
      enabled: true,
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      priority: priority ?? 100,
      apifoxWebUrl,
      localResponseId,
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
    <Drawer
      destroyOnHidden
      extra={
        <Space>
          <Button disabled={busy} onClick={props.onClose}>
            取消
          </Button>
          <Button disabled={saveDisabled} loading={busy} onClick={submit} type="primary">
            {saveButtonLabel(props.rule)}
          </Button>
        </Space>
      }
      onClose={props.onClose}
      open={props.visible}
      title={ruleDialogTitle(props.rule)}
      width={600}
    >
      <Form layout="vertical" requiredMark={false}>
        <Form.Item
          extra="输入完整 URL 或接口路径，失焦后将从当前 Apifox 项目自动匹配"
          label="接口 URL"
          required
        >
          <Input
            placeholder="https://api.example.com/api/orders/{id}"
            suffix={resolvingIndicator(resolving)}
            value={path}
            onBlur={resolveUrl}
            onChange={(event) => setPath(event.target.value)}
          />
        </Form.Item>
        <Form.Item label="接口名称" required>
          <Input
            placeholder="请输入接口名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Form.Item>
        <Form.Item label="Mock URL" required>
          <Input
            placeholder="https://mock.example.com/api/orders/{id}"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          />
        </Form.Item>
        <Form.Item label="使用预设响应体">
          <Switch
            checked={Boolean(localResponseId)}
            onChange={(checked) => {
              if (checked) {
                setLocalResponseId(props.localResponses[0]?.id || null);
                return;
              }
              setLocalResponseId(null);
            }}
          />
          <Select
            allowClear
            disabled={!localResponseId}
            onChange={setLocalResponseId}
            options={props.localResponses.map((item) => ({ label: item.name, value: item.id }))}
            placeholder="选择预设响应"
            style={{ marginLeft: 12, minWidth: 220 }}
            value={localResponseId || undefined}
          />
        </Form.Item>
        <div className="form-grid">
          <Form.Item label="请求方式" required>
            <Select
              options={["GET", "POST", "PUT", "PATCH", "DELETE"].map((item) => ({
                label: item,
                value: item,
              }))}
              placeholder="请选择"
              value={method || undefined}
              onChange={setMethod}
            />
          </Form.Item>
          <Form.Item label="匹配方式" required>
            <Select
              options={["exact", "template", "contains", "regex"].map((item) => ({
                label: item,
                value: item,
              }))}
              placeholder="请选择"
              value={matchMode || undefined}
              onChange={setMatchMode}
            />
          </Form.Item>
        </div>
        <div className="form-grid">
          <Form.Item label="Tags（逗号分隔）">
            <Input
              placeholder="选填"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
            />
          </Form.Item>
          <Form.Item label="优先级">
            <InputNumber min={0} placeholder="选填" value={priority} onChange={setPriority} />
          </Form.Item>
        </div>
      </Form>
    </Drawer>
  );
}

function ruleDialogTitle(rule: ProxyRule | null) {
  if (rule) return "编辑 Mock 接口";
  return "添加 Mock 接口";
}

function saveButtonLabel(rule: ProxyRule | null) {
  if (rule) return "更新";
  return "添加";
}

function resolvingIndicator(resolving: boolean) {
  if (resolving) return <Spin size="small" />;
  return null;
}

function normalizeRulePath(value: string) {
  try {
    return new URL(value).pathname;
  } catch {
    const path = value.split(/[?#]/)[0].trim();
    if (path.startsWith("/")) return path;
    return `/${path}`;
  }
}
