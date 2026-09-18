import { App as AntApp, Button, Input, Tooltip } from "antd";
import type { InputRef } from "antd";
import { ChevronDown, ChevronUp, Copy, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

interface ResponsePayloadViewerProps {
  body: string;
}

export function ResponsePayloadViewer(props: ResponsePayloadViewerProps) {
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const searchRef = useRef<InputRef>(null);
  const contentRef = useRef<HTMLPreElement>(null);
  const { message } = AntApp.useApp();
  const matchCount = countMatches(props.body, query);
  const fieldPaths = useMemo(() => findFieldPaths(props.body, query), [props.body, query]);
  let activePath = "";
  if (fieldPaths.length > 0) activePath = fieldPaths[matchIndex % fieldPaths.length];

  useEffect(() => {
    setQuery("");
    setMatchIndex(0);
  }, [props.body]);
  useEffect(() => {
    function focusSearch(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);
  useEffect(() => {
    if (!query.trim() || matchCount === 0) return;
    const activeMatch = contentRef.current?.querySelector("mark.active-match");
    activeMatch?.scrollIntoView({ block: "center" });
  }, [matchCount, matchIndex, query]);

  function updateQuery(value: string) {
    setQuery(value);
    setMatchIndex(0);
  }
  function moveMatch(direction: 1 | -1) {
    if (matchCount === 0) return;
    setMatchIndex((current) => {
      const next = current + direction;
      if (next < 0) return matchCount - 1;
      if (next >= matchCount) return 0;
      return next;
    });
  }
  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (event.shiftKey) {
      moveMatch(-1);
      return;
    }
    moveMatch(1);
  }
  async function copyPath() {
    if (!activePath) return;
    try {
      await navigator.clipboard.writeText(activePath);
      void message.success("字段路径已复制");
    } catch {
      void message.error("字段路径复制失败，请检查剪贴板权限");
    }
  }

  return (
    <div className="response-payload">
      <div className="response-payload-heading">
        <strong>响应内容</strong>
        <div className="response-search-tools">
          <Input
            ref={searchRef}
            allowClear
            onChange={(event) => updateQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索响应内容（Ctrl/Cmd+F）"
            prefix={<Search size={14} />}
            value={query}
          />
          <span className="response-match-count">{matchLabel(matchIndex, matchCount)}</span>
          <Tooltip title="上一个匹配">
            <Button
              aria-label="上一个匹配"
              disabled={matchCount === 0}
              icon={<ChevronUp size={15} />}
              onClick={() => moveMatch(-1)}
              size="small"
            />
          </Tooltip>
          <Tooltip title="下一个匹配">
            <Button
              aria-label="下一个匹配"
              disabled={matchCount === 0}
              icon={<ChevronDown size={15} />}
              onClick={() => moveMatch(1)}
              size="small"
            />
          </Tooltip>
        </div>
      </div>
      <pre ref={contentRef}>{renderSearchableText(props.body, query, matchIndex)}</pre>
      <FieldPath
        activePath={activePath}
        hasQuery={Boolean(query.trim())}
        onCopy={() => {
          void copyPath();
        }}
      />
    </div>
  );
}

function FieldPath(props: { activePath: string; hasQuery: boolean; onCopy: () => void }) {
  if (!props.hasQuery) return null;
  let path = "未找到对应 JSON 字段";
  if (props.activePath) path = props.activePath;
  return (
    <div className="response-field-path">
      <span>字段路径：</span>
      <code>{path}</code>
      <Tooltip title="复制字段路径">
        <Button
          aria-label="复制字段路径"
          disabled={!props.activePath}
          icon={<Copy size={14} />}
          onClick={props.onCopy}
          size="small"
          type="text"
        />
      </Tooltip>
    </div>
  );
}

function findFieldPaths(body: string, query: string) {
  if (!query.trim()) return [];
  try {
    const paths: string[] = [];
    collectFieldPaths(JSON.parse(body), "", query, paths);
    return paths;
  } catch {
    return [];
  }
}

function collectFieldPaths(value: unknown, path: string, query: string, paths: string[]) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectFieldPaths(item, `${path}[${index}]`, query, paths));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      const fieldPath = appendPath(path, key);
      addPathMatches(key, fieldPath, query, paths);
      collectFieldPaths(item, fieldPath, query, paths);
    });
    return;
  }
  addPathMatches(String(value), path, query, paths);
}

function appendPath(path: string, key: string) {
  if (/^[A-Za-z_$][\w$]*$/.test(key)) {
    if (!path) return key;
    return `${path}.${key}`;
  }
  return `${path}[${JSON.stringify(key)}]`;
}

function addPathMatches(value: string, path: string, query: string, paths: string[]) {
  const count = countMatches(value, query);
  for (let index = 0; index < count; index += 1) paths.push(path);
}

function renderSearchableText(body: string, query: string, activeMatchIndex: number) {
  if (!query.trim()) return body;
  const parts = body.split(new RegExp(`(${escapeRegExp(query)})`, "gi"));
  let matchIndex = 0;
  return parts.map((part, index) => {
    if (part.toLowerCase() === query.toLowerCase()) {
      const currentIndex = matchIndex;
      matchIndex += 1;
      return (
        <mark
          className={matchClassName(currentIndex === activeMatchIndex)}
          key={`${part}-${index}-${currentIndex}`}
        >
          {part}
        </mark>
      );
    }
    return part;
  });
}
function matchClassName(active: boolean) {
  if (active) return "active-match";
  return undefined;
}
function matchLabel(index: number, count: number) {
  if (count === 0) return "0 / 0";
  return `${index + 1} / ${count}`;
}
function countMatches(value: string, query: string) {
  if (!query.trim()) return 0;
  return Array.from(value.matchAll(new RegExp(escapeRegExp(query), "gi"))).length;
}
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
