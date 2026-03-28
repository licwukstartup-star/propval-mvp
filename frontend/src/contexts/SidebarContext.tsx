"use client"

import { createContext, useContext, useState, useCallback, type ReactNode } from "react"
import type { TabKey } from "@/types/property"

interface SidebarContextValue {
  collapsed: boolean
  toggleCollapsed: () => void
  setCollapsed: (v: boolean) => void
  activeTab: TabKey
  setActiveTab: (tab: TabKey) => void
  hasResult: boolean
  setHasResult: (v: boolean) => void
  adoptedCount: number
  setAdoptedCount: (n: number) => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

const STORAGE_KEY = "propval-sidebar-collapsed"

function getInitialCollapsed(): boolean {
  if (typeof window === "undefined") return false
  try {
    return localStorage.getItem(STORAGE_KEY) === "true"
  } catch {
    return false
  }
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedState] = useState(getInitialCollapsed)
  const [activeTab, setActiveTab] = useState<TabKey>("property")
  const [hasResult, setHasResult] = useState(false)
  const [adoptedCount, setAdoptedCount] = useState(0)

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v)
    try { localStorage.setItem(STORAGE_KEY, String(v)) } catch {}
  }, [])

  const toggleCollapsed = useCallback(() => {
    setCollapsedState(prev => {
      const next = !prev
      try { localStorage.setItem(STORAGE_KEY, String(next)) } catch {}
      return next
    })
  }, [])

  return (
    <SidebarContext.Provider value={{ collapsed, toggleCollapsed, setCollapsed, activeTab, setActiveTab, hasResult, setHasResult, adoptedCount, setAdoptedCount }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider")
  return ctx
}
