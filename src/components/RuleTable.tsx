import {
  App as AntApp,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tooltip,
} from "antd";
import type { TableColumnsType } from "antd";
import { Copy, MoveRight, Plus, Search, Trash2, WandSparkles } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  LocalMockResponse,
  OperationResolution,
  ProjectProfile,
  ProxyRule,
  ResolveOperationInput,
  RuleInput,
} from "../types";
import { RuleActions } from "./RuleActions";
import { RuleDialog } from "./RuleDialog";

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
  onToggleAll: (enabled: boolean) => Promise<void>;
  onToggleGlobal: (enabled: boolean) => Promise<void>;
  onDebugSingle: (ruleId: string) => Promise<void>;
  localResponses: LocalMockResponse[];
}

export function RuleTable(props: RuleTableProps) {
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<ProxyRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [togglingGlobal, setTogglingGlobal] = useState(false);
  const [togglingAllRules, setTogglingAllRules] = useState(false);
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
  const visible = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    if (!query) return props.profile.rules;
    return props.profile.rules.filter((rule) =>
      `${rule.name} ${rule.method} ${rule.path} ${rule.tags.join(" ")}`
        .toLowerCase()
        .includes(query),
    );
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

  async function toggleAllRules(enabled: boolean) {
    if (props.disabled || togglingAllRules) return;
    if (props.profile.rules.length === 0) return;
    setTogglingAllRules(true);
    try {
      await props.onToggleAll(enabled);
    } finally {
      setTogglingAllRules(false);
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

  const columns: TableColumnsType<ProxyRule> = [
    {
      title: (
        <Space size={4}>
          <span>Mock 开关</span>
          <Tooltip title="统一开启或关闭当前 Tab 的全部 Mock 接口">
            <Switch
              aria-label="批量切换当前 Tab 的全部 Mock 接口"
              checked={
                props.profile.rules.length > 0 && props.profile.rules.every((rule) => rule.enabled)
              }
              disabled={props.disabled || togglingAllRules || props.profile.rules.length === 0}
              loading={togglingAllRules}
              onChange={toggleAllRules}
              size="small"
            />
          </Tooltip>
        </Space>
      ),
      dataIndex: "enabled",
      width: 144,
      render: (_, rule) => (
        <Switch
          aria-label={`切换${rule.name}`}
          checked={rule.enabled}
          disabled={props.disabled || togglingAllRules}
          onChange={(enabled) => props.onToggle(rule.id, enabled)}
          size="small"
        />
      ),
    },
    {
      title: "接口信息",
      dataIndex: "name",
      width: 380,
      render: (_, rule) => (
        <div className="rule-info-cell">
          <div className="rule-name-line">
            <Tooltip title="复制接口信息">
              <Button
                aria-label="复制接口信息"
                className="row-action rule-copy-action"
                icon={<Copy size={14} />}
                onClick={() => {
                  void copyRuleInfo(rule, message);
                }}
                type="text"
              />
            </Tooltip>
            <RuleNameLink onOpenUrl={props.onOpenUrl} rule={rule} />
          </div>
          <span className="request-cell">
            <span className={`method-badge method-${rule.method.toLowerCase()}`}>
              {rule.method}
            </span>
            <RulePath rule={rule} />
          </span>
        </div>
      ),
    },
    {
      title: "Mock 目标",
      dataIndex: "target",
      width: 320,
      render: (_, rule) => (
        <div className="target-cell">
          <span title={displayMockTarget(rule, props.localResponses)}>
            {displayMockTarget(rule, props.localResponses)}
          </span>
        </div>
      ),
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 164,
      render: (_, rule) => (
        <RuleActions
          canMove={targetProfiles.length > 0}
          globalMockEnabled={props.profile.globalMockEnabled}
          localResponses={props.localResponses}
          onDebugSingle={props.onDebugSingle}
          onDelete={props.onDelete}
          onEdit={setEditing}
          onMove={() => startMove([rule.id])}
          onOpenUrl={props.onOpenUrl}
          rule={rule}
        />
      ),
    },
  ];

  return (
    <section className="rules-section">
      <div className="section-heading">
        <div className="rules-heading-primary">
          <h2>
            Mock 接口{" "}
            <Tooltip
              title={
                <div className="mock-help-tooltip">
                  <div>• 全局 Mock 或当前接口开关未开启</div>
                  <div>• 真实接口域名或路径前缀不匹配</div>
                  <div>• Apifox Method 定义错误，例如 GET 请求定义为 POST</div>
                  <div>• 接口路径或匹配方式不一致</div>
                  <div>• HTTPS 证书未信任</div>
                </div>
              }
            >
              <span className="help-icon" aria-label="Mock 接口不生效排查提示">
                ?
              </span>
            </Tooltip>
          </h2>
          <Input
            allowClear
            className="search-field"
            placeholder="搜索接口名称、URL 或 Tag"
            prefix={<Search size={16} />}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
        <div className="rules-tools">
          <div className="global-mock-control">
            <span>全局 Mock</span>
            <Switch
              aria-label="全局 Mock 开关"
              checked={props.profile.globalMockEnabled}
              disabled={props.disabled}
              loading={togglingGlobal}
              onChange={toggleGlobal}
            />
          </div>
          <Tooltip title={batchMoveHint}>
            <span>
              <Button
                disabled={targetProfiles.length === 0 || selectedRowKeys.length === 0}
                icon={<MoveRight size={15} />}
                onClick={() => startMove(selectedRowKeys)}
              >
                批量移动
              </Button>
            </span>
          </Tooltip>
          <Button
            disabled={selectedRowKeys.length === 0}
            icon={<WandSparkles size={15} />}
            onClick={() => {
              void copySimulationPrompt(
                props.profile.rules.filter((rule) => selectedRowKeys.includes(rule.id)),
                message,
              );
            }}
          >
            真机模拟
          </Button>
          <Button
            className="command-button"
            icon={<Plus size={16} />}
            onClick={() => setCreating(true)}
            type="primary"
          >
            添加接口
          </Button>
          <Popconfirm
            cancelText="取消"
            description={`将删除已勾选的 ${selectedRowKeys.length} 个 Mock 接口，此操作不可恢复。`}
            disabled={selectedRowKeys.length === 0 || deleting}
            okButtonProps={{ danger: true }}
            okText="确认删除"
            onConfirm={() => {
              void confirmBatchDelete();
            }}
            title="确认批量删除 Mock 接口？"
          >
            <Button
              className="danger-button"
              danger
              disabled={selectedRowKeys.length === 0 || deleting}
              icon={<Trash2 size={16} />}
              loading={deleting}
            >
              批量删除
            </Button>
          </Popconfirm>
        </div>
      </div>
      <div className="rule-table-wrap">
        <Table<ProxyRule>
          columns={columns}
          dataSource={visible}
          locale={{
            emptyText: (
              <Empty
                description="尚无 Mock 接口。先同步 Apifox Tag，或手动添加接口。"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ),
          }}
          pagination={false}
          rowKey="id"
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys.map(String)),
          }}
          scroll={{ x: 1162 }}
          size="small"
        />
      </div>
      <RuleDialog
        key={editing?.id || String(creating)}
        localResponses={props.localResponses}
        profile={props.profile}
        rule={editing}
        visible={creating || Boolean(editing)}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onResolve={props.onResolve}
        onSave={props.onSave}
      />
      <Modal
        cancelButtonProps={{ disabled: moving }}
        cancelText="取消"
        closable={!moving}
        confirmLoading={moving}
        keyboard={!moving}
        maskClosable={!moving}
        okButtonProps={{ disabled: !targetProfileId }}
        okText="确定移动"
        onCancel={() => setMovingRuleIds([])}
        onOk={() => {
          void confirmMove();
        }}
        open={movingRuleIds.length > 0}
        title={moveDialogTitle}
      >
        <Form layout="vertical">
          <Form.Item label="目的 Tab" required>
            <Select
              autoFocus
              options={targetProfiles.map((profile) => ({
                label: `${profile.name}（${profile.rules.length}）`,
                value: profile.id,
              }))}
              placeholder="请选择目的 Tab"
              value={targetProfileId}
              onChange={setTargetProfileId}
            />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}

