import { CloudDownload, KeyRound, Link2, Tags } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { OpenApiSyncInput, ProjectProfile } from "../types";

interface ApifoxSyncPanelProps {
  profile: ProjectProfile;
  onSync: (input: OpenApiSyncInput) => Promise<void>;
}

function getSubmitLabel(isSyncing: boolean) {
  if (isSyncing) {
    return "正在同步";
  }

  return "同步接口";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "同步失败，请检查 OpenAPI 地址和网络连接。";
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

export function ApifoxSyncPanel({ profile, onSync }: ApifoxSyncPanelProps) {
  const [mode, setMode] = useState<"local" | "online">(profile.apifox.mode);
  const [sourceUrl, setSourceUrl] = useState(profile.apifox.source);
  const [mockPrefix, setMockPrefix] = useState(profile.apifox.mockPrefix);
  const [tags, setTags] = useState(profile.apifox.selectedTags.join(", "));
  const [accessToken, setAccessToken] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setMode(profile.apifox.mode);
    setSourceUrl(profile.apifox.source);
    setMockPrefix(profile.apifox.mockPrefix);
    setTags(profile.apifox.selectedTags.join(", "));
    setAccessToken("");
    setError("");
  }, [profile]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSyncing(true);

    try {
      const input: OpenApiSyncInput = {
        profileId: profile.id,
        mode,
        sourceUrl: sourceUrl.trim(),
        mockPrefix: mockPrefix.trim(),
        selectedTags: parseTags(tags),
      };
      const token = accessToken.trim();

      if (token) {
        input.accessToken = token;
      }

      await onSync(input);
    } catch (syncError) {
      setError(getErrorMessage(syncError));
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <section className="apifox-sync-panel">
      <div className="apifox-panel-head">
        <div>
          <span>APIFOX SOURCE</span>
          <strong>接口同步</strong>
        </div>
        <div className="sync-mode" role="group" aria-label="Apifox 同步模式">
          <button className={getModeClassName(mode, "local")} onClick={() => setMode("local")} type="button">
            本地导出
          </button>
          <button className={getModeClassName(mode, "online")} onClick={() => setMode("online")} type="button">
            在线导出
          </button>
        </div>
      </div>

      <form className="apifox-form" onSubmit={handleSubmit}>
        <label>
          <span><Link2 size={13} strokeWidth={1.8} /> OpenAPI 地址</span>
          <input onChange={(event) => setSourceUrl(event.target.value)} value={sourceUrl} />
        </label>
        <label>
          <span><CloudDownload size={13} strokeWidth={1.8} /> Mock 前缀</span>
          <input onChange={(event) => setMockPrefix(event.target.value)} value={mockPrefix} />
        </label>
        <label>
          <span><Tags size={13} strokeWidth={1.8} /> Tag 筛选</span>
          <input onChange={(event) => setTags(event.target.value)} placeholder="商品, 订单" value={tags} />
        </label>
        <label>
          <span><KeyRound size={13} strokeWidth={1.8} /> 临时 Token</span>
          <input
            onChange={(event) => setAccessToken(event.target.value)}
            placeholder="仅用于本次在线同步"
            type="password"
            value={accessToken}
          />
        </label>
        <button className="sync-submit" disabled={isSyncing} type="submit">
          <CloudDownload size={15} strokeWidth={1.8} />
          {getSubmitLabel(isSyncing)}
        </button>
      </form>
      <SyncError error={error} />
    </section>
  );
}

function getModeClassName(activeMode: string, buttonMode: string) {
  if (activeMode === buttonMode) {
    return "sync-mode-active";
  }

  return "";
}

function SyncError({ error }: { error: string }) {
  if (!error) {
    return null;
  }

  return <p className="sync-error">{error}</p>;
}
