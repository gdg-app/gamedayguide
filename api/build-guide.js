export default async function handler(req, res) {
  try {
    const query = String((req.query && req.query.query) || "").trim();

    if (!query) {
      return res.status(400).json({
        ok: false,
        error: "Missing search query"
      });
    }

    const apiKey = process.env.MAPS_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "Missing MAPS_API_KEY"
      });
    }

    // Step 1: Geocode the location
    const geoUrl =
      "https://maps.googleapis.com/maps/api/geocode/json?address=" +
      encodeURIComponent(query) +
      "&key=" + apiKey;

    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();

    if (!geoData.results || !geoData.results.length) {
      return res.status(400).json({
        ok: false,
        error: "Location not found"
      });
    }

    const loc = geoData.results[0].geometry.location;

    // Step 2: Search nearby places (simple version for now)
    const placesUrl =
      "https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=" +
      loc.lat + "," + loc.lng +
      "&radius=5000&type=restaurant&key=" + apiKey;

    const placesRes = await fetch(placesUrl);
    const placesData = await placesRes.json();

    const results = (placesData.results || []).map(p => ({
      name: p.name,
      address: p.vicinity,
      rating: p.rating || "",
      location: p.geometry?.location || null
    }));

    return res.status(200).json({
      ok: true,
      data: results
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
}
