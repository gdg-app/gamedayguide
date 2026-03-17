function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSportsPriorityTerms() {
  return [
    "baseball",
    "ballpark",
    "ball park",
    "athletic park",
    "athletic complex",
    "sports complex",
    "baseball complex",
    "stadium",
    "field",
    "fields",
    "park",
    "tournament",
    "diamond",
    "high school",
    "middle school",
    "junior high",
    "school",
    "athletics",
    "athletic campus",
    "campus"
  ];
}

function looksLikeSportsFacilityText(value) {
  const hay = normalizeSearchText(value);
  if (!hay) return false;

  const includeTerms = getSportsPriorityTerms().concat([
    "rec park",
    "recreation park",
    "sportsplex",
    "training complex",
    "hs",
    "ms"
  ]);

  const excludeTerms = [
    "apartment",
    "apartments",
    "hotel",
    "restaurant",
    "bar",
    "brewery",
    "coffee",
    "urgent care",
    "pharmacy",
    "grocery",
    "gas station",
    "church",
    "school bus",
    "storage",
    "self storage",
    "bank"
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
    addCandidate(q + " high school athletic fields");
  }

  if (!qNorm.includes("middle school") && /\bmiddle\b/.test(qNorm)) {
    addCandidate(q + " school");
    addCandidate(q + " middle school");
    addCandidate(q + " middle school athletic fields");
  }

  if (!qNorm.includes("junior high") && /\bjunior\b/.test(qNorm)) {
    addCandidate(q + " high");
    addCandidate(q + " junior high");
    addCandidate(q + " junior high athletic fields");
  }

  if (/\bhs\b/.test(qNorm)) {
    addCandidate(q.replace(/\bhs\b/gi, "High School"));
    addCandidate(q.replace(/\bhs\b/gi, "High School") + " baseball field");
    addCandidate(q.replace(/\bhs\b/gi, "High School") + " athletic fields");
  }

  if (/\bms\b/.test(qNorm)) {
    addCandidate(q.replace(/\bms\b/gi, "Middle School"));
    addCandidate(q.replace(/\bms\b/gi, "Middle School") + " athletic fields");
  }

  if (
    !qNorm.includes("school") &&
    (
      /\bhigh\b/.test(qNorm) ||
      /\bmiddle\b/.test(qNorm) ||
      /\bjunior\b/.test(qNorm) ||
      /\bhs\b/.test(qNorm) ||
      /\bms\b/.test(qNorm)
    )
  ) {
    addCandidate(q + " school");
  }

  return candidates.slice(0, 8);
}

function scoreSuggestionText(text, mode) {
  const hay = normalizeSearchText(text);
  let score = 0;

  const strongTerms = [
    "baseball",
    "ballpark",
    "ball park",
    "baseball complex",
    "athletic complex",
    "sports complex",
    "athletic park",
    "stadium",
    "high school",
    "middle school",
    "junior high"
  ];

  const mediumTerms = [
    "field",
    "fields",
    "park",
    "sportsplex",
    "training complex",
    "diamond",
    "school",
    "athletics",
    "campus"
  ];

  for (const term of strongTerms) {
    if (hay.includes(term)) score += 25;
  }

  for (const term of mediumTerms) {
    if (hay.includes(term)) score += 10;
  }

  if (mode === "autocomplete") score += 8;
  if (mode === "tournament") score += 6;

  return score;
}

function dedupeSuggestions(items) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const key = item.placeId || normalizeSearchText(item.query || item.label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function parseAutocompleteSuggestions(data) {
  const predictions = data.predictions || [];
  const out = [];

  for (const p of predictions) {
    const mainText = (p.structured_formatting && p.structured_formatting.main_text) || p.description || "";
    const secondaryText = (p.structured_formatting && p.structured_formatting.secondary_text) || "";
    const fullText = p.description || ((mainText + ", " + secondaryText).replace(/^,\s*|\s*,\s*$/g, ""));

    if (!looksLikeSportsFacilityText(fullText) && !looksLikeSportsFacilityText(mainText)) continue;

    out.push({
      source: "google",
      type: "autocomplete",
      label: mainText || fullText,
      secondaryText: secondaryText,
      query: fullText,
      placeId: p.place_id || "",
      score: scoreSuggestionText(fullText, "autocomplete")
    });
  }

  return out;
}

function parseTextSearchSuggestions(data) {
  const results = data.results || [];
  const out = [];

  for (const p of results) {
    const name = p.name || "";
    const address = p.formatted_address || p.vicinity || "";
    const fullText = (name + (address ? ", " + address : "")).replace(/^,\s*|\s*,\s*$/g, "");

    if (!looksLikeSportsFacilityText(fullText) && !looksLikeSportsFacilityText(name)) continue;

    out.push({
      source: "google",
      type: "tournament",
      label: name || fullText,
      secondaryText: address,
      query: fullText,
      placeId: p.place_id || "",
      score: scoreSuggestionText(fullText, "tournament")
    });
  }

  return out;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json();

  if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(
      (data.error_message ? data.error_message + " (" + data.status + ")" : data.status)
    );
  }

  return data;
}

export default async function handler(req, res) {
  try {
    const query = String((req.query && req.query.query) || "").trim();

    if (!query || query.length < 2) {
      return res.status(200).json({
        ok: true,
        data: []
      });
    }

    const apiKey = process.env.MAPS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "Missing MAPS_API_KEY environment variable."
      });
    }

    const autocompleteUrl =
      "https://maps.googleapis.com/maps/api/place/autocomplete/json?input=" +
      encodeURIComponent(query) +
      "&types=establishment&components=country:us&key=" + encodeURIComponent(apiKey);

    const schoolQueries = buildSchoolExpandedQueries(query);
    const textSearchUrls = schoolQueries.map(function(q) {
      return (
        "https://maps.googleapis.com/maps/api/place/textsearch/json?query=" +
        encodeURIComponent(q) +
        "&key=" + encodeURIComponent(apiKey)
      );
    });

    const autocompleteData = await fetchJson(autocompleteUrl);
    let suggestions = parseAutocompleteSuggestions(autocompleteData);

    const textResults = await Promise.all(
      textSearchUrls.map(async function(url) {
        try {
          const data = await fetchJson(url);
          return parseTextSearchSuggestions(data);
        } catch (err) {
          return [];
        }
      })
    );

    for (const list of textResults) {
      suggestions = suggestions.concat(list);
    }

    suggestions = dedupeSuggestions(suggestions);

    suggestions.sort(function(a, b) {
      const sa = Number(a.score || 0);
      const sb = Number(b.score || 0);
      if (sb !== sa) return sb - sa;

      const la = String(a.label || "").toLowerCase();
      const lb = String(b.label || "").toLowerCase();
      return la < lb ? -1 : la > lb ? 1 : 0;
    });

    suggestions = suggestions.slice(0, 8);

    return res.status(200).json({
      ok: true,
      data: suggestions
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}
