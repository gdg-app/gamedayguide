export default async function handler(req, res) {
  try {
    const query = String((req.query && req.query.query) || "").trim();
    const lat = toFiniteNumber(req.query && req.query.lat);
    const lng = toFiniteNumber(req.query && req.query.lng);

    return res.status(200).json({
      ok: true,
      data: {
        venueName: query || (Number.isFinite(lat) && Number.isFinite(lng) ? "GPS Field Lookup" : "Unknown Venue"),
        parking: { status: "unknown", source: "placeholder" },
        restrooms: { status: "unknown", source: "placeholder" },
        concessions: { status: "unknown", source: "placeholder" },
        playground: { status: "unknown", source: "placeholder" }
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
