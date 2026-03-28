"use client"

import { useRef, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from './AuthProvider'
import { useTheme } from './ThemeProvider'
import NotificationBell from '@/app/components/NotificationBell'
import BasicCalculator from '@/app/components/BasicCalculator'

function saveBeforeNavigate() {
  window.dispatchEvent(new CustomEvent('propval-before-navigate'));
}

export default function Navbar() {
  const { user, session, role, isAdmin, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const router = useRouter()
  const signOutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showCalculator, setShowCalculator] = useState(false)

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

        {/* ── Calculator ────────────────────────────────────────── */}
        <div className="relative">
          <button
            onClick={() => setShowCalculator(prev => !prev)}
            aria-label="Calculator"
            className="flex items-center justify-center w-[28px] h-[28px] rounded-lg transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="2" width="16" height="20" rx="2" />
              <line x1="8" y1="6" x2="16" y2="6" />
              <line x1="8" y1="10" x2="8" y2="10.01" />
              <line x1="12" y1="10" x2="12" y2="10.01" />
              <line x1="16" y1="10" x2="16" y2="10.01" />
              <line x1="8" y1="14" x2="8" y2="14.01" />
              <line x1="12" y1="14" x2="12" y2="14.01" />
              <line x1="16" y1="14" x2="16" y2="14.01" />
              <line x1="8" y1="18" x2="8" y2="18.01" />
              <line x1="12" y1="18" x2="16" y2="18" />
            </svg>
          </button>
          {showCalculator && (
            <div style={{ position: 'fixed', right: 80, top: 50, zIndex: 9999 }}>
              <BasicCalculator onClose={() => setShowCalculator(false)} />
            </div>
          )}
        </div>

        {/* ── Notifications (always visible) ──────────────────── */}
        <NotificationBell session={session} onNavigate={(link) => {
          if (link.startsWith("/qa")) {
            const params = new URLSearchParams(link.split("?")[1] || "")
            const copyId = params.get("copy")
            window.dispatchEvent(new CustomEvent("propval-navigate-qa", { detail: { copyId } }))
          } else {
            router.push(link)
          }
        }} />

        {/* ── User menu (collapsed icon → hover dropdown) ────── */}
        <div className="relative group">
          <button
            aria-label="User menu"
            className="flex items-center justify-center w-[32px] h-[32px] rounded-full border transition-colors"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', background: 'var(--color-bg-surface)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </button>

          {/* Dropdown */}
          <div
            className="absolute right-0 top-full pt-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 z-50"
          >
            <div
              className="rounded-xl border py-2 min-w-[200px] shadow-lg"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-surface)' }}
            >
              {/* Email */}
              <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
                <span className="text-xs font-medium" style={{ color: 'var(--color-text-primary)' }}>{user.email}</span>
                {role && <span className="block text-[10px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{role}</span>}
              </div>

              <div id="navbar-customise-slot" className="flex items-center" />

              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                className="flex items-center gap-3 w-full px-4 py-2 text-xs transition-colors hover:bg-[var(--color-accent)]/5"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {/* Icon hints at the NEXT theme */}
                {theme === 'premium-dark' && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                )}
                {theme === 'dark' && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="13.5" cy="6.5" r="2.5"/>
                    <circle cx="17.5" cy="10.5" r="2.5"/>
                    <circle cx="8.5" cy="7.5" r="2.5"/>
                    <circle cx="6.5" cy="12" r="2.5"/>
                    <path d="M12 22C6.5 22 2 17.5 2 12S6.5 2 12 2s10 4.5 10 10-1.5 4-3 4h-1.3c-.8 0-1.5.7-1.5 1.5 0 .4.2.8.4 1.1.3.3.4.6.4 1 0 .8-.7 1.4-1.5 1.4H12z"/>
                  </svg>
                )}
                {theme === 'premium-light' && (
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
                )}
                {theme === 'light' && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="13.5" cy="6.5" r="2.5"/>
                    <circle cx="17.5" cy="10.5" r="2.5"/>
                    <circle cx="8.5" cy="7.5" r="2.5"/>
                    <circle cx="6.5" cy="12" r="2.5"/>
                    <path d="M12 22C6.5 22 2 17.5 2 12S6.5 2 12 2s10 4.5 10 10-1.5 4-3 4h-1.3c-.8 0-1.5.7-1.5 1.5 0 .4.2.8.4 1.1.3.3.4.6.4 1 0 .8-.7 1.4-1.5 1.4H12z"/>
                  </svg>
                )}
                {theme === 'premium-dark' ? 'Dark mode' : theme === 'dark' ? 'Premium light' : theme === 'premium-light' ? 'Light mode' : 'Premium dark'}
              </button>

              {/* Sign out */}
              <button
                onClick={handleSignOut}
                className="flex items-center gap-3 w-full px-4 py-2 text-xs transition-colors hover:bg-[var(--color-accent)]/5"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  )
}
