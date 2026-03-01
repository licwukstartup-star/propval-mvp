"use client";

import { useState } from "react";

interface PropertyResult {
  uprn: string | null;
  address: string;
  energy_rating: string | null;
  energy_score: number | null;
  property_type: string | null;
  built_form: string | null;
  floor_area_m2: number | null;
  construction_age_band: string | null;
  num_rooms: number | null;
  heating_type: string | null;
  inspection_date: string | null;
}

const RATING_COLOR: Record<string, string> = {
  A: "bg-green-600",
  B: "bg-green-500",
  C: "bg-lime-500",
  D: "bg-yellow-400",
  E: "bg-orange-400",
  F: "bg-orange-600",
  G: "bg-red-600",
};

export default function Home() {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PropertyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim()) return;

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const res = await fetch("http://localhost:8000/api/property/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? `Error ${res.status}`);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  const fields: [string, string | number | null][] = result
    ? [
        ["Energy score", result.energy_score],
        ["Property type", result.property_type],
        ["Built form", result.built_form],
        ["Floor area", result.floor_area_m2 != null ? `${result.floor_area_m2} m²` : null],
        ["Construction era", result.construction_age_band],
        ["Habitable rooms", result.num_rooms],
        ["Heating", result.heating_type],
        ["Inspection date", result.inspection_date],
      ]
    : [];

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center py-16 px-4">
      <div className="w-full max-w-xl">
        <h1 className="text-3xl font-bold text-gray-900 mb-1">PropVal</h1>
        <p className="text-sm text-gray-500 mb-8">
          Enter a UK address to look up EPC data
        </p>

        <form onSubmit={handleSearch} className="flex gap-2 mb-8">
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="e.g. 41 Gander Green Lane SM1 2EG"
            disabled={loading}
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          />
          <button
            type="submit"
            disabled={loading || !address.trim()}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </form>

        {loading && (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {result && (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-100">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Matched address</p>
                <p className="font-semibold text-gray-900">{result.address}</p>
                {result.uprn && (
                  <p className="text-xs text-gray-400 mt-0.5">UPRN: {result.uprn}</p>
                )}
              </div>
              {result.energy_rating && (
                <span
                  className={`shrink-0 flex items-center justify-center w-11 h-11 rounded-lg text-white font-bold text-xl ${RATING_COLOR[result.energy_rating] ?? "bg-gray-400"}`}
                >
                  {result.energy_rating}
                </span>
              )}
            </div>

            {/* Data grid */}
            <dl className="grid grid-cols-2 gap-px bg-gray-100">
              {fields
                .filter(([, v]) => v != null)
                .map(([label, value]) => (
                  <div key={label} className="bg-white px-4 py-3">
                    <dt className="text-xs text-gray-400">{label}</dt>
                    <dd className="mt-0.5 text-sm font-medium text-gray-900">
                      {String(value)}
                    </dd>
                  </div>
                ))}
            </dl>
          </div>
        )}
      </div>
    </main>
  );
}
