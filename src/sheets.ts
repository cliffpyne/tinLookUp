import { readFileSync } from "node:fs";
import { google } from "googleapis";
import * as XLSX from "xlsx";
import { config, SHEETS, type SheetConfig } from "./config.js";

/**
 * Multi-sheet plate→TIN lookup.
 *
 * Walks the SHEETS list in order; first hit wins. Handles both native Google
 * Sheets (Sheets API) and uploaded .xlsx files (Drive download + sheetjs).
 *
 * TIN rules (per spec):
 *   - the cell value is trimmed of '-' and any non-alphanumeric punctuation
 *   - if any letter/word character remains → "TIN is invalid"
 *   - the cleaned value must be exactly 9 digits → returned as 9 plain digits
 */

export interface LookupResult {
  plate: string;
  tin: string | null;
  invalidReason?: string;   // set when a TIN cell exists but isn't 9 clean digits
  rawTin?: string;          // the original (untrimmed) cell value, for debugging
  source?: string;          // which sheet it came from
}

export function normPlate(s: string): string {
  return String(s ?? "").trim().toUpperCase().replace(/[\s\-_]+/g, "");
}

/** Find a plate-shaped substring inside a cell. Tolerates extra surrounding text. */
function extractPlate(cell: unknown): string | null {
  if (cell == null) return null;
  const s = String(cell).toUpperCase().replace(/[\s\-_]+/g, "");
  // Accept TZ moto plates (MC###XXX), 4-letter variants (MC###XXXX), and the
  // older T-series. Falls back to a generic letter-digit pattern.
  const m =
    s.match(/MC\d{3}[A-Z]{3,4}/) ||
    s.match(/T\d{3}[A-Z]{3}/) ||
    s.match(/[A-Z]{1,3}\d{3,4}[A-Z]{1,4}/);
  return m ? m[0] : null;
}

/**
 * Apply the spec to a raw TIN cell.
 *   { tin: "123456789" }                 → clean, 9-digit TIN
 *   { invalidReason: "TIN is invalid" }  → there is something there, but it has
 *                                           letters or doesn't reduce to 9 digits
 *   null                                 → cell is empty, treat as "not found"
 */
export function cleanTin(cell: unknown): { tin?: string; invalidReason?: string } | null {
  if (cell == null) return null;
  let s = String(cell).trim();
  if (!s) return null;

  // Sheets API often returns numeric cells as plain numbers — keep them.
  // Strip any character that isn't a letter or digit (i.e. drop hyphens,
  // spaces, dots, commas, slashes, etc).
  const stripped = s.replace(/[^A-Za-z0-9]/g, "");
  if (!stripped) return null;

  // Any alphabetic character → invalid per spec.
  if (/[A-Za-z]/.test(stripped)) {
    return { invalidReason: "TIN is invalid" };
  }
  if (!/^\d{9}$/.test(stripped)) {
    return { invalidReason: "TIN is invalid" };
  }
  return { tin: stripped };
}

let _authClient: unknown = null;
async function getAuth() {
  if (_authClient) return _authClient;
  // Prefer the base64-env-var path (Render etc.); fall back to the local file.
  let raw: string;
  if (config.GOOGLE_CREDENTIALS_B64) {
    raw = Buffer.from(config.GOOGLE_CREDENTIALS_B64, "base64").toString("utf-8");
  } else {
    raw = readFileSync(config.GOOGLE_SERVICE_ACCOUNT_FILE, "utf-8");
  }
  const creds = JSON.parse(raw);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });
  _authClient = await auth.getClient();
  return _authClient;
}

/** Pull the configured (or first) tab of a native Google Sheet. */
async function fetchSheetsApi(s: SheetConfig): Promise<unknown[][] | null> {
  const authClient = (await getAuth()) as never;
  const sheets = google.sheets({ version: "v4", auth: authClient });
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: s.id,
      fields: "sheets(properties(sheetId,title))",
    });
    const tabs = meta.data.sheets ?? [];
    let target = s.tab
      ? tabs.find((t) => t.properties?.title === s.tab)?.properties?.title
      : tabs[0]?.properties?.title;
    if (!target) target = tabs[0]?.properties?.title;
    if (!target) return [];
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: s.id,
      range: `${target}!A:Z`,
      majorDimension: "ROWS",
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    return (res.data.values as unknown[][]) ?? [];
  } catch (e) {
    const msg = (e as Error).message || "";
    if (msg.toLowerCase().includes("office file")) return null; // → fall through
    throw e;
  }
}

