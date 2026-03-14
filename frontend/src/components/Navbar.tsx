"use client"

import { useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from './AuthProvider'

function saveBeforeNavigate() {
  window.dispatchEvent(new CustomEvent('propval-before-navigate'));
}

export default function Navbar() {
  const { user, role, isAdmin, signOut } = useAuth()
  const router = useRouter()
  const signOutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => { if (signOutTimerRef.current) clearTimeout(signOutTimerRef.current); };
  }, [])

  if (!user) return null

  const handleLogoClick = (e: React.MouseEvent) => {
    e.preventDefault();
    // Fire the reset event (home page listens to this to clear state)
    window.dispatchEvent(new CustomEvent('propval-reset-home'));
    // Always navigate to home — event listener on home page handles the reset if present
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
    // Small delay to let keepalive fetch fire before sign-out clears session
    signOutTimerRef.current = setTimeout(() => { signOut(); }, 100);
  };

  return (
    <nav
      className="flex items-center justify-between px-6 py-3"
      style={{ backgroundColor: '#111827', borderBottom: '1px solid #334155' }}
    >
      <a
        href="/"
        onClick={handleLogoClick}
        className="text-lg font-bold font-[var(--font-orbitron)]"
        style={{ color: '#00F0FF' }}
      >
        PropVal
      </a>

      <div className="flex items-center gap-4">
        <a
          href="/news"
          onClick={handleNewsClick}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#00f0ff33] text-[#94A3B8] transition-colors hover:text-[#00f0ff] hover:border-[#00f0ff66]"
        >
          <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ backgroundColor: '#00f0ff' }} />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ backgroundColor: '#00f0ff' }} />
          </span>
          Market Intelligence
        </a>
        <button
          onClick={() => { router.push('/'); setTimeout(() => window.dispatchEvent(new CustomEvent('open-my-cases')), 100); }}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg border border-[#00F0FF66] text-[#00F0FF] transition-all hover:shadow-[0_0_8px_#00F0FF20] hover:bg-[#00F0FF1a] hover:border-[#00F0FF99]"
        >
          My Cases
        </button>
        {isAdmin && (
          <a
            href="/admin"
            onClick={handleAdminClick}
            className="text-sm px-3 py-1 rounded transition-colors hover:opacity-80"
            style={{ backgroundColor: '#7B2FBE33', color: '#7B2FBE', border: '1px solid #7B2FBE' }}
          >
            Admin
          </a>
        )}

        <span
          className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={
            isAdmin
              ? { backgroundColor: '#FF2D7833', color: '#FF2D78' }
              : { backgroundColor: '#00F0FF22', color: '#00F0FF' }
          }
        >
          {isAdmin ? 'Admin' : 'Surveyor'}
        </span>

        <span className="text-sm" style={{ color: '#94A3B8' }}>
          {user.email}
        </span>

        <button
          onClick={handleSignOut}
          aria-label="Sign out of PropVal"
          className="text-sm px-3 py-1 rounded transition-colors hover:opacity-80"
          style={{ border: '1px solid #334155', color: '#94A3B8' }}
        >
          Sign out
        </button>
      </div>
    </nav>
  )
}
