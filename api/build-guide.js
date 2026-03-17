export default async function handler(req, res) {
  try {
    const apiKey = process.env.MAPS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing MAPS_API_KEY" });
    }

    const query = String(req.query.query || "").trim();
    const radiusMilesRaw = Number(req.query.radiusMiles || 5);
    const radiusMiles = clampNumber(isFinite(radiusMilesRaw) ? radiusMilesRaw : 5, 1, 25);

    if (!query) {
      return res.status(400).json({ error: "Missing query" });
    }

    const loc = await geocode(query, apiKey);
    if (!loc) {
      return res.status(200).json([]);
    }

    const radiusMeters = Math.round(radiusMiles * 1609.34);
    const requests = buildAllRequests(loc, radiusMeters, apiKey);

    const responses = await Promise.all(
      requests.map(async (request) => {
        try {
          const data = await fetchJson(request.url);
          return { request, data };
        } catch (error) {
          return { request, error: String(error && error.message ? error.message : error) };
        }
      })
    );

    const rows = buildRowsFromResponses(responses, loc, radiusMiles);
    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).send(
      "Build guide error: " + String(error && error.message ? error.message : error)
    );
  }
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error("Non-JSON response from Google: " + text.slice(0, 200));
  }

  if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(
      data.error_message ? `${data.status} - ${data.error_message}` : data.status
    );
  }

  return data;
}

async function geocode(query, apiKey) {
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
    loc.lat + "," + loc.lng +
    "&radius=" + radiusMeters +
    (type ? "&type=" + encodeURIComponent(type) : "") +
    (keyword ? "&keyword=" + encodeURIComponent(keyword) : "") +
    "&key=" + encodeURIComponent(apiKey)
  );
}

