import { FolderPlus, Layers3, MoreHorizontal, Settings2 } from "lucide-react";
import type { ProjectProfile } from "../types";

interface ProjectSidebarProps {
  profiles: ProjectProfile[];
  activeProfileId: string;
  onSelect: (profileId: string) => void;
}

function getProfileClassName(profileId: string, activeProfileId: string) {
  if (profileId === activeProfileId) {
    return "project-item project-item-active";
  }

  return "project-item";
}

export function ProjectSidebar({
  profiles,
  activeProfileId,
  onSelect,
}: ProjectSidebarProps) {
  return (
    <aside className="project-sidebar">
      <div className="brand-lockup">
        <div className="brand-mark">A</div>
        <div>
          <p className="brand-name">APIFOX PROXY</p>
          <p className="brand-caption">MINI PROGRAM DESK</p>
        </div>
      </div>

      <div className="sidebar-label-row">
        <span>联调项目</span>
        <button className="icon-button" title="新建联调项目" type="button">
          <FolderPlus size={16} strokeWidth={1.8} />
        </button>
      </div>

      <nav className="project-list" aria-label="联调项目">
        {profiles.map((profile) => (
          <button
            className={getProfileClassName(profile.id, activeProfileId)}
            key={profile.id}
            onClick={() => onSelect(profile.id)}
            type="button"
          >
            <Layers3 size={17} strokeWidth={1.7} />
            <span>{profile.name}</span>
            <small>{profile.rules.length}</small>
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <button className="sidebar-utility" type="button">
          <Settings2 size={17} strokeWidth={1.7} />
          偏好设置
        </button>
        <button className="sidebar-utility" type="button">
          <MoreHorizontal size={17} strokeWidth={1.7} />
          配置备份
        </button>
      </div>
    </aside>
  );
}
