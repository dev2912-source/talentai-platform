"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  CalendarClock,
  Database,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  matchPrefix?: string[];
}

const HR_NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    matchPrefix: ["/recruitment"],
  },
  {
    label: "Attendance",
    href: "/attendance",
    icon: CalendarClock,
  },
  {
    label: "Knowledge Base",
    href: "/knowledge-base",
    icon: Database,
  },
  {
    label: "Analytics",
    href: "/performance",
    icon: BarChart3,
  },
];

const EMPLOYEE_NAV_ITEMS: NavItem[] = [
  {
    label: "Attendance",
    href: "/attendance",
    icon: CalendarClock,
  },
  {
    label: "AI Assistant",
    href: "/chat",
    icon: MessageSquare,
  },
];

function isLinkActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") {
    if (pathname === "/") return true;
    return (
      item.matchPrefix?.some((prefix) => pathname.startsWith(prefix)) ?? false
    );
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Dark #1e2333 navigation rail (desktop) + responsive slide-over drawer (mobile). */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isHr = Boolean(profile?.is_hr);
  const navItems = isHr ? HR_NAV_ITEMS : EMPLOYEE_NAV_ITEMS;
  const homeHref = isHr ? "/" : "/chat";
  const initial = (profile?.username?.trim().charAt(0) || "U").toUpperCase();

  // Close mobile drawer on route change or Escape key
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  async function handleLogout() {
    setMobileOpen(false);
    await signOut();
    router.replace("/login");
  }

  const sidebarContent = (
    <div className="w-64 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border shrink-0 h-full">
      {/* Brand */}
      <div className="p-6 flex items-center justify-between">
        <Link
          href={homeHref}
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-chart-1 flex items-center justify-center shrink-0 shadow-md shadow-accent/25">
            <div
              className="w-6 h-6 bg-white rounded"
              style={{
                clipPath:
                  "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
              }}
            />
          </div>
          <div>
            <h1 className="text-lg tracking-tight font-semibold leading-tight">
              TalentAI
            </h1>
            <p className="text-xs text-sidebar-foreground/60">HR Intelligence</p>
          </div>
        </Link>

        {/* Mobile close button */}
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation menu"
          className="md:hidden p-1.5 rounded-lg text-sidebar-foreground/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Role-aware navigation */}
      <nav
        className="flex-1 px-4 space-y-1 overflow-y-auto"
        aria-label="Sidebar Navigation"
      >
        {profile &&
          navItems.map((item) => {
            const Icon = item.icon;
            const active = isLinkActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={
                  active
                    ? "flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-sidebar-primary/20 font-medium"
                    : "flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }
              >
                <Icon
                  className="w-5 h-5 shrink-0"
                  style={
                    active
                      ? { filter: "drop-shadow(0 0 8px rgba(99,102,241,0.6))" }
                      : undefined
                  }
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
      </nav>

      {/* Bottom user card */}
      <div className="p-4 border-t border-white/10">
        {profile ? (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/5">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-chart-1 to-chart-2 flex items-center justify-center text-sm font-medium text-white shrink-0">
              {initial}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{profile.username}</p>
              <p className="text-xs text-sidebar-foreground/60 truncate">
                {profile.is_hr ? "HR Manager" : "Employee"}
              </p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Logout"
              aria-label="Logout"
              className="p-1.5 rounded-md text-sidebar-foreground/60 hover:text-destructive hover:bg-white/10 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Link
              href="/login"
              onClick={() => setMobileOpen(false)}
              className="px-4 py-2 text-sm text-center bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
            >
              Login
            </Link>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Top Header Bar */}
      <header className="md:hidden h-14 px-4 bg-sidebar text-sidebar-foreground border-b border-sidebar-border flex items-center justify-between shrink-0 z-30">
        <Link href={homeHref} className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-chart-1 flex items-center justify-center shrink-0 shadow-sm shadow-accent/25">
            <div
              className="w-4 h-4 bg-white rounded-sm"
              style={{
                clipPath:
                  "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
              }}
            />
          </div>
          <span className="text-base font-semibold tracking-tight">
            TalentAI
          </span>
        </Link>

        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={mobileOpen}
          className="p-2 rounded-lg text-sidebar-foreground/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          <Menu className="w-5 h-5" />
        </button>
      </header>

      {/* Desktop Fixed Sidebar */}
      <aside className="hidden md:flex h-full shrink-0">
        {sidebarContent}
      </aside>

      {/* Mobile Slide-over Drawer */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Navigation"
        >
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-10 h-full shadow-2xl">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
