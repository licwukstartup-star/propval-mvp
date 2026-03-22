"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { API_BASE } from "@/lib/constants"

interface Notification {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  is_read: boolean
  created_at: string
}

interface NotificationBellProps {
  session?: { access_token: string } | null
  onNavigate?: (link: string) => void
}

function TypeIcon({ type }: { type: string }) {
  const cls = "w-4 h-4 shrink-0"
  const style = { color: "var(--color-text-secondary)" }
  switch (type) {
    case "review_request":
      return <svg className={cls} style={{ color: "#FF9500" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
    case "review_complete":
    case "approval":
      return <svg className={cls} style={{ color: "#34C759" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    case "revision_needed":
      return <svg className={cls} style={{ color: "#FF3B30" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
    case "edit_by_reviewer":
      return <svg className={cls} style={{ color: "#007AFF" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
    default:
      return <svg className={cls} style={style} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
  }
}

export default function NotificationBell({ session, onNavigate }: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const fetchUnreadCount = useCallback(async () => {
    if (!session?.access_token) return
    try {
      const res = await fetch(`${API_BASE}/api/notifications/unread-count`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setUnreadCount(data.count || 0)
      }
    } catch {}
  }, [session])

  const fetchNotifications = useCallback(async () => {
    if (!session?.access_token) return
    try {
      const res = await fetch(`${API_BASE}/api/notifications`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications || [])
      }
    } catch {}
  }, [session])

  const markRead = useCallback(async (id: string) => {
    if (!session?.access_token) return
    try {
      await fetch(`${API_BASE}/api/notifications/${id}/read`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch {}
  }, [session])

  const markAllRead = useCallback(async () => {
    if (!session?.access_token) return
    try {
      await fetch(`${API_BASE}/api/notifications/read-all`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
      setUnreadCount(0)
    } catch {}
  }, [session])

  // Poll unread count every 15 seconds, paused when tab not visible
  useEffect(() => {
    fetchUnreadCount()
    let interval: ReturnType<typeof setInterval> | null = null
    const start = () => { interval = setInterval(fetchUnreadCount, 15000) }
    const stop = () => { if (interval) { clearInterval(interval); interval = null } }
    const onVisChange = () => { document.hidden ? stop() : start() }
    start()
    document.addEventListener("visibilitychange", onVisChange)
    return () => { stop(); document.removeEventListener("visibilitychange", onVisChange) }
  }, [fetchUnreadCount])

  // Fetch full list when dropdown opens
  useEffect(() => {
    if (open) fetchNotifications()
  }, [open, fetchNotifications])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return "just now"
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h ago`
    const diffDay = Math.floor(diffHr / 24)
    return `${diffDay}d ago`
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(p => !p)}
        className="relative p-1.5 rounded-lg transition-colors hover:bg-[var(--color-bg-hover)]"
        title="Notifications"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--color-text-secondary)" }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white" style={{ backgroundColor: "#FF3B30" }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 rounded-xl border shadow-lg overflow-hidden z-50" style={{ backgroundColor: "var(--color-bg-surface)", borderColor: "var(--color-border)" }}>
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--color-border)" }}>
            <span className="text-xs font-semibold" style={{ color: "var(--color-text-primary)" }}>Notifications</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-[10px] transition-colors" style={{ color: "var(--color-accent)" }}>
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>No notifications</p>
              </div>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  onClick={() => {
                    if (!n.is_read) markRead(n.id)
                    if (n.link && onNavigate) onNavigate(n.link)
                    setOpen(false)
                  }}
                  className="w-full text-left px-3 py-2.5 border-b transition-colors hover:bg-[var(--color-bg-hover)]"
                  style={{
                    borderColor: "var(--color-border)",
                    backgroundColor: n.is_read ? "transparent" : "color-mix(in srgb, var(--color-accent) 5%, transparent)",
                  }}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5"><TypeIcon type={n.type} /></span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-medium truncate" style={{ color: "var(--color-text-primary)" }}>{n.title}</p>
                        {!n.is_read && (
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: "var(--color-accent)" }} />
                        )}
                      </div>
                      {n.body && (
                        <p className="text-[10px] mt-0.5 line-clamp-2" style={{ color: "var(--color-text-secondary)" }}>{n.body}</p>
                      )}
                      <p className="text-[9px] mt-0.5" style={{ color: "var(--color-text-secondary)" }}>{formatTime(n.created_at)}</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
