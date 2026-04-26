"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Settings,
  BarChart3,
  RefreshCw,
  Upload,
  Menu,
  X,
  Inbox,
  GitBranch,
  Activity,
  Star,
  Archive,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

type BadgeKey = "inbox" | "chosen" | "archive";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Key to look up a badge count in the nav-counts map. */
  badgeKey?: BadgeKey;
  /** CSS color for the badge background + collapsed dot. Defaults to --accent. */
  badgeColor?: string;
  /** CSS color for the badge text. Must pass WCAG AA on the chosen bg.
   *  Defaults to white (fine for the blue --accent, insufficient for gold). */
  badgeTextColor?: string;
};

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inbox", label: "Inbox", icon: Inbox, badgeKey: "inbox" },
  {
    href: "/chosen",
    label: "Chosen",
    icon: Star,
    badgeKey: "chosen",
    badgeColor: "var(--chosen)",
    // White (~1.95:1) fails WCAG AA on gold; --chosen-fg is dark zinc (~12:1).
    badgeTextColor: "var(--chosen-fg)",
  },
  { href: "/archive", label: "Archive", icon: Archive, badgeKey: "archive" },
  { href: "/pipeline", label: "Pipeline", icon: GitBranch },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/crawl-runs", label: "Runs", icon: Activity },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/settings", label: "Settings", icon: Settings },
];

type NavCounts = {
  inbox: number | null;
  chosen: number | null;
  archive: number | null;
};

/**
 * Poll inbox + chosen + archive counts every 30s. Each fetch is
 * independent:
 *   - fulfilled + ok → update that badge
 *   - rejected or !ok → leave previous value untouched (null on first failure,
 *     last-known thereafter)
 *
 * Uses Promise.allSettled so one endpoint failing doesn't block the other.
 * Initial `null` renders no badge at all; once a fetch has succeeded once,
 * the last-known value persists across transient failures.
 */
function useNavCounts(): NavCounts {
  const [inbox, setInbox] = useState<number | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [archive, setArchive] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchCounts() {
      const settled = await Promise.allSettled([
        fetch("/api/contracts?unreviewed=true&limit=1&page=1", {
          signal: AbortSignal.timeout(10_000),
        }),
        fetch(
          "/api/opportunity-families?decision=PROMOTE&limit=1&page=1",
          { signal: AbortSignal.timeout(10_000) },
        ),
        fetch(
          "/api/contracts?archived=true&includeUnreviewed=true&limit=1&page=1",
          { signal: AbortSignal.timeout(10_000) },
        ),
      ]);

      if (settled[0].status === "fulfilled" && settled[0].value.ok) {
        try {
          const json = await settled[0].value.json();
          if (!cancelled) setInbox(json.pagination?.total ?? 0);
        } catch {
          // JSON parse failure → keep last-known inbox value.
        }
      }
      if (settled[1].status === "fulfilled" && settled[1].value.ok) {
        try {
          const json = await settled[1].value.json();
          if (!cancelled) setChosen(json.pagination?.total ?? 0);
        } catch {
          // JSON parse failure → keep last-known chosen value.
        }
      }
      if (settled[2].status === "fulfilled" && settled[2].value.ok) {
        try {
          const json = await settled[2].value.json();
          if (!cancelled) setArchive(json.pagination?.total ?? 0);
        } catch {
          // JSON parse failure → keep last-known archive value.
        }
      }
    }

    fetchCounts();
    const t = setInterval(fetchCounts, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return { inbox, chosen, archive };
}

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const counts = useNavCounts();
  const badgeMap: Record<BadgeKey, number | null> = {
    inbox: counts.inbox,
    chosen: counts.chosen,
    archive: counts.archive,
  };

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--text-secondary)]"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/50"
          onClick={() => setMobileOpen(false)}
        >
          <aside
            className="w-64 h-full bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between h-14 px-4 border-b border-[var(--sidebar-hover)] shrink-0">
              <div className="flex items-center gap-3">
                <RefreshCw className="w-6 h-6 text-[var(--accent)] shrink-0" />
                <span className="font-semibold text-white text-sm">
                  JCL GovCon
                </span>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-1 hover:bg-[var(--sidebar-hover)] rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 py-4 space-y-1">
              {navItems.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/" || pathname.startsWith("/contracts")
                    : pathname.startsWith(item.href);
                const Icon = item.icon;
                const badge = item.badgeKey ? badgeMap[item.badgeKey] : null;
                const badgeBg = item.badgeColor ?? "var(--accent)";
                const badgeText = item.badgeTextColor ?? "#fff";
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center h-10 px-5 text-sm transition-colors",
                      isActive
                        ? "bg-[var(--accent-20)] text-[var(--accent)] border-r-2 border-[var(--accent)]"
                        : "hover:bg-[var(--sidebar-hover)] hover:text-white",
                    )}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    <span className="ml-3 flex-1">{item.label}</span>
                    {badge !== null && badge > 0 && (
                      <span
                        data-testid={
                          item.badgeKey
                            ? `nav-badge-${item.badgeKey}`
                            : undefined
                        }
                        className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: badgeBg, color: badgeText }}
                      >
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
            <div className="border-t border-[var(--sidebar-hover)] py-2">
              <ThemeToggle />
            </div>
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed left-0 top-0 z-40 h-screen w-16 hover:w-48 transition-all duration-200 bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] flex-col overflow-hidden group">
        {/* Logo */}
        <div className="flex items-center h-14 px-4 border-b border-[var(--sidebar-hover)] shrink-0">
          <RefreshCw className="w-6 h-6 text-[var(--accent)] shrink-0" />
          <span className="ml-3 font-semibold text-white text-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            JCL GovCon
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 space-y-1">
          {navItems.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/" || pathname.startsWith("/contracts")
                : pathname.startsWith(item.href);
            const Icon = item.icon;
            const badge = item.badgeKey ? badgeMap[item.badgeKey] : null;
            const showBadge = badge !== null && badge > 0;
            const badgeBg = item.badgeColor ?? "var(--accent)";
            const badgeText = item.badgeTextColor ?? "#fff";
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center h-10 px-5 text-sm transition-colors relative",
                  isActive
                    ? "bg-[var(--accent-20)] text-[var(--accent)] border-r-2 border-[var(--accent)]"
                    : "hover:bg-[var(--sidebar-hover)] hover:text-white",
                )}
              >
                <div className="relative shrink-0">
                  <Icon className="w-5 h-5" />
                  {/* Collapsed-sidebar dot: visible when collapsed, hidden on hover */}
                  {showBadge && (
                    <span
                      className="absolute -top-1 -right-1 w-2 h-2 rounded-full group-hover:hidden"
                      style={{ backgroundColor: badgeBg }}
                    />
                  )}
                </div>
                <span className="ml-3 flex-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  {item.label}
                </span>
                {showBadge && (
                  <span
                    data-testid={
                      item.badgeKey
                        ? `nav-badge-desktop-${item.badgeKey}`
                        : undefined
                    }
                    className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                    style={{ backgroundColor: badgeBg, color: badgeText }}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Theme toggle at bottom */}
        <div className="border-t border-[var(--sidebar-hover)] py-2">
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}
