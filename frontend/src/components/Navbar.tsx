"use client"

import Link from 'next/link'
import { useAuth } from './AuthProvider'

export default function Navbar() {
  const { user, role, isAdmin, signOut } = useAuth()

  if (!user) return null

  return (
    <nav
      className="flex items-center justify-between px-6 py-3"
      style={{ backgroundColor: '#111827', borderBottom: '1px solid #1f2937' }}
    >
      <Link
        href="/"
        className="text-lg font-bold font-[var(--font-orbitron)]"
        style={{ color: '#00F0FF' }}
      >
        PropVal
      </Link>

      <div className="flex items-center gap-4">
        {isAdmin && (
          <Link
            href="/admin"
            className="text-sm px-3 py-1 rounded transition-colors hover:opacity-80"
            style={{ backgroundColor: '#7B2FBE33', color: '#7B2FBE', border: '1px solid #7B2FBE' }}
          >
            Admin
          </Link>
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
          onClick={signOut}
          className="text-sm px-3 py-1 rounded transition-colors hover:opacity-80"
          style={{ border: '1px solid #334155', color: '#94A3B8' }}
        >
          Sign out
        </button>
      </div>
    </nav>
  )
}
