// SAFE MINIMAL FIX VERSION
// Only fixes incorrect column mappings for guide_build events

import { google } from "googleapis";
import crypto from "crypto";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

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

    const eventType = body.eventType || "";
    const sessionId = body.sessionId || "";
    const sourceType = (body.sourceType || "").toLowerCase();

    // 🔧 FIXED MAPPINGS
    const searchCategory = ""; // always blank for guide_build
    const interactionType = "build_guide";
    const placeId = "";
    const resultRank = ""; // DO NOT use resultCount anymore

    const sourceContext = body.sourceContext || "web_app";

    const contextResolutionMethod =
      sourceType === "gps" ? "device_gps" :
      sourceType === "query" ? "text_search" : "";

    const locationConfidence =
      sourceType === "gps" ? "high" :
      sourceType === "query" ? "medium" : "";

    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "event_log!A:S",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          eventId,
          eventTimeUtc,
          eventDateLocal,
          eventType,
          sessionId,
          "",
          body.queryOrGps || "",
          "",
          body.queryOrGps || "",
          searchCategory,
          interactionType,
          placeId,
          resultRank,
          sourceContext,
          contextResolutionMethod,
          locationConfidence,
          hourBucketLocal,
          dayOfWeekLocal,
          body.appVersion || ""
        ]]
      }
    });

    return res.status(200).json({ ok: true });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
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
