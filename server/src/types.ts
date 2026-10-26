// Types mirror shared/schemas.md. Change the contract there first.

export type LocationType =
  | "market"
  | "hospital"
  | "bus_stand"
  | "school"
  | "commercial"
  | "residential"
  | "park";

export type BinClass = "must_visit" | "visit_if_nearby" | "skip";
export type BinColor = "green" | "amber" | "red" | "purple" | "grey";
export type BinStatus = "online" | "offline";
export type TruckKind = "primary_compactor" | "secondary_autotipper";
export type TruckStatus =
  | "idle"
  | "driving"
  | "servicing"
  | "to_dump_yard"
  | "unloading"
  | "returning";
export type AlertType = "overflow" | "hazard" | "low_battery" | "offline";
export type DistanceSource = "osrm" | "haversine_fallback";

export interface SensorReading {
  bin_id: string;
  fill_pct: number;
  lat: number;
  lng: number;
  battery: number;
  temp_c: number;
  gas_ppm: number;
  timestamp: string;
}

export type ZoneId =
  | "maharaj_bada"
  | "lashkar"
  | "city_centre"
  | "thatipur"
  | "morar"
  | "hazira";

/** Fields a sensor or the seed provides. */
export interface BinBase {
  bin_id: string;
  zone_id: ZoneId;
  location_type: LocationType;
  lat: number;
  lng: number;
  fill_pct: number;
  fill_rate_pct_per_hour: number;
  battery: number;
  temp_c: number;
  gas_ppm: number;
  complaint: boolean;
  status: BinStatus;
  last_seen: string;
  last_emptied: string;
}

/** Fields derived by the server (Phase 3). */
export interface BinDerived {
  hazard: boolean;
  urgent: boolean;
  predicted_overflow: boolean;
  hours_to_full: number;
  overflow_risk: number;
  priority: number;
  bin_class: BinClass;
  color: BinColor;
}

export type Bin = BinBase & BinDerived;

export interface ZoneBase {
  zone_id: ZoneId;
  name: string;
  /** [lng, lat] pairs, GeoJSON order, first point not repeated. APPROXIMATE. */
  polygon: [number, number][];
  /** Seed rate; the Frequency Planner replaces it from history. */
  fill_rate_pct_per_day: number;
}

export type IntervalLabel = "daily" | "every_2_days" | "every_3_days" | "twice_a_week";

export interface ZoneSchedule {
  days_to_85: number;
  /** 3.5 for twice_a_week (average); the calendar uses fixed weekdays. */
  interval_days: number;
  interval_label: IntervalLabel;
  last_collection_date: string;
  /** First calendar date on or after today. */
  next_collection_date: string;
  /** Collection dates for the next config.frequency.calendarDays days, today included. */
  calendar: string[];
}

export type Zone = ZoneBase & ZoneSchedule;

export interface Site {
  site_id: string;
  kind: "depot" | "dump_yard";
  name: string;
  lat: number;
  lng: number;
}

export interface Truck {
  truck_id: string;
  kind: TruckKind;
  capacity_kg: number;
  load_kg: number;
  lat: number;
  lng: number;
  heading_deg: number;
  status: TruckStatus;
  route_id: string | null;
  next_stop_bin_id: string | null;
}

export interface Alert {
  alert_id: string;
  type: AlertType;
  bin_id: string;
  message: string;
  timestamp: string;
}
