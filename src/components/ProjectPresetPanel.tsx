import {
  App as AntApp,
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Tag,
} from "antd";
import { Download, FileInput, SlidersHorizontal } from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import type {
  ProjectPresetCreateInput,
  ProjectPresetExportInput,
  ProjectPresetPreview,
  ProjectProfile,
} from "../types";

interface ProjectPresetPanelProps {
  activeProfile: ProjectProfile | null;
  disabled: boolean;
  onCreate: (input: ProjectPresetCreateInput) => Promise<void>;
  onExport: (input: ProjectPresetExportInput) => Promise<void>;
  onRead: (path: string) => Promise<ProjectPresetPreview>;
}

export function ProjectPresetPanel(props: ProjectPresetPanelProps) {
  const { message } = AntApp.useApp();
  const [panelOpen, setPanelOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [preview, setPreview] = useState<ProjectPresetPreview | null>(null);
  const [pendingExport, setPendingExport] = useState<ProjectPresetExportInput | null>(null);
  const [exportName, setExportName] = useState("");
  const [description, setDescription] = useState("");
  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [hosts, setHosts] = useState("");
  const [pathPrefix, setPathPrefix] = useState("");
  const [port, setPort] = useState(8899);
  const [accessToken, setAccessToken] = useState("");
  const [mockToken, setMockToken] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!props.activeProfile) return;
    setExportName(`${props.activeProfile.name} 预设`);
  }, [props.activeProfile]);

  function openExport() {
    if (!props.activeProfile) return;
    setPanelOpen(false);
    setDescription("");
    setIncludeCredentials(false);
    setExportOpen(true);
  }

  async function choosePreset() {
    try {
      const path = await open({
        directory: false,
        filters: [{ extensions: ["json"], name: "项目预设" }],
        multiple: false,
      });
      if (typeof path !== "string") return;
      const imported = await props.onRead(path);
      applyPreview(imported);
      setPanelOpen(false);
    } catch (reason) {
      void message.error(errorMessage(reason));
    }
  }

  function applyPreview(imported: ProjectPresetPreview) {
    setPreview(imported);
    setProjectName(`${imported.project.suggestedName} 项目`);
    setHosts(imported.project.sourceHosts.join(", "));
    setPathPrefix(imported.project.pathPrefix);
    setPort(imported.project.suggestedPort);
    setAccessToken(imported.credentials.accessToken);
    setMockToken(imported.credentials.mockToken);
  }

  async function requestExport() {
    const profile = props.activeProfile;
    if (!profile || !exportName.trim()) return;
    const path = await save({
      defaultPath: defaultExportName(exportName),
      filters: [{ extensions: ["json"], name: "项目预设" }],
    });
    if (!path) return;
    const input: ProjectPresetExportInput = {
      profileId: profile.id,
      path,
      name: exportName,
      description,
      includeCredentials,
      exportedAt: new Date().toISOString(),
    };
    if (includeCredentials) {
      setPendingExport(input);
      return;
    }
    await finishExport(input);
  }

  async function finishExport(input: ProjectPresetExportInput) {
    setBusy(true);
    try {
      await props.onExport(input);
      setExportOpen(false);
      setPendingExport(null);
    } catch (reason) {
      void message.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function createProject() {
    if (!preview || !projectName.trim() || !hosts.trim()) return;
    const input: ProjectPresetCreateInput = {
      name: projectName,
      sourceHosts: hosts
        .split(",")
        .map((host) => host.trim())
        .filter(Boolean),
      pathPrefix,
      port,
      apifox: preview.project.apifox,
      credentials: {
        included: preview.credentialsIncluded,
        accessToken,
        mockToken,
      },
    };
    setBusy(true);
    try {
      await props.onCreate(input);
      setPreview(null);
    } catch (reason) {
      void message.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        disabled={props.disabled}
        icon={<SlidersHorizontal size={15} />}
        onClick={() => setPanelOpen(true)}
      >
        项目预设
      </Button>
      <Modal
        footer={null}
        onCancel={() => setPanelOpen(false)}
        open={panelOpen}
        title="项目预设"
        width={520}
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Button
            block
            icon={<FileInput size={16} />}
            onClick={() => {
              void choosePreset();
            }}
            size="large"
            type="primary"
          >
            导入预设
          </Button>
          <Button
            block
            disabled={!props.activeProfile}
            icon={<Download size={16} />}
            onClick={openExport}
            size="large"
          >
            导出当前项目为预设
          </Button>
          <Alert
            message="预设只包含项目基础配置和 Apifox 信息，不包含 Mock 接口和本地响应。"
            showIcon
            type="info"
          />
        </Space>
      </Modal>
      <Modal
        confirmLoading={busy}
        okButtonProps={{ disabled: !exportName.trim() }}
        okText="选择保存位置"
        onCancel={() => setExportOpen(false)}
        onOk={() => {
          void requestExport();
        }}
        open={exportOpen}
        title="导出项目预设"
      >
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="预设名称" required>
            <Input
              autoFocus
              value={exportName}
              onChange={(event) => setExportName(event.target.value)}
            />
          </Form.Item>
          <Form.Item label="说明">
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 4 }}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Form.Item>
          <Checkbox
            checked={includeCredentials}
            onChange={(event) => setIncludeCredentials(event.target.checked)}
          >
            包含 Apifox 凭据
          </Checkbox>
          <Alert
            className="preset-credential-alert"
            message="勾选后，Access Token 和 Mock Token 会以明文写入 JSON 文件。仅在可信的设备和传输渠道中使用。"
            showIcon
            type="warning"
          />
        </Form>
      </Modal>
      <Modal
        confirmLoading={busy}
        okButtonProps={{
          disabled: !projectName.trim() || !hosts.trim() || port < 1 || port > 65535,
        }}
        okText="创建项目"
        onCancel={() => setPreview(null)}
        onOk={() => {
          void createProject();
        }}
        open={Boolean(preview)}
        title="从项目预设创建项目"
        width={620}
      >
        {renderImportContent({
          preview,
          projectName,
          hosts,
          pathPrefix,
          port,
          accessToken,
          mockToken,
          setProjectName,
          setHosts,
          setPathPrefix,
          setPort,
          setAccessToken,
          setMockToken,
        })}
      </Modal>
      <Modal
        cancelText="返回修改"
        okButtonProps={{ danger: true }}
        okText="仍然导出"
        onCancel={() => setPendingExport(null)}
        onOk={() => {
          if (pendingExport) void finishExport(pendingExport);
        }}
        open={Boolean(pendingExport)}
        title="确认导出明文凭据"
      >
        <p>该文件将包含可用于访问 Apifox 的明文凭据。请确认文件只会存放和发送给受信任的人员。</p>
      </Modal>
    </>
  );
}

