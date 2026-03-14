// Shared type definitions extracted from page.tsx

export interface SaleRecord {
  date: string;
  price: number;
  tenure: string;
  property_type: string;
  new_build: boolean;
}

export interface ListedBuilding {
  list_entry: number | null;
  name: string;
  grade: string;
  url: string;
}

export interface ConservationArea {
  name: string;
  reference: string;
  designation_date: string;
  documentation_url: string;
}

export interface AncientWoodland {
  name: string;
  type: string;
}

export interface BrownfieldSite {
  name: string;
  hectares: string | null;
  ownership_status: string | null;
  planning_status: string | null;
  planning_type: string | null;
  planning_date: string | null;
  hazardous_substances: boolean;
}

export interface NearbyPlanningApp {
  lpa_name: string | null;
  site_name: string | null;
  decision_date: string | null;
  lpa_app_no: string | null;
  decision: string | null;
  application_type: string | null;
  application_type_full: string | null;
  postcode: string | null;
  description: string | null;
  street_name: string | null;
  status: string | null;
  valid_date: string | null;
  distance_m: number | null;
}

export interface PropertyResult {
  uprn: string | null;
  postcode: string | null;
  address: string;
  energy_rating: string | null;
  energy_score: number | null;
  epc_url: string | null;
  property_type: string | null;
  built_form: string | null;
  building_name: string | null;
  paon_number: string | null;
  saon: string | null;
  street_name: string | null;
  floor_area_m2: number | null;
  construction_age_band: string | null;
  num_rooms: number | null;
  heating_type: string | null;
  inspection_date: string | null;
  council_tax_band: string | null;
  lat: number | null;
  lon: number | null;
  coord_source: string | null;
  inspire_lat: number | null;
  inspire_lon: number | null;
  admin_district: string | null;
  region: string | null;
  lsoa: string | null;
  lsoa_code: string | null;
  rivers_sea_risk: string | null;
  surface_water_risk: string | null;
  planning_flood_zone: string | null;
  listed_buildings: ListedBuilding[];
  conservation_areas: ConservationArea[];
  sssi: string[];
  aonb: string | null;
  ancient_woodland: AncientWoodland[];
  green_belt: boolean;
  coal_mining_high_risk: boolean;
  coal_mining_in_coalfield: boolean;
  radon_risk: string | null;
  ground_shrink_swell: string | null;
  ground_landslides: string | null;
  ground_compressible: string | null;
  ground_collapsible: string | null;
  ground_running_sand: string | null;
  ground_soluble_rocks: string | null;
  brownfield: BrownfieldSite[];
  nearby_planning: NearbyPlanningApp[];
  nearby_planning_london_only: boolean;
  tenure: string | null;
  lease_commencement: string | null;
  lease_term_years: number | null;
  lease_expiry_date: string | null;
  sales: SaleRecord[];
  epc_matched: boolean;
  broadband: {
    max_download: number | null;
    max_upload: number | null;
    basic_download: number | null;
    basic_upload: number | null;
    superfast_download: number | null;
    superfast_upload: number | null;
    ultrafast_download: number | null;
    ultrafast_upload: number | null;
    uprn_matched: boolean;
  } | null;
  mobile: {
    operators: Record<string, {
      voice_outdoor: number | null;
      voice_indoor: number | null;
      data_outdoor: number | null;
      data_indoor: number | null;
    }>;
    uprn_matched: boolean;
  } | null;
  imd: {
    overall_rank: number | null;
    overall_decile: number | null;
    income_decile: number | null;
    employment_decile: number | null;
    education_decile: number | null;
    health_decile: number | null;
    crime_decile: number | null;
    housing_decile: number | null;
    environment_decile: number | null;
  } | null;
  hpi: {
    local_authority: string;
    data_month: string;
    avg_price: number | null;
    avg_price_type: number | null;
    annual_change_pct: number | null;
    monthly_change_pct: number | null;
    sales_volume: number | null;
    trend: HpiTrendSlice[];
  } | null;
}

export type CardSizeKey = "1x1" | "2x1" | "3x1" | "1x2";

export type TabKey = "property" | "comparables" | "wider" | "additional" | "adopted" | "report" | "hpi" | "map" | "report_typing" | "semv";

export type AdoptedSortKey = "default" | "date" | "size" | "price" | "psf";

export interface SavedCaseSummary {
  id: string;
  display_name: string | null;
  title: string;
  address: string;
  postcode: string | null;
  uprn: string | null;
  case_type: string;
  status: string;
  valuation_date: string | null;
  created_at: string;
  updated_at: string;
}

export type HpiValueKey = "hpi_all" | "hpi_flat" | "hpi_semi" | "hpi_detached" | "hpi_terraced";

export type HpiTrendSlice = {
  month: string;
  avg_price: number | null;
  avg_price_flat: number | null;
  avg_price_detached: number | null;
  avg_price_semi: number | null;
  avg_price_terraced: number | null;
  annual_change_pct: number | null;
  monthly_change_pct: number | null;
  annual_change_flat_pct: number | null;
  annual_change_detached_pct: number | null;
  annual_change_semi_pct: number | null;
  annual_change_terraced_pct: number | null;
  sales_volume: number | null;
  hpi_all: number | null;
  hpi_flat: number | null;
  hpi_semi: number | null;
  hpi_detached: number | null;
  hpi_terraced: number | null;
};
