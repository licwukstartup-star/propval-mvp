"use client"

import { useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from './AuthProvider'
import { useTheme } from './ThemeProvider'
import NotificationBell from '@/app/components/NotificationBell'

function saveBeforeNavigate() {
  window.dispatchEvent(new CustomEvent('propval-before-navigate'));
}

export default function Navbar() {
  const { user, session, role, isAdmin, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const router = useRouter()
  const signOutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => { if (signOutTimerRef.current) clearTimeout(signOutTimerRef.current); };
  }, [])

  if (!user) return null

  const handleLogoClick = (e: React.MouseEvent) => {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('propval-reset-home'));
    router.push('/');
  };

  const handleAdminClick = (e: React.MouseEvent) => {
    e.preventDefault();
    saveBeforeNavigate();
    router.push('/admin');
  };

  const handleNewsClick = (e: React.MouseEvent) => {
    e.preventDefault();
    saveBeforeNavigate();
    router.push('/news');
  };

  const handleSignOut = () => {
    saveBeforeNavigate();
    signOutTimerRef.current = setTimeout(() => { signOut(); }, 100);
  };

  return (
    <nav
      className="flex items-center justify-between px-6 py-3 transition-colors"
      style={{ backgroundColor: 'var(--color-navbar-bg)', borderBottom: '1px solid var(--color-navbar-border)' }}
    >
      <div className="flex items-center gap-3">
        <a
          href="/"
          onClick={handleLogoClick}
          className="text-lg font-bold font-[var(--font-orbitron)]"
          style={{ color: 'var(--color-accent)' }}
        >
          PropVal
        </a>
        {/* Portal slot for case status controls rendered from page.tsx */}
        <div id="navbar-status-slot" className="flex items-center" />
      </div>

      <div className="flex items-center gap-3">
        {/* ── Navigation group ─────────────────────────────────── */}
        <a
          href="/news"
          onClick={handleNewsClick}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-accent)'; e.currentTarget.style.borderColor = 'var(--color-accent-hover)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
        >
          <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ backgroundColor: 'var(--color-accent)' }} />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ backgroundColor: 'var(--color-accent)' }} />
          </span>
          Market Intelligence
        </a>
        <button
          onClick={() => { router.push('/'); setTimeout(() => window.dispatchEvent(new CustomEvent('open-my-cases')), 100); }}
          className="flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-accent)'; e.currentTarget.style.borderColor = 'var(--color-accent-hover)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
        >
          My Cases
        </button>
        {isAdmin && (
          <a
            href="/admin"
            onClick={handleAdminClick}
            className="flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors"
            style={{ borderColor: 'var(--color-accent-purple)', color: 'var(--color-accent-purple-text)' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-accent-purple-dim)'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            Platform Admin
          </a>
        )}

        {/* ── Separator ────────────────────────────────────────── */}
        <span className="w-px h-4" style={{ backgroundColor: 'var(--color-border)' }} />

        {/* ── Notifications ──────────────────────────────────── */}
        <NotificationBell session={session} onNavigate={(link) => {
          // Parse notification deep links (e.g., "/qa?copy=xxx")
          if (link.startsWith("/qa")) {
            const params = new URLSearchParams(link.split("?")[1] || "")
            const copyId = params.get("copy")
            window.dispatchEvent(new CustomEvent("propval-navigate-qa", { detail: { copyId } }))
          } else {
            router.push(link)
          }
        }} />

        {/* ── User info ────────────────────────────────────────── */}
        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {user.email}
        </span>

        {/* ── Separator ────────────────────────────────────────── */}
        <span className="w-px h-4" style={{ backgroundColor: 'var(--color-border)' }} />

        {/* ── Utility group ────────────────────────────────────── */}
        <div id="navbar-customise-slot" className="flex items-center" />
        <button
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          className="flex items-center justify-center w-[30px] h-[30px] rounded-lg border transition-colors"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-text-primary)'; e.currentTarget.style.borderColor = 'var(--color-text-muted)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
        >
          {theme === 'dark' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        <button
          onClick={handleSignOut}
          aria-label="Sign out of PropVal"
          className="flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-text-primary)'; e.currentTarget.style.borderColor = 'var(--color-text-muted)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
        >
          Sign out
        </button>
      </div>
    </nav>
  )
}
