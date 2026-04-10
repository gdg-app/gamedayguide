// 2026-04-10
// Full replacement: /api/log-usage.js
// Adds Decision Mode analytics while preserving existing guide_build, category_click, and place_click behavior.

import { google } from "googleapis";
import crypto from "crypto";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
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
    const isPlaceClick = eventType === "place_click";
    const isDecisionEvent = eventType.indexOf("decision_") === 0;

    const searchCategory = (function resolveSearchCategory() {
      if (isCategoryClick || isPlaceClick || isDecisionEvent) {
        return String(
          body.searchCategory ||
          body.categoryLabel ||
          body.category ||
          ""
        ).trim();
      }
      return "";
    })();

    const interactionType = (function resolveInteractionType() {
      if (isCategoryClick) return "open_category";
      if (isPlaceClick) return String(body.interactionType || "open_place").trim();
      if (isDecisionEvent) return String(body.interactionType || eventType).trim();
      return "build_guide";
    })();

    const placeId = (isPlaceClick || isDecisionEvent)
      ? String(body.placeId || "").trim()
      : "";

    const resultRank = (isPlaceClick || isDecisionEvent)
      ? String(body.resultRank || "").trim()
      : "";

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
          eventId,
          eventTimeUtc,
          eventDateLocal,
          eventType,
          sessionId,
          "",
          complexName,
          "",
          fieldName,
          searchCategory,
          interactionType,
          placeId,
          resultRank,
          sourceContext,
          contextResolutionMethod,
          locationConfidence,
          hourBucketLocal,
          dayOfWeekLocal,
          String(body.appVersion || "").trim()
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
