import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(4101),
  HOST: z.string().default("0.0.0.0"),

  /** Path to the service-account JSON file for local dev. */
  GOOGLE_SERVICE_ACCOUNT_FILE: z.string().default("./google-service-account.json"),
  /** Base64-encoded service-account JSON for cloud deploys (Render etc.). When
   *  set this wins over GOOGLE_SERVICE_ACCOUNT_FILE. */
  GOOGLE_CREDENTIALS_B64: z.string().optional().default(""),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid config:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const config = parsed.data;

export interface SheetConfig {
  name: string;
  id: string;
  plateCol: number;
  tinCol: number;
  /** Specific tab to parse — needed when the file has tabs whose columns
   *  don't match this sheet's plate/TIN positions. Omit to use the first tab. */
  tab?: string;
}

/**
 * Plate→TIN sheets the lookup walks. All four are shared with the
 * sms-sync-service@lmp-sms-sync.iam.gserviceaccount.com account.
 * Column indexes are 0-based (A=0, B=1, …).
 */
export const SHEETS: SheetConfig[] = [
  // Four tabs of the same xlsx file — different column layouts each.
  {
    name: "NEEMA",
    id: "1HJHu0nI_KRvkeMMI4cFYhK0IcqijCh-v",
    tab: "NEEMA",
    plateCol: 1, // B
    tinCol: 8,   // I
  },
  {
    name: "HALIMA",
    id: "1HJHu0nI_KRvkeMMI4cFYhK0IcqijCh-v",
    tab: "HALIMA",
    plateCol: 1, // B
    tinCol: 5,   // F
  },
  {
    name: "DOUBLE TITLE",
    id: "1HJHu0nI_KRvkeMMI4cFYhK0IcqijCh-v",
    tab: "DOUBLE TITLE",
    plateCol: 1, // B
    tinCol: 11,  // L (new-owner TIN; F holds the operator's own TIN)
  },
  {
    name: "GRACE",
    id: "1HJHu0nI_KRvkeMMI4cFYhK0IcqijCh-v",
    tab: "GRACE",
    plateCol: 1, // B
    tinCol: 6,   // G
  },
  {
    name: "CUSTOMER TIN AND CARD DATABASE",
    id: "192s5yoNPqLPrphUvhwUhDILDrqlrBVklLA6r3DlVWZI",
    tab: "CARD CHANGE",
    plateCol: 2, // C
    tinCol: 10,  // K
  },
  {
    name: "ELEGANSKY TITLE CHANGING TIN",
    id: "18Q-cUMDGUg4jztvHvLO7uJlqLakiJbNaa1PvjHHwdUk",
    tab: "Sheet1",
    plateCol: 0, // A
    tinCol: 9,   // J
  },
  {
    name: "TIN NUMBER CUSTOMER",
    id: "1pc2RqQcYhgOu0uO0qMO3OC98tXHTuJ6y8TTOuyAfe_8",
    tab: "Sheet1",
    plateCol: 0, // A
    tinCol: 6,   // G
  },
  {
    name: "TIN NUMBER CUSTOMER (rJD)",
    id: "1rJDv9YVTj8_oT31Cja5YAcVjlJGNr7pQ",
    tab: "Sheet1",
    plateCol: 0, // A
    tinCol: 8,   // I
  },
  {
    name: "Vehicle Data (ELIZA NEW)",
    id: "11AhYVKEG81lZneY6JZWcir3fUiGy22mN",
    tab: "Vehicle Data",
    plateCol: 0, // A
    tinCol: 4,   // E
  },
];
