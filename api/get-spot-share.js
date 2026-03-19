import { google } from "googleapis";

const SPOT_SHARES_SHEET_NAME =
  process.env.GOOGLE_SPOT_SHARES_SHEET_NAME || "SpotShares";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        ok: false,
        error: "Method not allowed"
      });
    }

    const spotId = String((req.query && req.query.spotId) || "").trim();

    if (!spotId) {
      return res.status(400).json({
        ok: false,
        error: "Missing spotId"
      });
    }

    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SPOT_SHARES_SHEET_NAME}!A:F`
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
      if (String(row[0] || "").trim() === spotId) {
        return res.status(200).json({
          ok: true,
          data: {
            spotId: String(row[0] || "").trim(),
            createdAt: row[1] || "",
            name: row[2] || "",
            address: row[3] || "",
            googleMapsUrl: row[4] || "",
            appleMapsUrl: row[5] || ""
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
