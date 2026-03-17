"use client"

import { useState, useEffect } from "react"

const STORAGE_KEY = "propval_cookie_consent"

export default function CookieConsent() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true)
    }
  }, [])

  function accept() {
    localStorage.setItem(STORAGE_KEY, "accepted")
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 p-4" style={{ backgroundColor: "color-mix(in srgb, var(--color-bg-panel) 93%, transparent)", borderTop: "1px solid var(--color-border)" }}>
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-primary)" }}>
          This site uses <strong>essential cookies only</strong> for authentication. No tracking, analytics, or third-party cookies are set.
          Your data is stored securely and never shared. See our{" "}
          <a href="/privacy" style={{ color: "var(--color-accent)", textDecoration: "underline" }}>Privacy Policy</a>.
          By continuing to use PropVal you acknowledge this.
        </p>
        <button
          onClick={accept}
          className="shrink-0 text-xs font-semibold px-4 py-1.5 rounded transition-colors"
          style={{ backgroundColor: "var(--color-btn-primary-bg)", color: "var(--color-bg-base)" }}
        >
          Got it
        </button>
      </div>
    </div>
  )
}
