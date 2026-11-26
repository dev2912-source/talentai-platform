"use client";

import type { ReactNode } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Sidebar } from "@/components/Sidebar";

/** Shared authenticated application shell with responsive navigation and light canvas. */
export default function AppShellLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <div className="h-[100dvh] w-full flex flex-col md:flex-row overflow-hidden bg-background text-foreground">
        <Sidebar />
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden bg-background">
          <div className="flex-1 overflow-y-auto p-3 sm:p-5 md:p-6">
            {children}
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}
