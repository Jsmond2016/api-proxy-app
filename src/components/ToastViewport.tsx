import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { useEffect } from "react";
import type { ToastMessage } from "../types";

export function ToastViewport(props: { toasts: ToastMessage[]; onDismiss: (id: string) => void }) {
  return <div aria-live="polite" className="toast-viewport">{props.toasts.map((toast) => <ToastItem key={toast.id} onDismiss={props.onDismiss} toast={toast} />)}</div>;
}

function ToastItem(props: { toast: ToastMessage; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => props.onDismiss(props.toast.id), 5000);
    return () => window.clearTimeout(timer);
  }, [props.onDismiss, props.toast.id]);
  return <div className={`toast-message toast-${props.toast.level}`} role="status"><ToastIcon level={props.toast.level} /><div><strong>{props.toast.title}</strong><span>{props.toast.message}</span></div><button className="icon-button" onClick={() => props.onDismiss(props.toast.id)} type="button"><X size={15} /></button></div>;
}

function ToastIcon({ level }: { level: ToastMessage["level"] }) {
  if (level === "success") return <CheckCircle2 size={18} />;
  return <CircleAlert size={18} />;
}
