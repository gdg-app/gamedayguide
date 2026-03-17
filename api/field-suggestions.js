function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSportsPriorityTerms() {
  return [
    "baseball","ballpark","ball park","athletic park","athletic complex",
    "sports complex","baseball complex","stadium","field","fields",
    "park","tournament","diamond","high school","middle school",
    "junior high","school","athletics","athletic campus","campus"
  ];
}

function looksLikeSportsFacilityText(value) {
  const hay = normalizeSearchText(value);
  if (!hay) return false;

  const includeTerms = getSportsPriorityTerms().concat([
    "rec park","recreation park","sportsplex","training complex","hs","ms"
  ]);

  const excludeTerms = [
    "apartment","apartments","hotel","restaurant","bar","brewery","coffee",
    "urgent care","pharmacy","grocery","gas station","church","school bus",
    "storage","self storage","bank"
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
  }

  return candidates.slice(0, 8);
}

function scoreSuggestionText(text, mode) {
  const hay = normalizeSearchText(text);
  let score = 0;

  const strongTerms = [
    "baseball","ballpark","sports complex","athletic complex","stadium"
  ];

  const mediumTerms = [
    "field","fields","park","school"
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

export default async function handler(req, res) {
  try {
    const query = String((req.query && req.query.query) || "").trim();

    if (!query || query.length < 2) {
      return res.status(200).json({ ok: true, data: [] });
    }

    const apiKey = process.env.MAPS_API_KEY;

    const url =
      "https://maps.googleapis.com/maps/api/place/autocomplete/json?input=" +
      encodeURIComponent(query) +
      "&types=establishment&components=country:us&key=" + apiKey;

    const response = await fetch(url);
    const data = await response.json();

    const suggestions = (data.predictions || []).map(p => ({
      label: p.description,
      query: p.description
    }));

    return res.status(200).json({
      ok: true,
      data: suggestions.slice(0, 8)
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
}
