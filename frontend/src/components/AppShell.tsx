"use client"

import Sidebar from "./Sidebar"

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex" style={{ height: "calc(100vh - 49px)" }}>
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
        {children}
      </main>
    </div>
  )
}