function buildAllRequests(loc, radiusMeters, apiKey) {
  return [
    // Closest stops / general categories
    { category: "⛽ Gas", url: buildNearbyUrl(loc, radiusMeters, "gas_station", "", apiKey) },
    { category: "☕ Coffee", url: buildNearbyUrl(loc, radiusMeters, "cafe", "coffee", apiKey) },
    { category: "💊 Pharmacy", url: buildNearbyUrl(loc, radiusMeters, "pharmacy", "", apiKey) },
    { category: "🏥 Medical", url: buildNearbyUrl(loc, radiusMeters, "hospital", "", apiKey) },
    { category: "🏥 Medical", url: buildNearbyUrl(loc, radiusMeters, "doctor", "urgent care", apiKey) },

    // Special medical
    { category: "🏥 Urgent Care / ER", specialType: "urgent", url: buildNearbyUrl(loc, radiusMeters, "hospital", "urgent care", apiKey) },
    { category: "🏥 Urgent Care / ER", specialType: "urgent", url: buildNearbyUrl(loc, radiusMeters, "hospital", "emergency room", apiKey) },
    { category: "🏥 Urgent Care / ER", specialType: "urgent", url: buildNearbyUrl(loc, radiusMeters, "doctor", "urgent care", apiKey) },

    { category: "🦷 Emergency Dentist", specialType: "dentist", url: buildNearbyUrl(loc, radiusMeters, "dentist", "emergency dentist", apiKey) },
    { category: "🦷 Emergency Dentist", specialType: "dentist", url: buildNearbyUrl(loc, radiusMeters, "dentist", "", apiKey) },

    // Sporting goods
    { category: "⚾ Sporting Goods", specialType: "sporting", url: buildNearbyUrl(loc, radiusMeters, "store", "sporting goods", apiKey) },
    { category: "⚾ Sporting Goods", specialType: "sporting", url: buildNearbyUrl(loc, radiusMeters, "store", "sports equipment", apiKey) },
    { category: "⚾ Sporting Goods", specialType: "sporting", url: buildNearbyUrl(loc, radiusMeters, "store", "Dick's Sporting Goods", apiKey) },
    { category: "⚾ Sporting Goods", specialType: "sporting", url: buildNearbyUrl(loc, radiusMeters, "store", "Academy Sports", apiKey) },

    // Grocery
    { category: "🛒 Grocery", specialType: "grocery", url: buildNearbyUrl(loc, radiusMeters, "supermarket", "", apiKey) },
    { category: "🛒 Grocery", specialType: "grocery", url: buildNearbyUrl(loc, radiusMeters, "store", "grocery", apiKey) },

    // Food
    { category: "🍔 Food", specialType: "food", url: buildNearbyUrl(loc, radiusMeters, "restaurant", "", apiKey) },
    { category: "🍔 Food", specialType: "food", url: buildNearbyUrl(loc, radiusMeters, "meal_takeaway", "", apiKey) },
    { category: "🍔 Food", specialType: "food", url: buildNearbyUrl(loc, radiusMeters, "restaurant", "fast food", apiKey) },
    { category: "🍔 Food", specialType: "food", url: buildNearbyUrl(loc, radiusMeters, "restaurant", "burger", apiKey) },
    { category: "🍔 Food", specialType: "food", url: buildNearbyUrl(loc, radiusMeters, "restaurant", "fried chicken", apiKey) },
    { category: "🍔 Food", specialType: "food", url: buildNearbyUrl(loc, radiusMeters, "restaurant", "sandwich", apiKey) },
    { category: "🍔 Food", specialType: "food", url: buildNearbyUrl(loc, radiusMeters, "restaurant", "pizza", apiKey) },
    { category: "🍔 Food", specialType: "food", url: buildNearbyUrl(loc, radiusMeters, "restaurant", "McDonald's", apiKey) },
    { category: "🍔 Food", specialType: "food", url: buildNearbyUrl(loc, radiusMeters, "restaurant", "Wendy's", apiKey) },
    { category: "🍔 Food", specialType: "food", url: buildNearbyUrl(loc, radiusMeters, "restaurant", "Chick-fil-A", apiKey) },
    { category: "🍔 Food", specialType: "food", url: buildNearbyUrl(loc, radiusMeters, "restaurant", "Cook Out", apiKey) },
    { category: "🍔 Food", specialType: "food", url: buildNearbyUrl(loc, radiusMeters, "restaurant", "Bojangles", apiKey) },
    { category: "🍔 Food", specialType: "food", url: buildNearbyUrl(loc, radiusMeters, "restaurant", "Subway", apiKey) },
    { category: "🍔 Food", specialType: "food", url: buildNearbyUrl(loc, radiusMeters, "restaurant", "Chipotle", apiKey) },
    { category: "🍔 Food", specialType: "food", url: buildNearbyUrl(loc, radiusMeters, "restaurant", "Panera", apiKey) }
  ];
}

function buildRowsFromResponses(responses, loc, radiusMiles) {
  let allRows = [];
  let urgentPlaces = [];
  let dentistPlaces = [];
  let sportingPlaces = [];
  let groceryPlaces = [];
  let foodPlaces = [];

  for (const item of responses) {
    if (!item || item.error || !item.data) continue;

    const request = item.request;
    const places = (item.data.results || []);

    if (request.specialType === "urgent") {
      urgentPlaces = urgentPlaces.concat(places);
    } else if (request.specialType === "dentist") {
      dentistPlaces = dentistPlaces.concat(places);
    } else if (request.specialType === "sporting") {
      sportingPlaces = sportingPlaces.concat(places);
    } else if (request.specialType === "grocery") {
      groceryPlaces = groceryPlaces.concat(places);
    } else if (request.specialType === "food") {
      foodPlaces = foodPlaces.concat(places);
    } else {
      const rows = parseStandardCategoryResponse(request.category, places, loc, radiusMiles, 8);
      allRows = allRows.concat(rows);
    }
  }

  const urgentRows = buildSpecialCategoryRows("🏥 Urgent Care / ER", urgentPlaces, loc, radiusMiles, 12);
  const dentistRows = buildSpecialCategoryRows("🦷 Emergency Dentist", dentistPlaces, loc, radiusMiles, 10);
  const sportingRows = buildSpecialCategoryRows("⚾ Sporting Goods", sportingPlaces, loc, radiusMiles, 10);
  const groceryRows = buildSpecialCategoryRows("🛒 Grocery", groceryPlaces, loc, radiusMiles, 10);
  const foodRows = buildSpecialCategoryRows("🍔 Food", foodPlaces, loc, radiusMiles, 15);

  allRows = allRows
    .concat(urgentRows)
    .concat(dentistRows)
    .concat(sportingRows)
    .concat(groceryRows)
    .concat(foodRows);

  return sortRows(allRows);
}

