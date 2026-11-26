"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  CalendarClock,
  Database,
  LayoutDashboard,
  LogOut,
  MessageSquare,
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

/** Dark #1e2333 navigation rail with role-aware links and user card. */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut } = useAuth();

  const isHr = Boolean(profile?.is_hr);
  const navItems = isHr ? HR_NAV_ITEMS : EMPLOYEE_NAV_ITEMS;
  const homeHref = isHr ? "/" : "/chat";
  const initial = (profile?.username?.trim().charAt(0) || "U").toUpperCase();

  async function handleLogout() {
    await signOut();
    router.replace("/login");
  }

  return (
    <aside className="w-64 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border shrink-0 h-full">
      {/* Brand */}
      <div className="p-6">
        <Link href={homeHref} className="flex items-center gap-3">
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
      </div>

      {/* Role-aware navigation */}
      <nav className="flex-1 px-4 space-y-1" aria-label="Sidebar Navigation">
        {profile &&
          navItems.map((item) => {
            const Icon = item.icon;
            const active = isLinkActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
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
              className="px-4 py-2 text-sm text-center border border-white/20 rounded-lg hover:bg-sidebar-accent transition-colors"
            >
              Login
            </Link>
            <Link
              href="/signup"
              className="px-4 py-2 text-sm text-center bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
            >
              Sign Up
            </Link>
          </div>
        )}
      </div>
    </aside>
  );
}
