// SAFE PHASE 2.5 VERSION
// Keeps guide_build behavior intact and adds category_click support.

import { google } from "googleapis";
import crypto from "crypto";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const now = new Date();

    const eventId = crypto.randomBytes(8).toString("hex");
    const eventTimeUtc = now.toISOString();
    const eventDateLocal = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(now);

    const hourBucketLocal = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hour12: false
    }).format(now) + ":00";

    const dayOfWeekLocal = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "long"
    }).format(now);

    const eventType = String(body.eventType || "").trim();
    const sessionId = String(body.sessionId || "").trim();
    const sourceType = String(body.sourceType || "").toLowerCase().trim();
    const sourceContext = String(body.sourceContext || "web_app").trim();

    const isCategoryClick = eventType === "category_click";

    // Preserve current guide_build behavior, but support category_click cleanly.
    const searchCategory = isCategoryClick
      ? String(body.categoryLabel || body.searchCategory || body.category || "").trim()
      : "";

    const interactionType = isCategoryClick ? "open_category" : "build_guide";
    const placeId = "";
    const resultRank = "";

    const contextResolutionMethod =
      sourceType === "gps" ? "device_gps" :
      sourceType === "query" ? "text_search" :
      "";

    const locationConfidence =
      sourceType === "gps" ? "high" :
      sourceType === "query" ? "medium" :
      "";

    const queryOrGps = String(body.queryOrGps || "").trim();
    const complexName = queryOrGps;
    const fieldName = queryOrGps;

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "event_log!A:S",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          eventId,                  // A  event_id
          eventTimeUtc,             // B  event_time_utc
          eventDateLocal,           // C  event_date_local
          eventType,                // D  event_type
          sessionId,                // E  session_id
          "",                       // F  complex_id
          complexName,              // G  complex_name
          "",                       // H  field_id
          fieldName,                // I  field_name
          searchCategory,           // J  search_category
          interactionType,          // K  interaction_type
          placeId,                  // L  place_id
          resultRank,               // M  result_rank
          sourceContext,            // N  source_context
          contextResolutionMethod,  // O  context_resolution_method
          locationConfidence,       // P  location_confidence
          hourBucketLocal,          // Q  hour_bucket_local
          dayOfWeekLocal,           // R  day_of_week_local
          String(body.appVersion || "").trim() // S  app_version
        ]]
      }
    });

    return res.status(200).json({ ok: true });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  await auth.authorize();

  return google.sheets({ version: "v4", auth });
}
