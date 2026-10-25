"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@repo/ui";

/* Client-side only for active-link detection; counts are resolved on the server */
export function SidebarNav({ sourceCount, documentCount }: { sourceCount: number; documentCount: number }) {
  const pathname = usePathname();
  const items = [
    { href: "/integrations", label: "Sources", count: sourceCount },
    { href: "/documents", label: "Documents", count: documentCount },
    { href: "/chat", label: "Assistant", count: null },
  ];

  return items.map(({ href, label, count }) => (
    <Button
      key={href}
      variant="nav"
      size="nav"
      aria-current={pathname.startsWith(href) ? "page" : undefined}
      nativeButton={false}
      render={<Link href={href} />}
    >
      <span>{label}</span>
      <span className="text-xs font-normal text-muted-foreground">{count}</span>
    </Button>
  ));
}
