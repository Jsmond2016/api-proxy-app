import { FolderPlus, Layers3, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ProfileInput, ProjectProfile } from "../types";

interface ProjectSidebarProps {
  profiles: ProjectProfile[];
  activeProfileId: string | null;
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

  return (
    <aside className="project-sidebar">
      <div className="brand-lockup">
        <div className="brand-mark">A</div>
        <div><p className="brand-name">APIFOX PROXY</p><p className="brand-caption">WECHAT DEVTOOLS</p></div>
      </div>
      <div className="sidebar-label-row">
        <span>联调项目</span>
        <button className="icon-button" disabled={props.disabled} onClick={openCreate} title="新建项目" type="button">
          <FolderPlus size={16} />
        </button>
      </div>
      <nav className="project-list" aria-label="联调项目">
        {props.profiles.map((profile) => (
          <button className={profileClass(profile.id, props.activeProfileId)} key={profile.id} onClick={() => props.onSelect(profile.id)} type="button">
            <Layers3 size={17} /><span>{profile.name}</span><small>{profile.rules.length}</small>
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button className="sidebar-utility" disabled={!props.activeProfileId || props.disabled} onClick={openEdit} type="button">
          <Pencil size={16} />编辑当前项目
        </button>
        <button className="sidebar-utility danger-utility" disabled={!props.activeProfileId || props.disabled} onClick={removeCurrent} type="button">
          <Trash2 size={16} />删除当前项目
        </button>
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
    </aside>
  );
}

function DeleteProjectDialog(props: { visible: boolean; busy: boolean; profile: ProjectProfile | null; onCancel: () => void; onConfirm: () => Promise<void> }) {
  if (!props.visible || !props.profile) return null;
  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-modal="true" className="modal-panel confirm-panel" role="dialog">
        <div className="modal-head"><h2>删除项目</h2><button className="icon-button" onClick={props.onCancel} type="button"><X size={17} /></button></div>
        <p>确定删除“{props.profile.name}”及其本地规则吗？该项目配置中的 Access Token 和 Mock Token 也会删除。</p>
        <div className="modal-actions"><button className="outline-button" disabled={props.busy} onClick={props.onCancel} type="button">取消</button><button className="danger-button" disabled={props.busy} onClick={props.onConfirm} type="button">确认删除</button></div>
      </section>
    </div>
  );
}

function profileClass(id: string, activeId: string | null) {
  if (id === activeId) {
    return "project-item project-item-active";
  }
  return "project-item";
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

  async function submit(event: FormEvent) {
    event.preventDefault();
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
    <div className="modal-backdrop" role="presentation">
      <form className="modal-panel" onSubmit={submit}>
        <div className="modal-head"><h2>{profileDialogTitle(props.profile)}</h2><button className="icon-button" onClick={props.onClose} type="button"><X size={17} /></button></div>
        <label>项目名称<input autoFocus required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>源域名（多个用逗号分隔）<input placeholder="api.example.com" required value={hosts} onChange={(event) => setHosts(event.target.value)} /></label>
        <label>路径前缀<input placeholder="/api，可留空" value={pathPrefix} onChange={(event) => setPathPrefix(event.target.value)} /></label>
        <label>本地代理端口<input max="65535" min="1" required type="number" value={port} onChange={(event) => setPort(event.target.value)} /></label>
        <div className="modal-actions"><button className="outline-button" onClick={props.onClose} type="button">取消</button><button className="command-button" disabled={busy} type="submit">保存</button></div>
      </form>
    </div>
  );
}

function profileDialogTitle(profile: ProjectProfile | null) {
  if (profile) {
    return "编辑项目";
  }
  return "创建项目";
}