function RuleNameLink(props: { rule: ProxyRule; onOpenUrl: (url: string) => Promise<void> }) {
  if (!props.rule.apifoxWebUrl) return <strong>{props.rule.name}</strong>;
  return (
    <a
      className="rule-name-link"
      href={props.rule.apifoxWebUrl}
      onClick={(event) => {
        event.preventDefault();
        void props.onOpenUrl(props.rule.apifoxWebUrl);
      }}
      title="在 Apifox Web 打开接口"
    >
      {props.rule.name}
    </a>
  );
}

function RulePath(props: { rule: ProxyRule }) {
  const { message } = AntApp.useApp();

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(props.rule.path);
      void message.success("接口 URL 已复制");
    } catch {
      void message.error("接口 URL 复制失败，请检查剪贴板权限");
    }
  }
  return (
    <button
      aria-label="复制接口 URL"
      className="rule-path-copy"
      onClick={() => {
        void copyPath();
      }}
      type="button"
    >
      <code>{props.rule.path}</code>
    </button>
  );
}

function findLocalResponse(rule: ProxyRule, responses: LocalMockResponse[]) {
  if (!rule.localResponseId) return null;
  return responses.find((response) => response.id === rule.localResponseId) || null;
}
function displayMockTarget(rule: ProxyRule, responses: LocalMockResponse[]) {
  const response = findLocalResponse(rule, responses);
  if (response) return `预设-${response.name}`;
  return rule.target;
}
async function copyRuleInfo(rule: ProxyRule, message: ReturnType<typeof AntApp.useApp>["message"]) {
  const content =
    [`- ${rule.name}`, `- ${rule.method} ${rule.path}`, `- apifox 地址：${rule.apifoxWebUrl}`].join(
      "\n",
    ) + "\n";
  try {
    await navigator.clipboard.writeText(content);
    void message.success("接口信息已复制");
  } catch {
    void message.error("接口信息复制失败，请检查剪贴板权限");
  }
}
async function copySimulationPrompt(
  rules: ProxyRule[],
  message: ReturnType<typeof AntApp.useApp>["message"],
) {
  const lines = rules
    .map((rule) => `- 原始接口：${rule.method} ${rule.path}\n  Mock 接口：${rule.target}`)
    .join("\n");
  const prompt = `请帮我将当前项目中以下接口的请求 URL 替换为对应的 Mock 接口 URL。\n\n${lines}\n\n限制：只替换 URL 请求地址，不修改请求方法、请求参数、请求体、响应处理、业务逻辑和其他接口代码。\n\n完成后，请在每个替换位置增加注释：TODO: 联调接口待删除。\n禁止提交这些 Mock 接口代码，保留修改在本地工作区，等待人工确认后再提交。`;
  try {
    await navigator.clipboard.writeText(prompt);
    message.success("真机模拟提示词已复制到剪贴板");
  } catch {
    message.error("提示词复制失败，请检查剪贴板权限");
  }
}
