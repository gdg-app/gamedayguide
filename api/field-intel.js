export default async function handler(req, res) {
  try {
    const apiKey = process.env.MAPS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "Missing MAPS_API_KEY"
      });
    }

    const query = String((req.query && req.query.query) || "").trim();
    const lat = Number(req.query && req.query.lat);
    const lng = Number(req.query && req.query.lng);

    return res.status(200).json({
      ok: true,
      data: {
        venueName: query || "Test Venue",
        parking: { status: "unknown" },
        restrooms: { status: "unknown" },
        concessions: { status: "unknown" },
        playground: { status: "unknown" }
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
}
