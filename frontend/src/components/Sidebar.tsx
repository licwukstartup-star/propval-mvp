"use client"

import { useSidebar } from "@/contexts/SidebarContext"
import { usePathname, useRouter } from "next/navigation"
import type { TabKey } from "@/types/property"

interface NavItem {
  key: TabKey | "search" | "cases"
  label: string
  icon: React.ReactNode
  action?: "search" | "cases"
}

interface NavSection {
  title?: string
  items: NavItem[]
  requiresResult?: boolean
}

const SECTIONS: NavSection[] = [
  {
    items: [
      {
        key: "search", label: "Search Property", action: "search",
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        ),
      },
      {
        key: "cases", label: "My Cases", action: "cases",
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        ),
      },
    ],
  },
  {
    title: "INTELLIGENCE",
    requiresResult: true,
    items: [
      {
        key: "property", label: "Subject Property",
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        ),
      },
      {
        key: "map", label: "Map",
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
          </svg>
        ),
      },
      {
        key: "hpi", label: "HPI",
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        ),
      },
    ],
  },
  {
    title: "COMPARABLES",
    requiresResult: true,
    items: [
      {
        key: "comparables", label: "Direct",
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" />
          </svg>
        ),
      },
      {
        key: "wider", label: "Wider",
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
          </svg>
        ),
      },
      {
        key: "additional", label: "Additional",
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
          </svg>
        ),
      },
      {
        key: "adopted", label: "Adopted",
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ),
      },
    ],
  },
  {
    title: "REPORTING",
    requiresResult: true,
    items: [
      {
        key: "semv", label: "SEMV",
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a10 10 0 1 0 10 10H12V2z" /><path d="M20.2 20.2A10 10 0 0 0 22 12h-10" />
          </svg>
        ),
      },
      {
        key: "report_typing", label: "Report Typing",
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        ),
      },
      {
        key: "agentic_report", label: "Agentic Report",
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        ),
      },
      {
        key: "qa", label: "QA",
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        ),
      },
    ],
  },
]

export default function Sidebar() {
  const { activeTab, setActiveTab, hasResult, adoptedCount } = useSidebar()
  const pathname = usePathname()
  const router = useRouter()

  const handleClick = (item: NavItem) => {
    if (item.action === "search") {
      if (pathname !== "/") {
        router.push("/")
        setTimeout(() => window.dispatchEvent(new CustomEvent("propval-reset-home")), 100)
      } else {
        window.dispatchEvent(new CustomEvent("propval-reset-home"))
      }
      return
    }
    if (item.action === "cases") {
      if (pathname !== "/") {
        router.push("/")
        setTimeout(() => window.dispatchEvent(new CustomEvent("open-my-cases")), 300)
      } else {
        window.dispatchEvent(new CustomEvent("open-my-cases"))
      }
      return
    }
    setActiveTab(item.key as TabKey)
  }

  return (
    <aside
      className="flex flex-col no-print shrink-0"
      style={{
        width: 240,
        minWidth: 240,
        backgroundColor: "var(--color-bg-panel)",
        borderRight: "1px solid var(--color-border)",
        height: "calc(100vh - 49px)",
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      <nav className="flex flex-col gap-1 py-3 flex-1">
        {SECTIONS.map((section, si) => {
          if (section.requiresResult && !hasResult) return null
          return (
            <div key={si}>
              {section.title && (
                <div
                  className="px-4 pt-4 pb-1 text-[10px] font-semibold tracking-widest select-none"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {section.title}
                </div>
              )}
              {si > 0 && !section.title && (
                <div className="mx-3 my-2 border-t" style={{ borderColor: "var(--color-border)" }} />
              )}
              {section.items.map((item) => {
                const isActive = !item.action && activeTab === item.key
                return (
                  <button
                    key={item.key}
                    onClick={() => handleClick(item)}
                    title={item.label}
                    className="flex items-center gap-3 w-full px-4 py-2 text-sm font-medium transition-colors rounded-md mx-1"
                    style={{
                      width: "calc(100% - 8px)",
                      color: isActive ? "var(--color-accent)" : "var(--color-text-secondary)",
                      backgroundColor: isActive ? "var(--color-accent-dim, rgba(0,240,255,0.07))" : "transparent",
                      borderLeft: isActive ? "3px solid var(--color-accent)" : "3px solid transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.backgroundColor = "var(--color-bg-surface)"
                        e.currentTarget.style.color = "var(--color-text-primary)"
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.backgroundColor = "transparent"
                        e.currentTarget.style.color = "var(--color-text-secondary)"
                      }
                    }}
                  >
                    <span className="shrink-0">{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                    {item.key === "adopted" && adoptedCount > 0 && (
                      <span className="ml-auto inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold" style={{ backgroundColor: "var(--color-status-success)", color: "var(--color-btn-primary-text)" }}>
                        {adoptedCount}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </nav>

    </aside>
  )
}
