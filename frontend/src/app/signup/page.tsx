"use client"

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role: 'customer',
        },
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setSuccess(true)
      setLoading(false)
    }
  }

  const inputStyle = {
    backgroundColor: '#0a0e1a',
    border: '1px solid #1f2937',
    color: '#e0e6f0',
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0a0e1a' }}>
        <div className="w-full max-w-md p-8 rounded-xl text-center" style={{ backgroundColor: '#111827', border: '1px solid #1f2937' }}>
          <h1 className="text-3xl font-bold mb-4 font-[var(--font-orbitron)]" style={{ color: '#00F0FF' }}>
            PropVal
          </h1>
          <p style={{ color: '#39FF14' }} className="text-lg mb-2">Account created!</p>
          <p style={{ color: '#94A3B8' }} className="text-sm mb-6">
            Check your email to confirm your account.
          </p>
          <Link href="/login" style={{ color: '#00F0FF' }} className="hover:underline text-sm">
            Back to login
          </Link>
        </div>
      </div>
    )
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

        <form onSubmit={handleSignup} className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: '#94A3B8' }}>
              Full name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className="w-full px-4 py-2.5 rounded-lg outline-none transition-colors"
              style={inputStyle}
              onFocus={(e) => e.target.style.borderColor = '#4a9eff'}
              onBlur={(e) => e.target.style.borderColor = '#1f2937'}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: '#94A3B8' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-2.5 rounded-lg outline-none transition-colors"
              style={inputStyle}
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
              minLength={8}
              className="w-full px-4 py-2.5 rounded-lg outline-none transition-colors"
              style={inputStyle}
              onFocus={(e) => e.target.style.borderColor = '#4a9eff'}
              onBlur={(e) => e.target.style.borderColor = '#1f2937'}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: '#94A3B8' }}>
              Confirm password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="w-full px-4 py-2.5 rounded-lg outline-none transition-colors"
              style={inputStyle}
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
            className="w-full py-2.5 rounded-lg font-semibold transition-opacity disabled:opacity-50"
            style={{ backgroundColor: '#00F0FF', color: '#0a0e1a' }}
          >
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className="text-center mt-6 text-sm" style={{ color: '#94A3B8' }}>
          Already have an account?{' '}
          <Link href="/login" style={{ color: '#00F0FF' }} className="hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
