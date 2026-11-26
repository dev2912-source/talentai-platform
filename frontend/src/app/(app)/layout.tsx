"use client";

import type { ReactNode } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Sidebar } from "@/components/Sidebar";

/** Shared authenticated application shell with the TalentAI dark sidebar and light canvas. */
export default function AppShellLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <div className="h-screen w-full flex overflow-hidden bg-background text-foreground">
        <Sidebar />
        <main className="flex-1 flex flex-col h-full overflow-hidden bg-background">
          <div className="flex-1 overflow-auto p-6">{children}</div>
        </main>
      </div>
    </AuthGuard>
  );
}
