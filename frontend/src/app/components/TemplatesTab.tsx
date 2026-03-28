"use client";

/**
 * TemplatesTab — ARTG (Adaptive Report Template Generator)
 *
 * Self-contained tab for managing report templates.
 * Three modes: Gallery (ready-made), Upload (AI-parsed), DIY (custom builder).
 *
 * Fully isolated — can be added/removed without affecting the rest of PropVal.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { API_BASE } from "@/lib/constants";

// Lazy-load the upload flow (only needed when uploading)
const TemplateUploadFlow = dynamic(() => import("./templates/TemplateUploadFlow"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-12">
      <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }} />
    </div>
  ),
});

// Lazy-load the DIY editor (heavy component, only needed when editing)
const TemplateDIYEditor = dynamic(() => import("./templates/TemplateDIYEditor"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "var(--color-bg-base)" }}>
      <div className="text-center space-y-3">
        <div className="w-8 h-8 mx-auto border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }} />
        <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>Loading template editor...</p>
      </div>
    </div>
  ),
});

// ── Types ────────────────────────────────────────────────────────────────────

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
}

interface TemplateSchema {
  version: string;
  page?: {
    size?: string;
    margins?: { top: number; right: number; bottom: number; left: number };
    orientation?: string;
  };
  branding?: {
    logo?: string;
    firm_name?: string;
    accent_color?: string;
    font_family?: string;
    font_size?: number;
  };
  header?: { layout?: string; content?: string[] };
  footer?: { content?: string };
  sections: TemplateSection[];
}

interface ReportTemplate {
  id: string;
  name: string;
  description: string | null;
  source: "system" | "uploaded" | "custom";
  schema?: TemplateSchema;
  is_default: boolean;
  thumbnail: string | null;
  created_at: string;
  updated_at: string;
}

type TabMode = "gallery" | "my_templates" | "upload";

interface TemplatesTabProps {
  session: { access_token: string } | null;
}

// ── Section type display helpers ─────────────────────────────────────────────

const SECTION_TYPE_LABELS: Record<string, { label: string; cssVar: string }> = {
  cover_page: { label: "Cover", cssVar: "var(--color-accent)" },
  boilerplate: { label: "Boilerplate", cssVar: "var(--color-text-secondary)" },
  narrative: { label: "Narrative", cssVar: "var(--color-status-success, #16A34A)" },
  data_field: { label: "Property Data", cssVar: "var(--color-status-warning, #D97706)" },
  comparables_table: { label: "Comparables", cssVar: "var(--color-accent-purple, #8B5CF6)" },
  valuation_summary: { label: "Valuation", cssVar: "var(--color-status-danger, #DC2626)" },
  image_grid: { label: "Images", cssVar: "var(--color-accent)" },
  image: { label: "Image", cssVar: "var(--color-accent)" },
  appendices: { label: "Appendices", cssVar: "var(--color-text-secondary)" },
  auto: { label: "Auto-populated", cssVar: "var(--color-status-warning, #D97706)" },
  placeholder: { label: "Placeholder", cssVar: "var(--color-text-secondary)" },
};

function SectionTypeBadge({ type }: { type: string }) {
  const info = SECTION_TYPE_LABELS[type] || { label: type, cssVar: "var(--color-text-secondary)" };
  return (
    <span
      className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full"
      style={{
        backgroundColor: `color-mix(in srgb, ${info.cssVar} 12%, transparent)`,
        color: info.cssVar,
        border: `1px solid color-mix(in srgb, ${info.cssVar} 25%, transparent)`,
      }}
    >
      {info.label}
    </span>
  );
}

// ── Source badge ──────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string }) {
  const styles: Record<string, { bg: string; text: string; label: string }> = {
    system: { bg: "var(--color-btn-primary-bg)", text: "var(--color-btn-primary-text)", label: "System" },
    uploaded: { bg: "var(--color-accent-purple)", text: "var(--color-accent-purple-text)", label: "AI Parsed" },
    custom: { bg: "var(--color-status-success)", text: "var(--color-bg-base)", label: "Custom" },
  };
  const s = styles[source] || styles.custom;
  return (
    <span
      className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full"
      style={{ backgroundColor: s.bg, color: s.text }}
    >
      {s.label}
    </span>
  );
}

// ── Template Card ────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  onPreview,
  onClone,
  onEdit,
  onDelete,
  isSystem,
}: {
  template: ReportTemplate;
  onPreview: () => void;
  onClone: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  isSystem: boolean;
}) {
  const sectionCount = template.schema?.sections?.length ?? 0;

  return (
    <div
      className="rounded-xl border p-4 transition-all hover:shadow-md cursor-pointer group"
      style={{
        backgroundColor: "var(--color-bg-surface)",
        borderColor: "var(--color-border)",
      }}
      onClick={onPreview}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0 mr-2">
          <div className="flex items-center gap-2 mb-1">
            <h3
              className="text-sm font-semibold truncate"
              style={{ color: "var(--color-text-primary)" }}
            >
              {template.name}
            </h3>
            {template.is_default && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                style={{ backgroundColor: "var(--color-btn-primary-bg)", color: "var(--color-btn-primary-text)" }}
              >
                DEFAULT
              </span>
            )}
          </div>
          <SourceBadge source={template.source} />
        </div>

        {/* Template icon */}
        <div
          className="w-10 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: "var(--color-bg-base)", border: "1px solid var(--color-border)" }}
        >
          <svg className="w-5 h-5" style={{ color: "var(--color-text-secondary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        </div>
      </div>

      {/* Description */}
      {template.description && (
        <p
          className="text-xs mb-3 line-clamp-2"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {template.description}
        </p>
      )}

      {/* Stats */}
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[11px]" style={{ color: "var(--color-text-secondary)" }}>
          {sectionCount} section{sectionCount !== 1 ? "s" : ""}
        </span>
        <span className="text-[11px]" style={{ color: "var(--color-text-secondary)" }}>
          {(() => { const d = new Date(template.created_at); return `${String(d.getDate()).padStart(2,"0")} ${d.toLocaleDateString("en-GB",{month:"short"})} ${String(d.getFullYear()).slice(-2)}`; })()}
        </span>
      </div>

      {/* Actions */}
      <div className="flex gap-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onPreview}
          className="flex-1 text-[11px] font-medium py-1.5 rounded-lg border transition-colors"
          style={{
            borderColor: "var(--color-accent)",
            color: "var(--color-accent)",
            backgroundColor: "transparent",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--color-accent) 10%, transparent)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
        >
          Preview
        </button>
        <button
          onClick={onClone}
          className="flex-1 text-[11px] font-medium py-1.5 rounded-lg transition-colors"
          style={{
            backgroundColor: "var(--color-btn-primary-bg)",
            color: "var(--color-btn-primary-text)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
        >
          {isSystem ? "Use & Customise" : "Clone"}
        </button>
        {onEdit && (
          <button
            onClick={onEdit}
            className="px-2 py-1.5 text-[11px] font-medium rounded-lg border transition-colors"
            style={{ borderColor: "color-mix(in srgb, var(--color-accent) 40%, transparent)", color: "var(--color-accent)" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--color-accent) 10%, transparent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            title="Edit template"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="px-2 py-1.5 text-[11px] rounded-lg border transition-colors"
            style={{ borderColor: "color-mix(in srgb, var(--color-status-danger, #DC2626) 25%, transparent)", color: "var(--color-status-danger, #DC2626)" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--color-status-danger, #DC2626) 8%, transparent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Template Preview Modal ───────────────────────────────────────────────────

function TemplatePreviewModal({
  template,
  onClose,
  onClone,
}: {
  template: ReportTemplate;
  onClose: () => void;
  onClone?: () => void;
}) {
  const sections = template.schema?.sections ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full max-w-2xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ backgroundColor: "var(--color-bg-surface)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold" style={{ color: "var(--color-text-primary)" }}>
                {template.name}
              </h2>
              <SourceBadge source={template.source} />
            </div>
            {template.description && (
              <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
                {template.description}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
            style={{ color: "var(--color-text-secondary)" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--color-bg-base)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Template schema info */}
        <div className="px-6 py-3 flex items-center gap-4 border-b" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-bg-base)" }}>
          <span className="text-[11px]" style={{ color: "var(--color-text-secondary)" }}>
            Page: {template.schema?.page?.size ?? "A4"} {template.schema?.page?.orientation ?? "portrait"}
          </span>
          <span className="text-[11px]" style={{ color: "var(--color-text-secondary)" }}>
            Font: {template.schema?.branding?.font_family ?? "Calibri"} {template.schema?.branding?.font_size ?? 11}pt
          </span>
          <span className="text-[11px]" style={{ color: "var(--color-text-secondary)" }}>
            {sections.length} top-level section{sections.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Section list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--color-text-secondary)" }}>
            Report Structure
          </h3>
          {sections.map((section, i) => (
            <div key={section.id}>
              {/* Top-level section */}
              <div
                className="flex items-center gap-3 py-2 px-3 rounded-lg"
                style={{ backgroundColor: "var(--color-bg-base)" }}
              >
                <span className="text-xs font-mono w-5 text-right" style={{ color: "var(--color-text-secondary)" }}>
                  {i + 1}
                </span>
                <span className="text-sm font-medium flex-1" style={{ color: "var(--color-text-primary)" }}>
                  {section.title}
                </span>
                <SectionTypeBadge type={section.type} />
              </div>

              {/* Subsections */}
              {section.subsections && section.subsections.length > 0 && (
                <div className="ml-8 mt-1 space-y-0.5">
                  {section.subsections.map((sub) => (
                    <div key={sub.id} className="flex items-center gap-3 py-1.5 px-3">
                      <span className="w-1 h-1 rounded-full" style={{ backgroundColor: "var(--color-border)" }} />
                      <span className="text-xs flex-1" style={{ color: "var(--color-text-secondary)" }}>
                        {sub.title}
                      </span>
                      <SectionTypeBadge type={sub.type} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 border-t flex justify-end gap-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={onClose}
            className="text-xs font-medium px-4 py-2 rounded-lg border transition-colors"
            style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
          >
            Close
          </button>
          {onClone && (
            <button
              onClick={() => { onClone(); onClose(); }}
              className="text-xs font-medium px-4 py-2 rounded-lg transition-colors"
              style={{ backgroundColor: "var(--color-btn-primary-bg)", color: "var(--color-btn-primary-text)" }}
            >
              {template.source === "system" ? "Use & Customise" : "Clone"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function TemplatesTab({ session }: TemplatesTabProps) {
  const [tabMode, setTabMode] = useState<TabMode>("gallery");
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<ReportTemplate | null>(null);
  const [cloning, setCloning] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<ReportTemplate | null>(null);
  const fetchedRef = useRef(false);

  // ── Fetch templates ──────────────────────────────────────────────────────

  const fetchTemplates = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${API_BASE}/api/templates`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!resp.ok) throw new Error(`Failed to load templates (${resp.status})`);
      const data = await resp.json();
      setTemplates(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      fetchTemplates();
    }
  }, [fetchTemplates]);

  // ── Preview with full schema fetch ───────────────────────────────────────

  const handlePreview = useCallback(async (template: ReportTemplate) => {
    if (template.schema) {
      setPreviewTemplate(template);
      return;
    }
    // Fetch full template with schema
    if (!session?.access_token) return;
    try {
      const resp = await fetch(`${API_BASE}/api/templates/${template.id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!resp.ok) throw new Error("Failed to load template");
      const full = await resp.json();
      setPreviewTemplate(full);
      // Update cache
      setTemplates((prev) => prev.map((t) => (t.id === full.id ? full : t)));
    } catch {
      setPreviewTemplate(template);
    }
  }, [session?.access_token]);

  // ── Clone ────────────────────────────────────────────────────────────────

  const handleClone = useCallback(async (templateId: string) => {
    if (!session?.access_token || cloning) return;
    setCloning(templateId);
    try {
      const resp = await fetch(`${API_BASE}/api/templates/${templateId}/clone`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!resp.ok) throw new Error("Failed to clone template");
      await fetchTemplates();
      setTabMode("my_templates");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Clone failed");
    } finally {
      setCloning(null);
    }
  }, [session?.access_token, cloning, fetchTemplates]);

  // ── Delete ───────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async (templateId: string) => {
    if (!session?.access_token) return;
    if (!window.confirm("Delete this template? This cannot be undone.")) return;
    try {
      const resp = await fetch(`${API_BASE}/api/templates/${templateId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!resp.ok) throw new Error("Failed to delete template");
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }, [session?.access_token]);

  // ── Edit ──────────────────────────────────────────────────────────────────

  const handleEdit = useCallback(async (template: ReportTemplate) => {
    // Ensure we have the full schema before opening editor
    if (template.schema) {
      setEditingTemplate(template);
      return;
    }
    if (!session?.access_token) return;
    try {
      const resp = await fetch(`${API_BASE}/api/templates/${template.id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!resp.ok) throw new Error("Failed to load template");
      const full = await resp.json();
      setEditingTemplate(full);
      setTemplates((prev) => prev.map((t) => (t.id === full.id ? full : t)));
    } catch {
      setEditingTemplate(template);
    }
  }, [session?.access_token]);

  const handleEditSave = useCallback(async (name: string, description: string, schema: any) => {
    if (!session?.access_token || !editingTemplate) return;
    const resp = await fetch(`${API_BASE}/api/templates/${editingTemplate.id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, description, schema_data: schema }),
    });
    if (!resp.ok) throw new Error("Failed to save template");
    const updated = await resp.json();
    setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setEditingTemplate(null);
  }, [session?.access_token, editingTemplate]);

  // ── Filter templates by mode ─────────────────────────────────────────────

  const systemTemplates = templates.filter((t) => t.source === "system");
  const userTemplates = templates.filter((t) => t.source !== "system");

  const displayedTemplates = tabMode === "gallery" ? systemTemplates : userTemplates;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-orbitron text-[var(--color-accent)] text-sm tracking-[3px] uppercase">
            Report Templates
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)]/70 mt-0.5">
            Choose, customise, or upload your report format
          </p>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl" style={{ backgroundColor: "var(--color-bg-base)" }}>
        {([
          { key: "gallery" as TabMode, label: "Gallery", icon: "M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" },
          { key: "my_templates" as TabMode, label: "My Templates", icon: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" },
          { key: "upload" as TabMode, label: "Import from Word", icon: "M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" },
        ]).map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTabMode(key)}
            className="flex items-center gap-1.5 flex-1 text-xs font-medium py-2 px-3 rounded-lg transition-all text-center justify-center"
            style={{
              backgroundColor: tabMode === key ? "var(--color-bg-surface)" : "transparent",
              color: tabMode === key ? "var(--color-accent)" : "var(--color-text-secondary)",
              boxShadow: tabMode === key ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            }}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
            </svg>
            {label}
            {key === "my_templates" && userTemplates.length > 0 && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: "var(--color-btn-primary-bg)", color: "var(--color-btn-primary-text)" }}
              >
                {userTemplates.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div
          className="text-xs px-4 py-2.5 rounded-lg flex items-center gap-2"
          style={{ backgroundColor: "color-mix(in srgb, var(--color-status-danger, #DC2626) 8%, transparent)", color: "var(--color-status-danger, #DC2626)", border: "1px solid color-mix(in srgb, var(--color-status-danger, #DC2626) 20%, transparent)" }}
        >
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-[10px] underline">dismiss</button>
        </div>
      )}

      {/* Content */}
      {tabMode === "upload" ? (
        <TemplateUploadFlow session={session} onSaved={() => { fetchTemplates(); setTabMode("my_templates"); }} />
      ) : loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center space-y-3">
            <div
              className="w-8 h-8 mx-auto border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }}
            />
            <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
              Loading templates...
            </p>
          </div>
        </div>
      ) : displayedTemplates.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <div
            className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center"
            style={{ backgroundColor: "var(--color-bg-base)" }}
          >
            <svg className="w-7 h-7" style={{ color: "var(--color-text-secondary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
            {tabMode === "my_templates" ? "No custom templates yet" : "No templates available"}
          </p>
          <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
            {tabMode === "my_templates"
              ? "Clone a template from the Gallery or upload your own .docx to get started."
              : "System templates will appear here once configured."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayedTemplates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onPreview={() => handlePreview(t)}
              onClone={() => handleClone(t.id)}
              onEdit={t.source !== "system" ? () => handleEdit(t) : undefined}
              onDelete={t.source !== "system" ? () => handleDelete(t.id) : undefined}
              isSystem={t.source === "system"}
            />
          ))}
        </div>
      )}

      {/* Preview modal */}
      {previewTemplate && (
        <TemplatePreviewModal
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
          onClone={() => handleClone(previewTemplate.id)}
        />
      )}

      {/* DIY Editor — full-screen overlay */}
      {editingTemplate && editingTemplate.schema && (
        <TemplateDIYEditor
          templateId={editingTemplate.id}
          templateName={editingTemplate.name}
          templateDescription={editingTemplate.description || ""}
          schema={editingTemplate.schema}
          onSave={handleEditSave}
          onClose={() => setEditingTemplate(null)}
        />
      )}
    </div>
  );
}
