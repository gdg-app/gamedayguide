export default async function handler(req, res) {
  try {
    const apiKey = process.env.MAPS_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing MAPS_API_KEY" });

    const query = String((req.query && req.query.query) || "").trim();
    const radiusMilesRaw = Number((req.query && req.query.radiusMiles) || 5);
    const radiusMiles = Math.max(1, Math.min(25, Number.isFinite(radiusMilesRaw) ? radiusMilesRaw : 5));

    if (!query) return res.status(400).json({ error: "Missing query" });

    const loc = await geocodeQuery(query, apiKey);
    if (!loc) return res.status(200).json([]);

    const radiusMeters = Math.round(radiusMiles * 1609.34);
    const requests = buildRequests(loc, radiusMeters, apiKey);

    const settled = await Promise.all(
      requests.map(async function (request) {
        try {
          const data = await fetchJson(request.url);
          return { ok: true, request: request, data: data };
        } catch (error) {
          return { ok: false, request: request, error: String(error && error.message ? error.message : error) };
        }
      })
    );

    const rows = buildRowsFromSettled(settled, loc, radiusMiles);
    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).send("Build guide error: " + String(error && error.message ? error.message : error));
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error("Non-JSON response: " + text.slice(0, 200));
  }

  if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(data.error_message ? (data.status + " - " + data.error_message) : data.status);
  }

  return data;
}

async function geocodeQuery(query, apiKey) {
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?address=" +
    encodeURIComponent(query) +
    "&key=" + encodeURIComponent(apiKey);

  const data = await fetchJson(url);
  const first = data.results && data.results[0];
  if (!first || !first.geometry || !first.geometry.location) return null;

  return {
    lat: Number(first.geometry.location.lat),
    lng: Number(first.geometry.location.lng)
  };
}

function buildNearbyUrl(loc, radiusMeters, type, keyword, apiKey) {
  return (
    "https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=" +
    encodeURIComponent(loc.lat + "," + loc.lng) +
    "&radius=" + encodeURIComponent(radiusMeters) +
    (type ? "&type=" + encodeURIComponent(type) : "") +
    (keyword ? "&keyword=" + encodeURIComponent(keyword) : "") +
    "&key=" + encodeURIComponent(apiKey)
  );
}

function buildRequests(loc, radiusMeters, apiKey) {
  return [
    { category: "⛽ Gas", group: "standard", url: buildNearbyUrl(loc, radiusMeters, "gas_station", "", apiKey) },
    { category: "☕ Coffee", group: "standard", url: buildNearbyUrl(loc, radiusMeters, "cafe", "coffee", apiKey) },
    { category: "💊 Pharmacy", group: "standard", url: buildNearbyUrl(loc, radiusMeters, "pharmacy", "", apiKey) },
    { category: "🏥 Medical", group: "standard", url: buildNearbyUrl(loc, radiusMeters, "hospital", "", apiKey) },
    { category: "🏥 Medical", group: "standard", url: buildNearbyUrl(loc, radiusMeters, "doctor", "urgent care", apiKey) },
    { category: "🏥 Urgent Care / ER", group: "urgent", url: buildNearbyUrl(loc, radiusMeters, "doctor", "urgent care", apiKey) },
    { category: "🦷 Emergency Dentist", group: "dentist", url: buildNearbyUrl(loc, radiusMeters, "dentist", "emergency dentist", apiKey) },
    { category: "⚾ Sporting Goods", group: "sporting", url: buildNearbyUrl(loc, radiusMeters, "store", "sporting goods", apiKey) },
    { category: "🛒 Grocery", group: "grocery", url: buildNearbyUrl(loc, radiusMeters, "supermarket", "", apiKey) },
    { category: "🍔 Food", group: "food", url: buildNearbyUrl(loc, radiusMeters, "restaurant", "", apiKey) },
    { category: "🍔 Food", group: "food", url: buildNearbyUrl(loc, radiusMeters, "meal_takeaway", "", apiKey) },
    { category: "🍔 Food", group: "food", url: buildNearbyUrl(loc, radiusMeters, "restaurant", "fast food", apiKey) },
    { category: "🍔 Food", group: "food", url: buildNearbyUrl(loc, radiusMeters, "restaurant", "burger", apiKey) },
    { category: "🍔 Food", group: "food", url: buildNearbyUrl(loc, radiusMeters, "restaurant", "chicken", apiKey) }
  ];
}

function buildRowsFromSettled(settled, loc, radiusMiles) {
  let allRows = [];
  let urgentPlaces = [];
  let dentistPlaces = [];
  let sportingPlaces = [];
  let groceryPlaces = [];
  let foodPlaces = [];

  for (const item of settled) {
    if (!item.ok || !item.data) continue;

    const places = Array.isArray(item.data.results) ? item.data.results : [];
    const request = item.request;

    if (request.group === "urgent") {
      urgentPlaces = urgentPlaces.concat(places);
    } else if (request.group === "dentist") {
      dentistPlaces = dentistPlaces.concat(places);
    } else if (request.group === "sporting") {
      sportingPlaces = sportingPlaces.concat(places);
    } else if (request.group === "grocery") {
      groceryPlaces = groceryPlaces.concat(places);
    } else if (request.group === "food") {
      foodPlaces = foodPlaces.concat(places);
    } else {
      allRows = allRows.concat(parseStandardCategoryResponse(request.category, places, loc, radiusMiles, 12));
    }
  }

  allRows = allRows
    .concat(buildGenericSpecialRows("🏥 Urgent Care / ER", urgentPlaces, loc, radiusMiles, 12))
    .concat(buildGenericSpecialRows("🦷 Emergency Dentist", dentistPlaces, loc, radiusMiles, 12))
    .concat(buildGenericSpecialRows("⚾ Sporting Goods", sportingPlaces, loc, radiusMiles, 12))
    .concat(buildGenericSpecialRows("🛒 Grocery", groceryPlaces, loc, radiusMiles, 12))
    .concat(buildFoodRows(foodPlaces, loc, radiusMiles, 18));

  return sortRows(allRows);
}

