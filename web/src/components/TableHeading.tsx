import type { ReactNode } from "react";
import { CalendarDays, Hash, IdCard, Mail, Phone, Type } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { FieldType } from "../lib/types";

export function fieldIcon(type: FieldType): LucideIcon {
  return {
    文本: Type,
    手机号: Phone,
    数值: Hash,
    日期: CalendarDays,
    邮箱: Mail,
    身份证: IdCard,
  }[type];
}

export function TableHeading({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span className="table-heading-label">
      <Icon size={14} strokeWidth={1.7} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}
