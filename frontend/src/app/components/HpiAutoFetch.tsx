"use client";

import { useRef, useEffect } from "react";
import { API_BASE } from "@/lib/constants";
import type { PropertyResult } from "@/types/property";

/** Auto-fetch HPI when tab is opened and data is missing */
export default function HpiAutoFetch({ active, hpi, postcode, propertyType, builtForm, token, onHpi }: {
  active: boolean;
  hpi: unknown;
  postcode?: string | null;
  propertyType?: string | null;
  builtForm?: string | null;
  token?: string;
  onHpi: (hpi: NonNullable<PropertyResult["hpi"]>) => void;
}) {
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (!active || hpi || fetchedRef.current || !postcode || !token) return;
    fetchedRef.current = true;
    fetch(`${API_BASE}/api/property/hpi`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ postcode, property_type: propertyType, built_form: builtForm }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.hpi) onHpi(d.hpi); })
      .catch(() => {});
  }, [active, hpi, postcode, propertyType, builtForm, token, onHpi]);
  // Reset when postcode changes (new case loaded)
  useEffect(() => { fetchedRef.current = false; }, [postcode]);
  return null;
}