/** Per-file workbook cache so multiple configured tabs of the same xlsx
 *  don't trigger N Drive downloads — fetch once, parse tabs as needed. */
const workbookCache = new Map<string, { wb: XLSX.WorkBook; loadedAt: number }>();

async function fetchWorkbook(fileId: string): Promise<XLSX.WorkBook> {
  const hit = workbookCache.get(fileId);
  if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS) return hit.wb;
  const authClient = (await getAuth()) as never;
  const drive = google.drive({ version: "v3", auth: authClient });
  const meta = await drive.files.get({
    fileId, fields: "id,name,mimeType", supportsAllDrives: true,
  });
  const mime = meta.data.mimeType ?? "";
  let buf: Buffer;
  if (mime === "application/vnd.google-apps.spreadsheet") {
    const res = await drive.files.export(
      { fileId, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      { responseType: "arraybuffer" },
    );
    buf = Buffer.from(res.data as ArrayBuffer);
  } else {
    const res = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" },
    );
    buf = Buffer.from(res.data as ArrayBuffer);
  }
  const wb = XLSX.read(buf, { type: "buffer" });
  workbookCache.set(fileId, { wb, loadedAt: Date.now() });
  return wb;
}

/** Download via Drive (works for uploaded xlsx as well as native Sheets). */
async function fetchDrive(s: SheetConfig): Promise<unknown[][]> {
  const wb = await fetchWorkbook(s.id);
  // Only the configured tab — column layouts differ between tabs, so reading
  // them all would mis-map plate/TIN columns. Fall back to the first tab if
  // the named tab is missing.
  const targetName = s.tab && wb.SheetNames.includes(s.tab) ? s.tab : wb.SheetNames[0];
  if (!targetName) return [];
  const sh = wb.Sheets[targetName];
  if (!sh) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: "" });
}

interface SheetCacheEntry {
  rows: unknown[][];
  loadedAt: number;
}
const cache = new Map<string, SheetCacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getRows(s: SheetConfig): Promise<unknown[][]> {
  const cacheKey = s.id + "::" + (s.tab ?? "");
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS) return hit.rows;
  let rows = await fetchSheetsApi(s);
  if (rows === null) rows = await fetchDrive(s);
  cache.set(cacheKey, { rows, loadedAt: Date.now() });
  return rows;
}

/** Try one sheet — returns null if the plate isn't in it. */
async function lookupInSheet(plate: string, s: SheetConfig): Promise<LookupResult | null> {
  const target = normPlate(plate);
  const rows = await getRows(s);
  for (const r of rows) {
    if (!Array.isArray(r) || r.length === 0) continue;
    const cell = r[s.plateCol];
    const found = extractPlate(cell);
    if (!found || found !== target) continue;
    const raw = r[s.tinCol];
    const cleaned = cleanTin(raw);
    if (!cleaned) {
      // Plate is in this sheet but the TIN cell is empty — let the next
      // sheet try, since this plate might be filled in elsewhere.
      continue;
    }
    return {
      plate: target,
      tin: cleaned.tin ?? null,
      invalidReason: cleaned.invalidReason,
      rawTin: raw == null ? "" : String(raw),
      source: s.name,
    };
  }
  return null;
}

/** Walk all configured sheets in order — first plate match wins. */
export async function lookupPlate(plate: string): Promise<LookupResult> {
  const target = normPlate(plate);
  for (const s of SHEETS) {
    try {
      const hit = await lookupInSheet(target, s);
      if (hit) return hit;
    } catch (e) {
      console.error(`[sheets] ${s.name} fetch failed:`, (e as Error).message);
    }
  }
  return { plate: target, tin: null };
}

export async function lookupPlates(plates: string[]): Promise<LookupResult[]> {
  const out: LookupResult[] = [];
  for (const p of plates) {
    out.push(await lookupPlate(p));
  }
  return out;
}
