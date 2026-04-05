import { google } from "googleapis";
import crypto from "crypto";

export default async function handler(req, res) {
  try {
    // TEMP TEST MODE
    if (req.method === "GET" && req.query && req.query.test === "1") {
      const sheets = await getSheetsClient();
      const spreadsheetId = String(process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "").trim();

      if (!spreadsheetId) {
        return res.status(500).json({
          ok: false,
          error: "Missing GOOGLE_SHEETS_SPREADSHEET_ID"
        });
      }

      const now = new Date();
      const tipId = "test_" + Date.now();

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "venue_tips!A:I",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: [[
            tipId,
            now.toISOString(),
            "test_place_123",
            "Test Field",
            "123 Test St",
            "Bring chairs. Not much shade.",
            "seating, shade",
            "active",
            "test_session"
          ]]
        }
      });

      return res.status(200).json({ ok: true, test: true });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    const venuePlaceId = String(body.venuePlaceId || body.placeId || "").trim();
    const venueName = String(body.venueName || "").trim();
    const venueAddress = String(body.venueAddress || "").trim();
    const tipText = String(body.tipText || "").trim();
    const sessionId = String(body.sessionId || "").trim();

    if (!venuePlaceId) {
      return res.status(400).json({
        ok: false,
        error: "Missing venuePlaceId"
      });
    }

    if (!tipText) {
      return res.status(400).json({
        ok: false,
        error: "Missing tipText"
      });
    }

    if (tipText.length < 3) {
      return res.status(400).json({
        ok: false,
        error: "Tip is too short"
      });
    }

    if (tipText.length > 500) {
      return res.status(400).json({
        ok: false,
        error: "Tip is too long"
      });
    }

    const spreadsheetId = String(process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "").trim();
    if (!spreadsheetId) {
      return res.status(500).json({
        ok: false,
        error: "Missing GOOGLE_SHEETS_SPREADSHEET_ID"
      });
    }

    const now = new Date();
    const tipId = crypto.randomBytes(8).toString("hex");
    const createdAtUtc = now.toISOString();
    const tipTags = buildTipTags(tipText).join(", ");
    const tipStatus = "active";

    const sheets = await getSheetsClient();

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "venue_tips!A:I",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          tipId,
          createdAtUtc,
          venuePlaceId,
          venueName,
          venueAddress,
          tipText,
          tipTags,
          tipStatus,
          sessionId
        ]]
      }
    });

    return res.status(200).json({
      ok: true,
      data: {
        tipId,
        createdAtUtc,
        venuePlaceId,
        venueName,
        tipText,
        tipTags,
        tipStatus
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildTipTags(tipText) {
  const hay = normalizeText(tipText);
  const tags = [];

  const rules = [
    { tag: "parking", terms: ["parking", "park lot", "parking lot", "park early", "tight parking"] },
    { tag: "restrooms", terms: ["restroom", "restrooms", "bathroom", "bathrooms", "porta potty", "porta-potty"] },
    { tag: "concessions", terms: ["concession", "concessions", "snack bar", "snack stand", "food stand"] },
    { tag: "playground", terms: ["playground", "park", "kids area", "play area"] },
    { tag: "shade", terms: ["shade", "shaded", "sun", "sunny", "no shade"] },
    { tag: "seating", terms: ["bleachers", "chair", "chairs", "seating", "bring a chair", "bring chairs"] },
    { tag: "water", terms: ["water fountain", "water fountains", "water", "hydration"] },
    { tag: "gate", terms: ["gate", "entrance", "entry", "check in", "check-in"] }
  ];

  for (const rule of rules) {
    for (const term of rule.terms) {
      if (hay.includes(term)) {
        tags.push(rule.tag);
        break;
      }
    }
  }

  return Array.from(new Set(tags));
}

async function getSheetsClient() {
  const email = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  const privateKey = String(process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!email || !privateKey) {
    throw new Error("Missing Google Sheets service account configuration");
  }

  const auth = new google.auth.JWT({
    email: email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  await auth.authorize();

  return google.sheets({ version: "v4", auth });
}
