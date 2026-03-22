"""PDF generation from report copy HTML via Playwright.

Uses a headless Chromium browser to render editor HTML as a styled A4 PDF.
Playwright is already a project dependency (used for other tasks).
"""

import logging
import re

logger = logging.getLogger(__name__)

# A4 print stylesheet matching the TipTap editor design language
_PRINT_CSS = """
@page {
  size: A4;
  margin: 20mm;
}
body {
  font-family: Calibri, 'Segoe UI', sans-serif;
  font-size: 11pt;
  line-height: 1.5;
  color: #1D1D1F;
  margin: 0;
  padding: 0;
}
h1 { font-size: 22px; font-weight: 700; margin: 16px 0 8px; }
h2 { font-size: 16px; font-weight: 700; margin: 20px 0 8px; color: #007AFF; }
h3 { font-size: 12px; font-weight: 700; margin: 14px 0 4px; color: #1D1D1F; }
h4 { font-size: 11px; font-weight: 700; margin: 10px 0 4px; color: #636366; }
p { margin: 4px 0; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 10pt; }
th, td { border: 1px solid #E5E5EA; padding: 5px 8px; text-align: left; }
th { background: #F2F2F7; font-weight: 600; color: #636366; }
tr:nth-child(even) td { background: #F9F9FB; }
blockquote { border-left: 3px solid #007AFF; padding-left: 12px; margin: 8px 0; color: #636366; }
hr { border: none; border-top: 1px solid #E5E5EA; margin: 16px 0; }
ul { list-style: disc; padding-left: 24px; margin: 4px 0; }
ol { list-style: decimal; padding-left: 24px; margin: 4px 0; }
li { margin: 2px 0; }
img { max-width: 100%; height: auto; margin: 8px 0; }
"""

# Tags and patterns to strip from HTML before PDF rendering (SSRF/XSS prevention)
_DANGEROUS_TAGS = re.compile(
    r"<\s*(script|iframe|object|embed|applet|form|input|textarea|button|select|link|meta|base)[^>]*>.*?</\s*\1\s*>|"
    r"<\s*(script|iframe|object|embed|applet|form|input|textarea|button|select|link|meta|base)[^>]*/?>",
    re.IGNORECASE | re.DOTALL,
)
_EVENT_HANDLERS = re.compile(r'\s+on\w+\s*=\s*["\'][^"\']*["\']', re.IGNORECASE)


def _sanitize_html(html: str) -> str:
    """Strip dangerous tags and event handlers from HTML for safe PDF rendering."""
    html = _DANGEROUS_TAGS.sub("", html)
    html = _EVENT_HANDLERS.sub("", html)
    return html


async def html_to_pdf(html: str) -> bytes:
    """Render HTML string to a PDF byte buffer.

    Uses Playwright's Chromium to print an A4 page.
    Returns the PDF as bytes.
    """
    from playwright.async_api import async_playwright

    safe_html = _sanitize_html(html)

    full_html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>{_PRINT_CSS}</style></head>
<body>{safe_html}</body>
</html>"""

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            page = await browser.new_page()
            await page.set_content(full_html, wait_until="networkidle", timeout=15000)
            pdf_bytes = await page.pdf(
                format="A4",
                margin={"top": "20mm", "bottom": "20mm", "left": "20mm", "right": "20mm"},
                print_background=True,
            )
        finally:
            await browser.close()

    logger.info("PDF generated: %d bytes", len(pdf_bytes))
    return pdf_bytes