function parseStandardCategoryResponse(category, places, loc, radiusMiles, limit) {
  const deduped = dedupePlaces(places);
  const rows = [];

  for (const p of deduped) {
    const row = buildRowFromPlace(category, p, loc, radiusMiles);
    if (!row) continue;
    rows.push(row);
  }

  rows.sort(compareRowsByDistanceThenRating);
  return rows.slice(0, limit);
}

function buildSpecialCategoryRows(category, places, loc, radiusMiles, limit) {
  const deduped = dedupePlaces(places);

  if (category === "🍔 Food") {
    return buildFoodRows(deduped, loc, radiusMiles, limit);
  }

  const rows = [];
  for (const p of deduped) {
    const row = buildRowFromPlace(category, p, loc, radiusMiles);
    if (!row) continue;
    rows.push(row);
  }

  rows.sort(compareRowsByDistanceThenRating);
  return rows.slice(0, limit);
}

function buildFoodRows(places, loc, radiusMiles, limit) {
  const deduped = dedupePlaces(places);
  const scored = [];

  for (const p of deduped) {
    if (!textMatchesFood(p)) continue;

    const row = buildRowFromPlace("🍔 Food", p, loc, radiusMiles);
    if (!row) continue;

    scored.push({
      row,
      score: getFoodRankingScore(p, loc)
    });
  }

  scored.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;

    const da = typeof a.row[6] === "number" ? a.row[6] : 9999;
    const db = typeof b.row[6] === "number" ? b.row[6] : 9999;
    if (da !== db) return da - db;

    const ra = Number(a.row[2] || 0);
    const rb = Number(b.row[2] || 0);
    if (rb !== ra) return rb - ra;

    return String(a.row[1] || "").localeCompare(String(b.row[1] || ""));
  });

  return scored.slice(0, limit).map((item) => item.row);
}

