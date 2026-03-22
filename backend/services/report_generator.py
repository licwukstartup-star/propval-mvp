"""Report Generator — merges structured content with template schema to produce .docx.

Takes:
  1. Structured content (metadata, valuer inputs, AI sections, comparables)
  2. Template schema (sections, branding, page setup)

Produces:
  - A styled .docx file matching the template layout

Uses python-docx for .docx creation. This replaces the client-side docx-js export
when a template is selected.
"""

import logging
import tempfile
from pathlib import Path

from docx import Document
from docx.shared import Pt, Inches, Mm, RGBColor, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.section import WD_ORIENT

logger = logging.getLogger(__name__)


def _hex_to_rgb(hex_color: str) -> RGBColor:
    """Convert #RRGGBB to RGBColor."""
    h = hex_color.lstrip("#")
    return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _set_cell_text(cell, text: str, bold: bool = False, size: int = 11,
                   color: str | None = None, font_name: str = "Calibri"):
    """Set text in a table cell with formatting."""
    cell.text = ""
    p = cell.paragraphs[0]
    run = p.add_run(str(text))
    run.font.size = Pt(size)
    run.font.name = font_name
    run.bold = bold
    if color:
        run.font.color.rgb = _hex_to_rgb(color)


def generate_report_docx(
    content: dict,
    template_schema: dict,
) -> str:
    """Generate a .docx report from structured content and template schema.

    Args:
        content: {
            "metadata": { report_reference, report_date, client_name, ... },
            "valuer_inputs": { market_value, condition_rating, ... },
            "ai_sections": { location_description, market_commentary, ... },
            "comparables": [ { address, price, date, area, ... } ],
            "property": { address, postcode, property_type, tenure, ... },
            "firm_template": { instructions, purpose, firm_name, ... },
        }
        template_schema: The JSONB schema from report_templates.schema

    Returns:
        Path to the generated .docx file (temp file).
    """
    doc = Document()

    # ── Page setup ────────────────────────────────────────────────────────
    page_config = template_schema.get("page", {})
    margins = page_config.get("margins", {})
    section = doc.sections[0]
    section.page_width = Mm(210)  # A4
    section.page_height = Mm(297)

    if page_config.get("orientation") == "landscape":
        section.orientation = WD_ORIENT.LANDSCAPE
        section.page_width, section.page_height = section.page_height, section.page_width

    # Margins (stored in twips in schema, convert to EMU: 1 twip = 635 EMU)
    if margins.get("top"):
        section.top_margin = Emu(margins["top"] * 635)
    if margins.get("bottom"):
        section.bottom_margin = Emu(margins["bottom"] * 635)
    if margins.get("left"):
        section.left_margin = Emu(margins["left"] * 635)
    if margins.get("right"):
        section.right_margin = Emu(margins["right"] * 635)

    # ── Branding ──────────────────────────────────────────────────────────
    branding = template_schema.get("branding", {})
    font_family = branding.get("font_family", "Calibri")
    font_size = branding.get("font_size", 11)
    accent_color = branding.get("accent_color", "#007AFF")

    # Set default font
    style = doc.styles["Normal"]
    style.font.name = font_family
    style.font.size = Pt(font_size)

    # ── Extract content ───────────────────────────────────────────────────
    metadata = content.get("metadata", {})
    valuer = content.get("valuer_inputs", {})
    ai_sections = content.get("ai_sections", {})
    comparables = content.get("comparables", [])
    prop = content.get("property", {})
    firm = content.get("firm_template", {})

    # ── Render each section ───────────────────────────────────────────────
    for tmpl_section in template_schema.get("sections", []):
        section_type = tmpl_section.get("type", "narrative")
        title = tmpl_section.get("title", "")

        # ── Cover page ────────────────────────────────────────────────────
        if section_type == "cover_page":
            # Firm name
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run(firm.get("firm_name", ""))
            run.font.size = Pt(16)
            run.font.name = font_family
            run.bold = True

            # Report title
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run(title)
            run.font.size = Pt(22)
            run.font.name = font_family
            run.font.color.rgb = _hex_to_rgb(accent_color)

            # Property address
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run(prop.get("address", ""))
            run.font.size = Pt(18)
            run.font.name = font_family
            run.bold = True

            # Postcode
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run(prop.get("postcode", ""))
            run.font.size = Pt(14)
            run.font.name = font_family
            run.font.color.rgb = _hex_to_rgb("#636366")

            # Metadata fields
            doc.add_paragraph()  # spacer
            for field in tmpl_section.get("fields", []):
                val = (
                    metadata.get(field, "")
                    or prop.get(field, "")
                    or firm.get(field, "")
                    or ""
                )
                if val:
                    label = field.replace("_", " ").title()
                    p = doc.add_paragraph()
                    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    run = p.add_run(f"{label}: ")
                    run.font.size = Pt(10)
                    run.font.color.rgb = _hex_to_rgb("#636366")
                    run.font.name = font_family
                    run = p.add_run(str(val))
                    run.font.size = Pt(10)
                    run.font.name = font_family

            doc.add_page_break()

        # ── Boilerplate ───────────────────────────────────────────────────
        elif section_type == "boilerplate":
            _add_heading(doc, title, accent_color, font_family)
            source_field = tmpl_section.get("source_field", "")
            text = firm.get(source_field, "") if source_field else ""

            # Check subsections
            subsections = tmpl_section.get("subsections", [])
            if subsections:
                for sub in subsections:
                    _add_subheading(doc, sub.get("title", ""), font_family)
                    sub_field = sub.get("source_field", "")
                    sub_text = firm.get(sub_field, "") if sub_field else ""
                    if sub.get("type") == "data_field":
                        _render_data_fields(doc, sub.get("fields", []), valuer, font_family)
                    elif sub_text:
                        _add_body_text(doc, sub_text, font_family, font_size)
                    else:
                        _add_body_text(doc, "[Not configured]", font_family, font_size, "#8E8E93")
            elif text:
                _add_body_text(doc, text, font_family, font_size)
            else:
                _add_body_text(doc, "[Not configured]", font_family, font_size, "#8E8E93")

        # ── Narrative ─────────────────────────────────────────────────────
        elif section_type == "narrative":
            _add_heading(doc, title, accent_color, font_family)
            ai_key = tmpl_section.get("ai_section_key", "")
            text = ai_sections.get(ai_key, "") if ai_key else ""

            subsections = tmpl_section.get("subsections", [])
            if subsections:
                for sub in subsections:
                    _add_subheading(doc, sub.get("title", ""), font_family)
                    sub_ai_key = sub.get("ai_section_key", "")
                    sub_text = ai_sections.get(sub_ai_key, "") if sub_ai_key else ""
                    if sub.get("type") == "data_field":
                        _render_data_fields(doc, sub.get("fields", []), valuer, font_family)
                    elif sub_text:
                        _add_body_text(doc, sub_text, font_family, font_size)
                    else:
                        _add_body_text(doc, "[Pending]", font_family, font_size, "#FF9500")
            elif text:
                _add_body_text(doc, text, font_family, font_size)
            else:
                _add_body_text(doc, "[Pending]", font_family, font_size, "#FF9500")

        # ── Data fields ───────────────────────────────────────────────────
        elif section_type == "data_field":
            _add_heading(doc, title, accent_color, font_family)
            _render_data_fields(doc, tmpl_section.get("fields", []), valuer, font_family)

        # ── Comparables table ─────────────────────────────────────────────
        elif section_type == "comparables_table":
            _add_heading(doc, title, accent_color, font_family)
            columns = tmpl_section.get("columns", ["address", "price", "date", "type", "area"])
            max_rows = tmpl_section.get("max_rows", 6)

            if comparables:
                table = doc.add_table(rows=1, cols=len(columns))
                table.alignment = WD_TABLE_ALIGNMENT.CENTER

                # Header row
                for j, col in enumerate(columns):
                    _set_cell_text(table.rows[0].cells[j], col.replace("_", " ").title(),
                                   bold=True, size=9, color="#636366", font_name=font_family)

                # Data rows
                for comp in comparables[:max_rows]:
                    row = table.add_row()
                    for j, col in enumerate(columns):
                        val = comp.get(col, "")
                        if col == "price" and isinstance(val, (int, float)):
                            val = f"£{val:,.0f}"
                        _set_cell_text(row.cells[j], str(val or "—"), size=9, font_name=font_family)
            else:
                _add_body_text(doc, "No comparables adopted.", font_family, font_size, "#8E8E93")

        # ── Valuation summary ─────────────────────────────────────────────
        elif section_type == "valuation_summary":
            _add_heading(doc, title, accent_color, font_family)
            subsections = tmpl_section.get("subsections", [])
            if subsections:
                for sub in subsections:
                    _add_subheading(doc, sub.get("title", ""), font_family)
                    if sub.get("type") == "narrative":
                        ai_key = sub.get("ai_section_key", "")
                        text = ai_sections.get(ai_key, "") if ai_key else ""
                        if text:
                            _add_body_text(doc, text, font_family, font_size)
                        else:
                            _add_body_text(doc, "[Pending]", font_family, font_size, "#FF9500")
                    elif sub.get("type") == "data_field":
                        _render_data_fields(doc, sub.get("fields", []), valuer, font_family)
            else:
                mv = valuer.get("market_value", "")
                if mv:
                    p = doc.add_paragraph()
                    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    run = p.add_run(f"£{int(float(mv)):,}" if mv else "£___________")
                    run.font.size = Pt(20)
                    run.font.bold = True
                    run.font.color.rgb = _hex_to_rgb(accent_color)
                    run.font.name = font_family

        # ── Appendices ────────────────────────────────────────────────────
        elif section_type == "appendices":
            doc.add_page_break()
            _add_heading(doc, title, accent_color, font_family)
            for sub in tmpl_section.get("subsections", []):
                _add_subheading(doc, sub.get("title", ""), font_family)
                if sub.get("type") in ("image", "image_grid"):
                    _add_body_text(doc, "[Image placeholder]", font_family, font_size, "#5AC8FA")
                else:
                    _add_body_text(doc, "[See attached]", font_family, font_size, "#8E8E93")

        # ── Image grid ────────────────────────────────────────────────────
        elif section_type in ("image_grid", "image"):
            _add_heading(doc, title, accent_color, font_family)
            _add_body_text(doc, "[Image placeholder]", font_family, font_size, "#5AC8FA")

        # ── Auto / placeholder ────────────────────────────────────────────
        elif section_type in ("auto", "placeholder"):
            _add_heading(doc, title, accent_color, font_family)
            _add_body_text(doc, "[Auto-populated / placeholder]", font_family, font_size, "#8E8E93")

    # ── Save to temp file ─────────────────────────────────────────────────
    tmp = tempfile.NamedTemporaryFile(suffix=".docx", delete=False)
    doc.save(tmp.name)
    tmp.close()
    return tmp.name