function parseStandardCategoryResponse(category, places, loc, radiusMiles, limit) {
  const rows = [];
  for (const p of dedupePlaces(places)) {
    const row = buildRowFromPlace(category, p, loc, radiusMiles);
    if (row) rows.push(row);
  }
  rows.sort(compareRowsByDistanceThenRating);
  return rows.slice(0, limit);
}

function buildGenericSpecialRows(category, places, loc, radiusMiles, limit) {
  const rows = [];
  for (const p of dedupePlaces(places)) {
    const row = buildRowFromPlace(category, p, loc, radiusMiles);
    if (row) rows.push(row);
  }
  rows.sort(compareRowsByDistanceThenRating);
  return rows.slice(0, limit);
}

function buildFoodRows(places, loc, radiusMiles, limit) {
  const scored = [];

  for (const p of dedupePlaces(places)) {
    if (!textMatchesFood(p)) continue;
    const row = buildRowFromPlace("🍔 Food", p, loc, radiusMiles);
    if (!row) continue;

    scored.push({ row: row, score: getFoodRankingScore(p, loc) });
  }

  scored.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return compareRowsByDistanceThenRating(a.row, b.row);
  });

  return scored.slice(0, limit).map(function (item) { return item.row; });
}

function textMatchesFood(p) {
  const types = Array.isArray(p.types) ? p.types : [];
  const hay = [p.name || "", p.formatted_address || "", p.vicinity || "", types.join(" ")].join(" ").toLowerCase();

  if (types.includes("restaurant") || types.includes("meal_takeaway") || types.includes("meal_delivery")) {
    return true;
  }

  if (types.includes("gas_station") || types.includes("convenience_store")) return false;

  const includeWords = [
    "restaurant", "fast food", "burger", "pizza", "chicken", "sandwich", "subway", "mcdonald", "wendy",
    "chick-fil-a", "chick fil a", "cook out", "bojangles", "zaxby", "panera", "chipotle", "five guys"
  ];

  for (const word of includeWords) {
    if (hay.includes(word)) return true;
  }

  return false;
}

function getFoodRankingScore(p, loc) {
  const coords = getPlaceCoords(p);
  if (!coords) return -9999;

  const distance = haversineMiles(loc.lat, loc.lng, coords.lat, coords.lng);
  let score = 0;

  if (distance < 1) score += 50;
  else if (distance <= 3) score += 35;
  else if (distance <= 6) score += 20;
  else if (distance <= 10) score += 8;

  if (p.opening_hours && typeof p.opening_hours.open_now === "boolean") {
    if (p.opening_hours.open_now) score += 20;
    else score -= 30;
  }

  const rating = Number(p.rating || 0);
  if (rating >= 4.5) score += 16;
  else if (rating >= 4.0) score += 10;
  else if (rating >= 3.5) score += 5;

  if (textLooksLikeQuickFood([p.name || "", p.vicinity || ""].join(" "))) score += 35;

  return score;
}

function textLooksLikeQuickFood(text) {
  const hay = String(text || "").toLowerCase();
  const quickTerms = [
    "mcdonald", "wendy", "chick-fil-a", "chick fil a", "cook out", "bojangles", "zaxby", "subway",
    "chipotle", "panera", "five guys", "burger", "pizza", "sandwich", "chicken", "taco"
  ];

  for (const term of quickTerms) {
    if (hay.includes(term)) return true;
  }
  return false;
}

function buildRowFromPlace(category, p, loc, radiusMiles) {
  const coords = getPlaceCoords(p);
  if (!coords) return null;

  const dist = haversineMiles(loc.lat, loc.lng, coords.lat, coords.lng);
  if (dist > radiusMiles) return null;

  const openNow =
    p.opening_hours && typeof p.opening_hours.open_now === "boolean"
      ? (p.opening_hours.open_now ? "Open" : "Closed")
      : "";

  const address = p.formatted_address || p.vicinity || "";
  const link = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent((p.name || "") + " " + address);

  return [category, p.name || "", p.rating || "", address, openNow, link, dist];
}

function getPlaceCoords(p) {
  if (p && p.geometry && p.geometry.location && typeof p.geometry.location.lat === "number" && typeof p.geometry.location.lng === "number") {
    return { lat: Number(p.geometry.location.lat), lng: Number(p.geometry.location.lng) };
  }
  return null;
}

function dedupePlaces(places) {
  const seen = {};
  const deduped = [];

  for (const p of places || []) {
    const key = String(p.place_id || ((p.name || "") + "|" + (p.formatted_address || p.vicinity || ""))).toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    deduped.push(p);
  }

  return deduped;
}

function sortRows(rows) {
  const seen = {};
  const dedupedRows = [];

  for (const row of rows || []) {
    const key = (String(row[0] || "") + "|" + String(row[1] || "") + "|" + String(row[3] || "")).toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    dedupedRows.push(row);
  }

  dedupedRows.sort(compareRowsByDistanceThenRating);
  return dedupedRows;
}

function compareRowsByDistanceThenRating(a, b) {
  const da = typeof a[6] === "number" ? a[6] : 9999;
  const db = typeof b[6] === "number" ? b[6] : 9999;
  if (da !== db) return da - db;

  const ra = Number(a[2] || 0);
  const rb = Number(b[2] || 0);
  if (rb !== ra) return rb - ra;

  return String(a[1] || "").localeCompare(String(b[1] || ""));
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  function toRad(deg) { return deg * Math.PI / 180; }

  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}
