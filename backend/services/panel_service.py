"""Panel Service — merge panel configs with base template schemas.

Panel configs are thin JSON overlays that sit on top of a base report template.
Each panel (VAS, Method, etc.) defines extra sections, tighter field requirements,
inline reminders, QA rules, boilerplate overrides, and branding tweaks.

The base template is never mutated — the overlay is computed fresh each time.
"""

import copy
import logging

logger = logging.getLogger(__name__)


def merge_panel_with_template(
    template_schema: dict,
    panel_config: dict,
) -> dict:
    """Merge a panel config overlay onto a base template schema.

    Pure function — no side effects, no DB calls.

    Args:
        template_schema: The base template JSONB schema (from report_templates.schema)
        panel_config: The panel's config JSONB (from panel_configs.config)

    Returns:
        A new merged schema dict. The original is not mutated.
    """
    if not panel_config:
        return template_schema

    merged = copy.deepcopy(template_schema)
    sections = merged.get("sections", [])

    # 1. Inject extra_sections at specified positions
    for extra in panel_config.get("extra_sections", []):
        insert_after = extra.get("insert_after")
        new_section = {
            "id": extra["id"],
            "type": extra.get("type", "narrative"),
            "title": extra.get("title", ""),
        }
        if extra.get("ai_section_key"):
            new_section["ai_section_key"] = extra["ai_section_key"]
        if extra.get("source_field"):
            new_section["source_field"] = extra["source_field"]
        if extra.get("panel_boilerplate"):
            new_section["override_text"] = extra["panel_boilerplate"]

        # Find insertion point
        inserted = False
        if insert_after:
            for i, s in enumerate(sections):
                if s.get("id") == insert_after:
                    sections.insert(i + 1, new_section)
                    inserted = True
                    break
                # Also check subsections
                for j, sub in enumerate(s.get("subsections", [])):
                    if sub.get("id") == insert_after:
                        sections.insert(i + 1, new_section)
                        inserted = True
                        break
                if inserted:
                    break
        if not inserted:
            sections.append(new_section)

    # 2. Remove hidden_sections
    hidden = set(panel_config.get("hidden_sections", []))
    if hidden:
        sections = [s for s in sections if s.get("id") not in hidden]
        # Also remove hidden subsections
        for s in sections:
            if "subsections" in s:
                s["subsections"] = [
                    sub for sub in s["subsections"]
                    if sub.get("id") not in hidden
                ]

    # 3. Apply section_order if provided
    section_order = panel_config.get("section_order", [])
    if section_order:
        order_map = {sid: i for i, sid in enumerate(section_order)}
        # Sections in the order list come first (sorted), then the rest
        ordered = sorted(
            [s for s in sections if s.get("id") in order_map],
            key=lambda s: order_map[s["id"]],
        )
        remaining = [s for s in sections if s.get("id") not in order_map]
        sections = ordered + remaining

    merged["sections"] = sections

    # 4. Merge branding_overrides
    branding_overrides = panel_config.get("branding_overrides", {})
    if branding_overrides:
        merged_branding = merged.get("branding", {})
        merged_branding.update(branding_overrides)
        merged["branding"] = merged_branding

    # 5. Apply boilerplate_overrides — set override_text on matching sections
    boilerplate_overrides = panel_config.get("boilerplate_overrides", {})
    if boilerplate_overrides:
        for s in merged["sections"]:
            source_field = s.get("source_field", "")
            if source_field in boilerplate_overrides:
                s["override_text"] = boilerplate_overrides[source_field]
            # Check subsections too
            for sub in s.get("subsections", []):
                sub_field = sub.get("source_field", "")
                if sub_field in boilerplate_overrides:
                    sub["override_text"] = boilerplate_overrides[sub_field]

    # 6. Attach field_overrides as top-level metadata
    field_overrides = panel_config.get("field_overrides", {})
    if field_overrides:
        merged["panel_field_overrides"] = field_overrides

    # 7. Attach inline_reminders as top-level metadata (for frontend)
    inline_reminders = panel_config.get("inline_reminders", [])
    if inline_reminders:
        merged["panel_inline_reminders"] = inline_reminders

    return merged


def evaluate_reminders(
    panel_config: dict,
    current_state: dict,
) -> list[dict]:
    """Evaluate panel inline reminders against current report state.

    Args:
        panel_config: The panel's config JSONB
        current_state: Current report state with keys like:
            - comparables_count: int
            - condition_notes: str
            - market_commentary: str
            - fields: dict of field_name -> value

    Returns:
        List of active reminders (those whose conditions are met).
    """
    reminders = panel_config.get("inline_reminders", [])
    if not reminders:
        return []

    active = []
    for reminder in reminders:
        field = reminder.get("trigger_field", "")
        condition = reminder.get("condition", "")
        triggered = False

        if "count <" in condition:
            try:
                threshold = int(condition.split("<")[1].strip())
                count = current_state.get("comparables_count", 0)
                if field == "comparables" and count < threshold:
                    triggered = True
            except (ValueError, IndexError):
                pass

        elif condition == "not_ranked":
            # Check if comparables have ranking metadata
            if not current_state.get("comparables_ranked", False):
                triggered = True

        elif condition == "empty":
            val = current_state.get("fields", {}).get(field, "")
            if not val or not str(val).strip():
                triggered = True

        elif "length <" in condition:
            try:
                threshold = int(condition.split("<")[1].strip())
                val = current_state.get("fields", {}).get(field, "")
                if len(str(val)) < threshold:
                    triggered = True
            except (ValueError, IndexError):
                pass

        if triggered:
            active.append({
                "field": field,
                "message": reminder.get("message", ""),
                "severity": reminder.get("severity", "info"),
            })

    return active


def get_panel_qa_rules(panel_config: dict) -> list[str]:
    """Extract QA rules from a panel config.

    Returns:
        List of rule strings to append to the QA system prompt.
    """
    return panel_config.get("qa_rules", [])
