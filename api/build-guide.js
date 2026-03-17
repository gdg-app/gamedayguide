export default async function handler(req, res) {
  try {
    const apiKey = process.env.MAPS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing MAPS_API_KEY" });
    }

    const query = String((req.query && req.query.query) || "").trim();
    const lat = toFiniteNumber(req.query && req.query.lat);
    const lng = toFiniteNumber(req.query && req.query.lng);
    const radiusMiles = normalizeRadius((req.query && req.query.radiusMiles) || 5);

    let loc = null;

    if (isValidLatLng(lat, lng)) {
      loc = { lat, lng };
    } else if (query) {
      loc = await resolveLocation(query, apiKey);
    } else {
      return res.status(400).json({ error: "Missing query or lat/lng" });
    }

    const rows = await collectAllRows(loc, radiusMiles, apiKey);
    return res.status(200).json(rows);
  } catch (err) {
    return res.status(500).json({
      error: "Build guide failed",
      detail: err && err.message ? err.message : String(err)
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

function normalizeRadius(radiusMiles) {
  const n = Number(radiusMiles);
  if (!Number.isFinite(n) || n <= 0) return 5;
  if (n > 50) return 50;
  return n;
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

async function resolveLocation(query, apiKey) {
  const geocodeLoc = await geocode(query, apiKey);
  if (geocodeLoc) return geocodeLoc;

  const textSearchLoc = await findPlaceByTextSearch(query, apiKey);
  if (textSearchLoc) return textSearchLoc;

  throw new Error("Location search failed for: " + query);
}

async function geocode(query, apiKey) {
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?address=" +
    encodeURIComponent(query) +
    "&key=" +
    encodeURIComponent(apiKey);

  const geo = await fetchJson(url);

  if (geo.status === "OK" && geo.results && geo.results.length) {
    return {
      lat: Number(geo.results[0].geometry.location.lat),
      lng: Number(geo.results[0].geometry.location.lng)
    };
  }

  if (geo.status === "ZERO_RESULTS") {
    return null;
  }

  throw new Error(
    "Location search failed: " +
      geo.status +
      (geo.error_message ? " - " + geo.error_message : "")
  );
}

async function findPlaceByTextSearch(query, apiKey) {
  const url =
    "https://maps.googleapis.com/maps/api/place/textsearch/json?query=" +
    encodeURIComponent(query) +
    "&key=" +
    encodeURIComponent(apiKey);

  const result = await fetchJson(url);

  if (result.status === "OK" && result.results && result.results.length) {
    const first = result.results[0];
    if (
      first.geometry &&
      first.geometry.location &&
      typeof first.geometry.location.lat === "number" &&
      typeof first.geometry.location.lng === "number"
    ) {
      return {
        lat: Number(first.geometry.location.lat),
        lng: Number(first.geometry.location.lng)
      };
    }
  }

  if (result.status === "ZERO_RESULTS") {
    return null;
  }

  throw new Error(
    "Place text search failed: " +
      result.status +
      (result.error_message ? " - " + result.error_message : "")
  );
}

function categories() {
  return [
    ["🍔 Food", "restaurant", "", [], []],
    ["☕ Coffee", "cafe", "", [], []],
    ["🍦 Ice Cream", "store", "ice cream gelato frozen yogurt froyo creamery", [], ["restaurant", "bar", "night_club", "gas_station"]],
    ["🏧 ATM", "atm", "", ["atm"], []],
    ["🍺 Breweries/Bars", "bar", "brewery bar taproom pub", [], []],
    ["⛽ Gas", "gas_station", "", ["gas_station"], []],
    ["🛒 Grocery", "supermarket", "", ["supermarket"], ["gas_station", "convenience_store"]],
    ["🏨 Hotels", "lodging", "", ["lodging"], []],
    ["💊 Pharmacy", "pharmacy", "", ["pharmacy"], ["veterinary_care", "pet_store", "animal_hospital"]],
    ["⚾ Sporting Goods", "sporting_goods_store", "sporting goods", [], []],
    ["🏥 Urgent Care / ER", "doctor", "urgent care", [], []],
    ["🦷 Emergency Dentist", "dentist", "emergency dentist", [], []]
  ];
}

function isUrgentCareCategory(label) {
  return label === "🏥 Urgent Care / ER";
}

function isEmergencyDentistCategory(label) {
  return label === "🦷 Emergency Dentist";
}

function isSportingGoodsCategory(label) {
  return label === "⚾ Sporting Goods";
}

function isGroceryCategory(label) {
  return label === "🛒 Grocery";
}

function isFoodCategory(label) {
  return label === "🍔 Food";
}

function categorySortKey(label) {
  label = String(label || "").trim();

  const foodOrder = ["🍔 Food", "☕ Coffee", "🍦 Ice Cream"];
  const nonFoodOrder = [
    "🏧 ATM",
    "🍺 Breweries/Bars",
    "⛽ Gas",
    "🛒 Grocery",
    "🏨 Hotels",
    "💊 Pharmacy",
    "⚾ Sporting Goods",
    "🏥 Urgent Care / ER",
    "🦷 Emergency Dentist"
  ];

  const foodIndex = foodOrder.indexOf(label);
  if (foodIndex !== -1) return "0_" + ("00" + foodIndex).slice(-2);

  const nonFoodIndex = nonFoodOrder.indexOf(label);
  if (nonFoodIndex !== -1) return "1_" + ("00" + nonFoodIndex).slice(-2);

  return "9_" + label.toLowerCase();
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.7613;
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

function hasAnyType(placeTypes, requiredTypes) {
  if (!requiredTypes || !requiredTypes.length) return true;
  if (!placeTypes || !placeTypes.length) return false;

  for (let i = 0; i < requiredTypes.length; i++) {
    if (placeTypes.indexOf(requiredTypes[i]) !== -1) return true;
  }
  return false;
}

function hasExcludedType(placeTypes, excludedTypes) {
  if (!excludedTypes || !excludedTypes.length) return false;
  if (!placeTypes || !placeTypes.length) return false;

  for (let i = 0; i < excludedTypes.length; i++) {
    if (placeTypes.indexOf(excludedTypes[i]) !== -1) return true;
  }

  return false;
}

function textMatchesIceCream(p) {
  const hay = (((p.name || "") + " " + (p.vicinity || "") + " " + (p.formatted_address || "")).toLowerCase());

  const includeWords = ["ice cream", "gelato", "frozen yogurt", "froyo", "creamery", "custard", "yogurt"];
  const excludeWords = ["pizza", "burger", "mexican", "grill", "bar", "steakhouse", "restaurant", "bbq"];

  let include = false;
  for (let i = 0; i < includeWords.length; i++) {
    if (hay.indexOf(includeWords[i]) !== -1) {
      include = true;
      break;
    }
  }

  if (!include) return false;

  for (let j = 0; j < excludeWords.length; j++) {
    if (hay.indexOf(excludeWords[j]) !== -1) return false;
  }

  return true;
}

function textMatchesPharmacy(p) {
  const hay = (((p.name || "") + " " + (p.vicinity || "") + " " + (p.formatted_address || "")).toLowerCase());
  const excludeWords = ["vet", "veterinary", "animal", "pet"];

  for (let i = 0; i < excludeWords.length; i++) {
    if (hay.indexOf(excludeWords[i]) !== -1) return false;
  }

  return true;
}

function textMatchesCoffee(p) {
  const hay = (((p.name || "") + " " + (p.vicinity || "") + " " + (p.formatted_address || "")).toLowerCase());
  const types = p.types || [];

  const includeWords = [
    "coffee", "coffee house", "coffeehouse", "espresso", "roastery", "roast",
    "cafe", "café", "starbucks", "dunkin", "krispy kreme", "krispy creme"
  ];

  const excludeWords = [
    "wine", "paint", "painting", "paint and sip", "paint & sip", "sip and paint", "sip & paint",
    "art studio", "studio", "pottery", "ceramic", "bar", "brewery", "lounge", "night club",
    "nightclub", "yoga", "martial arts", "spa", "salon"
  ];

  for (let i = 0; i < excludeWords.length; i++) {
    if (hay.indexOf(excludeWords[i]) !== -1) return false;
  }

  for (let j = 0; j < includeWords.length; j++) {
    if (hay.indexOf(includeWords[j]) !== -1) return true;
  }

  return types.indexOf("cafe") !== -1;
}

function textMatchesSportingGoods(p) {
  const hay = (((p.name || "") + " " + (p.vicinity || "") + " " + (p.formatted_address || "")).toLowerCase());

  const includeWords = [
    "sporting goods", "sports store", "sports shop", "athletic store", "outdoor store", "outdoors",
    "dick's sporting goods", "dicks sporting goods", "dick's house of sport", "dicks house of sport",
    "house of sport", "academy sports", "academy sports + outdoors", "play it again sports",
    "hibbett sports", "hibbett", "rei", "golf galaxy", "bass pro", "cabela"
  ];

  const excludeWords = [
    "sport clips", "barber", "salon", "billiards", "pool hall", "sports bar", "restaurant",
    "spa", "gym", "fitness", "martial arts"
  ];

  let include = false;
  for (let i = 0; i < includeWords.length; i++) {
    if (hay.indexOf(includeWords[i]) !== -1) {
      include = true;
      break;
    }
  }

  if (!include) return false;

  for (let j = 0; j < excludeWords.length; j++) {
    if (hay.indexOf(excludeWords[j]) !== -1) return false;
  }

  return true;
}

function textMatchesUrgentCare(p) {
  const hay = (((p.name || "") + " " + (p.formatted_address || "") + " " + (p.vicinity || "")).toLowerCase());
  const types = p.types || [];

  const urgentTerms = [
    "urgent care", "urgentcare", "pediatric urgent care", "emergency room", "emergency department",
    "walk-in", "walk in", "immediate care", "after hours", "after-hours", "express care",
    "minor emergency", "er"
  ];

  const routineOnlyTerms = [
    "primary care", "family medicine", "internal medicine", "dermatology", "cardiology",
    "orthopedics", "orthopaedics", "neurology", "oncology", "gastroenterology", "urology",
    "ophthalmology", "optometry", "physical therapy", "rehab", "radiology", "imaging",
    "obgyn", "ob/gyn", "dental", "dentist"
  ];

  for (let i = 0; i < urgentTerms.length; i++) {
    if (hay.indexOf(urgentTerms[i]) !== -1) return true;
  }

  for (let j = 0; j < routineOnlyTerms.length; j++) {
    if (hay.indexOf(routineOnlyTerms[j]) !== -1) return false;
  }

  if (types.indexOf("hospital") !== -1) return true;
  return false;
}

function textMatchesEmergencyDentist(p) {
  const hay = (((p.name || "") + " " + (p.formatted_address || "") + " " + (p.vicinity || "")).toLowerCase());
  const types = p.types || [];

  const includeTerms = [
    "emergency dentist", "emergency dental", "urgent dental", "urgent dentist", "24 hour dentist",
    "24-hour dentist", "after hours dentist", "after-hours dentist", "same day dentist",
    "walk in dentist", "walk-in dentist", "dental emergency"
  ];

  const excludeTerms = [
    "orthodontics", "orthodontist", "pediatric dentistry", "cosmetic dentistry", "oral surgery",
    "periodontics", "endodontics", "prosthodontics", "dental lab"
  ];

  if (types.indexOf("dentist") === -1) return false;

  for (let i = 0; i < excludeTerms.length; i++) {
    if (hay.indexOf(excludeTerms[i]) !== -1) return false;
  }

  for (let j = 0; j < includeTerms.length; j++) {
    if (hay.indexOf(includeTerms[j]) !== -1) return true;
  }

  return false;
}

function textMatchesHotel(p) {
  const hay = (((p.name || "") + " " + (p.formatted_address || "") + " " + (p.vicinity || "")).toLowerCase());
  const types = p.types || [];

  const includeWords = [
    "hotel", "motel", "inn", "suites", "resort", "lodge", "extended stay", "hampton", "hilton",
    "marriott", "courtyard", "fairfield", "holiday inn", "hyatt", "residence inn", "homewood suites",
    "doubletree", "comfort inn", "quality inn", "best western", "la quinta", "springhill",
    "embassy suites", "aloft", "westin", "sheraton", "drury", "microtel", "days inn", "super 8",
    "tru by hilton"
  ];

  const excludeWords = [
    "airbnb", "vrbo", "vacation rental", "vacation home", "rental property", "rental home",
    "short-term rental", "short term rental", "apartment", "apartments", "condo", "condos",
    "townhome", "townhouse", "corporate housing", "furnished rental", "property management"
  ];

  for (let i = 0; i < excludeWords.length; i++) {
    if (hay.indexOf(excludeWords[i]) !== -1) return false;
  }

  if (types.indexOf("lodging") !== -1) {
    for (let j = 0; j < includeWords.length; j++) {
      if (hay.indexOf(includeWords[j]) !== -1) return true;
    }
  }

  for (let k = 0; k < includeWords.length; k++) {
    if (hay.indexOf(includeWords[k]) !== -1) return true;
  }

  return false;
}

function textMatchesGrocery(p) {
  const hay = (((p.name || "") + " " + (p.formatted_address || "") + " " + (p.vicinity || "")).toLowerCase());

  const includeWords = [
    "grocery", "supermarket", "market", "food lion", "harris teeter", "publix", "lowe's foods",
    "lowes foods", "aldi", "wegmans", "whole foods", "fresh market", "trader joe", "trader joe's"
  ];

  const excludeWords = ["gas station", "convenience", "convenience store", "mini mart", "martial arts", "restaurant"];

  for (let i = 0; i < excludeWords.length; i++) {
    if (hay.indexOf(excludeWords[i]) !== -1) return false;
  }

  for (let j = 0; j < includeWords.length; j++) {
    if (hay.indexOf(includeWords[j]) !== -1) return true;
  }

  return false;
}

function textLooksLikeQuickFood(text) {
  const hay = String(text || "").toLowerCase();
  const quickTerms = [
    "grill", "deli", "cafe", "café", "pizza", "bbq", "barbecue", "chicken", "taco", "tacos",
    "burrito", "sandwich", "subs", "wings", "burger", "burgers", "panera", "chipotle",
    "chick-fil-a", "chick fil a", "jersey mike", "jimmy john", "firehouse", "five guys",
    "smashburger", "qdoba", "moes", "moe's", "zaxby", "raising cane", "raising cane's",
    "shake shack", "cook out", "cookout", "whataburger", "wendy's", "mcdonald", "sonic",
    "culver", "tropical smoothie", "panda express", "subway"
  ];

  for (let i = 0; i < quickTerms.length; i++) {
    if (hay.indexOf(quickTerms[i]) !== -1) return true;
  }

  return false;
}

function textMatchesFood(p) {
  const hay = (((p.name || "") + " " + (p.formatted_address || "") + " " + (p.vicinity || "")).toLowerCase());
  const types = p.types || [];

  if (types.indexOf("gas_station") !== -1) return false;
  if (types.indexOf("convenience_store") !== -1) return false;
  if (types.indexOf("bar") !== -1) return false;
  if (types.indexOf("night_club") !== -1) return false;
  if (types.indexOf("liquor_store") !== -1) return false;

  const excludeWords = [
    "gas station", "fuel", "convenience store", "mini mart", "travel center", "travel centre", "truck stop",
    "barber", "salon", "spa", "hotel", "motel", "pharmacy", "urgent care", "dentist", "veterinary",
    "pet store", "bank", "atm", "wine bar", "sports bar", "taproom", "brewery", "lounge", "night club",
    "nightclub", "cocktail", "pub"
  ];

  for (let i = 0; i < excludeWords.length; i++) {
    if (hay.indexOf(excludeWords[i]) !== -1) return false;
  }

  const includeWords = [
    "restaurant", "grill", "pizza", "burger", "burgers", "sandwich", "subs", "sub", "burrito", "taco",
    "tacos", "bbq", "barbecue", "chicken", "wings", "deli", "fast food", "takeout", "take-out",
    "take away", "takeaway", "panera", "chipotle", "chick-fil-a", "chick fil a", "mcdonald",
    "wendy's", "five guys", "cook out", "cookout", "zaxby", "subway", "jersey mike", "jimmy john",
    "firehouse", "qdoba", "moes", "moe's", "panda express", "raising cane", "raising cane's",
    "shake shack", "whataburger", "sonic", "culver", "panera bread"
  ];

  if (
    types.indexOf("restaurant") !== -1 ||
    types.indexOf("meal_takeaway") !== -1 ||
    types.indexOf("meal_delivery") !== -1
  ) {
    return true;
  }

  for (let j = 0; j < includeWords.length; j++) {
    if (hay.indexOf(includeWords[j]) !== -1) return true;
  }

  return false;
}

function categoryPassesExtraFilter(category, p) {
  if (category === "🍔 Food") return textMatchesFood(p);
  if (category === "🍦 Ice Cream") return textMatchesIceCream(p);
  if (category === "☕ Coffee") return textMatchesCoffee(p);
  if (category === "💊 Pharmacy") return textMatchesPharmacy(p);
  if (category === "🏨 Hotels") return textMatchesHotel(p);
  return true;
}

function buildNearbyUrl(loc, radiusMeters, type, keyword, apiKey) {
  return (
    "https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=" +
    loc.lat + "," + loc.lng +
    "&radius=" + radiusMeters +
    "&type=" + encodeURIComponent(type) +
    (keyword ? "&keyword=" + encodeURIComponent(keyword) : "") +
    "&key=" + encodeURIComponent(apiKey)
  );
}

function buildStandardCategoryRequests(loc, radiusMeters, apiKey) {
  const cats = categories();
  const requests = [];

  for (let i = 0; i < cats.length; i++) {
    const c = cats[i];
    if (
      isUrgentCareCategory(c[0]) ||
      isSportingGoodsCategory(c[0]) ||
      isGroceryCategory(c[0]) ||
      isEmergencyDentistCategory(c[0]) ||
      isFoodCategory(c[0])
    ) {
      continue;
    }

    requests.push({
      category: c[0],
      type: c[1],
      keyword: c[2],
      requiredTypes: c[3],
      excludedTypes: c[4],
      url: buildNearbyUrl(loc, radiusMeters, c[1], c[2], apiKey)
    });
  }

  return requests;
}

function buildTextSearchUrl(loc, radiusMeters, queryText, apiKey) {
  return (
    "https://maps.googleapis.com/maps/api/place/textsearch/json?query=" +
    encodeURIComponent(queryText) +
    "&location=" + loc.lat + "," + loc.lng +
    "&radius=" + radiusMeters +
    "&key=" + encodeURIComponent(apiKey)
  );
}

function buildUrgentCareTextSearchRequests(loc, radiusMeters, apiKey) {
  return [
    { category: "🏥 Urgent Care / ER", queryText: "urgent care", specialType: "urgent", url: buildTextSearchUrl(loc, radiusMeters, "urgent care", apiKey) },
    { category: "🏥 Urgent Care / ER", queryText: "pediatric urgent care", specialType: "urgent", url: buildTextSearchUrl(loc, radiusMeters, "pediatric urgent care", apiKey) },
    { category: "🏥 Urgent Care / ER", queryText: "emergency room", specialType: "urgent", url: buildTextSearchUrl(loc, radiusMeters, "emergency room", apiKey) }
  ];
}

function buildEmergencyDentistTextSearchRequests(loc, radiusMeters, apiKey) {
  return [
    { category: "🦷 Emergency Dentist", queryText: "emergency dentist", specialType: "dentist", url: buildTextSearchUrl(loc, radiusMeters, "emergency dentist", apiKey) },
    { category: "🦷 Emergency Dentist", queryText: "urgent dental care", specialType: "dentist", url: buildTextSearchUrl(loc, radiusMeters, "urgent dental care", apiKey) },
    { category: "🦷 Emergency Dentist", queryText: "24 hour dentist", specialType: "dentist", url: buildTextSearchUrl(loc, radiusMeters, "24 hour dentist", apiKey) },
    { category: "🦷 Emergency Dentist", queryText: "dental emergency", specialType: "dentist", url: buildTextSearchUrl(loc, radiusMeters, "dental emergency", apiKey) }
  ];
}

function buildSportingGoodsTextSearchRequests(loc, radiusMeters, apiKey) {
  return [
    { category: "⚾ Sporting Goods", queryText: "sporting goods", specialType: "sporting", url: buildTextSearchUrl(loc, radiusMeters, "sporting goods", apiKey) },
    { category: "⚾ Sporting Goods", queryText: "sports store", specialType: "sporting", url: buildTextSearchUrl(loc, radiusMeters, "sports store", apiKey) },
    { category: "⚾ Sporting Goods", queryText: "Dick's Sporting Goods", specialType: "sporting", url: buildTextSearchUrl(loc, radiusMeters, "Dick's Sporting Goods", apiKey) },
    { category: "⚾ Sporting Goods", queryText: "Dicks Sporting Goods", specialType: "sporting", url: buildTextSearchUrl(loc, radiusMeters, "Dicks Sporting Goods", apiKey) },
    { category: "⚾ Sporting Goods", queryText: "Dick's House of Sport", specialType: "sporting", url: buildTextSearchUrl(loc, radiusMeters, "Dick's House of Sport", apiKey) },
    { category: "⚾ Sporting Goods", queryText: "Dicks House of Sport", specialType: "sporting", url: buildTextSearchUrl(loc, radiusMeters, "Dicks House of Sport", apiKey) },
    { category: "⚾ Sporting Goods", queryText: "House of Sport", specialType: "sporting", url: buildTextSearchUrl(loc, radiusMeters, "House of Sport", apiKey) },
    { category: "⚾ Sporting Goods", queryText: "Academy Sports", specialType: "sporting", url: buildTextSearchUrl(loc, radiusMeters, "Academy Sports", apiKey) },
    { category: "⚾ Sporting Goods", queryText: "Play It Again Sports", specialType: "sporting", url: buildTextSearchUrl(loc, radiusMeters, "Play It Again Sports", apiKey) },
    { category: "⚾ Sporting Goods", queryText: "Hibbett Sports", specialType: "sporting", url: buildTextSearchUrl(loc, radiusMeters, "Hibbett Sports", apiKey) },
    { category: "⚾ Sporting Goods", queryText: "REI", specialType: "sporting", url: buildTextSearchUrl(loc, radiusMeters, "REI", apiKey) },
    { category: "⚾ Sporting Goods", queryText: "Golf Galaxy", specialType: "sporting", url: buildTextSearchUrl(loc, radiusMeters, "Golf Galaxy", apiKey) }
  ];
}

function buildGroceryTextSearchRequests(loc, radiusMeters, apiKey) {
  return [
    { category: "🛒 Grocery", queryText: "grocery store", specialType: "grocery", url: buildTextSearchUrl(loc, radiusMeters, "grocery store", apiKey) },
    { category: "🛒 Grocery", queryText: "supermarket", specialType: "grocery", url: buildTextSearchUrl(loc, radiusMeters, "supermarket", apiKey) },
    { category: "🛒 Grocery", queryText: "Harris Teeter", specialType: "grocery", url: buildTextSearchUrl(loc, radiusMeters, "Harris Teeter", apiKey) },
    { category: "🛒 Grocery", queryText: "Food Lion", specialType: "grocery", url: buildTextSearchUrl(loc, radiusMeters, "Food Lion", apiKey) },
    { category: "🛒 Grocery", queryText: "Publix", specialType: "grocery", url: buildTextSearchUrl(loc, radiusMeters, "Publix", apiKey) },
    { category: "🛒 Grocery", queryText: "Lowe's Foods", specialType: "grocery", url: buildTextSearchUrl(loc, radiusMeters, "Lowe's Foods", apiKey) },
    { category: "🛒 Grocery", queryText: "Aldi", specialType: "grocery", url: buildTextSearchUrl(loc, radiusMeters, "Aldi", apiKey) },
    { category: "🛒 Grocery", queryText: "Wegmans", specialType: "grocery", url: buildTextSearchUrl(loc, radiusMeters, "Wegmans", apiKey) },
    { category: "🛒 Grocery", queryText: "Whole Foods", specialType: "grocery", url: buildTextSearchUrl(loc, radiusMeters, "Whole Foods", apiKey) }
  ];
}

function buildFoodSearchRequests(loc, radiusMeters, apiKey) {
  return [
    { category: "🍔 Food", type: "restaurant", keyword: "", specialType: "food", queryText: "", url: buildNearbyUrl(loc, radiusMeters, "restaurant", "", apiKey) },
    { category: "🍔 Food", type: "meal_takeaway", keyword: "", specialType: "food", queryText: "", url: buildNearbyUrl(loc, radiusMeters, "meal_takeaway", "", apiKey) },
    { category: "🍔 Food", type: "meal_delivery", keyword: "", specialType: "food", queryText: "", url: buildNearbyUrl(loc, radiusMeters, "meal_delivery", "", apiKey) },
    { category: "🍔 Food", queryText: "fast food", specialType: "food", url: buildTextSearchUrl(loc, radiusMeters, "fast food", apiKey) },
    { category: "🍔 Food", queryText: "burger restaurant", specialType: "food", url: buildTextSearchUrl(loc, radiusMeters, "burger restaurant", apiKey) },
    { category: "🍔 Food", queryText: "chicken restaurant", specialType: "food", url: buildTextSearchUrl(loc, radiusMeters, "chicken restaurant", apiKey) },
    { category: "🍔 Food", queryText: "sandwich shop", specialType: "food", url: buildTextSearchUrl(loc, radiusMeters, "sandwich shop", apiKey) },
    { category: "🍔 Food", queryText: "burrito restaurant", specialType: "food", url: buildTextSearchUrl(loc, radiusMeters, "burrito restaurant", apiKey) },
    { category: "🍔 Food", queryText: "pizza restaurant", specialType: "food", url: buildTextSearchUrl(loc, radiusMeters, "pizza restaurant", apiKey) },
    { category: "🍔 Food", queryText: "McDonald's", specialType: "food", url: buildTextSearchUrl(loc, radiusMeters, "McDonald's", apiKey) },
    { category: "🍔 Food", queryText: "Chick-fil-A", specialType: "food", url: buildTextSearchUrl(loc, radiusMeters, "Chick-fil-A", apiKey) },
    { category: "🍔 Food", queryText: "Wendy's", specialType: "food", url: buildTextSearchUrl(loc, radiusMeters, "Wendy's", apiKey) },
    { category: "🍔 Food", queryText: "Cook Out", specialType: "food", url: buildTextSearchUrl(loc, radiusMeters, "Cook Out", apiKey) },
    { category: "🍔 Food", queryText: "Zaxby's", specialType: "food", url: buildTextSearchUrl(loc, radiusMeters, "Zaxby's", apiKey) },
    { category: "🍔 Food", queryText: "Five Guys", specialType: "food", url: buildTextSearchUrl(loc, radiusMeters, "Five Guys", apiKey) },
    { category: "🍔 Food", queryText: "Chipotle", specialType: "food", url: buildTextSearchUrl(loc, radiusMeters, "Chipotle", apiKey) },
    { category: "🍔 Food", queryText: "Panera Bread", specialType: "food", url: buildTextSearchUrl(loc, radiusMeters, "Panera Bread", apiKey) },
    { category: "🍔 Food", queryText: "Subway", specialType: "food", url: buildTextSearchUrl(loc, radiusMeters, "Subway", apiKey) }
  ];
}

function getFoodRankingScore(p, loc) {
  let placeLat = null;
  let placeLng = null;

  if (
    p.geometry &&
    p.geometry.location &&
    typeof p.geometry.location.lat === "number" &&
    typeof p.geometry.location.lng === "number"
  ) {
    placeLat = p.geometry.location.lat;
    placeLng = p.geometry.location.lng;
  }

  if (placeLat === null || placeLng === null) return -9999;

  const distance = haversineMiles(loc.lat, loc.lng, placeLat, placeLng);
  let score = 0;

  if (distance < 1) score += 40;
  else if (distance <= 3) score += 30;
  else if (distance <= 6) score += 15;
  else if (distance <= 10) score += 5;

  if (p.opening_hours && typeof p.opening_hours.open_now === "boolean") {
    if (p.opening_hours.open_now) score += 25;
    else score -= 100;
  }

  const rating = Number(p.rating || 0);
  if (rating >= 4.5) score += 20;
  else if (rating >= 4.0) score += 15;
  else if (rating >= 3.5) score += 8;

  const textBlob = [p.name || "", p.formatted_address || "", p.vicinity || ""].join(" ");
  if (textLooksLikeQuickFood(textBlob)) score += 10;

  return score;
}

function buildFoodRows(places, loc, radiusMiles, limit) {
  const deduped = dedupePlaces(places);
  const scored = [];

  for (let i = 0; i < deduped.length; i++) {
    const p = deduped[i];
    if (!textMatchesFood(p)) continue;

    const row = buildRowFromPlace("🍔 Food", p, loc, radiusMiles);
    if (!row) continue;

    scored.push({ row, score: getFoodRankingScore(p, loc) });
  }

  scored.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;

    const da = typeof a.row[6] === "number" ? a.row[6] : 9999;
    const db = typeof b.row[6] === "number" ? b.row[6] : 9999;
    if (da < db) return -1;
    if (da > db) return 1;

    const ra = Number(a.row[2] || 0);
    const rb = Number(b.row[2] || 0);
    if (rb !== ra) return rb - ra;

    const na = String(a.row[1] || "").toLowerCase();
    const nb = String(b.row[1] || "").toLowerCase();
    return na < nb ? -1 : na > nb ? 1 : 0;
  });

  return scored.slice(0, limit).map(function(item) {
    return item.row;
  });
}

function buildRowFromPlace(category, p, loc, radiusMiles) {
  let placeLat = null;
  let placeLng = null;

  if (
    p.geometry &&
    p.geometry.location &&
    typeof p.geometry.location.lat === "number" &&
    typeof p.geometry.location.lng === "number"
  ) {
    placeLat = p.geometry.location.lat;
    placeLng = p.geometry.location.lng;
  }

  if (placeLat === null || placeLng === null) return null;

  const dist = haversineMiles(loc.lat, loc.lng, placeLat, placeLng);
  if (typeof dist === "number" && dist > radiusMiles) return null;

  const openNow =
    p.opening_hours && typeof p.opening_hours.open_now === "boolean"
      ? (p.opening_hours.open_now ? "Open" : "Closed")
      : "";

  const address = p.formatted_address || p.vicinity || "";
  const link =
    "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent((p.name || "") + " " + address);

  return [category, p.name || "", p.rating || "", address, openNow, link, dist];
}

function parseStandardCategoryResponse(request, res, loc, radiusMiles, limit) {
  if (res.status !== "OK" && res.status !== "ZERO_RESULTS") {
    throw new Error(
      "Places failed for " +
        request.category +
        ": " +
        res.status +
        (res.error_message ? " - " + res.error_message : "")
    );
  }

  const rows = [];
  const results = res.results || [];

  for (let i = 0; i < results.length && rows.length < limit; i++) {
    const p = results[i];
    const pTypes = p.types || [];

    if (!hasAnyType(pTypes, request.requiredTypes)) continue;
    if (hasExcludedType(pTypes, request.excludedTypes)) continue;
    if (!categoryPassesExtraFilter(request.category, p)) continue;

    const row = buildRowFromPlace(request.category, p, loc, radiusMiles);
    if (row) rows.push(row);
  }

  return rows;
}

function collectPlacesFromTextResponse(res, labelForErrors) {
  if (res.status !== "OK" && res.status !== "ZERO_RESULTS") {
    throw new Error(
      "Text Search failed for " +
        labelForErrors +
        ": " +
        res.status +
        (res.error_message ? " - " + res.error_message : "")
    );
  }
  return res.results || [];
}

function collectPlacesFromNearbyResponse(res, labelForErrors) {
  if (res.status !== "OK" && res.status !== "ZERO_RESULTS") {
    throw new Error(
      "Nearby Search failed for " +
        labelForErrors +
        ": " +
        res.status +
        (res.error_message ? " - " + res.error_message : "")
    );
  }
  return res.results || [];
}

function dedupePlaces(places) {
  const seen = {};
  const deduped = [];

  for (let i = 0; i < places.length; i++) {
    const p = places[i];
    const key =
      p.place_id ||
      ((p.name || "") + "|" + (p.formatted_address || p.vicinity || "")).toLowerCase();

    if (seen[key]) continue;
    seen[key] = true;
    deduped.push(p);
  }

  return deduped;
}

function buildSpecialCategoryRows(category, places, loc, radiusMiles, limit) {
  const deduped = dedupePlaces(places);

  if (category === "🍔 Food") {
    return buildFoodRows(deduped, loc, radiusMiles, limit);
  }

  const rows = [];
  for (let i = 0; i < deduped.length; i++) {
    const p = deduped[i];

    if (category === "🏥 Urgent Care / ER" && !textMatchesUrgentCare(p)) continue;
    if (category === "⚾ Sporting Goods" && !textMatchesSportingGoods(p)) continue;
    if (category === "🛒 Grocery" && !textMatchesGrocery(p)) continue;
    if (category === "🦷 Emergency Dentist" && !textMatchesEmergencyDentist(p)) continue;

    const row = buildRowFromPlace(category, p, loc, radiusMiles);
    if (row) rows.push(row);
  }

  rows.sort(function(a, b) {
    const da = typeof a[6] === "number" ? a[6] : 9999;
    const db = typeof b[6] === "number" ? b[6] : 9999;
    if (da < db) return -1;
    if (da > db) return 1;

    const na = String(a[1] || "").toLowerCase();
    const nb = String(b[1] || "").toLowerCase();
    return na < nb ? -1 : na > nb ? 1 : 0;
  });

  return rows.slice(0, limit);
}

function sortRows(rows) {
  rows.sort(function(a, b) {
    const catA = categorySortKey(a[0]);
    const catB = categorySortKey(b[0]);

    if (catA < catB) return -1;
    if (catA > catB) return 1;

    const da = typeof a[6] === "number" ? a[6] : 9999;
    const db = typeof b[6] === "number" ? b[6] : 9999;
    if (da < db) return -1;
    if (da > db) return 1;

    const nameA = String(a[1] || "").toLowerCase();
    const nameB = String(b[1] || "").toLowerCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return 0;
  });

  return rows;
}

async function collectAllRows(loc, radiusMiles, apiKey) {
  const radiusMeters = Math.round(radiusMiles * 1609.34);

  const standardRequests = buildStandardCategoryRequests(loc, radiusMeters, apiKey);
  const urgentRequests = buildUrgentCareTextSearchRequests(loc, radiusMeters, apiKey);
  const dentistRequests = buildEmergencyDentistTextSearchRequests(loc, radiusMeters, apiKey);
  const sportingRequests = buildSportingGoodsTextSearchRequests(loc, radiusMeters, apiKey);
  const groceryRequests = buildGroceryTextSearchRequests(loc, radiusMeters, apiKey);
  const foodRequests = buildFoodSearchRequests(loc, radiusMeters, apiKey);

  const allRequests = standardRequests
    .concat(urgentRequests)
    .concat(dentistRequests)
    .concat(sportingRequests)
    .concat(groceryRequests)
    .concat(foodRequests);

  const responses = await Promise.all(
    allRequests.map(async function(request) {
      try {
        const res = await fetchJson(request.url);
        return { request, res, error: null };
      } catch (err) {
        return {
          request,
          res: null,
          error: err && err.message ? err.message : String(err)
        };
      }
    })
  );

  let allRows = [];
  let urgentPlaces = [];
  let dentistPlaces = [];
  let sportingPlaces = [];
  let groceryPlaces = [];
  let foodPlaces = [];

  for (let i = 0; i < responses.length; i++) {
    const item = responses[i];
    const request = item.request;
    const res = item.res;
    const error = item.error;

    if (error || !res) continue;

    try {
      if (request.specialType === "urgent") {
        urgentPlaces = urgentPlaces.concat(collectPlacesFromTextResponse(res, "urgent care"));
      } else if (request.specialType === "dentist") {
        dentistPlaces = dentistPlaces.concat(collectPlacesFromTextResponse(res, "emergency dentist"));
      } else if (request.specialType === "sporting") {
        sportingPlaces = sportingPlaces.concat(collectPlacesFromTextResponse(res, "sporting goods"));
      } else if (request.specialType === "grocery") {
        groceryPlaces = groceryPlaces.concat(collectPlacesFromTextResponse(res, "grocery"));
      } else if (request.specialType === "food") {
        if (request.type) {
          foodPlaces = foodPlaces.concat(collectPlacesFromNearbyResponse(res, "food nearby"));
        } else {
          foodPlaces = foodPlaces.concat(collectPlacesFromTextResponse(res, "food text search"));
        }
      } else {
        const rows = parseStandardCategoryResponse(request, res, loc, radiusMiles, 15);
        allRows = allRows.concat(rows);
      }
    } catch (_e) {
      // Skip failed category parsing without breaking the full guide.
    }
  }

  const urgentRows = buildSpecialCategoryRows("🏥 Urgent Care / ER", urgentPlaces, loc, radiusMiles, 15);
  const dentistRows = buildSpecialCategoryRows("🦷 Emergency Dentist", dentistPlaces, loc, radiusMiles, 15);
  const sportingRows = buildSpecialCategoryRows("⚾ Sporting Goods", sportingPlaces, loc, radiusMiles, 15);
  const groceryRows = buildSpecialCategoryRows("🛒 Grocery", groceryPlaces, loc, radiusMiles, 15);
  const foodRows = buildSpecialCategoryRows("🍔 Food", foodPlaces, loc, radiusMiles, 15);

  allRows = allRows
    .concat(urgentRows)
    .concat(dentistRows)
    .concat(sportingRows)
    .concat(groceryRows)
    .concat(foodRows);

  return sortRows(allRows);
}
