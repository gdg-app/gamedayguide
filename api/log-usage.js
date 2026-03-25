import { google } from "googleapis";
import crypto from "crypto";

const EVENT_LOG_SHEET_NAME =
  process.env.GOOGLE_EVENT_LOG_SHEET_NAME || "event_log";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        error: "Method not allowed"
      });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : (req.body || {});

    const eventType = String(body.eventType || "").trim();
    const sessionId = normalizeSessionId(body.sessionId);
    const queryOrGps = String(body.queryOrGps || "").trim();
    const sourceType = String(body.sourceType || "").trim().toLowerCase();
    const radius = normalizeRadius(body.radius);
    const resultCount = normalizeResultCount(body.resultCount);
    const appVersion = String(body.appVersion || "").trim();

    if (!eventType) {
      return res.status(400).json({
        ok: false,
        error: "Missing eventType"
      });
    }

    const now = new Date();
    const eventId = createEventId();
    const eventTimeUtc = now.toISOString();
    const eventDateLocal = formatLocalDate(now);
    const hourBucketLocal = formatHourBucket(now);
    const dayOfWeekLocal = formatDayOfWeek(now);

    const contextResolutionMethod =
      sourceType === "gps" ? "device_gps"
      : sourceType === "query" ? "text_search"
      : "";

    const locationConfidence =
      sourceType === "gps" ? "high"
      : sourceType === "query" ? "medium"
      : "";

    const sourceContext = detectSourceContext(body);

    const complexName = sourceType === "query" ? queryOrGps : "";
    const fieldName = sourceType === "query" ? queryOrGps : "";

    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    await ensureEventLogSheetExists(sheets, spreadsheetId, EVENT_LOG_SHEET_NAME);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${EVENT_LOG_SHEET_NAME}!A:S`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          eventId,                    // A  event_id
          eventTimeUtc,               // B  event_time_utc
          eventDateLocal,             // C  event_date_local
          eventType,                  // D  event_type
          sessionId,                  // E  session_id
          "",                         // F  complex_id
          complexName,                // G  complex_name
          "",                         // H  field_id
          fieldName,                  // I  field_name
          sourceType,                 // J  search_category
          "build_guide",              // K  interaction_type
          "",                         // L  place_id
          resultCount === null ? "" : resultCount, // M result_rank
          sourceContext,              // N  source_context
          contextResolutionMethod,    // O  context_resolution_method
          locationConfidence,         // P  location_confidence
          hourBucketLocal,            // Q  hour_bucket_local
          dayOfWeekLocal,             // R  day_of_week_local
          appVersion                  // S  app_version
        ]]
      }
    });

    return res.status(200).json({
      ok: true,
      data: {
        eventId,
        eventType,
        eventTimeUtc
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

function createEventId() {
  return crypto.randomBytes(8).toString("hex");
}

function normalizeSessionId(value) {
  const sessionId = String(value || "").trim();
  return sessionId || "unknown";
}

function normalizeRadius(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 5;
  if (n > 50) return 50;
  return n;
}

function normalizeResultCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function formatLocalDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatDayOfWeek(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long"
  }).format(date);
}

function formatHourBucket(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false
  }).formatToParts(date);

  let hour = 0;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].type === "hour") {
      hour = Number(parts[i].value);
      break;
    }
  }

  if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
    hour = 0;
  }

  return String(hour).padStart(2, "0") + ":00";
}

function detectSourceContext(body) {
  const sourceContext = String(body.sourceContext || "").trim();
  if (sourceContext) return sourceContext;

  const platform = String(body.platform || "").trim().toLowerCase();
  if (platform === "ios_webview") return "ios_webview";
  if (platform === "android_webview") return "android_webview";
  if (platform === "web_app") return "web_app";

  return "web_app";
}

function getSpreadsheetId() {
  const spreadsheetId = String(process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "").trim();
  if (!spreadsheetId) {
    throw new Error("Missing GOOGLE_SHEETS_SPREADSHEET_ID");
  }
  return spreadsheetId;
}

function getServiceAccountEmail() {
  const email = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  if (!email) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL");
  }
  return email;
}

function getPrivateKey() {
  const key = String(process.env.GOOGLE_PRIVATE_KEY || "").trim();
  if (!key) {
    throw new Error("Missing GOOGLE_PRIVATE_KEY");
  }

  return key.replace(/\\n/g, "\n");
}

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: getServiceAccountEmail(),
    key: getPrivateKey(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  await auth.authorize();

  return google.sheets({
    version: "v4",
    auth
  });
}

async function ensureEventLogSheetExists(sheets, spreadsheetId, sheetName) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId
  });

  const existingSheets = (((meta || {}).data || {}).sheets || []).map(function(sheet) {
    return sheet && sheet.properties ? sheet.properties.title : "";
  });

  if (!existingSheets.includes(sheetName)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName
              }
            }
          }
        ]
      }
    });
  }

  const headerRange = `${sheetName}!A1:S1`;
  const headerRead = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: headerRange
  });

  const firstRow = (headerRead.data && headerRead.data.values && headerRead.data.values[0]) || [];
  const expected = [
    "event_id",
    "event_time_utc",
    "event_date_local",
    "event_type",
    "session_id",
    "complex_id",
    "complex_name",
    "field_id",
    "field_name",
    "search_category",
    "interaction_type",
    "place_id",
    "result_rank",
    "source_context",
    "context_resolution_method",
    "location_confidence",
    "hour_bucket_local",
    "day_of_week_local",
    "app_version"
  ];

  const needsHeaderWrite =
    firstRow.length !== expected.length ||
    expected.some(function(value, index) {
      return firstRow[index] !== value;
    });

  if (needsHeaderWrite) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: headerRange,
      valueInputOption: "RAW",
      requestBody: {
        values: [expected]
      }
    });
  }
}
