import { useState } from "react";
import { Plus, ChevronRight } from "lucide-react";
import { categories, makeRule, ruleCatalog } from "../data/rules";
import type { Field, Rule } from "../lib/types";
import { Dialog, SearchBox, Badge, Empty } from "./UI";
export default function RulePicker({
  fields,
  onAdd,
  onClose,
}: {
  fields: Field[];
  onAdd: (r: Rule) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("全部规则");
  const rules = ruleCatalog.filter(
    (r) =>
      (category === "全部规则" || r.category === category) &&
      (r.name + r.description).includes(search),
  );
  return (
    <Dialog title="添加系统清洗规则" onClose={onClose} wide>
      <div className="picker-toolbar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="搜索规则名称或用途…"
        />
        <select
          aria-label="规则分类"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="picker-rules">
        {rules.map((r) => (
          <button
            className="picker-rule"
            key={r.id}
            onClick={() => onAdd(makeRule(r, fields))}
          >
            <span className="rule-icon">
              <Plus size={18} />
            </span>
            <span>
              <strong>{r.name}</strong>
              <small>{r.description}</small>
            </span>
            <Badge>{r.category}</Badge>
            <ChevronRight size={15} />
          </button>
        ))}
        {!rules.length && (
          <Empty
            title="没有匹配的规则"
            description="调整关键词或分类后重试。"
          />
        )}
      </div>
    </Dialog>
  );
}