# ── Helper functions ──────────────────────────────────────────────────────────

def _add_heading(doc, text: str, accent_color: str, font_family: str):
    """Add a styled H2 heading."""
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.size = Pt(14)
    run.font.bold = True
    run.font.name = font_family
    run.font.color.rgb = _hex_to_rgb(accent_color)
    # Bottom border via paragraph formatting
    pf = p.paragraph_format
    pf.space_after = Pt(6)
    pf.space_before = Pt(12)


def _add_subheading(doc, text: str, font_family: str):
    """Add a styled H3 subheading."""
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.size = Pt(12)
    run.font.bold = True
    run.font.name = font_family
    pf = p.paragraph_format
    pf.space_after = Pt(4)
    pf.space_before = Pt(8)


def _add_body_text(doc, text: str, font_family: str, font_size: int,
                   color: str | None = None):
    """Add body text, splitting on double newlines into paragraphs."""
    for paragraph_text in text.split("\n\n"):
        paragraph_text = paragraph_text.strip()
        if not paragraph_text:
            continue
        p = doc.add_paragraph()
        run = p.add_run(paragraph_text)
        run.font.size = Pt(font_size)
        run.font.name = font_family
        if color:
            run.font.color.rgb = _hex_to_rgb(color)


def _render_data_fields(doc, fields: list[str], valuer: dict, font_family: str):
    """Render a list of data fields as a simple label: value table."""
    if not fields:
        return

    table = doc.add_table(rows=0, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.LEFT

    for field in fields:
        val = valuer.get(field, "")
        if isinstance(val, bool):
            val = "Yes" if val else "No"
        elif val is None:
            val = ""

        row = table.add_row()
        label = field.replace("_", " ").replace("basis ", "").title()
        _set_cell_text(row.cells[0], label, bold=True, size=10,
                       color="#636366", font_name=font_family)
        _set_cell_text(row.cells[1], str(val) if val else "—", size=10,
                       font_name=font_family)
