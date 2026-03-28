"use client";

/**
 * TemplateDIYEditor — Drag-and-drop template section builder.
 *
 * Lets users:
 *  - Rename the template
 *  - Add / remove / reorder sections
 *  - Configure section properties (title, type, subsections)
 *  - Edit branding (font, colours, margins)
 *  - Live preview of section structure
 *  - Save back to API
 *
 * Fully self-contained — receives template data as props, emits onSave/onClose.
 */

import React, { useState, useCallback } from "react";
import { getPlaceholdersByCategory, type PlaceholderDef } from "../report-typing/extensions/placeholderRegistry";

// ── Types (local to editor) ─────────────────────────────────────────────────

interface TemplateSection {
  id: string;
  type: string;
  title: string;
  source_field?: string;
  ai_section_key?: string;
  fields?: string[];
  columns?: string[];
  subsections?: TemplateSection[];
  layout?: string;
  max_rows?: number;
  source?: string;
}

interface TemplateBranding {
  logo?: string;
  firm_name?: string;
  accent_color?: string;
  font_family?: string;
  font_size?: number;
}

interface TemplateSchema {
  version: string;
  page?: {
    size?: string;
    margins?: { top: number; right: number; bottom: number; left: number };
    orientation?: string;
  };
  branding?: TemplateBranding;
  header?: { layout?: string; content?: string[] };
  footer?: { content?: string };
  sections: TemplateSection[];
}

