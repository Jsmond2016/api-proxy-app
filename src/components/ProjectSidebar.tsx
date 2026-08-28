import { Button, Form, Input, InputNumber, Modal, Tabs, Tooltip } from "antd";
import { FolderPlus, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProfileInput, ProjectProfile } from "../types";

interface ProjectSidebarProps {
  profiles: ProjectProfile[];
  activeProfileId: string | null;
  appVersion: string;
  disabled: boolean;
  onCreate: (input: ProfileInput) => Promise<void>;
  onDelete: (profileId: string) => Promise<void>;
  onSelect: (profileId: string) => Promise<void>;
  onUpdate: (input: ProfileInput) => Promise<void>;
}

export function ProjectSidebar(props: ProjectSidebarProps) {
  const [editing, setEditing] = useState<ProjectProfile | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function openCreate() {
    setEditing(null);
    setCreating(true);
  }

  function openEdit() {
    const current = props.profiles.find((profile) => profile.id === props.activeProfileId);
    if (current) {
      setEditing(current);
    }
  }

  function removeCurrent() {
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!props.activeProfileId) return;
    setDeleting(true);
    try {
      await props.onDelete(props.activeProfileId);
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  const tabItems = props.profiles.map((profile) => ({ key: profile.id, label: <span className="project-tab-label"><span>{profile.name}</span><small>{profile.rules.length}</small></span> }));
  return (
    <header className="project-sidebar">
      <div className="brand-lockup">
        <div className="brand-mark">A</div>
        <div className="brand-copy">
          <div className="brand-title-row"><p className="brand-name">APIFOX PROXY</p><span className="brand-version">v{props.appVersion}</span></div>
          <p className="brand-caption">WECHAT DEVTOOLS</p>
        </div>
      </div>
      <div className="project-tabs-bar">
        <span className="project-tabs-title">联调项目</span>
        <Tabs activeKey={props.activeProfileId || undefined} items={tabItems} onChange={(id) => { void props.onSelect(id); }} />
        <div className="project-tabs-actions">
          <Tooltip title="新建项目"><Button aria-label="新建项目" className="icon-button" disabled={props.disabled} icon={<FolderPlus size={16} />} onClick={openCreate} type="text" /></Tooltip>
          <Tooltip title="编辑当前项目"><Button aria-label="编辑当前项目" className="icon-button" disabled={!props.activeProfileId || props.disabled} icon={<Pencil size={16} />} onClick={openEdit} type="text" /></Tooltip>
          <Tooltip title="删除当前项目"><Button aria-label="删除当前项目" className="icon-button danger-utility" danger disabled={!props.activeProfileId || props.disabled} icon={<Trash2 size={16} />} onClick={removeCurrent} type="text" /></Tooltip>
        </div>
      </div>
      <ProfileDialog
        key={editing?.id || String(creating)}
        onClose={() => { setCreating(false); setEditing(null); }}
        onCreate={props.onCreate}
        onUpdate={props.onUpdate}
        profile={editing}
        visible={creating || Boolean(editing)}
      />
      <DeleteProjectDialog
        busy={deleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        profile={props.profiles.find((profile) => profile.id === props.activeProfileId) || null}
        visible={deleteOpen}
      />
    </header>
  );
}

function DeleteProjectDialog(props: { visible: boolean; busy: boolean; profile: ProjectProfile | null; onCancel: () => void; onConfirm: () => Promise<void> }) {
  if (!props.visible || !props.profile) return null;
  return (
    <Modal cancelText="取消" confirmLoading={props.busy} okButtonProps={{ danger: true }} okText="确认删除" onCancel={props.onCancel} onOk={props.onConfirm} open title="删除项目">
      <p>确定删除“{props.profile.name}”及其本地 Mock 接口吗？该项目配置中的 Access Token 和 Mock Token 也会删除。</p>
    </Modal>
  );
}

interface ProfileDialogProps {
  visible: boolean;
  profile: ProjectProfile | null;
  onClose: () => void;
  onCreate: (input: ProfileInput) => Promise<void>;
  onUpdate: (input: ProfileInput) => Promise<void>;
}

function ProfileDialog(props: ProfileDialogProps) {
  const [name, setName] = useState("");
  const [hosts, setHosts] = useState("");
  const [pathPrefix, setPathPrefix] = useState("");
  const [port, setPort] = useState("8899");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!props.profile) {
      return;
    }
    setName(props.profile.name);
    setHosts(props.profile.sourceHosts.join(", "));
    setPathPrefix(props.profile.pathPrefix);
    setPort(String(props.profile.port));
  }, [props.profile]);

  if (!props.visible) {
    return null;
  }

  async function submit() {
    const input: ProfileInput = {
      name,
      sourceHosts: hosts.split(",").map((host) => host.trim()).filter(Boolean),
      pathPrefix,
      port: Number(port),
    };
    if (props.profile) {
      input.id = props.profile.id;
    }
    setBusy(true);
    try {
      if (props.profile) {
        await props.onUpdate(input);
      } else {
        await props.onCreate(input);
      }
      props.onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal cancelText="取消" confirmLoading={busy} destroyOnHidden okButtonProps={{ disabled: !name.trim() || !hosts.trim() || Number(port) < 1 || Number(port) > 65535 }} okText="保存" onCancel={props.onClose} onOk={submit} open title={profileDialogTitle(props.profile)}>
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label="项目名称" required><Input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></Form.Item>
        <Form.Item label="源域名（多个用逗号分隔）" required><Input placeholder="api.example.com" value={hosts} onChange={(event) => setHosts(event.target.value)} /></Form.Item>
        <Form.Item label="路径前缀"><Input placeholder="/api，可留空" value={pathPrefix} onChange={(event) => setPathPrefix(event.target.value)} /></Form.Item>
        <Form.Item label="本地代理端口" required><InputNumber max={65535} min={1} value={Number(port)} onChange={(value) => setPort(String(value || ""))} /></Form.Item>
      </Form>
    </Modal>
  );
}

function profileDialogTitle(profile: ProjectProfile | null) {
  if (profile) {
    return "编辑项目";
  }
  return "创建项目";
}