function renderImportContent(props: ImportContentProps) {
  if (!props.preview) return null;
  const preset = props.preview;
  return (
    <Form layout="vertical" requiredMark={false}>
      <Descriptions bordered column={1} size="small">
        <Descriptions.Item label="预设">
          <span>{preset.metadata.name}</span>
          {preset.metadata.description && (
            <span className="preset-description">{preset.metadata.description}</span>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="Apifox 项目 ID">
          {preset.project.apifox.projectId || "未配置"}
        </Descriptions.Item>
        <Descriptions.Item label="建议 Tag">
          {renderTags(preset.project.apifox.selectedTags)}
        </Descriptions.Item>
        <Descriptions.Item label="凭据">
          {renderCredentialStatus(preset.credentialsIncluded)}
        </Descriptions.Item>
      </Descriptions>
      <Divider />
      <Form.Item label="项目名称" required>
        <Input
          autoFocus
          value={props.projectName}
          onChange={(event) => props.setProjectName(event.target.value)}
        />
      </Form.Item>
      <Form.Item label="源域名（多个用逗号分隔）" required>
        <Input value={props.hosts} onChange={(event) => props.setHosts(event.target.value)} />
      </Form.Item>
      <Form.Item label="路径前缀">
        <Input
          value={props.pathPrefix}
          onChange={(event) => props.setPathPrefix(event.target.value)}
        />
      </Form.Item>
      <Form.Item label="本地代理端口" required>
        <InputNumber
          max={65535}
          min={1}
          value={props.port}
          onChange={(value) => props.setPort(value || 0)}
        />
      </Form.Item>
      {renderCredentials(props)}
      <Alert
        message="创建后不会自动连接 Apifox 或开启 Mock。请在项目中验证连接后按 Tag 同步接口，或手动新增接口。"
        showIcon
        type="info"
      />
    </Form>
  );
}

function renderCredentials(props: ImportContentProps) {
  if (!props.preview || !props.preview.credentialsIncluded) return null;
  return (
    <div className="preset-credentials">
      <Form.Item label="Access Token">
        <Input.Password
          value={props.accessToken}
          onChange={(event) => props.setAccessToken(event.target.value)}
        />
      </Form.Item>
      <Form.Item label="Mock Token">
        <Input.Password
          value={props.mockToken}
          onChange={(event) => props.setMockToken(event.target.value)}
        />
      </Form.Item>
    </div>
  );
}

function renderCredentialStatus(included: boolean) {
  if (included) return <Tag color="gold">已包含</Tag>;
  return <Tag>未包含</Tag>;
}

function renderTags(tags: string[]) {
  if (tags.length === 0) return "未设置";
  return (
    <Space size={[4, 4]} wrap>
      {tags.map((tag) => (
        <Tag key={tag}>{tag}</Tag>
      ))}
    </Space>
  );
}

function defaultExportName(name: string) {
  const base = name.trim().replace(/[\\/:*?"<>|]/g, "-");
  return `${base || "项目预设"}.apifox-proxy-preset.json`;
}

function errorMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

interface ImportContentProps {
  preview: ProjectPresetPreview | null;
  projectName: string;
  hosts: string;
  pathPrefix: string;
  port: number;
  accessToken: string;
  mockToken: string;
  setProjectName: (value: string) => void;
  setHosts: (value: string) => void;
  setPathPrefix: (value: string) => void;
  setPort: (value: number) => void;
  setAccessToken: (value: string) => void;
  setMockToken: (value: string) => void;
}
