import Placeholder from "../shared/Placeholder"

export default function AppendicesContent() {
  return (
    <>
      <Placeholder text="Auto-assembled at final report export:" />
      <div className="space-y-1 ml-3">
        {[
          "I — Instruction Letter (uploaded)",
          "II — Terms & Conditions (firm template)",
          "III — OS Map (auto-generated)",
          "IV — Location Plans (auto-generated)",
          "V — EPC Certificate (from API / uploaded)",
          "Flood Risk Map (auto-generated)",
          "Noise Map (auto-generated)",
          "IMD Map (auto-generated)",
          "Comparable Location Map (auto-generated)",
        ].map((a, i) => (
          <p key={i} className="text-sm" style={{ color: "var(--color-text-secondary)" }}>• {a}</p>
        ))}
      </div>
    </>
  )
}
