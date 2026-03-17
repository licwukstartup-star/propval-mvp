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

interface AiSummary {
  today_calls: number
  week_calls: number
  month_calls: number
  all_time_calls: number
  total_input_tokens: number
  total_output_tokens: number
  total_tokens: number
  avg_latency_ms: number
  success_count: number
  fail_count: number
  success_rate: number
}

interface AiUserBreakdown {
  user_email: string
  total_calls: number
  total_tokens: number
  last_used: string
  avg_latency_ms: number
  success: number
  fail: number
}

interface AiDailyData {
  date: string
  calls: number
  tokens: number
  success: number
  fail: number
}

interface AiRecentCall {
  timestamp: string
  user_email: string
  endpoint: string
  model: string
  address: string | null
  postcode: string | null
  input_tokens: number
  output_tokens: number
  latency_ms: number
  success: boolean
  error_message: string | null
}

interface AiUsageData {
  summary: AiSummary
  per_user: AiUserBreakdown[]
  daily_chart: AiDailyData[]
  recent_calls: AiRecentCall[]
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

export default function AdminPage() {
  const { isAdmin, session } = useAuth()
  const router = useRouter()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [aiUsage, setAiUsage] = useState<AiUsageData | null>(null)
  const [aiLoading, setAiLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'users' | 'ai'>('ai')

  useEffect(() => {
    if (!isAdmin) {
      router.push('/')
      return
    }

    const headers = { Authorization: `Bearer ${session?.access_token}` }

    fetch(`${API_BASE}/api/admin/users`, { headers })
      .then(r => r.ok ? r.json() : Promise.reject('Failed'))
      .then(d => setUsers(d.users))
      .catch(e => setError(typeof e === 'string' ? e : 'Failed to load users'))
      .finally(() => setLoading(false))

    fetch(`${API_BASE}/api/admin/ai-usage`, { headers })
      .then(r => r.ok ? r.json() : Promise.reject('Failed'))
      .then(d => setAiUsage(d))
      .catch(() => {})
      .finally(() => setAiLoading(false))
  }, [isAdmin, session, router])

  if (!isAdmin) return null

  const maxDayCalls = aiUsage ? Math.max(...aiUsage.daily_chart.map(d => d.calls), 1) : 1

  return (
    <div className="min-h-screen p-6 md:p-8" style={{ backgroundColor: 'var(--color-bg-base)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1
          className="text-2xl font-bold font-[var(--font-orbitron)]"
          style={{ color: 'var(--color-accent)' }}
        >
          Admin Panel
        </h1>
        <button
          onClick={() => router.push('/')}
          className="text-xs px-3 py-1.5 rounded-lg"
          style={{ backgroundColor: 'var(--color-bg-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
        >
          Back to App
        </button>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 mb-6 p-1 rounded-lg w-fit" style={{ backgroundColor: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}>
        {(['ai', 'users'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-4 py-2 rounded-md text-xs font-semibold uppercase tracking-wider transition-all"
            style={activeTab === tab ? {
              background: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-purple) 100%)',
              color: 'var(--color-bg-base)',
            } : {
              color: 'var(--color-text-secondary)',
            }}
          >
            {tab === 'ai' ? 'AI Usage' : 'Users'}
          </button>
        ))}
      </div>

      {error && <p className="mb-4 text-sm" style={{ color: 'var(--color-status-danger)' }}>{error}</p>}

      {/* ── AI Usage Tab ─────────────────────────────────────────── */}
      {activeTab === 'ai' && (
        <div className="space-y-6">
          {aiLoading ? (
            <div className="animate-pulse space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[1,2,3,4].map(i => (
                  <div key={i} className="h-24 rounded-xl" style={{ backgroundColor: 'var(--color-bg-panel)' }} />
                ))}
              </div>
              <div className="h-64 rounded-xl" style={{ backgroundColor: 'var(--color-bg-panel)' }} />
            </div>
          ) : aiUsage ? (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SummaryCard label="Total AI Calls" value={formatNumber(aiUsage.summary.all_time_calls)} sub={`${aiUsage.summary.today_calls} today`} color="var(--color-accent)" />
                <SummaryCard label="Total Tokens" value={formatNumber(aiUsage.summary.total_tokens)} sub={`${formatNumber(aiUsage.summary.total_input_tokens)} in / ${formatNumber(aiUsage.summary.total_output_tokens)} out`} color="var(--color-accent-pink)" />
                <SummaryCard label="Avg Latency" value={`${(aiUsage.summary.avg_latency_ms / 1000).toFixed(1)}s`} sub={`${aiUsage.summary.success_rate}% success`} color="var(--color-status-warning)" />
                <SummaryCard label="This Month" value={formatNumber(aiUsage.summary.month_calls)} sub={`${aiUsage.summary.week_calls} this week`} color="var(--color-status-success)" />
              </div>

              {/* Success/Fail strip */}
              {aiUsage.summary.all_time_calls > 0 && (
                <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Success Rate</span>
                    <span className="text-xs" style={{ color: 'var(--color-text-primary)' }}>
                      <span style={{ color: 'var(--color-status-success)' }}>{aiUsage.summary.success_count}</span>
                      {' / '}
                      <span style={{ color: 'var(--color-status-danger)' }}>{aiUsage.summary.fail_count}</span>
                    </span>
                  </div>
                  <div className="w-full h-3 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-surface)' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${aiUsage.summary.success_rate}%`,
                        background: 'linear-gradient(90deg, var(--color-status-success) 0%, var(--color-accent) 100%)',
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Daily Usage Chart */}
              <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--color-accent)' }}>
                  Daily AI Calls — Last 30 Days
                </h3>
                <div className="flex items-end gap-[3px]" style={{ height: 180 }}>
                  {aiUsage.daily_chart.map((d, i) => {
                    const h = d.calls > 0 ? Math.max(8, (d.calls / maxDayCalls) * 160) : 0
                    const failH = d.fail > 0 ? Math.max(2, (d.fail / maxDayCalls) * 160) : 0
                    return (
                      <div key={d.date} className="flex-1 flex flex-col items-center justify-end" style={{ height: '100%' }}>
                        <div className="relative w-full group" style={{ height: h }}>
                          {/* Success portion */}
                          <div
                            className="absolute bottom-0 left-0 right-0 rounded-t-sm transition-all group-hover:opacity-80"
                            style={{
                              height: h - failH,
                              background: 'linear-gradient(180deg, var(--color-accent) 0%, var(--color-accent-purple) 100%)',
                            }}
                          />
                          {/* Fail portion */}
                          {failH > 0 && (
                            <div
                              className="absolute bottom-0 left-0 right-0 rounded-t-sm"
                              style={{ height: failH, backgroundColor: 'var(--color-status-danger)' }}
                            />
                          )}
                          {/* Tooltip */}
                          <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block whitespace-nowrap text-[10px] px-1.5 py-0.5 rounded z-10"
                            style={{ backgroundColor: 'var(--color-bg-base)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)' }}>
                            {d.date.slice(5)}: {d.calls} calls
                          </div>
                        </div>
                        {/* X-axis label every 5th day */}
                        {i % 5 === 0 && (
                          <span className="text-[10px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>{d.date.slice(5)}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
                {/* Legend */}
                <div className="flex gap-4 mt-3">
                  <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--color-btn-primary-bg)' }} /> Success
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--color-status-danger)' }} /> Failed
                  </span>
                </div>
              </div>

              {/* Per-User Breakdown */}
              {aiUsage.per_user.length > 0 && (
                <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                  <div className="px-5 py-3" style={{ backgroundColor: 'var(--color-bg-panel)' }}>
                    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent)' }}>
                      Per-User Breakdown
                    </h3>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: 'linear-gradient(90deg, var(--color-accent) 0%, var(--color-accent-pink) 100%)' }}>
                        <th className="text-left px-4 py-2.5 font-semibold text-xs" style={{ color: 'var(--color-bg-base)' }}>User</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-xs" style={{ color: 'var(--color-bg-base)' }}>Calls</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-xs" style={{ color: 'var(--color-bg-base)' }}>Tokens</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-xs" style={{ color: 'var(--color-bg-base)' }}>Avg Latency</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-xs" style={{ color: 'var(--color-bg-base)' }}>Success</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-xs" style={{ color: 'var(--color-bg-base)' }}>Last Used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aiUsage.per_user.map((u, i) => (
                        <tr key={u.user_email} style={{ backgroundColor: i % 2 === 0 ? 'var(--color-bg-panel)' : 'var(--color-bg-surface)' }}>
                          <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--color-text-primary)' }}>{u.user_email}</td>
                          <td className="px-4 py-2.5 text-xs text-right" style={{ color: 'var(--color-accent)' }}>{u.total_calls}</td>
                          <td className="px-4 py-2.5 text-xs text-right" style={{ color: 'var(--color-accent-pink)' }}>{formatNumber(u.total_tokens)}</td>
                          <td className="px-4 py-2.5 text-xs text-right" style={{ color: 'var(--color-status-warning)' }}>{(u.avg_latency_ms / 1000).toFixed(1)}s</td>
                          <td className="px-4 py-2.5 text-xs text-right">
                            <span style={{ color: 'var(--color-status-success)' }}>{u.success}</span>
                            {u.fail > 0 && <span style={{ color: 'var(--color-status-danger)' }}> / {u.fail}</span>}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-right" style={{ color: 'var(--color-text-secondary)' }}>
                            {u.last_used ? timeAgo(u.last_used) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Recent Calls Log */}
              {aiUsage.recent_calls.length > 0 && (
                <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                  <div className="px-5 py-3" style={{ backgroundColor: 'var(--color-bg-panel)' }}>
                    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent)' }}>
                      Recent AI Calls
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ background: 'linear-gradient(90deg, var(--color-accent) 0%, var(--color-accent-purple) 100%)' }}>
                          <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--color-bg-base)' }}>Time</th>
                          <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--color-bg-base)' }}>User</th>
                          <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--color-bg-base)' }}>Address</th>
                          <th className="text-right px-3 py-2 font-semibold" style={{ color: 'var(--color-bg-base)' }}>In</th>
                          <th className="text-right px-3 py-2 font-semibold" style={{ color: 'var(--color-bg-base)' }}>Out</th>
                          <th className="text-right px-3 py-2 font-semibold" style={{ color: 'var(--color-bg-base)' }}>Latency</th>
                          <th className="text-center px-3 py-2 font-semibold" style={{ color: 'var(--color-bg-base)' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aiUsage.recent_calls.map((c, i) => (
                          <tr key={i} style={{ backgroundColor: i % 2 === 0 ? 'var(--color-bg-panel)' : 'var(--color-bg-surface)' }}>
                            <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                              {c.timestamp ? timeAgo(c.timestamp) : '-'}
                            </td>
                            <td className="px-3 py-2" style={{ color: 'var(--color-text-primary)' }}>
                              {c.user_email.split('@')[0]}
                            </td>
                            <td className="px-3 py-2 max-w-[200px] truncate" style={{ color: 'var(--color-text-primary)' }}>
                              {c.address || c.postcode || '-'}
                            </td>
                            <td className="px-3 py-2 text-right" style={{ color: 'var(--color-text-secondary)' }}>
                              {formatNumber(c.input_tokens)}
                            </td>
                            <td className="px-3 py-2 text-right" style={{ color: 'var(--color-text-secondary)' }}>
                              {formatNumber(c.output_tokens)}
                            </td>
                            <td className="px-3 py-2 text-right" style={{ color: 'var(--color-status-warning)' }}>
                              {(c.latency_ms / 1000).toFixed(1)}s
                            </td>
                            <td className="px-3 py-2 text-center">
                              {c.success ? (
                                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--color-status-success)', boxShadow: '0 0 6px var(--color-status-success)' }} />
                              ) : (
                                <span className="inline-block w-2 h-2 rounded-full" title={c.error_message || 'Failed'} style={{ backgroundColor: 'var(--color-status-danger)', boxShadow: '0 0 6px var(--color-status-danger)' }} />
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12 rounded-xl" style={{ backgroundColor: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}>
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>No AI usage data yet. Run a property search to generate AI narratives.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Users Tab ────────────────────────────────────────────── */}
      {activeTab === 'users' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SummaryCard label="Total Users" value={users.length.toString()} color="var(--color-accent)" />
            <SummaryCard label="Admins" value={users.filter(u => u.role === 'admin').length.toString()} color="var(--color-accent-pink)" />
            <SummaryCard label="Surveyors" value={users.filter(u => u.role !== 'admin').length.toString()} color="var(--color-status-success)" />
          </div>

          {loading ? (
            <p style={{ color: 'var(--color-text-secondary)' }}>Loading users...</p>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'linear-gradient(90deg, var(--color-accent) 0%, var(--color-accent-pink) 100%)' }}>
                    <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--color-bg-base)' }}>Email</th>
                    <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--color-bg-base)' }}>Name</th>
                    <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--color-bg-base)' }}>Role</th>
                    <th className="text-left px-4 py-3 font-semibold" style={{ color: 'var(--color-bg-base)' }}>Signed up</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u, i) => (
                    <tr
                      key={u.id}
                      style={{ backgroundColor: i % 2 === 0 ? 'var(--color-bg-panel)' : 'var(--color-bg-surface)' }}
                    >
                      <td className="px-4 py-3" style={{ color: 'var(--color-text-primary)' }}>{u.email}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-text-primary)' }}>{u.full_name || '-'}</td>
                      <td className="px-4 py-3">
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={
                            u.role === 'admin'
                              ? { backgroundColor: 'color-mix(in srgb, var(--color-accent-pink) 20%, transparent)', color: 'var(--color-accent-pink)' }
                              : { backgroundColor: 'color-mix(in srgb, var(--color-accent) 13%, transparent)', color: 'var(--color-accent)' }
                          }
                        >
                          {u.role === 'admin' ? 'Admin' : 'Surveyor'}
                        </span>
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-text-secondary)' }}>
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--color-bg-panel)', border: '1px solid var(--color-border)' }}>
      <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{sub}</p>}
    </div>
  )
}
