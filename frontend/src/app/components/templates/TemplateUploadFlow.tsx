"use client";

/**
 * TemplateUploadFlow — Upload .docx → AI parse → Review mapping → Save
 *
 * Three-step flow:
 *  1. Upload: drag-and-drop or file picker for .docx
 *  2. Review: show AI-classified sections, user confirms/adjusts
 *  3. Save: name the template and save to account
 */

import React, { useState, useCallback, useRef } from "react";
import { API_BASE } from "@/lib/constants";

// ── Types ────────────────────────────────────────────────────────────────────

interface Classification {
  index: number;
  title: string;
  type: string;
  confidence: number;
  ai_section_key?: string | null;
  source_field?: string | null;
}

interface UploadResult {
  parsed_sections: number;
  schema: any;
  classifications: Classification[];
  metadata: {
    fonts_detected: string[];
    total_sections: number;
    table_count: number;
  };
}

interface UploadFlowProps {
  session: { access_token: string } | null;
  onSaved: () => void; // callback after successful save to refresh list
}

type Step = "upload" | "review" | "save";

const SECTION_TYPES = [
  { value: "cover_page", label: "Cover Page" },
  { value: "boilerplate", label: "Boilerplate" },
  { value: "narrative", label: "Narrative" },
  { value: "data_field", label: "Data Fields" },
  { value: "comparables_table", label: "Comparables" },
  { value: "valuation_summary", label: "Valuation" },
  { value: "image_grid", label: "Image Grid" },
  { value: "image", label: "Image" },
  { value: "appendices", label: "Appendices" },
  { value: "auto", label: "Auto" },
  { value: "placeholder", label: "Placeholder" },
];

// ── Confidence indicator ─────────────────────────────────────────────────────