interface EditorProps {
  templateId?: string;
  templateName: string;
  templateDescription: string;
  schema: TemplateSchema;
  onSave: (name: string, description: string, schema: TemplateSchema) => Promise<void>;
  onClose: () => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const SECTION_TYPES = [
  { value: "cover_page", label: "Cover Page" },
  { value: "boilerplate", label: "Boilerplate Text" },
  { value: "narrative", label: "Narrative (AI/Valuer)" },
  { value: "data_field", label: "Property Data" },
  { value: "comparables_table", label: "Comparables Table" },
  { value: "valuation_summary", label: "Valuation Summary" },
  { value: "image_grid", label: "Image Grid" },
  { value: "image", label: "Single Image" },
  { value: "appendices", label: "Appendices" },
  { value: "auto", label: "Auto-populated" },
  { value: "placeholder", label: "Placeholder" },
];

const AI_SECTION_KEYS = [
  "location_description",
  "subject_development",
  "subject_building",
  "subject_property",
  "market_commentary",
  "valuation_considerations",
  "environmental_commentary",
  "fire_risk_commentary",
];

const BOILERPLATE_FIELDS = [
  "instructions", "purpose", "responsibility", "disclosure",
  "pi_insurance", "expertise", "inspection", "environmental",
  "asbestos", "fire_risk", "methodology", "general_comments",
];

const DATA_FIELDS = [
  "basis_market_value", "basis_market_rent", "basis_mv_90day", "basis_mv_180day", "basis_birc",
  "conflict_of_interest", "conflict_notes",
  "assumption_no_deleterious", "assumption_no_contamination", "assumption_good_title",
  "assumption_statutory_compliance", "assumption_no_encroachment", "assumption_bespoke",
  "gia_sqm", "gia_adopted_epc", "site_area_sqm",
  "service_gas", "service_water", "service_electricity", "service_drainage",
  "condition_rating", "condition_notes",
  "market_rent", "market_rent_frequency", "market_value",
  "suitable_security", "birc_value", "birc_rate_psm",
];

const COVER_FIELDS = [
  "property_address", "valuation_date", "client_name", "report_ref",
  "firm_name", "firm_address", "preparer_name",
];

function generateId(): string {
  return `section_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Section type badge ───────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const info = SECTION_TYPES.find((s) => s.value === type) || { label: type };
  return (
    <span
      className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
      style={{
        backgroundColor: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
        color: "var(--color-accent)",
        border: "1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)",
      }}
    >
      {info.label}
    </span>
  );
}

// ── Placeholder browser (expandable panel showing all registry placeholders) ─

const CATEGORY_LABELS: Record<string, string> = {
  B: "Case Metadata",
  C: "API Auto-populated",
  D: "AI-Generated",
  E: "Valuer Input",
  F: "Auto Assembly",
};

function PlaceholderBrowser({
  selectedFields,
  onToggleField,
}: {
  selectedFields: string[];
  onToggleField: (field: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [filterCat, setFilterCat] = useState<string>("all");

  const categories = ["B", "C", "D", "E", "F"] as const;
  const allPlaceholders = categories.flatMap((cat) => getPlaceholdersByCategory(cat));
  const filtered = filterCat === "all" ? allPlaceholders : allPlaceholders.filter((p) => p.category === filterCat);

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[10px] font-medium transition-colors"
        style={{ color: "var(--color-accent)" }}
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        Browse All Placeholders ({allPlaceholders.length})
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {/* Category filter */}
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setFilterCat("all")}
              className="text-[9px] px-2 py-0.5 rounded-full border transition-colors"
              style={{
                backgroundColor: filterCat === "all" ? "var(--color-btn-primary-bg)" : "transparent",
                color: filterCat === "all" ? "var(--color-btn-primary-text)" : "var(--color-text-secondary)",
                borderColor: filterCat === "all" ? "var(--color-accent)" : "var(--color-border)",
              }}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilterCat(cat)}
                className="text-[9px] px-2 py-0.5 rounded-full border transition-colors"
                style={{
                  backgroundColor: filterCat === cat ? "var(--color-btn-primary-bg)" : "transparent",
                  color: filterCat === cat ? "var(--color-btn-primary-text)" : "var(--color-text-secondary)",
                  borderColor: filterCat === cat ? "var(--color-accent)" : "var(--color-border)",
                }}
              >
                {CATEGORY_LABELS[cat]} ({getPlaceholdersByCategory(cat).length})
              </button>
            ))}
          </div>

          {/* Placeholder chips */}
          <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
            {filtered.map((p) => {
              const selected = selectedFields.includes(p.key);
              return (
                <button
                  key={p.key}
                  onClick={() => onToggleField(p.key)}
                  className="text-[10px] px-2 py-1 rounded-full border transition-colors"
                  title={`${p.label} (${p.category}) — ${p.source}`}
                  style={{
                    backgroundColor: selected ? "var(--color-btn-primary-bg)" : "transparent",
                    color: selected ? "var(--color-btn-primary-text)" : "var(--color-text-secondary)",
                    borderColor: selected ? "var(--color-accent)" : "var(--color-border)",
                  }}
                >
                  {p.required && "* "}{p.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Subsection editor row ────────────────────────────────────────────────────

function SubsectionRow({
  sub,
  onUpdate,
  onRemove,
}: {
  sub: TemplateSection;
  onUpdate: (updated: TemplateSection) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2 py-1.5 px-3 rounded-lg group"
      style={{ backgroundColor: "var(--color-bg-base)" }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: "var(--color-border)" }} />
      <input
        className="flex-1 text-xs bg-transparent border-none outline-none"
        style={{ color: "var(--color-text-primary)" }}
        value={sub.title}
        onChange={(e) => onUpdate({ ...sub, title: e.target.value })}
      />
      <select
        className="text-[10px] bg-transparent border rounded px-1 py-0.5 outline-none"
        style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
        value={sub.type}
        onChange={(e) => onUpdate({ ...sub, type: e.target.value })}
      >
        {SECTION_TYPES.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>
      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-[var(--color-status-danger, #DC2626)] transition-opacity"
        title="Remove subsection"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ── Section editor card ──────────────────────────────────────────────────────

function SectionCard({
  section,
  index,
  totalSections,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  expanded,
  onToggle,
}: {
  section: TemplateSection;
  index: number;
  totalSections: number;
  onUpdate: (updated: TemplateSection) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const addSubsection = () => {
    const subs = section.subsections || [];
    const newSub: TemplateSection = {
      id: generateId(),
      type: "narrative",
      title: `${section.title.split(".")[0]}.${subs.length + 1} New Subsection`,
    };
    onUpdate({ ...section, subsections: [...subs, newSub] });
  };

  const updateSubsection = (subIndex: number, updated: TemplateSection) => {
    const subs = [...(section.subsections || [])];
    subs[subIndex] = updated;
    onUpdate({ ...section, subsections: subs });
  };

  const removeSubsection = (subIndex: number) => {
    const subs = (section.subsections || []).filter((_, i) => i !== subIndex);
    onUpdate({ ...section, subsections: subs });
  };

  return (
    <div
      className="rounded-xl border overflow-hidden transition-shadow"
      style={{ backgroundColor: "var(--color-bg-surface)", borderColor: "var(--color-border)" }}
    >
      {/* Section header — always visible */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer group"
        onClick={onToggle}
      >
        {/* Section index */}
        <span className="text-xs font-mono w-6 text-center flex-shrink-0" style={{ color: "var(--color-text-secondary)" }}>
          {index + 1}
        </span>

        {/* Title */}
        <span className="flex-1 text-sm font-medium truncate" style={{ color: "var(--color-text-primary)" }}>
          {section.title}
        </span>

        {/* Type badge */}
        <TypeBadge type={section.type} />

        {/* Subsection count */}
        {section.subsections && section.subsections.length > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "var(--color-bg-base)", color: "var(--color-text-secondary)" }}>
            {section.subsections.length} sub
          </span>
        )}

        {/* Move buttons */}
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-focus-within:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onMoveUp}
            disabled={index === 0}
            className="w-6 h-6 rounded flex items-center justify-center disabled:opacity-20 transition-colors"
            style={{ color: "var(--color-text-secondary)" }}
            onMouseEnter={(e) => { if (index > 0) e.currentTarget.style.backgroundColor = "var(--color-bg-base)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <button
            onClick={onMoveDown}
            disabled={index === totalSections - 1}
            className="w-6 h-6 rounded flex items-center justify-center disabled:opacity-20 transition-colors"
            style={{ color: "var(--color-text-secondary)" }}
            onMouseEnter={(e) => { if (index < totalSections - 1) e.currentTarget.style.backgroundColor = "var(--color-bg-base)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {/* Expand chevron */}
        <svg
          className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          style={{ color: "var(--color-text-secondary)" }}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: "var(--color-border)" }}>
          {/* Title + Type row */}
          <div className="flex gap-3 mt-3">
            <div className="flex-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Section Title</label>
              <input
                className="w-full text-sm mt-1 px-3 py-2 rounded-lg border outline-none focus:ring-1"
                style={{
                  backgroundColor: "var(--color-bg-base)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
                value={section.title}
                onChange={(e) => onUpdate({ ...section, title: e.target.value })}
              />
            </div>
            <div className="w-48">
              <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Type</label>
              <select
                className="w-full text-sm mt-1 px-3 py-2 rounded-lg border outline-none focus:ring-1"
                style={{
                  backgroundColor: "var(--color-bg-base)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
                value={section.type}
                onChange={(e) => onUpdate({ ...section, type: e.target.value })}
              >
                {SECTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Type-specific configuration */}
          {section.type === "narrative" && (
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>AI Section Key (optional)</label>
              <select
                className="w-full text-xs mt-1 px-3 py-2 rounded-lg border outline-none"
                style={{ backgroundColor: "var(--color-bg-base)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
                value={section.ai_section_key || ""}
                onChange={(e) => onUpdate({ ...section, ai_section_key: e.target.value || undefined })}
              >
                <option value="">None — valuer types manually</option>
                {AI_SECTION_KEYS.map((k) => (
                  <option key={k} value={k}>{k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</option>
                ))}
              </select>
            </div>
          )}

          {section.type === "boilerplate" && (
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Firm Template Field</label>
              <select
                className="w-full text-xs mt-1 px-3 py-2 rounded-lg border outline-none"
                style={{ backgroundColor: "var(--color-bg-base)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
                value={section.source_field || ""}
                onChange={(e) => onUpdate({ ...section, source_field: e.target.value || undefined })}
              >
                <option value="">Select field...</option>
                {BOILERPLATE_FIELDS.map((f) => (
                  <option key={f} value={f}>{f.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()).replace(/\bPi\b/, "PI")}</option>
                ))}
              </select>
            </div>
          )}

          {section.type === "data_field" && (
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Data Fields</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {DATA_FIELDS.map((f) => {
                  const selected = (section.fields || []).includes(f);
                  return (
                    <button
                      key={f}
                      className="text-[10px] px-2 py-1 rounded-full border transition-colors"
                      style={{
                        backgroundColor: selected ? "var(--color-btn-primary-bg)" : "transparent",
                        color: selected ? "var(--color-btn-primary-text)" : "var(--color-text-secondary)",
                        borderColor: selected ? "var(--color-accent)" : "var(--color-border)",
                      }}
                      onClick={() => {
                        const fields = selected
                          ? (section.fields || []).filter((x) => x !== f)
                          : [...(section.fields || []), f];
                        onUpdate({ ...section, fields });
                      }}
                    >
                      {f.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()).replace(/\bGia\b/, "GIA").replace(/\bPi\b/, "PI").replace(/\bBirc\b/, "BIRC").replace(/\bEpc\b/, "EPC").replace(/\bMv\b/, "MV")}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {section.type === "cover_page" && (
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Cover Page Fields</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {COVER_FIELDS.map((f) => {
                  const selected = (section.fields || []).includes(f);
                  return (
                    <button
                      key={f}
                      className="text-[10px] px-2 py-1 rounded-full border transition-colors"
                      style={{
                        backgroundColor: selected ? "var(--color-btn-primary-bg)" : "transparent",
                        color: selected ? "var(--color-btn-primary-text)" : "var(--color-text-secondary)",
                        borderColor: selected ? "var(--color-accent)" : "var(--color-border)",
                      }}
                      onClick={() => {
                        const fields = selected
                          ? (section.fields || []).filter((x) => x !== f)
                          : [...(section.fields || []), f];
                        onUpdate({ ...section, fields });
                      }}
                    >
                      {f.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()).replace(/\bGia\b/, "GIA").replace(/\bPi\b/, "PI").replace(/\bBirc\b/, "BIRC").replace(/\bEpc\b/, "EPC").replace(/\bMv\b/, "MV")}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {section.type === "comparables_table" && (
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Max Rows</label>
              <input
                type="number"
                className="w-24 text-xs mt-1 px-3 py-2 rounded-lg border outline-none"
                style={{ backgroundColor: "var(--color-bg-base)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
                value={section.max_rows || 6}
                min={1}
                max={20}
                onChange={(e) => onUpdate({ ...section, max_rows: parseInt(e.target.value) || 6 })}
              />
            </div>
          )}

          {section.type === "image_grid" && (
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Grid Layout</label>
              <select
                className="w-full text-xs mt-1 px-3 py-2 rounded-lg border outline-none"
                style={{ backgroundColor: "var(--color-bg-base)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
                value={section.layout || "2x3"}
                onChange={(e) => onUpdate({ ...section, layout: e.target.value })}
              >
                <option value="1x1">1 x 1</option>
                <option value="1x2">1 x 2</option>
                <option value="2x2">2 x 2</option>
                <option value="2x3">2 x 3</option>
                <option value="3x3">3 x 3</option>
              </select>
            </div>
          )}

          {/* Placeholder browser — for data_field or cover_page sections */}
          {(section.type === "data_field" || section.type === "cover_page") && (
            <PlaceholderBrowser
              selectedFields={section.fields || []}
              onToggleField={(field) => {
                const fields = (section.fields || []).includes(field)
                  ? (section.fields || []).filter((x) => x !== field)
                  : [...(section.fields || []), field];
                onUpdate({ ...section, fields });
              }}
            />
          )}

          {/* Subsections */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>
                Subsections ({(section.subsections || []).length})
              </label>
              <button
                onClick={addSubsection}
                className="text-[10px] font-medium px-2 py-1 rounded-lg transition-colors"
                style={{ color: "var(--color-accent)" }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--color-accent) 10%, transparent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                + Add Subsection
              </button>
            </div>
            {(section.subsections || []).length > 0 && (
              <div className="space-y-1 mt-2">
                {(section.subsections || []).map((sub, si) => (
                  <SubsectionRow
                    key={sub.id}
                    sub={sub}
                    onUpdate={(updated) => updateSubsection(si, updated)}
                    onRemove={() => removeSubsection(si)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Remove section */}
          <div className="pt-2 border-t flex justify-end" style={{ borderColor: "var(--color-border)" }}>
            <button
              onClick={onRemove}
              className="text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
              style={{ color: "var(--color-status-danger, #DC2626)" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--color-status-danger, #DC2626) 8%, transparent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Remove Section
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Editor Component ────────────────────────────────────────────────────

export default function TemplateDIYEditor({ templateName, templateDescription, schema, onSave, onClose }: EditorProps) {
  const [name, setName] = useState(templateName);
  const [description, setDescription] = useState(templateDescription || "");
  const [sections, setSections] = useState<TemplateSection[]>(schema.sections || []);
  const [branding, setBranding] = useState<TemplateBranding>(schema.branding || { font_family: "Calibri", font_size: 11, accent_color: "#007AFF" });
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const markDirty = useCallback(() => setDirty(true), []);

  const handleClose = useCallback(() => {
    if (dirty && !window.confirm("You have unsaved changes. Discard and close?")) return;
    onClose();
  }, [dirty, onClose]);

  // ── Section operations ─────────────────────────────────────────────────

  const updateSection = (index: number, updated: TemplateSection) => {
    setSections((prev) => prev.map((s, i) => (i === index ? updated : s)));
    markDirty();
  };

  const removeSection = (index: number) => {
    setSections((prev) => prev.filter((_, i) => i !== index));
    markDirty();
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    setSections((prev) => {
      const arr = [...prev];
      const target = index + direction;
      if (target < 0 || target >= arr.length) return arr;
      [arr[index], arr[target]] = [arr[target], arr[index]];
      return arr;
    });
    markDirty();
  };

  const addSection = () => {
    const newSection: TemplateSection = {
      id: generateId(),
      type: "narrative",
      title: `${sections.length + 1}. New Section`,
    };
    setSections((prev) => [...prev, newSection]);
    setExpandedSection(newSection.id);
    markDirty();
  };

  // ── Save ───────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const updatedSchema: TemplateSchema = {
        ...schema,
        branding,
        sections,
      };
      await onSave(name, description, updatedSchema);
      setDirty(false);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: "var(--color-bg-base)" }}>
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-6 py-3 border-b shadow-sm"
        style={{ backgroundColor: "var(--color-bg-surface)", borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: "var(--color-text-secondary)" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--color-bg-base)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            title="Close editor"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h2 className="font-orbitron text-[var(--color-accent)] text-xs tracking-[2px] uppercase">Template Editor</h2>
            <p className="text-[10px] mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
              {sections.length} section{sections.length !== 1 ? "s" : ""} {dirty ? "— unsaved changes" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-[10px] px-2 py-1 rounded-full" style={{ backgroundColor: "color-mix(in srgb, var(--color-status-warning, #D97706) 12%, transparent)", color: "var(--color-status-warning, #D97706)" }}>
              Unsaved
            </span>
          )}
          <button
            onClick={handleClose}
            className="text-xs font-medium px-4 py-2 rounded-lg border transition-colors"
            style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="text-xs font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-40"
            style={{ backgroundColor: "var(--color-btn-primary-bg)", color: "var(--color-btn-primary-text)" }}
          >
            {saving ? "Saving..." : "Save Template"}
          </button>
        </div>
      </div>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">

          {/* Save error */}
          {saveError && (
            <div
              className="text-xs px-4 py-2.5 rounded-lg flex items-center gap-2"
              style={{ backgroundColor: "color-mix(in srgb, var(--color-status-danger, #DC2626) 8%, transparent)", color: "var(--color-status-danger, #DC2626)", border: "1px solid color-mix(in srgb, var(--color-status-danger, #DC2626) 20%, transparent)" }}
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              {saveError}
              <button onClick={() => setSaveError(null)} className="ml-auto text-[10px] underline">dismiss</button>
            </div>
          )}

          {/* Template info */}
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Template Name</label>
              <input
                className="w-full text-sm mt-1 px-3 py-2 rounded-lg border outline-none focus:ring-1"
                style={{ backgroundColor: "var(--color-bg-surface)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
                value={name}
                onChange={(e) => { setName(e.target.value); markDirty(); }}
                placeholder="e.g. My Standard Residential Report"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Description</label>
              <input
                className="w-full text-xs mt-1 px-3 py-2 rounded-lg border outline-none focus:ring-1"
                style={{ backgroundColor: "var(--color-bg-surface)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
                value={description}
                onChange={(e) => { setDescription(e.target.value); markDirty(); }}
                placeholder="Brief description of this template..."
              />
            </div>
          </div>

          {/* Branding */}
          <div
            className="rounded-xl border p-4 space-y-3"
            style={{ backgroundColor: "var(--color-bg-surface)", borderColor: "var(--color-border)" }}
          >
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>
              Branding & Formatting
            </h3>
            <div className="flex flex-wrap gap-4">
              <div className="flex-1">
                <label className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>Font Family</label>
                <select
                  className="w-full text-xs mt-1 px-3 py-2 rounded-lg border outline-none"
                  style={{ backgroundColor: "var(--color-bg-base)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
                  value={branding.font_family || "Calibri"}
                  onChange={(e) => { setBranding({ ...branding, font_family: e.target.value }); markDirty(); }}
                >
                  <option value="Calibri">Calibri</option>
                  <option value="Arial">Arial</option>
                  <option value="Times New Roman">Times New Roman</option>
                  <option value="Georgia">Georgia</option>
                  <option value="Garamond">Garamond</option>
                </select>
              </div>
              <div className="w-24">
                <label className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>Font Size</label>
                <input
                  type="number"
                  className="w-full text-xs mt-1 px-3 py-2 rounded-lg border outline-none"
                  style={{ backgroundColor: "var(--color-bg-base)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
                  value={branding.font_size || 11}
                  min={8}
                  max={16}
                  onChange={(e) => { setBranding({ ...branding, font_size: parseInt(e.target.value) || 11 }); markDirty(); }}
                />
              </div>
              <div className="w-32">
                <label className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>Accent Colour</label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="color"
                    className="w-8 h-8 rounded border cursor-pointer"
                    style={{ borderColor: "var(--color-border)" }}
                    value={branding.accent_color || "#007AFF"}
                    onChange={(e) => { setBranding({ ...branding, accent_color: e.target.value }); markDirty(); }}
                  />
                  <span className="text-[10px] font-mono" style={{ color: "var(--color-text-secondary)" }}>
                    {branding.accent_color || "#007AFF"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Sections */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>
                Report Sections ({sections.length})
              </h3>
              <button
                onClick={addSection}
                className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                style={{ backgroundColor: "var(--color-btn-primary-bg)", color: "var(--color-btn-primary-text)" }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add Section
              </button>
            </div>

            <div className="space-y-2">
              {sections.map((section, i) => (
                <SectionCard
                  key={section.id}
                  section={section}
                  index={i}
                  totalSections={sections.length}
                  onUpdate={(updated) => updateSection(i, updated)}
                  onRemove={() => removeSection(i)}
                  onMoveUp={() => moveSection(i, -1)}
                  onMoveDown={() => moveSection(i, 1)}
                  expanded={expandedSection === section.id}
                  onToggle={() => setExpandedSection(expandedSection === section.id ? null : section.id)}
                />
              ))}
            </div>

            {sections.length === 0 && (
              <div
                className="text-center py-12 rounded-xl border-2 border-dashed"
                style={{ borderColor: "var(--color-border)" }}
              >
                <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>No sections yet</p>
                <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)", opacity: 0.6 }}>
                  Click "Add Section" to start building your template
                </p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