function textMatchesFood(p) {
  const hay = [
    p.name || "",
    p.formatted_address || "",
    p.vicinity || "",
    Array.isArray(p.types) ? p.types.join(" ") : ""
  ].join(" ").toLowerCase();

  const types = Array.isArray(p.types) ? p.types : [];

  if (
    types.includes("restaurant") ||
    types.includes("meal_takeaway") ||
    types.includes("meal_delivery") ||
    types.includes("fast_food_restaurant")
  ) {
    return true;
  }

  if (types.includes("gas_station") || types.includes("convenience_store")) return false;

  const excludeWords = [
    "gas station",
    "fuel",
    "convenience store",
    "mini mart",
    "travel center",
    "travel centre",
    "truck stop",
    "hotel",
    "motel",
    "pharmacy",
    "urgent care",
    "dentist",
    "bank",
    "atm"
  ];

  for (const word of excludeWords) {
    if (hay.includes(word)) return false;
  }

  const includeWords = [
    "restaurant",
    "grill",
    "pizza",
    "burger",
    "burgers",
    "sandwich",
    "subs",
    "sub",
    "burrito",
    "taco",
    "tacos",
    "bbq",
    "barbecue",
    "chicken",
    "wings",
    "deli",
    "fast food",
    "takeout",
    "take-away",
    "take away",
    "takeaway",
    "panera",
    "chipotle",
    "chick-fil-a",
    "chick fil a",
    "mcdonald",
    "mcdonalds",
    "wendy",
    "five guys",
    "cook out",
    "cookout",
    "bojangles",
    "zaxby",
    "subway",
    "jersey mike",
    "jimmy john",
    "firehouse",
    "qdoba",
    "moes",
    "moe's",
    "panda express",
    "raising cane",
    "shake shack",
    "whataburger",
    "sonic",
    "culver",
    "panera bread",
    "arbys",
    "arby's",
    "hardee",
    "hardee's",
    "jack in the box",
    "dairy queen",
    "little caesars",
    "dominos",
    "domino's",
    "pizza hut",
    "kfc"
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

  if (distance < 1) score += 45;
  else if (distance <= 2) score += 35;
  else if (distance <= 5) score += 20;
  else if (distance <= 10) score += 8;

  if (p.opening_hours && typeof p.opening_hours.open_now === "boolean") {
    if (p.opening_hours.open_now) score += 20;
    else score -= 60;
  }

  const rating = Number(p.rating || 0);
  if (rating >= 4.5) score += 16;
  else if (rating >= 4.0) score += 11;
  else if (rating >= 3.5) score += 6;

  const textBlob = [
    p.name || "",
    p.formatted_address || "",
    p.vicinity || "",
    Array.isArray(p.types) ? p.types.join(" ") : ""
  ].join(" ");

  if (textLooksLikeQuickFood(textBlob)) score += 30;

  return score;
}

function textLooksLikeQuickFood(text) {
  const hay = String(text || "").toLowerCase();

  const quickTerms = [
    "grill",
    "deli",
    "cafe",
    "café",
    "pizza",
    "bbq",
    "barbecue",
    "chicken",
    "taco",
    "tacos",
    "burrito",
    "sandwich",
    "subs",
    "wings",
    "burger",
    "burgers",
    "panera",
    "chipotle",
    "chick-fil-a",
    "chick fil a",
    "jersey mike",
    "jimmy john",
    "firehouse",
    "five guys",
    "qdoba",
    "moes",
    "moe's",
    "zaxby",
    "raising cane",
    "raising cane's",
    "shake shack",
    "cook out",
    "cookout",
    "whataburger",
    "wendy",
    "mcdonald",
    "mcdonalds",
    "sonic",
    "culver",
    "tropical smoothie",
    "panda express",
    "subway",
    "arbys",
    "arby's",
    "bojangles",
    "hardee",
    "hardee's",
    "krystal",
    "del taco",
    "jack in the box",
    "dairy queen",
    "dq",
    "little caesars",
    "dominos",
    "domino's",
    "pizza hut",
    "kfc"
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
  if (typeof dist === "number" && dist > radiusMiles) return null;

  const openNow =
    p.opening_hours && typeof p.opening_hours.open_now === "boolean"
      ? (p.opening_hours.open_now ? "Open" : "Closed")
      : "";

  const address = p.formatted_address || p.vicinity || "";
  const link =
    "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent((p.name || "") + " " + address);

  return [
    category,
    p.name || "",
    p.rating || "",
    address,
    openNow,
    link,
    dist
  ];
}

function getPlaceCoords(p) {
  if (
    p &&
    p.geometry &&
    p.geometry.location &&
    typeof p.geometry.location.lat === "number" &&
    typeof p.geometry.location.lng === "number"
  ) {
    return {
      lat: p.geometry.location.lat,
      lng: p.geometry.location.lng
    };
  }
  return null;
}

function dedupePlaces(places) {
  const seen = {};
  const deduped = [];

  for (const p of places || []) {
    const key = (
      p.place_id ||
      ((p.name || "") + "|" + (p.formatted_address || p.vicinity || ""))
    ).toLowerCase();

    if (seen[key]) continue;
    seen[key] = true;
    deduped.push(p);
  }

  return deduped;
}

function sortRows(rows) {
  const deduped = [];
  const seen = {};

  for (const row of rows || []) {
    const key = (String(row[0] || "") + "|" + String(row[1] || "") + "|" + String(row[3] || "")).toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    deduped.push(row);
  }

  deduped.sort(compareRowsByDistanceThenRating);
  return deduped;
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
  const toRad = (deg) => deg * Math.PI / 180;
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
