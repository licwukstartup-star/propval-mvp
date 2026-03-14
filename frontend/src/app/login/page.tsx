"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0a0e1a' }}>
      <div className="w-full max-w-md p-8 rounded-xl" style={{ backgroundColor: '#111827', border: '1px solid #1f2937' }}>
        <h1
          className="text-3xl font-bold text-center mb-8 font-[var(--font-orbitron)]"
          style={{ color: '#00F0FF' }}
        >
          PropVal
        </h1>

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: '#94A3B8' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full px-4 py-2.5 rounded-lg outline-none transition-colors"
              style={{
                backgroundColor: '#0a0e1a',
                border: '1px solid #1f2937',
                color: '#e0e6f0',
              }}
              onFocus={(e) => e.target.style.borderColor = '#4a9eff'}
              onBlur={(e) => e.target.style.borderColor = '#1f2937'}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: '#94A3B8' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full px-4 py-2.5 rounded-lg outline-none transition-colors"
              style={{
                backgroundColor: '#0a0e1a',
                border: '1px solid #1f2937',
                color: '#e0e6f0',
              }}
              onFocus={(e) => e.target.style.borderColor = '#4a9eff'}
              onBlur={(e) => e.target.style.borderColor = '#1f2937'}
            />
          </div>

          {error && (
            <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg font-semibold transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ backgroundColor: '#00F0FF', color: '#0a0e1a' }}
          >
            {loading && <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" /></svg>}
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center mt-6 text-sm" style={{ color: '#94A3B8' }}>
          Don&apos;t have an account?{' '}
          <Link href="/signup" style={{ color: '#00F0FF' }} className="hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
