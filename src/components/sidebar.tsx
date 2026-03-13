"use client";

import { useState } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

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
              <button onClick={() => setMobileOpen(false)} className="p-1 hover:bg-[var(--sidebar-hover)] rounded">
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
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center h-10 px-5 text-sm transition-colors",
                      isActive
                        ? "bg-[var(--accent)]/20 text-[var(--accent)] border-r-2 border-[var(--accent)]"
                        : "hover:bg-[var(--sidebar-hover)] hover:text-white"
                    )}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    <span className="ml-3">{item.label}</span>
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
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center h-10 px-5 text-sm transition-colors",
                  isActive
                    ? "bg-[var(--accent)]/20 text-[var(--accent)] border-r-2 border-[var(--accent)]"
                    : "hover:bg-[var(--sidebar-hover)] hover:text-white"
                )}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className="ml-3 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  {item.label}
                </span>
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
