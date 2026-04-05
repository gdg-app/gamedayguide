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
    const lat = toFiniteNumber(req.query && req.query.lat);
    const lng = toFiniteNumber(req.query && req.query.lng);

    let venue = null;

    if (query) {
      venue = await findVenueFromQuery(query, apiKey);
    } else if (isValidLatLng(lat, lng)) {
      venue = await findVenueFromGps(lat, lng, apiKey);
    } else {
      return res.status(400).json({
        ok: false,
        error: "Missing query or lat/lng"
      });
    }

    if (!venue || !venue.placeId) {
      return res.status(200).json({
        ok: true,
        data: {
          venueName: venue ? venue.name : (query || "Unknown Venue"),
          venueAddress: venue ? venue.address : "",
          placeId: venue ? venue.placeId : "",
          source: venue ? venue.source : "none",
          parking: { status: "unknown", source: "none" },
          restrooms: { status: "unknown", source: "none" },
          concessions: { status: "unknown", source: "none" },
          playground: { status: "unknown", source: "none" }
        }
      });
    }

    const details = await fetchVenueDetails(venue.placeId, apiKey);
    const venueLat =
      details &&
      details.geometry &&
      details.geometry.location &&
      typeof details.geometry.location.lat === "number"
        ? Number(details.geometry.location.lat)
        : venue.lat;
    const venueLng =
      details &&
      details.geometry &&
      details.geometry.location &&
      typeof details.geometry.location.lng === "number"
        ? Number(details.geometry.location.lng)
        : venue.lng;

    const intel = await buildFieldIntel({
      venue: Object.assign({}, venue, {
        lat: venueLat,
        lng: venueLng
      }),
      details,
      apiKey
    });

    return res.status(200).json({
      ok: true,
      data: {
        venueName: details.name || venue.name || (query || "Unknown Venue"),
        venueAddress: details.formatted_address || venue.address || "",
        placeId: venue.placeId || "",
        source: venue.source || "none",
        parking: intel.parking,
        restrooms: intel.restrooms,
        concessions: intel.concessions,
        playground: intel.playground
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

function isValidLatLng(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSportsPriorityTerms() {
  return [
    "baseball", "ballpark", "ball park", "athletic park", "athletic complex",
    "sports complex", "baseball complex", "stadium", "field", "fields",
    "park", "tournament", "diamond", "high school", "middle school",
    "junior high", "school", "athletics", "athletic campus", "campus",
    "sportsplex", "training complex", "rec park", "recreation park"
  ];
}

function looksLikeSportsFacilityText(value) {
  const hay = normalizeSearchText(value);
  if (!hay) return false;

  const includeTerms = getSportsPriorityTerms();
  const excludeTerms = [
    "apartment", "apartments", "hotel", "restaurant", "bar", "brewery", "coffee",
    "urgent care", "pharmacy", "grocery", "gas station", "church", "school bus",
    "storage", "self storage", "bank"
  ];

  for (const term of excludeTerms) {
    if (hay.includes(term)) return false;
  }

  for (const term of includeTerms) {
    if (hay.includes(term)) return true;
  }

  return false;
}

function buildSchoolExpandedQueries(query) {
  const q = String(query || "").trim();
  const qNorm = normalizeSearchText(q);
  const candidates = [];
  const seen = new Set();

  function addCandidate(text) {
    text = String(text || "").trim();
    if (!text) return;
    const key = normalizeSearchText(text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push(text);
  }

  addCandidate(q);
  addCandidate(q + " baseball field");
  addCandidate(q + " athletic park");
  addCandidate(q + " sports complex");
  addCandidate(q + " stadium");

  if (!qNorm.includes("high school") && /\bhigh\b/.test(qNorm)) {
    addCandidate(q + " school");
    addCandidate(q + " high school");
    addCandidate(q + " high school baseball field");
  }

  if (!qNorm.includes("middle school") && /\bmiddle\b/.test(qNorm)) {
    addCandidate(q + " school");
    addCandidate(q + " middle school");
    addCandidate(q + " middle school baseball field");
  }

  return candidates.slice(0, 8);
}

function scoreSuggestionText(text, mode) {
  const hay = normalizeSearchText(text);
  let score = 0;

  const strongTerms = [
    "baseball", "ballpark", "sports complex", "athletic complex", "stadium", "training complex"
  ];

  const mediumTerms = [
    "field", "fields", "park", "school", "campus", "diamond"
  ];

  for (const term of strongTerms) {
    if (hay.includes(term)) score += 25;
  }

  for (const term of mediumTerms) {
    if (hay.includes(term)) score += 10;
  }

  if (mode === "nearby") score += 8;
  if (mode === "text") score += 6;
  if (mode === "autocomplete") score += 4;

  return score;
}

function dedupeCandidates(items) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const key =
      String(item.placeId || "").trim() ||
      normalizeSearchText((item.name || "") + " " + (item.address || ""));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function rankVenueCandidates(items, originalQuery) {
  const qNorm = normalizeSearchText(originalQuery);
  const ranked = items.map(function(item) {
    const combined = normalizeSearchText(
      [item.name || "", item.address || ""].join(" ")
    );

    let score = Number(item.score || 0);

    if (combined === qNorm) score += 1000;
    else if (combined.startsWith(qNorm)) score += 250;
    else if (combined.includes(qNorm)) score += 140;

    if (looksLikeSportsFacilityText(item.name || "")) score += 180;
    if (looksLikeSportsFacilityText(item.address || "")) score += 40;

    return Object.assign({}, item, { rankScore: score });
  });

  ranked.sort(function(a, b) {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  return ranked;
}

async function findVenueFromQuery(query, apiKey) {
  const queries = buildSchoolExpandedQueries(query);
  let candidates = [];

  for (const expandedQuery of queries) {
    const textCandidates = await searchTextCandidates(expandedQuery, apiKey);
    candidates = candidates.concat(textCandidates);
  }

  const deduped = dedupeCandidates(candidates);
  const ranked = rankVenueCandidates(deduped, query);

  if (ranked.length) return ranked[0];

  const geo = await geocode(query, apiKey);
  if (geo) {
    return await findVenueFromGps(geo.lat, geo.lng, apiKey);
  }

  return null;
}

async function findVenueFromGps(lat, lng, apiKey) {
  const radiusMeters = 250;
  const nearby = await nearbyVenueCandidates(lat, lng, radiusMeters, apiKey);

  if (!nearby.length) {
    return null;
  }

  nearby.sort(function(a, b) {
    if (a.distanceMeters !== b.distanceMeters) {
      return a.distanceMeters - b.distanceMeters;
    }
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  return nearby[0];
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error("Non-JSON response: " + text.slice(0, 300));
  }

  return data;
}

async function geocode(query, apiKey) {
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?address=" +
    encodeURIComponent(query) +
    "&key=" +
    encodeURIComponent(apiKey);

  const data = await fetchJson(url);

  if (data.status === "OK" && data.results && data.results.length) {
    const first = data.results[0];
    if (first.geometry && first.geometry.location) {
      return {
        lat: Number(first.geometry.location.lat),
        lng: Number(first.geometry.location.lng)
      };
    }
  }

  if (data.status === "ZERO_RESULTS") return null;

  throw new Error(
    "Geocode failed: " +
      data.status +
      (data.error_message ? " - " + data.error_message : "")
  );
}

async function searchTextCandidates(query, apiKey) {
  const url =
    "https://maps.googleapis.com/maps/api/place/textsearch/json?query=" +
    encodeURIComponent(query) +
    "&key=" +
    encodeURIComponent(apiKey);

  const data = await fetchJson(url);

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(
      "Text search failed: " +
        data.status +
        (data.error_message ? " - " + data.error_message : "")
    );
  }

  const results = Array.isArray(data.results) ? data.results : [];
  const out = [];

  for (const place of results) {
    const name = String(place.name || "").trim();
    const address = String(place.formatted_address || place.vicinity || "").trim();
    const combined = [name, address].join(" ");

    if (!looksLikeSportsFacilityText(combined)) continue;

    out.push({
      name,
      address,
      placeId: String(place.place_id || "").trim(),
      source: "text",
      score: scoreSuggestionText(combined, "text")
    });
  }

  return out;
}

async function nearbyVenueCandidates(lat, lng, radiusMeters, apiKey) {
  const sportsKeywords = [
    "sports complex",
    "baseball field",
    "ballpark",
    "stadium",
    "athletic park"
  ];

  let out = [];

  for (const keyword of sportsKeywords) {
    const url =
      "https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=" +
      lat + "," + lng +
      "&radius=" + radiusMeters +
      "&keyword=" + encodeURIComponent(keyword) +
      "&key=" + encodeURIComponent(apiKey);

    const data = await fetchJson(url);

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      throw new Error(
        "Nearby search failed: " +
          data.status +
          (data.error_message ? " - " + data.error_message : "")
      );
    }

    const results = Array.isArray(data.results) ? data.results : [];
    for (const place of results) {
      const name = String(place.name || "").trim();
      const address = String(place.vicinity || place.formatted_address || "").trim();
      const combined = [name, address].join(" ");

      if (!looksLikeSportsFacilityText(combined)) continue;
      if (!place.geometry || !place.geometry.location) continue;

      const distanceMeters = haversineMeters(
        lat,
        lng,
        Number(place.geometry.location.lat),
        Number(place.geometry.location.lng)
      );

      out.push({
        name,
        address,
        placeId: String(place.place_id || "").trim(),
        source: "nearby",
        score: scoreSuggestionText(combined, "nearby"),
        distanceMeters,
        lat: Number(place.geometry.location.lat),
        lng: Number(place.geometry.location.lng)
      });
    }
  }

  return dedupeCandidates(out);
}

async function fetchVenueDetails(placeId, apiKey) {
  const url =
    "https://maps.googleapis.com/maps/api/place/details/json?place_id=" +
    encodeURIComponent(placeId) +
    "&fields=name,formatted_address,place_id,geometry,types,reviews,editorial_summary" +
    "&reviews_no_translations=true" +
    "&key=" +
    encodeURIComponent(apiKey);

  const data = await fetchJson(url);

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(
      "Place details failed: " +
        data.status +
        (data.error_message ? " - " + data.error_message : "")
    );
  }

  return data.result || {};
}

async function buildFieldIntel(context) {
  const venue = context.venue || {};
  const details = context.details || {};
  const apiKey = context.apiKey;

  const corpus = buildVenueCorpus(details);
  const profile = buildVenueProfile(venue, details);
  const intel = {
    parking: { status: "unknown", source: "none" },
    restrooms: { status: "unknown", source: "none" },
    concessions: { status: "unknown", source: "none" },
    playground: { status: "unknown", source: "none" }
  };

  if (isValidLatLng(venue.lat, venue.lng)) {
    const nearestPlayground = await findNearestNearbyAmenity({
      lat: venue.lat,
      lng: venue.lng,
      apiKey,
      keyword: "playground",
      radiusMeters: 800,
      validator: isValidPlaygroundAmenity
    });

    if (nearestPlayground) {
      intel.playground = {
        status: "nearby",
        source: "nearby",
        name: nearestPlayground.name,
        distanceMiles: roundMiles(nearestPlayground.distanceMeters / 1609.344)
      };
    }

    const nearbyParking = await findNearestNearbyAmenity({
      lat: venue.lat,
      lng: venue.lng,
      apiKey,
      keyword: "parking",
      radiusMeters: 300,
      validator: isValidParkingAmenity
    });

    if (nearbyParking) {
      intel.parking = {
        status: "available",
        source: "nearby",
        name: nearbyParking.name
      };
    }
  }

  if (intel.parking.status === "unknown" && textHasAny(corpus, [
    "parking", "park lot", "parking lot", "easy parking", "plenty of parking"
  ])) {
    intel.parking = {
      status: "mentioned",
      source: "reviews"
    };
  }

  if (textHasAny(corpus, [
    "restroom", "restrooms", "bathroom", "bathrooms", "portable toilet", "porta potty", "porta-potty"
  ])) {
    intel.restrooms = {
      status: "mentioned",
      source: "reviews"
    };
  }

  if (textHasAny(corpus, [
    "concession", "concessions", "snack bar", "snack stand", "food stand"
  ])) {
    intel.concessions = {
      status: "mentioned",
      source: "reviews"
    };
  }

  applyHeuristicFallbacks(intel, profile);

  return intel;
}

function buildVenueCorpus(details) {
  const bits = [];

  if (details.name) bits.push(String(details.name));
  if (details.formatted_address) bits.push(String(details.formatted_address));

  if (
    details.editorial_summary &&
    typeof details.editorial_summary.overview === "string"
  ) {
    bits.push(details.editorial_summary.overview);
  }

  if (Array.isArray(details.reviews)) {
    for (const review of details.reviews.slice(0, 5)) {
      if (review && typeof review.text === "string") {
        bits.push(review.text);
      }
    }
  }

  return normalizeSearchText(bits.join(" "));
}

function buildVenueProfile(venue, details) {
  const name = String((details && details.name) || (venue && venue.name) || "").trim();
  const address = String((details && details.formatted_address) || (venue && venue.address) || "").trim();
  const combined = normalizeSearchText([name, address].join(" "));
  const types = Array.isArray(details && details.types) ? details.types.map(normalizeSearchText) : [];
  const joinedTypes = types.join(" ");

  const hasAny = function(terms) {
    return terms.some(function(term) {
      const norm = normalizeSearchText(term);
      return combined.includes(norm) || joinedTypes.includes(norm);
    });
  };

  const isSportsVenue = looksLikeSportsFacilityText([name, address, joinedTypes].join(" "));
  const isSchoolVenue = hasAny(["school", "high school", "middle school", "junior high", "campus"]);
  const isBaseballVenue = hasAny(["baseball", "ballpark", "diamond", "stadium", "training complex"]);
  const isParkVenue = hasAny(["park", "athletic park", "recreation park", "sports complex", "athletic complex", "sportsplex"]);

  return {
    name,
    address,
    isSportsVenue,
    isSchoolVenue,
    isBaseballVenue,
    isParkVenue,
    strongConcessionsLikelihood: isBaseballVenue || hasAny(["tournament", "sports complex", "athletic complex", "stadium", "training complex"])
  };
}

function applyHeuristicFallbacks(intel, profile) {
  if (!profile || !profile.isSportsVenue) return;

  if (intel.parking.status === "unknown") {
    intel.parking = {
      status: "available",
      source: "heuristic"
    };
  }

  if (intel.restrooms.status === "unknown" && (profile.isSchoolVenue || profile.isParkVenue || profile.isBaseballVenue)) {
    intel.restrooms = {
      status: "mentioned",
      source: "heuristic"
    };
  }

  if (intel.concessions.status === "unknown" && (profile.strongConcessionsLikelihood || profile.isSchoolVenue || profile.isParkVenue)) {
    intel.concessions = {
      status: "mentioned",
      source: "heuristic"
    };
  }
}

function textHasAny(haystack, terms) {
  const text = normalizeSearchText(haystack);
  if (!text) return false;

  for (const term of terms) {
    if (text.includes(normalizeSearchText(term))) {
      return true;
    }
  }

  return false;
}

async function findNearestNearbyAmenity(params) {
  const lat = params.lat;
  const lng = params.lng;
  const apiKey = params.apiKey;
  const keyword = String(params.keyword || "").trim();
  const radiusMeters = Number(params.radiusMeters || 500);
  const validator = typeof params.validator === "function" ? params.validator : null;

  if (!keyword || !isValidLatLng(lat, lng)) return null;

  const url =
    "https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=" +
    lat + "," + lng +
    "&radius=" + radiusMeters +
    "&keyword=" + encodeURIComponent(keyword) +
    "&key=" +
    encodeURIComponent(apiKey);

  const data = await fetchJson(url);

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(
      "Nearby amenity search failed: " +
        data.status +
        (data.error_message ? " - " + data.error_message : "")
    );
  }

  const results = Array.isArray(data.results) ? data.results : [];
  let best = null;

  for (const place of results) {
    if (!place.geometry || !place.geometry.location) continue;

    const name = String(place.name || "").trim();
    const address = String(place.vicinity || place.formatted_address || "").trim();
    const types = Array.isArray(place.types) ? place.types : [];

    if (validator && !validator({ name, address, types })) continue;

    const placeLat = Number(place.geometry.location.lat);
    const placeLng = Number(place.geometry.location.lng);
    const distanceMeters = haversineMeters(lat, lng, placeLat, placeLng);

    if (!best || distanceMeters < best.distanceMeters) {
      best = {
        name,
        distanceMeters
      };
    }
  }

  return best;
}

function isValidParkingAmenity(place) {
  const text = normalizeSearchText(
    [place && place.name, place && place.address].join(" ")
  );
  const types = Array.isArray(place && place.types) ? place.types : [];

  const strongInclude = [
    "parking", "parking lot", "public parking", "stadium parking",
    "school parking", "athletic complex parking", "ballpark parking"
  ];

  const weakExclude = [
    "dog park", "park", "playground", "adcom", "restaurant", "coffee",
    "brewery", "bar", "church", "office", "worldwide", "medical"
  ];

  for (const term of weakExclude) {
    if (text.includes(term) && !text.includes("parking")) return false;
  }

  for (const term of strongInclude) {
    if (text.includes(term)) return true;
  }

  return (
    types.includes("parking") ||
    types.includes("parking_lot") ||
    types.includes("premise_parking")
  );
}

function isValidPlaygroundAmenity(place) {
  const text = normalizeSearchText(
    [place && place.name, place && place.address].join(" ")
  );
  const types = Array.isArray(place && place.types) ? place.types : [];

  const includeTerms = [
    "playground", "park playground", "community playground", "recreation playground"
  ];

  const excludeTerms = [
    "play space", "playspace", "indoor playground", "indoor play",
    "kids gym", "gymnastics", "trampoline", "jump", "birthday", "adventure park"
  ];

  for (const term of excludeTerms) {
    if (text.includes(term)) return false;
  }

  for (const term of includeTerms) {
    if (text.includes(term)) return true;
  }

  return types.includes("playground") || types.includes("park");
}

function roundMiles(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = Math.PI / 180;

  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;

  lat1 = lat1 * toRad;
  lat2 = lat2 * toRad;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
