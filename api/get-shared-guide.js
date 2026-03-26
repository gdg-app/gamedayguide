import { google } from "googleapis";

const SHARED_GUIDES_SHEET_NAME =
  process.env.GOOGLE_SHARED_GUIDES_SHEET_NAME || "SharedGuides";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        ok: false,
        error: "Method not allowed"
      });
    }

    const shareId = String((req.query && req.query.shareId) || "").trim();

    if (!shareId) {
      return res.status(400).json({
        ok: false,
        error: "Missing shareId"
      });
    }

    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHARED_GUIDES_SHEET_NAME}!A:G`
    });

    const rows = (response.data && response.data.values) || [];

    if (rows.length <= 1) {
      return res.status(200).json({
        ok: true,
        data: null
      });
    }

    for (let i = rows.length - 1; i >= 1; i--) {
      const row = rows[i] || [];

      if (String(row[0] || "").trim() === shareId) {
        const isNewFormat = row.length >= 7;

        return res.status(200).json({
          ok: true,
          data: {
            shareId: String(row[0] || "").trim(),
            createdAt: row[1] || "",
            sourceType: isNewFormat ? row[2] : row[2],
            queryOrGps: isNewFormat ? row[3] : row[3],
            radius: Number(isNewFormat ? row[4] : row[4] || 5),
            results: safeJsonParseArray(isNewFormat ? row[5] : row[5]),
            shareType: isNewFormat
              ? normalizeShareType(row[6])
              : "full_guide"
          }
        });
      }
    }

    return res.status(200).json({
      ok: true,
      data: null
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

function normalizeShareType(value) {
  var v = String(value || "").trim().toLowerCase();
  if (v === "selected_places") return "selected_places";
  return "full_guide";
}

function safeJsonParseArray(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
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
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  });

  await auth.authorize();

  return google.sheets({
    version: "v4",
    auth
  });
}
