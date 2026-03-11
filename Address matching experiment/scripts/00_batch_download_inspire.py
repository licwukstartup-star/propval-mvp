"""
Script 00 -- Automated Batch Download of INSPIRE Index Polygons
===============================================================
Downloads INSPIRE GML zip files for all London boroughs directly via HTTP.
No browser, no login, no licence click required -- just GET requests.

The HMLR "Use land and property data" site exposes direct download URLs
of the form: /datasets/inspire/download/{Borough_Name}.zip
These are publicly accessible after accepting the analytics cookie banner
(which we do via a one-time session request).

Usage:
  python scripts/00_batch_download_inspire.py          # all London boroughs
  python scripts/00_batch_download_inspire.py --list   # print URLs only
  python scripts/00_batch_download_inspire.py --slug bromley sutton  # specific

Output: ../data/inspire_raw/{slug}.zip  (ready for Script 01b)

After download, run:
  python scripts/01_batch_convert_inspire.py

ISOLATION: All output goes to the experiment folder. No changes to propval-mvp.
"""

import argparse
import sys
import time
from pathlib import Path

import requests

BASE_DIR = Path(__file__).parent.parent
DOWNLOAD_DIR = BASE_DIR / "data" / "inspire_raw"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

HMLR_BASE = "https://use-land-property-data.service.gov.uk"

# All London borough download paths scraped from the HMLR download page.
# slug is used as the output filename: {slug}.zip -> inspire_{slug}.geojson
LONDON_BOROUGHS = [
    ("city_of_london",           "/datasets/inspire/download/City_of_London_Corporation.zip"),
    ("barking_and_dagenham",     "/datasets/inspire/download/London_Borough_of_Barking_and_Dagenham.zip"),
    ("barnet",                   "/datasets/inspire/download/London_Borough_of_Barnet.zip"),
    ("bexley",                   "/datasets/inspire/download/London_Borough_of_Bexley.zip"),
    ("brent",                    "/datasets/inspire/download/London_Borough_of_Brent.zip"),
    ("bromley",                  "/datasets/inspire/download/London_Borough_of_Bromley.zip"),
    ("camden",                   "/datasets/inspire/download/London_Borough_of_Camden.zip"),
    ("croydon",                  "/datasets/inspire/download/London_Borough_of_Croydon.zip"),
    ("ealing",                   "/datasets/inspire/download/London_Borough_of_Ealing.zip"),
    ("enfield",                  "/datasets/inspire/download/London_Borough_of_Enfield.zip"),
    ("greenwich",                "/datasets/inspire/download/Royal_Borough_of_Greenwich.zip"),
    ("hackney",                  "/datasets/inspire/download/London_Borough_of_Hackney.zip"),
    ("hammersmith_and_fulham",   "/datasets/inspire/download/London_Borough_of_Hammersmith_and_Fulham.zip"),
    ("haringey",                 "/datasets/inspire/download/London_Borough_of_Haringey.zip"),
    ("harrow",                   "/datasets/inspire/download/London_Borough_of_Harrow.zip"),
    ("havering",                 "/datasets/inspire/download/London_Borough_of_Havering.zip"),
    ("hillingdon",               "/datasets/inspire/download/London_Borough_of_Hillingdon.zip"),
    ("hounslow",                 "/datasets/inspire/download/London_Borough_of_Hounslow.zip"),
    ("islington",                "/datasets/inspire/download/London_Borough_of_Islington.zip"),
    ("kensington_and_chelsea",   "/datasets/inspire/download/Royal_Borough_of_Kensington_and_Chelsea.zip"),
    ("kingston_upon_thames",     "/datasets/inspire/download/Royal_Borough_of_Kingston_upon_Thames.zip"),
    ("lambeth",                  "/datasets/inspire/download/London_Borough_of_Lambeth.zip"),
    ("lewisham",                 "/datasets/inspire/download/London_Borough_of_Lewisham.zip"),
    ("merton",                   "/datasets/inspire/download/London_Borough_of_Merton.zip"),
    ("newham",                   "/datasets/inspire/download/London_Borough_of_Newham.zip"),
    ("redbridge",                "/datasets/inspire/download/London_Borough_of_Redbridge.zip"),
    ("richmond_upon_thames",     "/datasets/inspire/download/London_Borough_of_Richmond_upon_Thames.zip"),
    ("southwark",                "/datasets/inspire/download/London_Borough_of_Southwark.zip"),
    ("sutton",                   "/datasets/inspire/download/London_Borough_of_Sutton.zip"),
    ("tower_hamlets",            "/datasets/inspire/download/London_Borough_of_Tower_Hamlets.zip"),
    ("waltham_forest",           "/datasets/inspire/download/London_Borough_of_Waltham_Forest.zip"),
    ("wandsworth",               "/datasets/inspire/download/London_Borough_of_Wandsworth.zip"),
    ("westminster",              "/datasets/inspire/download/Westminster_City_Council.zip"),
]


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": HMLR_BASE,
    })
    return s


