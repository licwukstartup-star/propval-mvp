"use client"

import { useEffect, useState } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { useRouter } from 'next/navigation'

interface AdminUser {
  id: string
  email: string
  full_name: string
  role: string
  created_at: string
}

export default function AdminPage() {
  const { isAdmin, session } = useAuth()
  const router = useRouter()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAdmin) {
      router.push('/')
      return
    }

    const fetchUsers = async () => {
      try {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'
        const res = await fetch(`${backendUrl}/api/admin/users`, {
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
          },
        })

        if (!res.ok) throw new Error('Failed to fetch users')
        const data = await res.json()
        setUsers(data.users)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load users')
      } finally {
        setLoading(false)
      }
    }

    fetchUsers()
  }, [isAdmin, session, router])

  if (!isAdmin) return null

  return (
    <div className="min-h-screen p-8" style={{ backgroundColor: '#0a0e1a' }}>
      <h1
        className="text-2xl font-bold mb-6 font-[var(--font-orbitron)]"
        style={{ color: '#00F0FF' }}
      >
        Admin Panel
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="p-4 rounded-lg" style={{ backgroundColor: '#111827', border: '1px solid #334155' }}>
          <p className="text-sm" style={{ color: '#94A3B8' }}>Total Users</p>
          <p className="text-2xl font-bold" style={{ color: '#00F0FF' }}>{users.length}</p>
        </div>
        <div className="p-4 rounded-lg" style={{ backgroundColor: '#111827', border: '1px solid #334155' }}>
          <p className="text-sm" style={{ color: '#94A3B8' }}>Admins</p>
          <p className="text-2xl font-bold" style={{ color: '#FF2D78' }}>
            {users.filter(u => u.role === 'admin').length}
          </p>
        </div>
        <div className="p-4 rounded-lg" style={{ backgroundColor: '#111827', border: '1px solid #334155' }}>
          <p className="text-sm" style={{ color: '#94A3B8' }}>Surveyors</p>
          <p className="text-2xl font-bold" style={{ color: '#39FF14' }}>
            {users.filter(u => u.role !== 'admin').length}
          </p>
        </div>
      </div>

      {error && <p className="mb-4 text-sm" style={{ color: '#ef4444' }}>{error}</p>}

      {loading ? (
        <p style={{ color: '#94A3B8' }}>Loading users...</p>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #334155' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'linear-gradient(90deg, #00F0FF 0%, #FF2D78 100%)' }}>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: '#0a0e1a' }}>Email</th>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: '#0a0e1a' }}>Name</th>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: '#0a0e1a' }}>Role</th>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: '#0a0e1a' }}>Signed up</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr
                  key={u.id}
                  style={{ backgroundColor: i % 2 === 0 ? '#111827' : '#1E293B' }}
                >
                  <td className="px-4 py-3" style={{ color: '#E2E8F0' }}>{u.email}</td>
                  <td className="px-4 py-3" style={{ color: '#E2E8F0' }}>{u.full_name || '-'}</td>
                  <td className="px-4 py-3">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={
                        u.role === 'admin'
                          ? { backgroundColor: '#FF2D7833', color: '#FF2D78' }
                          : { backgroundColor: '#00F0FF22', color: '#00F0FF' }
                      }
                    >
                      {u.role === 'admin' ? 'Admin' : 'Surveyor'}
                    </span>
                  </td>
                  <td className="px-4 py-3" style={{ color: '#94A3B8' }}>
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
