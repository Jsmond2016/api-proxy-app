import { Alert, App as AntApp, Button, Modal, Spin } from "antd";
import { useMemoizedFn, useRequest } from "ahooks";
import { AlertCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DiagnosticPanel } from "./components/DiagnosticPanel";
import { AppFooter } from "./components/AppFooter";
import { Workspace } from "./components/Workspace";
import * as desktop from "./lib/desktop";
import { errorMessage } from "./lib/format";
import type { ApifoxRequest, DesktopSnapshot, DiagnosticEntry, RequestLog } from "./types";
import "./App.css";

function App() {
  const { message } = AntApp.useApp();
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  const [appVersion, setAppVersion] = useState(desktop.buildVersion);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [proxyTransition, setProxyTransition] = useState(false);
  const allowCloseRef = useRef(false);
  const closeListenerRef = useRef<(() => void) | null>(null);

  const showError = useMemoizedFn((reason: unknown) => {
    setError(errorMessage(reason));
  });

  const recordDiagnostic = useMemoizedFn(
    (level: DiagnosticEntry["level"], action: string, detail: string) => {
      const entry: DiagnosticEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        createdAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        level,
        action,
        message: detail,
      };
      setDiagnostics((current) => [entry, ...current].slice(0, 100));
    },
  );

  const mergeRequestLog = useMemoizedFn((log: RequestLog) => {
    setSnapshot((current) => {
      if (!current) return current;
      const logs = [log, ...current.logs.filter((item) => item.id !== log.id)].slice(0, 500);
      return { ...current, logs };
    });
  });

  const { loading: initializing, refresh: refreshSnapshot } = useRequest(
    desktop.getDesktopSnapshot,
    {
      onSuccess(nextSnapshot) {
        setSnapshot(nextSnapshot);
        recordDiagnostic("success", "应用启动", "本地配置读取成功");
      },
      onError(reason) {
        showError(reason);
        recordDiagnostic("error", "应用启动", errorMessage(reason));
      },
    },
  );

  const retryLoadSnapshot = useMemoizedFn(() => {
    setError("");
    refreshSnapshot();
  });

  useRequest(desktop.getAppVersion, {
    onSuccess: setAppVersion,
  });

  useEffect(() => {
    let unsubscribe: () => void = () => undefined;
    void desktop
      .subscribeProxyEvents(setSnapshot, mergeRequestLog)
      .then((stop) => {
        unsubscribe = stop;
      })
      .catch((reason) => {
        showError(reason);
        recordDiagnostic("error", "事件订阅", errorMessage(reason));
      });
    return () => unsubscribe();
  }, [mergeRequestLog, recordDiagnostic, showError]);

  useEffect(() => {
    if (!desktop.isDesktopRuntime()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      if (disposed) return;
      const currentWindow = getCurrentWindow();
      unlisten = await currentWindow.onCloseRequested((event) => {
        if (allowCloseRef.current) return;
        event.preventDefault();
        setCloseConfirmOpen(true);
      });
      closeListenerRef.current = unlisten;
    });
    return () => {
      disposed = true;
      closeListenerRef.current?.();
      closeListenerRef.current = null;
    };
  }, []);

  async function confirmClose() {
    allowCloseRef.current = true;
    closeListenerRef.current?.();
    closeListenerRef.current = null;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    try {
      await getCurrentWindow().close();
    } catch (reason) {
      allowCloseRef.current = false;
      showError(reason);
      setCloseConfirmOpen(false);
    }
  }

  const activeProfile = useMemo(() => {
    if (!snapshot || !snapshot.activeProfileId) return null;
    return snapshot.profiles.find((profile) => profile.id === snapshot.activeProfileId) || null;
  }, [snapshot]);

  const notify = useMemoizedFn((level: "success" | "error", title: string, detail: string) => {
    void message.open({ type: level, content: `${title}：${detail}` });
  });

  const apply = useMemoizedFn(
    async (action: Promise<DesktopSnapshot>, label: string, notifySuccess = true) => {
      setError("");
      recordDiagnostic("info", label, "操作已开始");
      try {
        setSnapshot(await action);
        recordDiagnostic("success", label, "操作成功");
        if (notifySuccess) notify("success", label, "操作成功");
      } catch (reason) {
        showError(reason);
        recordDiagnostic("error", label, errorMessage(reason));
        notify("error", label, errorMessage(reason));
        throw reason;
      }
    },
  );

  const applyProxyTransition = useMemoizedFn(
    async (action: Promise<DesktopSnapshot>, label: string, notifySuccess = true) => {
      setProxyTransition(true);
      try {
        await apply(action, label, notifySuccess);
      } finally {
        setProxyTransition(false);
      }
    },
  );

  const validateApifox = useMemoizedFn(async (request: ApifoxRequest) => {
    setError("");
    recordDiagnostic("info", "Apifox 连接/接口解析", "请求已开始");
    try {
      const preview = await desktop.validateApifox(request);
      recordDiagnostic(
        "success",
        "Apifox 连接/接口解析",
        `成功：${preview.selectedOperationCount} 个接口，${preview.availableTags.length} 个 Tag`,
      );
      notify(
        "success",
        "Apifox 连接成功",
        `发现 ${preview.availableTags.length} 个 Tag、${preview.operationCount} 个接口`,
      );
      return preview;
    } catch (reason) {
      showError(reason);
      recordDiagnostic("error", "Apifox 连接/接口解析", errorMessage(reason));
      notify("error", "Apifox 连接失败", errorMessage(reason));
      throw reason;
    }
  });

  const execute = useMemoizedFn(async (action: Promise<unknown>, label: string) => {
    setError("");
    recordDiagnostic("info", label, "操作已开始");
    try {
      await action;
      recordDiagnostic("success", label, "操作成功");
      notify("success", label, "操作成功");
    } catch (reason) {
      showError(reason);
      recordDiagnostic("error", label, errorMessage(reason));
      notify("error", label, errorMessage(reason));
      throw reason;
    }
  });

  if (!snapshot)
    return <InitializationState busy={initializing} error={error} onRetry={retryLoadSnapshot} />;

  return (
    <main className="app-shell">
      <section className="workspace">
        <RuntimeNotice />
        <ErrorBanner error={error} onClose={() => setError("")} />
        <Workspace
          activeProfile={activeProfile}
          snapshot={snapshot}
          apply={apply}
          applyProxyTransition={applyProxyTransition}
          execute={execute}
          appVersion={appVersion}
          proxyTransition={proxyTransition}
          projectNavigation={{
            activeProfileId: snapshot.activeProfileId,
            disabled: snapshot.proxyStatus === "starting" || proxyTransition,
            profiles: snapshot.profiles,
            onCreate: (input) => applyProxyTransition(desktop.createProfile(input), "创建项目"),
            onCreateFromPreset: (input) =>
              applyProxyTransition(desktop.createProfileFromPreset(input), "从预设创建项目"),
            onDelete: (id) => applyProxyTransition(desktop.deleteProfile(id), "删除项目"),
            onExportPreset: (input) => execute(desktop.exportProjectPreset(input), "导出项目预设"),
            onReadPreset: desktop.readProjectPreset,
            onSelect: (id) => applyProxyTransition(desktop.setActiveProfile(id), "切换项目", false),
            onUpdate: (input) => applyProxyTransition(desktop.updateProfile(input), "更新项目"),
          }}
          validateApifox={validateApifox}
        />
        <DiagnosticPanel
          entries={diagnostics}
          onClear={() => setDiagnostics([])}
          snapshot={snapshot}
        />
        <AppFooter version={appVersion} />
      </section>
      <Modal
        cancelText="继续使用"
        okButtonProps={{ danger: true }}
        okText="确认关闭"
        onCancel={() => setCloseConfirmOpen(false)}
        onOk={() => {
          void confirmClose();
        }}
        open={closeConfirmOpen}
        title="关闭 Apifox Proxy？"
      >
        <p>
          关闭前请先将微信开发者工具的代理设置还原，否则关闭本应用后请求可能继续指向已停止的代理。
        </p>
        <p className="close-guide-path">设置 → 代理设置 → 代理 → 手动设置代理</p>
      </Modal>
    </main>
  );
}

function InitializationState(props: { busy: boolean; error: string; onRetry: () => void }) {
  if (props.busy)
    return (
      <main className="app-loading">
        <Spin tip="正在读取本地配置..." size="large">
          <div className="loading-space" />
        </Spin>
      </main>
    );
  return (
    <main className="app-loading">
      <section className="initialization-error">
        <AlertCircle size={28} />
        <h1>应用初始化失败</h1>
        <p>{props.error}</p>
        <Button type="primary" onClick={props.onRetry}>
          重试
        </Button>
      </section>
    </main>
  );
}

function RuntimeNotice() {
  if (desktop.isDesktopRuntime()) return null;
  return (
    <Alert
      className="runtime-notice"
      message="当前为网页预览，网络代理、本地配置和证书功能只在打包后的桌面应用中可用。"
      showIcon
      type="warning"
    />
  );
}

function ErrorBanner({ error, onClose }: { error: string; onClose: () => void }) {
  if (!error) return null;
  return (
    <Alert
      className="error-banner"
      closable
      message={error}
      onClose={onClose}
      showIcon
      type="error"
    />
  );
}

export default App;
