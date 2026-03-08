"use client"

import { useRouter } from 'next/navigation'
import { useAuth } from './AuthProvider'

function saveBeforeNavigate() {
  window.dispatchEvent(new CustomEvent('propval-before-navigate'));
}

export default function Navbar() {
  const { user, role, isAdmin, signOut } = useAuth()
  const router = useRouter()

  if (!user) return null

  const handleLogoClick = (e: React.MouseEvent) => {
    e.preventDefault();
    saveBeforeNavigate();
    window.dispatchEvent(new CustomEvent('propval-reset-home'));
  };

  const handleAdminClick = (e: React.MouseEvent) => {
    e.preventDefault();
    saveBeforeNavigate();
    router.push('/admin');
  };

  const handleSignOut = () => {
    saveBeforeNavigate();
    // Small delay to let keepalive fetch fire before sign-out clears session
    setTimeout(() => { signOut(); }, 100);
  };

  return (
    <nav
      className="flex items-center justify-between px-6 py-3"
      style={{ backgroundColor: '#111827', borderBottom: '1px solid #1f2937' }}
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
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('open-my-cases'))}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg border transition-colors shadow-[0_0_8px_#00F0FF20]"
          style={{ borderColor: '#00F0FF66', color: '#00F0FF' }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#00F0FF1a'; e.currentTarget.style.borderColor = '#00F0FF99'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = '#00F0FF66'; }}
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
          className="text-sm px-3 py-1 rounded transition-colors hover:opacity-80"
          style={{ border: '1px solid #334155', color: '#94A3B8' }}
        >
          Sign out
        </button>
      </div>
    </nav>
  )
}
