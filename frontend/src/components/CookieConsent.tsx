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
    <div className="fixed bottom-0 inset-x-0 z-50 p-4" style={{ backgroundColor: "#111827EE", borderTop: "1px solid #334155" }}>
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <p className="text-xs leading-relaxed" style={{ color: "#E2E8F0" }}>
          This site uses <strong>essential cookies only</strong> for authentication. No tracking, analytics, or third-party cookies are set.
          Your data is stored securely and never shared. By continuing to use PropVal you acknowledge this.
        </p>
        <button
          onClick={accept}
          className="shrink-0 text-xs font-semibold px-4 py-1.5 rounded transition-colors"
          style={{ backgroundColor: "#00F0FF", color: "#0A0E1A" }}
        >
          Got it
        </button>
      </div>
    </div>
  )
}
