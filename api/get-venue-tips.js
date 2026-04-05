import { google } from "googleapis";

export default async function handler(req, res) {
  try {
    const placeId = String((req.query && req.query.placeId) || "").trim();

    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    if (!placeId) {
      return res.status(400).json({
        ok: false,
        error: "Missing placeId"
      });
    }

    const spreadsheetId = String(process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "").trim();
    if (!spreadsheetId) {
      return res.status(500).json({
        ok: false,
        error: "Missing GOOGLE_SHEETS_SPREADSHEET_ID"
      });
    }

    const sheets = await getSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "venue_tips!A:I"
    });

    const rows = Array.isArray(response.data && response.data.values)
      ? response.data.values
      : [];

    if (!rows.length) {
      return res.status(200).json({ ok: true, data: [] });
    }

    const dataRows = rows.slice(1);
    const matches = dataRows
      .map(function(row) {
        return {
          tipId: String(row[0] || "").trim(),
          createdAtUtc: String(row[1] || "").trim(),
          venuePlaceId: String(row[2] || "").trim(),
          venueName: String(row[3] || "").trim(),
          venueAddress: String(row[4] || "").trim(),
          tipText: String(row[5] || "").trim(),
          tipTags: String(row[6] || "").trim(),
          tipStatus: String(row[7] || "").trim(),
          sessionId: String(row[8] || "").trim()
        };
      })
      .filter(function(item) {
        return (
          item.venuePlaceId === placeId &&
          item.tipText &&
          String(item.tipStatus || "").toLowerCase() !== "hidden"
        );
      })
      .sort(function(a, b) {
        const aTime = Date.parse(a.createdAtUtc || "") || 0;
        const bTime = Date.parse(b.createdAtUtc || "") || 0;
        return bTime - aTime;
      })
      .slice(0, 3);

    return res.status(200).json({
      ok: true,
      data: matches
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
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
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  });

  await auth.authorize();

  return google.sheets({ version: "v4", auth });
}