function ConfidenceDot({ confidence }: { confidence: number }) {
  const color = confidence >= 0.8 ? "var(--color-status-success, #16A34A)" : confidence >= 0.5 ? "var(--color-status-warning, #D97706)" : "var(--color-status-danger, #DC2626)";
  return (
    <span className="flex items-center gap-1">
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[10px]" style={{ color }}>
        {Math.round(confidence * 100)}%
      </span>
    </span>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function TemplateUploadFlow({ session, onSaved }: UploadFlowProps) {
  const [step, setStep] = useState<Step>("upload");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [classifications, setClassifications] = useState<Classification[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [templateDesc, setTemplateDesc] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Upload handler ─────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".docx")) {
      setError("Only .docx files are supported");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File too large (max 10MB)");
      return;
    }
    if (!session?.access_token) {
      setError("Not authenticated");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const resp = await fetch(`${API_BASE}/api/templates/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.detail || `Upload failed (${resp.status})`);
      }

      const data: UploadResult = await resp.json();
      setResult(data);
      setClassifications(data.classifications);
      setTemplateName(file.name.replace(/\.docx$/i, ""));
      setStep("review");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [session?.access_token]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // ── Update classification ──────────────────────────────────────────────

  const updateClassification = (index: number, field: string, value: string) => {
    setClassifications((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c))
    );
  };

  // ── Save template ──────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!session?.access_token || !result) return;
    setSaving(true);
    setError(null);

    try {
      // Build final schema from reviewed classifications
      const finalSchema = { ...result.schema };
      finalSchema.sections = classifications.map((cls) => {
        const section: any = {
          id: `section_${cls.index}`,
          type: cls.type,
          title: cls.title,
        };
        if (cls.ai_section_key) section.ai_section_key = cls.ai_section_key;
        if (cls.source_field) section.source_field = cls.source_field;
        if (cls.type === "comparables_table") {
          section.columns = ["address", "price", "date", "type", "area", "price_per_sqm"];
          section.max_rows = 6;
        }
        if (cls.type === "image_grid") section.layout = "2x3";
        if (cls.type === "cover_page") {
          section.fields = ["property_address", "valuation_date", "client_name", "report_ref"];
        }
        return section;
      });

      const resp = await fetch(`${API_BASE}/api/templates/save-uploaded`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: templateName || "Uploaded Template",
          description: templateDesc || "Created from uploaded .docx",
          source: "uploaded",
          schema_data: finalSchema,
        }),
      });

      if (!resp.ok) throw new Error("Failed to save template");

      onSaved();
      // Reset
      setStep("upload");
      setResult(null);
      setClassifications([]);
      setTemplateName("");
      setTemplateDesc("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [session?.access_token, result, classifications, templateName, templateDesc, onSaved]);

  // ── Render: Step 1 — Upload ────────────────────────────────────────────

  if (step === "upload") {
    return (
      <div className="space-y-4">
        {error && (
          <div className="text-xs px-4 py-2.5 rounded-lg" style={{ backgroundColor: "color-mix(in srgb, var(--color-status-danger, #DC2626) 8%, transparent)", color: "var(--color-status-danger, #DC2626)", border: "1px solid color-mix(in srgb, var(--color-status-danger, #DC2626) 20%, transparent)" }}>
            {error}
          </div>
        )}

        <div
          className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors cursor-pointer ${dragOver ? "border-[var(--color-accent)]" : ""}`}
          style={{ borderColor: dragOver ? "var(--color-accent)" : "var(--color-border)", backgroundColor: dragOver ? "color-mix(in srgb, var(--color-accent) 5%, transparent)" : "transparent" }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={handleFileInput}
          />

          {uploading ? (
            <div className="space-y-4">
              <div className="w-12 h-12 mx-auto border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }} />
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>Analysing your report...</p>
                <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>Extracting structure and classifying sections with AI</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center" style={{ backgroundColor: "color-mix(in srgb, var(--color-accent) 10%, transparent)" }}>
                <svg className="w-8 h-8" style={{ color: "var(--color-accent)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                  Drop your .docx report here
                </h3>
                <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
                  or click to browse. Max 10MB. We'll extract the structure and suggest section mappings.
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg font-medium" style={{ backgroundColor: "var(--color-btn-primary-bg)", color: "var(--color-btn-primary-text)" }}>
                Choose .docx File
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Render: Step 2 — Review classifications ────────────────────────────

  if (step === "review" && result) {
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
              Review Section Mapping
            </h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
              {result.parsed_sections} sections detected. Adjust any incorrect mappings below.
            </p>
          </div>
          <div className="flex items-center gap-3 text-[10px]" style={{ color: "var(--color-text-secondary)" }}>
            {result.metadata.fonts_detected.length > 0 && (
              <span>Font: {result.metadata.fonts_detected[0]}</span>
            )}
            {result.metadata.table_count > 0 && (
              <span>{result.metadata.table_count} table{result.metadata.table_count !== 1 ? "s" : ""}</span>
            )}
          </div>
        </div>

        {error && (
          <div className="text-xs px-4 py-2.5 rounded-lg" style={{ backgroundColor: "color-mix(in srgb, var(--color-status-danger, #DC2626) 8%, transparent)", color: "var(--color-status-danger, #DC2626)", border: "1px solid color-mix(in srgb, var(--color-status-danger, #DC2626) 20%, transparent)" }}>
            {error}
          </div>
        )}

        {/* Classification table */}
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
          <table className="w-full min-w-[500px]">
            <thead>
              <tr style={{ backgroundColor: "var(--color-bg-base)" }}>
                <th className="text-[10px] font-semibold uppercase tracking-wider text-left px-4 py-2" style={{ color: "var(--color-text-secondary)" }}>#</th>
                <th className="text-[10px] font-semibold uppercase tracking-wider text-left px-4 py-2" style={{ color: "var(--color-text-secondary)" }}>Section Title</th>
                <th className="text-[10px] font-semibold uppercase tracking-wider text-left px-4 py-2" style={{ color: "var(--color-text-secondary)" }}>Type</th>
                <th className="text-[10px] font-semibold uppercase tracking-wider text-left px-4 py-2" style={{ color: "var(--color-text-secondary)" }}>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {classifications.map((cls, i) => (
                <tr
                  key={cls.index}
                  className="border-t"
                  style={{
                    borderColor: "var(--color-border)",
                    backgroundColor: i % 2 === 0 ? "var(--color-bg-surface)" : "var(--color-bg-base)",
                  }}
                >
                  <td className="px-4 py-2 text-xs font-mono" style={{ color: "var(--color-text-secondary)" }}>
                    {cls.index}
                  </td>
                  <td className="px-4 py-2">
                    <input
                      className="text-xs bg-transparent border-none outline-none w-full"
                      style={{ color: "var(--color-text-primary)" }}
                      value={cls.title}
                      onChange={(e) => updateClassification(i, "title", e.target.value)}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <select
                      className="text-[11px] bg-transparent border rounded px-2 py-1 outline-none"
                      style={{ borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
                      value={cls.type}
                      onChange={(e) => updateClassification(i, "type", e.target.value)}
                    >
                      {SECTION_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <ConfidenceDot confidence={cls.confidence} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Actions */}
        <div className="flex justify-between">
          <button
            onClick={() => { setStep("upload"); setResult(null); setClassifications([]); }}
            className="text-xs font-medium px-4 py-2 rounded-lg border transition-colors"
            style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
          >
            Start Over
          </button>
          <button
            onClick={() => setStep("save")}
            className="text-xs font-medium px-6 py-2 rounded-lg transition-colors"
            style={{ backgroundColor: "var(--color-btn-primary-bg)", color: "var(--color-btn-primary-text)" }}
          >
            Looks Good — Continue
          </button>
        </div>
      </div>
    );
  }

  // ── Render: Step 3 — Name and save ─────────────────────────────────────

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <div className="text-center mb-6">
        <div className="w-12 h-12 mx-auto rounded-2xl flex items-center justify-center mb-3" style={{ backgroundColor: "color-mix(in srgb, var(--color-status-success, #16A34A) 10%, transparent)" }}>
          <svg className="w-6 h-6" style={{ color: "var(--color-status-success, #16A34A)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
          Almost done!
        </h3>
        <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
          Name your template and save it to your account.
        </p>
      </div>

      {error && (
        <div className="text-xs px-4 py-2.5 rounded-lg" style={{ backgroundColor: "color-mix(in srgb, var(--color-status-danger, #DC2626) 8%, transparent)", color: "var(--color-status-danger, #DC2626)", border: "1px solid color-mix(in srgb, var(--color-status-danger, #DC2626) 20%, transparent)" }}>
          {error}
        </div>
      )}

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Template Name</label>
        <input
          className="w-full text-sm mt-1 px-4 py-2.5 rounded-lg border outline-none focus:ring-1"
          style={{ backgroundColor: "var(--color-bg-surface)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          placeholder="e.g. My Standard Residential Report"
        />
      </div>
      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Description (optional)</label>
        <input
          className="w-full text-xs mt-1 px-4 py-2.5 rounded-lg border outline-none focus:ring-1"
          style={{ backgroundColor: "var(--color-bg-surface)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
          value={templateDesc}
          onChange={(e) => setTemplateDesc(e.target.value)}
          placeholder="Brief description..."
        />
      </div>

      <div className="flex justify-between pt-4">
        <button
          onClick={() => setStep("review")}
          className="text-xs font-medium px-4 py-2 rounded-lg border transition-colors"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
        >
          Back to Review
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !templateName.trim()}
          className="text-xs font-medium px-6 py-2 rounded-lg transition-colors disabled:opacity-40"
          style={{ backgroundColor: "var(--color-btn-primary-bg)", color: "var(--color-btn-primary-text)" }}
        >
          {saving ? "Saving..." : "Save Template"}
        </button>
      </div>
    </div>
  );
}
