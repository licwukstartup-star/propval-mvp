"use client"

import { useState, useEffect, useCallback } from "react"
import { API_BASE } from "@/lib/constants"
import type { Signatory } from "./report-typing/shared/SignatorySelect"

interface FirmSignatorySettingsProps {
  session: any
  onClose: () => void
  onChanged?: (signatories: Signatory[]) => void
}

const EMPTY_FORM: Omit<Signatory, "id"> = {
  full_name: "", rics_number: "", qualifications: "", role_title: "",
  email: "", phone: "", can_prepare: true, can_countersign: false,
}

export default function FirmSignatorySettings({ session, onClose, onChanged }: FirmSignatorySettingsProps) {
  const [signatories, setSignatories] = useState<Signatory[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null) // null = list view, "new" = add form, uuid = edit form
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<"ok" | "err" | null>(null)

  const token = session?.access_token
  const getHeaders = useCallback(() => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }), [token])

  // Load signatories
  useEffect(() => {
    if (!session?.access_token) return
    setLoading(true)
    fetch(`${API_BASE}/api/firm-signatories`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => r.json())
      .then(data => setSignatories(Array.isArray(data) ? data : []))
      .catch(err => console.error("Failed to load signatories:", err))
      .finally(() => setLoading(false))
  }, [session])

  const startEdit = (sig: Signatory) => {
    setEditingId(sig.id)
    setForm({ full_name: sig.full_name, rics_number: sig.rics_number, qualifications: sig.qualifications, role_title: sig.role_title, email: sig.email, phone: sig.phone, can_prepare: sig.can_prepare, can_countersign: sig.can_countersign })
  }

  const startAdd = () => {
    setEditingId("new")
    setForm({ ...EMPTY_FORM })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm({ ...EMPTY_FORM })
  }

  const handleSave = useCallback(async () => {
    if (!form.full_name.trim()) return
    setSaving(true)
    setFlash(null)
    try {
      const url = editingId === "new" ? `${API_BASE}/api/firm-signatories` : `${API_BASE}/api/firm-signatories/${editingId}`
      const method = editingId === "new" ? "POST" : "PUT"
      const res = await fetch(url, { method, headers: getHeaders(), body: JSON.stringify(form) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const saved = await res.json()

      let next: Signatory[]
      if (editingId === "new") {
        next = [...signatories, saved].sort((a, b) => a.full_name.localeCompare(b.full_name))
      } else {
        next = signatories.map(s => s.id === editingId ? saved : s)
      }
      setSignatories(next)
      onChanged?.(next)
      setFlash("ok")
      setTimeout(() => { setFlash(null); cancelEdit() }, 600)
    } catch {
      setFlash("err")
      setTimeout(() => setFlash(null), 2000)
    } finally {
      setSaving(false)
    }
  }, [editingId, form, signatories, getHeaders, onChanged])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await fetch(`${API_BASE}/api/firm-signatories/${id}`, { method: "DELETE", headers: getHeaders() })
      const next = signatories.filter(s => s.id !== id)
      setSignatories(next)
      onChanged?.(next)
    } catch (err) {
      console.error("Failed to delete signatory:", err)
    }
  }, [signatories, getHeaders, onChanged])

  const updateForm = (key: string, value: string | boolean) => setForm(prev => ({ ...prev, [key]: value }))

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="bg-[var(--color-bg-base)] border border-[var(--color-border)] rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
        style={{ boxShadow: "0 0 40px color-mix(in srgb, var(--color-accent) 13%, transparent), 0 8px 32px rgba(0,0,0,0.6)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3">
            <span className="text-[10px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-semibold"
              style={{ backgroundColor: "color-mix(in srgb, var(--color-accent) 13%, transparent)", color: "var(--color-status-info)" }}>
              Staff Registry
            </span>
            <h2 className="font-orbitron text-[var(--color-accent)] text-sm tracking-[2px] uppercase">Signatory Registry</h2>
          </div>
          <button onClick={onClose}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <svg className="animate-spin h-6 w-6 text-[var(--color-accent)]" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
              </svg>
              <span className="ml-3 text-sm text-[var(--color-text-secondary)]">Loading registry…</span>
            </div>
          ) : editingId !== null ? (
            /* ── Add / Edit Form ── */
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-accent)" }}>
                {editingId === "new" ? "Add Signatory" : "Edit Signatory"}
              </h3>
              {([
                { key: "full_name", label: "Full Name", placeholder: "e.g. John Smith", required: true },
                { key: "rics_number", label: "RICS Number", placeholder: "e.g. 1234567" },
                { key: "qualifications", label: "Qualifications", placeholder: "e.g. BSc (Hons) MRICS" },
                { key: "role_title", label: "Role / Title", placeholder: "e.g. Director" },
                { key: "email", label: "Email", placeholder: "e.g. john@firm.co.uk" },
                { key: "phone", label: "Phone", placeholder: "e.g. 020 7123 4567" },
              ] as const).map(f => (
                <div key={f.key} className="flex items-center gap-2">
                  <span className="text-[10px] font-medium shrink-0 w-28 text-right" style={{ color: "var(--color-text-secondary)" }}>{f.label}</span>
                  <input
                    type="text"
                    value={(form as any)[f.key]}
                    onChange={e => updateForm(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="flex-1 text-xs px-3 py-2 rounded-lg bg-[var(--color-bg-panel)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)]/60 focus:outline-none transition-colors placeholder:text-[var(--color-text-muted)]"
                  />
                </div>
              ))}
              <div className="flex items-center gap-6 pt-1 pl-[7.5rem]">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={form.can_prepare} onChange={e => updateForm("can_prepare", e.target.checked)}
                    className="accent-[var(--color-accent)]" />
                  <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>Can sign as Preparer</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={form.can_countersign} onChange={e => updateForm("can_countersign", e.target.checked)}
                    className="accent-[var(--color-accent)]" />
                  <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>Can Counter-sign</span>
                </label>
              </div>
              <div className="flex items-center gap-2 pt-2 pl-[7.5rem]">
                <button onClick={cancelEdit}
                  className="text-xs px-4 py-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] transition-colors">
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving || !form.full_name.trim()}
                  className="text-xs px-5 py-1.5 rounded-lg font-semibold transition-all disabled:opacity-40"
                  style={{
                    background: flash === "ok" ? "var(--color-status-success)" : flash === "err" ? "var(--color-status-danger)" : "var(--color-accent)",
                    color: "var(--color-bg-base)",
                  }}>
                  {saving ? "Saving…" : flash === "ok" ? "Saved!" : flash === "err" ? "Error" : editingId === "new" ? "Add" : "Update"}
                </button>
              </div>
            </div>
          ) : (
            /* ── List View ── */
            <div className="space-y-2">
              <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-3">
                Manage your firm&apos;s signatories. These staff members appear in the Preparer and Counter-signatory dropdowns when typing reports.
              </p>
              {signatories.length === 0 ? (
                <p className="text-xs text-center py-8" style={{ color: "var(--color-text-muted)" }}>No signatories added yet. Click &quot;Add Signatory&quot; to get started.</p>
              ) : (
                signatories.map(sig => (
                  <div key={sig.id} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>{sig.full_name}</span>
                        {sig.qualifications && <span className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>{sig.qualifications}</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        {sig.role_title && <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>{sig.role_title}</span>}
                        {sig.rics_number && <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>RICS {sig.rics_number}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {sig.can_prepare && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-semibold"
                          style={{ backgroundColor: "color-mix(in srgb, var(--color-accent) 13%, transparent)", color: "var(--color-accent)" }}>
                          Preparer
                        </span>
                      )}
                      {sig.can_countersign && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-semibold"
                          style={{ backgroundColor: "color-mix(in srgb, var(--color-accent-purple) 13%, transparent)", color: "var(--color-accent-purple-text)" }}>
                          Counter-sign
                        </span>
                      )}
                    </div>
                    <button onClick={() => startEdit(sig)}
                      className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors p-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button onClick={() => handleDelete(sig.id)}
                      className="text-[var(--color-text-secondary)] hover:text-[var(--color-status-danger)] transition-colors p-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--color-border)]">
          <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
            {signatories.length} signator{signatories.length === 1 ? "y" : "ies"} registered
          </span>
          <div className="flex items-center gap-3">
            {editingId === null && (
              <button onClick={startAdd}
                className="text-xs px-4 py-2 rounded-lg font-semibold transition-all"
                style={{ backgroundColor: "var(--color-accent)", color: "var(--color-bg-base)" }}>
                + Add Signatory
              </button>
            )}
            <button onClick={onClose}
              className="text-xs px-4 py-2 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] transition-colors">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
