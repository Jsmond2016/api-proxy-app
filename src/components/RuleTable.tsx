import { CircleDotDashed, ExternalLink, Plus, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import type { ProxyRule } from "../types";

interface RuleTableProps {
  rules: ProxyRule[];
  onToggle: (ruleId: string, enabled: boolean) => void;
}

function getToggleClassName(enabled: boolean) {
  if (enabled) {
    return "rule-switch rule-switch-on";
  }

  return "rule-switch";
}

function getMethodClassName(method: string) {
  return `method-badge method-${method.toLowerCase()}`;
}

export function RuleTable({ rules, onToggle }: RuleTableProps) {
  const [keyword, setKeyword] = useState("");
  const [activeTag, setActiveTag] = useState("全部");
  const tags = useMemo(() => {
    const tagSet = new Set(rules.map((rule) => rule.tag));
    return ["全部", ...tagSet];
  }, [rules]);
  const visibleRules = useMemo(() => {
    return rules.filter((rule) => {
      const keywordMatches = `${rule.name} ${rule.path}`.toLowerCase().includes(keyword.toLowerCase());

      if (!keywordMatches) {
        return false;
      }

      if (activeTag === "全部") {
        return true;
      }

      return rule.tag === activeTag;
    });
  }, [activeTag, keyword, rules]);

  return (
    <section className="rules-section">
      <div className="section-heading">
        <div>
          <div className="section-kicker">APIFOX ROUTES</div>
          <h2>Mock 规则</h2>
        </div>
        <div className="rules-tools">
          <label className="search-field">
            <Search size={16} strokeWidth={1.8} />
            <input onChange={(event) => setKeyword(event.target.value)} placeholder="搜索接口或路径" value={keyword} />
          </label>
          <button className="outline-button" type="button">
            <SlidersHorizontal size={16} strokeWidth={1.8} />
            批量操作
          </button>
          <button className="command-button" type="button">
            <Plus size={16} strokeWidth={2} />
            添加规则
          </button>
        </div>
      </div>

      <div className="rule-tabs" role="tablist" aria-label="接口标签">
        {tags.map((tag) => (
          <button
            className={getTabClassName(tag, activeTag)}
            key={tag}
            onClick={() => setActiveTag(tag)}
            role="tab"
            type="button"
          >
            {tag}
          </button>
        ))}
      </div>

      <div className="rule-table-wrap">
        <table className="rule-table">
          <thead>
            <tr>
              <th>状态</th>
              <th>接口</th>
              <th>请求</th>
              <th>匹配</th>
              <th>Apifox Mock 目标</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {visibleRules.map((rule) => (
              <RuleRow key={rule.id} onToggle={onToggle} rule={rule} />
            ))}
          </tbody>
        </table>
        <EmptyRules visibleRules={visibleRules} />
      </div>
    </section>
  );
}

function getTabClassName(tag: string, activeTag: string) {
  if (tag === activeTag) {
    return "rule-tab rule-tab-active";
  }

  return "rule-tab";
}

function RuleRow({ rule, onToggle }: { rule: ProxyRule; onToggle: (ruleId: string, enabled: boolean) => void }) {
  return (
    <tr>
      <td>
        <button
          aria-label={`切换${rule.name}`}
          className={getToggleClassName(rule.enabled)}
          onClick={() => onToggle(rule.id, !rule.enabled)}
          type="button"
        >
          <span />
        </button>
      </td>
      <td>
        <div className="rule-name-cell">
          <strong>{rule.name}</strong>
          <span>{rule.tag}</span>
        </div>
      </td>
      <td>
        <span className={getMethodClassName(rule.method)}>{rule.method}</span>
        <code>{rule.path}</code>
      </td>
      <td>
        <span className="match-mode">
          <CircleDotDashed size={14} strokeWidth={1.8} />
          {rule.matchMode}
        </span>
      </td>
      <td>
        <div className="target-cell">
          <span>{rule.target}</span>
        </div>
      </td>
      <td>
        <button className="row-action" title="打开接口详情" type="button">
          <ExternalLink size={16} strokeWidth={1.8} />
        </button>
      </td>
    </tr>
  );
}

function EmptyRules({ visibleRules }: { visibleRules: ProxyRule[] }) {
  if (visibleRules.length > 0) {
    return null;
  }

  return <div className="empty-rules">当前筛选条件下没有 Mock 规则。</div>;
}
