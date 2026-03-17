export default function Placeholder({ text }: { text: string }) {
  return <p className="text-sm italic" style={{ color: "var(--color-text-secondary)" }}>{text}</p>
}