def already_downloaded(slug: str) -> Path | None:
    for candidate in [
        DOWNLOAD_DIR / f"{slug}.zip",
        DOWNLOAD_DIR / f"inspire_{slug}.geojson",
    ]:
        if candidate.exists():
            return candidate
    # Also match manually-downloaded zips e.g. "London_Borough_of_Bromley.zip"
    slug_words = slug.replace("_", " ").lower()
    for f in DOWNLOAD_DIR.glob("*.zip"):
        if slug_words in f.name.lower().replace("_", " "):
            return f
    return None


def download_borough(session: requests.Session, slug: str, path: str, dest: Path) -> bool:
    url = HMLR_BASE + path
    try:
        r = session.get(url, stream=True, timeout=120)
        if r.status_code != 200:
            print(f"    HTTP {r.status_code} — {url}")
            return False
        content_type = r.headers.get("Content-Type", "")
        if "html" in content_type:
            print(f"    Got HTML instead of zip — URL may be wrong: {url}")
            return False

        total = int(r.headers.get("Content-Length", 0))
        downloaded = 0
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=1_048_576):
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded / total * 100
                    print(f"\r    {pct:5.1f}%  ({downloaded/1_048_576:.0f}/{total/1_048_576:.0f} MB)", end="", flush=True)

        print(f"\r    [OK] {dest.name} ({downloaded/1_048_576:.1f} MB)            ")
        return True

    except requests.exceptions.Timeout:
        print(f"    TIMEOUT — {url}")
        dest.unlink(missing_ok=True)
        return False
    except Exception as e:
        print(f"    ERROR: {e}")
        dest.unlink(missing_ok=True)
        return False


def main():
    parser = argparse.ArgumentParser(description="Batch download London INSPIRE polygons")
    parser.add_argument("--list", action="store_true", help="Print URLs only, don't download")
    parser.add_argument("--slug", nargs="+", help="Only download specific slugs e.g. bromley sutton")
    args = parser.parse_args()

    boroughs = LONDON_BOROUGHS
    if args.slug:
        boroughs = [(s, p) for s, p in LONDON_BOROUGHS if s in args.slug]
        if not boroughs:
            print(f"No matching slugs. Available: {[s for s, _ in LONDON_BOROUGHS]}")
            sys.exit(1)

    print(f"\n=== Script 00: Batch INSPIRE Download ({len(boroughs)} boroughs) ===\n")

    if args.list:
        for slug, path in boroughs:
            print(f"  {slug:<35} {HMLR_BASE + path}")
        return

    pending = []
    for slug, path in boroughs:
        existing = already_downloaded(slug)
        if existing:
            print(f"  [SKIP] {slug:<35} ({existing.name})")
        else:
            pending.append((slug, path))

    if not pending:
        print("\n  [OK] All boroughs already downloaded.")
        print("  Next: python scripts/01_batch_convert_inspire.py")
        return

    print(f"\n  Downloading {len(pending)} borough(s)...\n")

    session = make_session()
    ok = 0
    failed = []

    for slug, path in pending:
        dest = DOWNLOAD_DIR / f"{slug}.zip"
        print(f"  {slug}")
        success = download_borough(session, slug, path, dest)
        if success:
            ok += 1
        else:
            failed.append((slug, path))
        time.sleep(1)

    print(f"\n  ============================================")
    print(f"  Downloaded: {ok}   Failed: {len(failed)}")
    if failed:
        print(f"\n  Failed — retry manually:")
        for slug, path in failed:
            print(f"    {HMLR_BASE + path}")
    else:
        print(f"  Next: python scripts/01_batch_convert_inspire.py")


if __name__ == "__main__":
    main()
