export const metadata = {
  title: "Privacy Policy — PropVal",
};

const S = {
  page: "min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)] px-6 py-16 flex justify-center",
  card: "max-w-3xl w-full",
  h1: "text-2xl font-bold text-[var(--color-accent)] mb-2 tracking-wide",
  updated: "text-xs text-[var(--color-text-secondary)] mb-10",
  h2: "text-lg font-semibold text-[var(--color-accent)] mt-10 mb-3 border-b border-[var(--color-border)] pb-1",
  p: "text-sm leading-relaxed text-[var(--color-text-secondary)] mb-4",
  ul: "list-disc list-inside text-sm text-[var(--color-text-secondary)] mb-4 space-y-1 pl-2",
  a: "text-[var(--color-accent)] underline hover:text-[var(--color-status-info)]",
} as const;

export default function PrivacyPage() {
  return (
    <div className={S.page}>
      <div className={S.card}>
        <h1 className={S.h1}>Privacy Policy</h1>
        <p className={S.updated}>Last updated: 14 March 2026</p>

        <h2 className={S.h2}>1. Who We Are</h2>
        <p className={S.p}>
          PropVal (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) is a property intelligence platform
          for MRICS valuation surveyors. This policy explains how we collect, use, and protect your
          personal data when you use our service at propval.co.uk.
        </p>

        <h2 className={S.h2}>2. Data We Collect</h2>
        <p className={S.p}>We collect the following categories of personal data:</p>
        <ul className={S.ul}>
          <li><strong>Account data:</strong> name, email address, firm name, RICS registration number</li>
          <li><strong>Authentication data:</strong> hashed password, session tokens</li>
          <li><strong>Usage data:</strong> pages visited, features used, timestamps</li>
          <li><strong>Case data:</strong> property addresses, postcodes, UPRNs, valuation notes you enter</li>
        </ul>
        <p className={S.p}>
          We do not collect payment information directly. If we introduce paid plans, payments will be
          processed by a PCI-compliant third-party processor.
        </p>

        <h2 className={S.h2}>3. How We Use Your Data</h2>
        <ul className={S.ul}>
          <li>To provide and improve the PropVal service</li>
          <li>To authenticate your account and enforce access controls</li>
          <li>To generate property intelligence reports on your behalf</li>
          <li>To cache public property data (EPC, Land Registry, flood risk, etc.) for performance</li>
          <li>To communicate service updates and security notices</li>
        </ul>

        <h2 className={S.h2}>4. Legal Basis (UK GDPR)</h2>
        <p className={S.p}>
          We process your data under the following lawful bases: <strong>contract performance</strong> (to
          deliver the service you signed up for), <strong>legitimate interest</strong> (to improve the
          platform and prevent abuse), and <strong>consent</strong> (for optional analytics cookies, which
          you can withdraw at any time).
        </p>

        <h2 className={S.h2}>5. Data Sharing</h2>
        <p className={S.p}>We do not sell your personal data. We share data only with:</p>
        <ul className={S.ul}>
          <li><strong>Supabase</strong> — database and authentication hosting (EU/UK data region)</li>
          <li><strong>Vercel</strong> — frontend hosting and edge delivery</li>
          <li><strong>Render</strong> — backend API hosting</li>
          <li><strong>UK Government APIs</strong> — we send postcodes, UPRNs, and coordinates to public
            data services (EPC, Land Registry, Environment Agency, Ofcom, etc.) to retrieve property data.
            These are public services; no personal data beyond the property identifier is transmitted.</li>
        </ul>

        <h2 className={S.h2}>6. Data Retention</h2>
        <p className={S.p}>
          Account data is retained while your account is active. Case data is retained for 6 years
          after the valuation date to comply with RICS professional indemnity requirements. Cached
          public property data is retained indefinitely as it is non-personal. You may request
          deletion of your account and personal data at any time.
        </p>

        <h2 className={S.h2}>7. Your Rights</h2>
        <p className={S.p}>Under the UK GDPR you have the right to:</p>
        <ul className={S.ul}>
          <li>Access the personal data we hold about you</li>
          <li>Rectify inaccurate data</li>
          <li>Erase your data (subject to legal retention obligations)</li>
          <li>Restrict or object to processing</li>
          <li>Data portability — receive your data in a structured format</li>
          <li>Withdraw consent for optional processing</li>
        </ul>
        <p className={S.p}>
          To exercise any of these rights, contact us at{" "}
          <a href="mailto:privacy@propval.co.uk" className={S.a}>privacy@propval.co.uk</a>.
        </p>

        <h2 className={S.h2}>8. Cookies</h2>
        <p className={S.p}>
          We use strictly necessary cookies for authentication and session management. Optional
          analytics cookies are only set with your consent via the cookie banner. You can change
          your cookie preferences at any time.
        </p>

        <h2 className={S.h2}>9. Security</h2>
        <p className={S.p}>
          We protect your data with encryption in transit (TLS 1.2+), encryption at rest,
          row-level security in our database, and regular security reviews. We follow OWASP
          guidelines and never store plaintext passwords.
        </p>

        <h2 className={S.h2}>10. Changes to This Policy</h2>
        <p className={S.p}>
          We may update this policy from time to time. Material changes will be communicated via
          email or an in-app notice. The &quot;last updated&quot; date at the top reflects the
          most recent revision.
        </p>

        <h2 className={S.h2}>11. Contact</h2>
        <p className={S.p}>
          For privacy enquiries, contact{" "}
          <a href="mailto:privacy@propval.co.uk" className={S.a}>privacy@propval.co.uk</a>.
        </p>
        <p className={S.p}>
          If you are unsatisfied with our response, you have the right to lodge a complaint with
          the{" "}
          <a href="https://ico.org.uk" className={S.a} target="_blank" rel="noopener noreferrer">
            Information Commissioner&apos;s Office (ICO)
          </a>.
        </p>

        <div className="mt-12 pt-6 border-t border-[var(--color-border)] text-center">
          <a href="/" className={S.a}>← Back to PropVal</a>
        </div>
      </div>
    </div>
  );
}
