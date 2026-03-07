/**
 * Export the PropVal valuation report as a .docx Word file.
 * Uses the `docx` library to build a structured document matching the on-screen report.
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  ShadingType,
  HeadingLevel,
  Footer,
  PageNumber,
  NumberFormat,
} from "docx";
import { saveAs } from "file-saver";

// ── Types (mirrors page.tsx) ─────────────────────────────────────────────────

interface SaleRecord {
  date: string;
  price: number;
  tenure: string;
  property_type: string;
  new_build: boolean;
}

interface ListedBuilding {
  name: string;
  grade: string;
}

interface ConservationArea {
  name: string;
}

interface AncientWoodland {
  name: string;
}

interface BrownfieldSite {
  name: string;
}

export interface WordReportData {
  address: string;
  uprn: string | null;
  valuationDate: string | null;
  admin_district: string | null;
  region: string | null;
  // Property details
  property_type: string | null;
  built_form: string | null;
  floor_area_m2: number | null;
  num_rooms: number | null;
  construction_age_band: string | null;
  heating_type: string | null;
  energy_rating: string | null;
  energy_score: number | null;
  council_tax_band: string | null;
  lsoa: string | null;
  lat: number | null;
  lon: number | null;
  // Tenure
  tenure: string | null;
  lease_commencement: string | null;
  lease_expiry_date: string | null;
  lease_term_years: number | null;
  // Environmental
  rivers_sea_risk: string | null;
  surface_water_risk: string | null;
  planning_flood_zone: string | null;
  listed_buildings: ListedBuilding[];
  conservation_areas: ConservationArea[];
  green_belt: boolean;
  aonb: string | null;
  brownfield: BrownfieldSite[];
  coal_mining_high_risk: boolean;
  coal_mining_in_coalfield: boolean;
  radon_risk: string | null;
  sssi: string[];
  ancient_woodland: AncientWoodland[];
  ground_shrink_swell: string | null;
  ground_landslides: string | null;
  ground_compressible: string | null;
  ground_collapsible: string | null;
  ground_running_sand: string | null;
  ground_soluble_rocks: string | null;
  // Transaction history
  sales: SaleRecord[];
  // Comparables
  comparables: {
    address: string;
    property_type: string | null;
    building_era: string | null;
    bedrooms: number | null;
    price: number;
    floor_area_sqm: number | null;
    transaction_date: string;
    adjFactor: number;
    sizeAdjPsf: number | null;
  }[];
  // Valuation stats
  adoptedPriceMin: number;
  adoptedPriceMax: number;
  adoptedPriceAvg: number;
  adoptedPsfMin: number | null;
  adoptedPsfMax: number | null;
  adoptedPsfAvg: number | null;
  adjPsfMin: number | null;
  adjPsfMax: number | null;
  adjPsfAvg: number | null;
  sizeAdjPsfMin: number | null;
  sizeAdjPsfMax: number | null;
  sizeAdjPsfAvg: number | null;
  adoptedSizeMin: number | null;
  adoptedSizeMax: number | null;
  adoptedSizeAvg: number | null;
  adoptedDateMin: string | null;
  adoptedDateMax: string | null;
  // Indicative values
  indicativeLow: number | null;
  indicativeHigh: number | null;
  indicativeMid: number | null;
  subjectAreaM2: number | null;
  hpiCorrelation: number;
  sizeElasticity: number;
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function fmtPrice(p: number): string {
  return "£" + p.toLocaleString("en-GB");
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(2)}m`;
  return `£${Math.round(n / 1000)}k`;
}

function fmtPsf(n: number): string {
  return `£${Math.round(n)}/sqft`;
}

function fmtDateGB(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

function yearsMonths(from: Date, to: Date): string {
  let y = to.getFullYear() - from.getFullYear();
  let m = to.getMonth() - from.getMonth();
  if (m < 0) { y--; m += 12; }
  const parts: string[] = [];
  if (y > 0) parts.push(`${y} yr${y !== 1 ? "s" : ""}`);
  if (m > 0) parts.push(`${m} mo`);
  return parts.length ? parts.join(" ") : "< 1 month";
}

// ── Table builder helpers ────────────────────────────────────────────────────

const BLUE = "007AFF";
const PURPLE = "5856D6";
const HEADER_BG = "F2F2F7";
const STRIPE_A = "F9F9FB";
const STRIPE_B = "FFFFFF";
const BORDER_COLOR = "E5E5EA";

const thinBorder = {
  top: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
  left: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
  right: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
} as const;

function headerCell(text: string, widthPct?: number): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, size: 18, font: "Calibri", color: "3C3C43" })],
      spacing: { before: 40, after: 40 },
    })],
    shading: { type: ShadingType.SOLID, color: HEADER_BG },
    borders: thinBorder,
    ...(widthPct ? { width: { size: widthPct, type: WidthType.PERCENTAGE } } : {}),
  });
}

function dataCell(text: string, opts?: { bold?: boolean; color?: string; italic?: boolean; align?: typeof AlignmentType[keyof typeof AlignmentType] }): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({
        text,
        bold: opts?.bold,
        italics: opts?.italic,
        size: 19,
        font: "Calibri",
        color: opts?.color ?? "000000",
      })],
      spacing: { before: 30, after: 30 },
      alignment: opts?.align,
    })],
    borders: thinBorder,
  });
}

function labelCell(text: string): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, size: 18, font: "Calibri", color: "6E6E73" })],
      spacing: { before: 30, after: 30 },
    })],
    borders: thinBorder,
  });
}

function stripeRow(cells: TableCell[], _idx: number): TableRow {
  return new TableRow({ children: cells });
}

function kvTable(rows: [string, string | null][]): Table {
  const filtered = rows.filter(([, v]) => v != null) as [string, string][];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: filtered.map(([label, value], i) =>
      stripeRow([labelCell(label), dataCell(value)], i)
    ),
  });
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 22, font: "Calibri", color: "1D1D1F" })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 360, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR, space: 6 } },
  });
}

// ── Main export function ─────────────────────────────────────────────────────

export async function exportWordReport(data: WordReportData) {
  const sections: Paragraph[] | (Paragraph | Table)[] = [];
  const children: (Paragraph | Table)[] = [];

  // ── Title / cover ──────────────────────────────────────────────────────
  children.push(new Paragraph({
    children: [new TextRun({ text: "PROPVAL", size: 20, font: "Calibri", color: "8E8E93", bold: true })],
    spacing: { after: 40 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: "Valuation Report", size: 48, font: "Calibri", bold: true, color: BLUE })],
    spacing: { after: 300 },
  }));

  // Subject property header
  children.push(new Paragraph({
    children: [new TextRun({ text: "SUBJECT PROPERTY", size: 16, font: "Calibri", color: "8E8E93", bold: true })],
    spacing: { after: 60 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: data.address, size: 32, font: "Calibri", bold: true, color: "000000" })],
    spacing: { after: 40 },
  }));
  if (data.uprn) {
    children.push(new Paragraph({
      children: [new TextRun({ text: `UPRN ${data.uprn}`, size: 18, font: "Calibri", color: "8E8E93" })],
      spacing: { after: 120 },
    }));
  }

  // Key metadata line
  const metaItems = [
    ["Valuation Date", data.valuationDate ? fmtDateGB(data.valuationDate) : "Not specified"],
    ["Report Date", new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })],
    ...(data.admin_district ? [["Local Authority", data.admin_district]] : []),
    ...(data.region ? [["Region", data.region]] : []),
  ] as [string, string][];

  for (const [label, value] of metaItems) {
    children.push(new Paragraph({
      children: [
        new TextRun({ text: `${label}: `, size: 18, font: "Calibri", color: "8E8E93" }),
        new TextRun({ text: value, size: 18, font: "Calibri", bold: true, color: "000000" }),
      ],
      spacing: { after: 20 },
    }));
  }

  // ── 1. Property Details ────────────────────────────────────────────────
  children.push(sectionHeading("1. PROPERTY DETAILS"));
  children.push(kvTable([
    ["Property Type", data.property_type],
    ["Built Form", data.built_form],
    ["Floor Area (GIA)", data.floor_area_m2 != null ? `${data.floor_area_m2} m²  /  ${Math.round(data.floor_area_m2 * 10.764).toLocaleString("en-GB")} sq ft` : null],
    ["Habitable Rooms", data.num_rooms != null ? String(data.num_rooms) : null],
    ["Construction Era", data.construction_age_band],
    ["Heating", data.heating_type],
    ["EPC Rating", data.energy_rating && data.energy_score != null ? `${data.energy_rating} (score ${data.energy_score})` : data.energy_rating],
    ["Council Tax Band", data.council_tax_band ? `Band ${data.council_tax_band}` : null],
    ["LSOA", data.lsoa],
    ["Coordinates", data.lat != null ? `${data.lat.toFixed(5)}, ${data.lon!.toFixed(5)}` : null],
  ]));

  // ── 2. Tenure ──────────────────────────────────────────────────────────
  if (data.tenure) {
    children.push(sectionHeading("2. TENURE"));
    const tenureRows: [string, string | null][] = [
      ["Tenure", data.tenure],
    ];
    if (data.lease_commencement) tenureRows.push(["Lease Commencement", fmtDateGB(data.lease_commencement)]);
    if (data.lease_expiry_date) {
      tenureRows.push(["Lease Expiry", fmtDateGB(data.lease_expiry_date)]);
      tenureRows.push(["Unexpired Term", yearsMonths(new Date(), new Date(data.lease_expiry_date))]);
    }
    if (data.lease_term_years) tenureRows.push(["Original Term", `${data.lease_term_years} years`]);
    children.push(kvTable(tenureRows));
  }

  // ── 3. Environmental & Statutory Assessment ────────────────────────────
  children.push(sectionHeading("3. ENVIRONMENTAL & STATUTORY ASSESSMENT"));

  const envRows: [string, string, string][] = [
    ["Flood Risk - Rivers & Sea", data.rivers_sea_risk ?? "Not assessed", "EA NaFRA2 Jan 2025"],
    ["Flood Risk - Surface Water", data.surface_water_risk ?? "Not assessed", "EA Surface Water"],
    ["NPPF Planning Flood Zone", data.planning_flood_zone ?? "Zone 1 (Low probability)", "planning.data.gov.uk"],
    ["Listed Buildings (75m)", data.listed_buildings.length === 0 ? "None within 75m" : data.listed_buildings.map(lb => `${lb.grade}: ${lb.name}`).join(" | "), "Historic England NHLE"],
    ["Conservation Area", data.conservation_areas.length === 0 ? "Not within a conservation area" : data.conservation_areas.map(ca => ca.name).join(", "), "planning.data.gov.uk"],
    ["Green Belt", data.green_belt ? "Within Green Belt" : "Not in Green Belt", "Natural England"],
    ["AONB / National Landscape", data.aonb ?? "Not within an AONB", "Natural England"],
    ["Brownfield Land (100m)", data.brownfield.length === 0 ? "No brownfield sites within 100m" : `${data.brownfield.length} site(s) identified within 100m`, "planning.data.gov.uk"],
    ["Coal Mining - High Risk Area", data.coal_mining_high_risk ? "Within Development High Risk Area" : "Not in High Risk Area", "Mining Remediation Authority"],
    ["Coal Mining - Coalfield", data.coal_mining_in_coalfield ? "Within coalfield area" : "Not in coalfield area", "Mining Remediation Authority"],
    ["Radon Risk", data.radon_risk ?? "Not assessed", "UK Radon / PHE"],
    ["SSSI (2km)", data.sssi.length === 0 ? "No SSSIs within 2km" : data.sssi.join(" | "), "Natural England"],
    ["Ancient Woodland (50m)", data.ancient_woodland.length === 0 ? "No ancient woodland within 50m" : data.ancient_woodland.map(aw => aw.name).join(" | "), "Natural England"],
  ];

  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [headerCell("Factor", 35), headerCell("Finding"), headerCell("Source", 22)],
      }),
      ...envRows.map(([factor, finding, source], i) =>
        stripeRow([labelCell(factor), dataCell(finding), dataCell(source, { color: "8E8E93" })], i)
      ),
    ],
  }));

  // Ground conditions sub-table
  const groundRows: [string, string][] = ([
    ["Shrink-swell clay", data.ground_shrink_swell],
    ["Landslides", data.ground_landslides],
    ["Compressible ground", data.ground_compressible],
    ["Collapsible deposits", data.ground_collapsible],
    ["Running sand", data.ground_running_sand],
    ["Soluble rocks", data.ground_soluble_rocks],
  ] as [string, string | null][]).filter((r): r is [string, string] => r[1] != null);

  if (groundRows.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "Ground Conditions - BGS GeoSure", size: 18, font: "Calibri", bold: true, color: "6E6E73" })],
      spacing: { before: 200, after: 80 },
    }));
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [headerCell("Hazard", 45), headerCell("Susceptibility")] }),
        ...groundRows.map(([label, value], i) =>
          stripeRow([labelCell(label), dataCell(value)], i)
        ),
      ],
    }));
  }

  // ── 4. Transaction History ─────────────────────────────────────────────
  children.push(sectionHeading("4. TRANSACTION HISTORY"));
  children.push(new Paragraph({
    children: [new TextRun({ text: "Source: HM Land Registry Price Paid Data", size: 16, font: "Calibri", color: "8E8E93" })],
    spacing: { after: 80 },
  }));

  if (data.sales.length === 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "No Land Registry transactions found for this address.", size: 19, font: "Calibri", italics: true, color: "999999" })],
    }));
  } else {
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: ["Date", "Price", "Tenure", "Property Type"].map(h => headerCell(h)),
        }),
        ...data.sales.map((sale, i) =>
          stripeRow([
            dataCell(sale.date),
            dataCell(fmtPrice(sale.price), { bold: true }),
            dataCell(sale.tenure),
            dataCell(sale.property_type + (sale.new_build ? " (New Build)" : "")),
          ], i)
        ),
      ],
    }));
  }

  // ── 5. Sales Comparable Evidence ───────────────────────────────────────
  children.push(sectionHeading("5. SALES COMPARABLE EVIDENCE"));
  children.push(new Paragraph({
    children: [new TextRun({
      text: `Source: HM Land Registry Price Paid Data - ${data.comparables.length} comparable${data.comparables.length !== 1 ? "s" : ""} adopted`,
      size: 18, font: "Calibri", color: "86868B",
    })],
    spacing: { after: 80 },
  }));

  if (data.comparables.length === 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "No comparables adopted.", size: 19, font: "Calibri", italics: true, color: "999999" })],
    }));
  } else {
    const compHeaders = ["Address", "Type / Era", "Rooms", "Price", "Size (sqft)", "£/sqft", "Adj. £/sqft"];
    if (data.sizeElasticity > 0) compHeaders.push(`Size-Adj PSF`);
    compHeaders.push("Date");

    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: compHeaders.map(h => headerCell(h)) }),
        ...data.comparables.map((comp, i) => {
          const sqft = comp.floor_area_sqm != null ? Math.round(comp.floor_area_sqm * 10.764) : null;
          const psf = sqft != null ? Math.round(comp.price / sqft) : null;
          const adjPsf = sqft != null ? Math.round(comp.price * comp.adjFactor / sqft) : null;
          const cells = [
            dataCell(comp.address, { italic: true, bold: true }),
            dataCell([comp.property_type, comp.building_era].filter(Boolean).join(", ") || "-"),
            dataCell(comp.bedrooms != null ? String(comp.bedrooms) : "-", { align: AlignmentType.CENTER }),
            dataCell(fmtPrice(comp.price), { bold: true }),
            dataCell(sqft != null ? sqft.toLocaleString("en-GB") : "-", { align: AlignmentType.RIGHT }),
            dataCell(psf != null ? `£${psf.toLocaleString("en-GB")}` : "-", { align: AlignmentType.RIGHT }),
            dataCell(adjPsf != null ? `£${adjPsf.toLocaleString("en-GB")}` : "-", { align: AlignmentType.RIGHT, color: adjPsf != null ? "0070C9" : "999999" }),
          ];
          if (data.sizeElasticity > 0) {
            cells.push(dataCell(
              comp.sizeAdjPsf != null ? `£${Math.round(comp.sizeAdjPsf).toLocaleString("en-GB")}` : "-",
              { align: AlignmentType.RIGHT, color: comp.sizeAdjPsf != null ? PURPLE : "999999", bold: comp.sizeAdjPsf != null }
            ));
          }
          cells.push(dataCell(fmtDateShort(comp.transaction_date)));
          return stripeRow(cells, i);
        }),
      ],
    }));
  }

  // ── 6. Indicative Valuation Analysis ───────────────────────────────────
  children.push(sectionHeading("6. INDICATIVE VALUATION ANALYSIS"));

  if (data.comparables.length > 0) {
    // Summary metrics table
    const metricHeaders = ["Metric", "Minimum", "Maximum", "Average"];
    const metricRows: [string, string, string, string][] = [
      ["Transaction Price", fmtK(data.adoptedPriceMin), fmtK(data.adoptedPriceMax), fmtK(data.adoptedPriceAvg)],
    ];
    if (data.adoptedPsfMin != null) {
      metricRows.push(["Price per sq ft", fmtPsf(data.adoptedPsfMin), fmtPsf(data.adoptedPsfMax!), fmtPsf(data.adoptedPsfAvg!)]);
    }
    if (data.adjPsfMin != null && data.hpiCorrelation > 0) {
      metricRows.push([`Adj. £/sqft (HPI ${data.hpiCorrelation}%)`, fmtPsf(data.adjPsfMin), fmtPsf(data.adjPsfMax!), fmtPsf(data.adjPsfAvg!)]);
    }
    if (data.sizeAdjPsfMin != null && data.sizeElasticity > 0) {
      metricRows.push([`Size-Adj £/sqft (β=${data.sizeElasticity}%)`, fmtPsf(data.sizeAdjPsfMin), fmtPsf(data.sizeAdjPsfMax!), fmtPsf(data.sizeAdjPsfAvg!)]);
    }
    if (data.adoptedSizeMin != null) {
      metricRows.push(["Floor Area (m²)", `${Math.round(data.adoptedSizeMin)} m²`, `${Math.round(data.adoptedSizeMax!)} m²`, `${Math.round(data.adoptedSizeAvg!)} m²`]);
    }
    if (data.adoptedDateMin) {
      metricRows.push(["Transaction Date Range", fmtDateShort(data.adoptedDateMin), fmtDateShort(data.adoptedDateMax!), "-"]);
    }

    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: metricHeaders.map(h => headerCell(h)) }),
        ...metricRows.map(([metric, min, max, avg], i) =>
          stripeRow([labelCell(metric), dataCell(min), dataCell(max), dataCell(avg, { bold: true })], i)
        ),
      ],
    }));

    // Indicative value
    if (data.indicativeLow != null) {
      children.push(new Paragraph({ spacing: { before: 240 }, children: [] }));
      children.push(new Paragraph({
        children: [new TextRun({ text: "INDICATIVE MARKET VALUE", size: 18, font: "Calibri", color: BLUE, bold: true })],
        spacing: { after: 80 },
      }));
      if (data.subjectAreaM2 != null) {
        children.push(new Paragraph({
          children: [new TextRun({
            text: `Subject floor area: ${Math.round(data.subjectAreaM2)} m² / ${Math.round(data.subjectAreaM2 * 10.764).toLocaleString("en-GB")} sq ft`,
            size: 18, font: "Calibri", color: "6E6E73",
          })],
          spacing: { after: 60 },
        }));
      }
      children.push(new Paragraph({
        children: [new TextRun({
          text: `${fmtK(data.indicativeLow)} - ${fmtK(data.indicativeHigh!)}`,
          size: 40, font: "Calibri", bold: true, color: BLUE,
        })],
        spacing: { after: 40 },
      }));
      if (data.indicativeMid != null) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: "Mid-point: ", size: 20, font: "Calibri", color: "1D1D1F" }),
            new TextRun({ text: fmtK(data.indicativeMid), size: 20, font: "Calibri", bold: true, color: "1D1D1F" }),
          ],
          spacing: { after: 120 },
        }));
      }
    } else {
      children.push(new Paragraph({
        children: [new TextRun({
          text: data.subjectAreaM2 == null
            ? "Subject floor area not available - indicative valuation cannot be calculated."
            : "EPC floor area data not available on comparables - indicative valuation cannot be calculated.",
          size: 19, font: "Calibri", italics: true, color: "86868B",
        })],
      }));
    }

    // Disclaimer
    children.push(new Paragraph({
      children: [
        new TextRun({ text: "Disclaimer: ", size: 16, font: "Calibri", bold: true, color: "6E6E73" }),
        new TextRun({
          text: "This is a computer-generated indicative range based on adopted comparable evidence and is provided for guidance only. It does not constitute a formal opinion of value. A full inspection and valuation by a RICS Registered Valuer is required before any lending, purchase, or disposal decision is made. This output has not been prepared in accordance with RICS Valuation - Global Standards (Red Book) and must not be relied upon as such.",
          size: 16, font: "Calibri", color: "86868B",
        }),
      ],
      spacing: { before: 200, after: 80 },
    }));
  } else {
    children.push(new Paragraph({
      children: [new TextRun({ text: "No comparable evidence adopted.", size: 19, font: "Calibri", italics: true, color: "999999" })],
    }));
  }

  // ── Footer ─────────────────────────────────────────────────────────────
  children.push(new Paragraph({
    children: [new TextRun({
      text: `Generated by PropVal · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} · Data sourced from HMLR Price Paid Data, EPC Open Data, Environment Agency, Historic England NHLE, Natural England, BGS GeoSure, and planning.data.gov.uk. This report is for professional use only and does not constitute a formal RICS valuation.`,
      size: 16, font: "Calibri", color: "86868B",
    })],
    spacing: { before: 300 },
    border: { top: { style: BorderStyle.SINGLE, size: 1, color: "D2D2D7", space: 8 } },
  }));

  // ── Build document ─────────────────────────────────────────────────────
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1000, right: 1200, bottom: 1000, left: 1200 },
          pageNumbers: { start: 1 },
        },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: "PropVal Valuation Report", size: 14, font: "Calibri", color: "8E8E93" }),
              new TextRun({ text: "   |   Page ", size: 14, font: "Calibri", color: "8E8E93" }),
              new TextRun({ children: [PageNumber.CURRENT], size: 14, font: "Calibri", color: "8E8E93" }),
            ],
            alignment: AlignmentType.CENTER,
          })],
        }),
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  const today = new Date().toISOString().slice(0, 10);
  const filename = `${data.address} - PropVal Report ${today}.docx`;

  // Use File System Access API (Save As dialog with folder picker) if available
  if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
    try {
      const handle = await (window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: "Word Document",
          accept: { "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err: unknown) {
      // User cancelled the dialog — don't fall through to saveAs
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }

  // Fallback for browsers without File System Access API
  saveAs(blob, filename);
}
