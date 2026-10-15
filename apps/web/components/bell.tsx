"use client";
import Link from "next/link";
import { Icon } from "./ui";
import { useSession } from "@/lib/session";

/** Колокольчик с числом непрочитанных: ведет в раздел уведомлений. */
export function Bell() {
  const { unread } = useSession();
  return (
    <Link href="/notifications" className="bell" aria-label={unread ? `Уведомления, новых: ${unread}` : "Уведомления"}>
      <Icon name="bell" size={22} />
      {unread > 0 && <span className="bell-n">{unread > 9 ? "9+" : unread}</span>}
    </Link>
  );
}
