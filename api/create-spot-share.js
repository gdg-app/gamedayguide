import { google } from "googleapis";
import crypto from "crypto";

const SPOT_SHARES_SHEET_NAME =
  process.env.GOOGLE_SPOT_SHARES_SHEET_NAME || "SpotShares";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        error: "Method not allowed"
      });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    const name = String(body.name || "").trim();
    const address = String(body.address || "").trim();
    const googleMapsUrl = String(body.googleMapsUrl || "").trim();
    const appleMapsUrl = String(body.appleMapsUrl || "").trim();

    if (!name && !address) {
      return res.status(400).json({
        ok: false,
        error: "Missing spot details."
      });
    }

    const spotId = createSpotId();
    const createdAt = new Date().toISOString();

    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    await ensureSpotSharesSheetExists(sheets, spreadsheetId, SPOT_SHARES_SHEET_NAME);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SPOT_SHARES_SHEET_NAME}!A:F`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          spotId,
          createdAt,
          name,
          address,
          googleMapsUrl,
          appleMapsUrl
        ]]
      }
    });

    return res.status(200).json({
      ok: true,
      data: {
        spotId,
        createdAt,
        name,
        address,
        googleMapsUrl,
        appleMapsUrl
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

function createSpotId() {
  return crypto.randomBytes(6).toString("hex");
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

async function ensureSpotSharesSheetExists(sheets, spreadsheetId, sheetName) {
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

  const headerRange = `${sheetName}!A1:F1`;
  const headerRead = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: headerRange
  });

  const firstRow = (headerRead.data && headerRead.data.values && headerRead.data.values[0]) || [];
  const expected = ["SpotId", "CreatedAt", "Name", "Address", "GoogleMapsUrl", "AppleMapsUrl"];

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
