import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import { PDFDocument } from "pdf-lib";
import { config } from "./config.js";
import { lookupPlate, normPlate } from "./sheets.js";

/**
 * Mobile-first scan-to-PDF app.
 *
 * Flow:
 *   1. user opens the page on their phone
 *   2. enters a plate; the page calls /api/lookup to fill the TIN
 *   3. takes a photo of the document (browser opens the camera)
 *   4. enters dateOfSales (DD/MM/YYYY) and amountOfSales
 *   5. POSTs the image + fields to /api/generate; gets a PDF back named
 *      PLATE-TIN-DDMMYYYY-AMOUNT.pdf
 *   6. browser offers Share-to-WhatsApp (Web Share API) or Download
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, "..", "public");

/** "21/03/2026" → "21032026". Anything that isn't a digit is dropped. */
function dateForFilename(s: string): string {
  return String(s ?? "").replace(/\D+/g, "");
}

/** Keep just digits, drop currency commas / decimals / etc. */
function amountForFilename(s: string): string {
  return String(s ?? "").replace(/[^\d]/g, "");
}

/** Force-safe filename component (no slashes, control chars, etc.). */
function safe(s: string): string {
  return String(s).replace(/[^A-Za-z0-9_-]+/g, "");
}

export async function buildServer() {
  const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });
  await app.register(fastifyStatic, { root: publicDir, prefix: "/" });
  await app.register(fastifyMultipart, {
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per photo
  });

  /** Plate → TIN. Returns { tin } when ok, or { error } when missing/invalid. */
  app.get<{ Querystring: { plate?: string } }>("/api/lookup", async (req, reply) => {
    const plate = String(req.query.plate ?? "").trim();
    if (!plate) return reply.code(400).send({ error: "plate is required" });
    const r = await lookupPlate(plate);
    if (r.tin) {
      return reply.send({ plate: r.plate, tin: r.tin, source: r.source ?? null });
    }
    if (r.invalidReason) {
      return reply.code(422).send({
        plate: r.plate,
        error: r.invalidReason,
        rawTin: r.rawTin ?? "",
        source: r.source ?? null,
      });
    }
    return reply.code(404).send({ plate: r.plate, error: "plate not found in any sheet" });
  });

  /**
   * Build the PDF. Accepts multipart:
   *   - photo  : the camera image (jpg/png)
   *   - plate  : string
   *   - tin    : 9-digit TIN (client-side already cleaned)
   *   - date   : DD/MM/YYYY
   *   - amount : digits
   *
   * Returns the PDF bytes with Content-Disposition naming it correctly.
   */
  app.post("/api/generate", async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.code(400).send({ error: "multipart/form-data required" });
    }

    let imgBuf: Buffer | null = null;
    let imgMime = "";
    const fields: Record<string, string> = {};

    for await (const part of req.parts()) {
      if (part.type === "file") {
        if (part.fieldname === "photo") {
          imgBuf = await part.toBuffer();
          imgMime = part.mimetype || "";
        } else {
          await part.toBuffer(); // drain
        }
      } else {
        fields[part.fieldname] = String(part.value ?? "");
      }
    }

    if (!imgBuf) return reply.code(400).send({ error: "photo is required" });
    const plate = normPlate(fields.plate ?? "");
    const tin = safe(fields.tin ?? "");
    const date = dateForFilename(fields.date ?? "");
    const amount = amountForFilename(fields.amount ?? "");
    if (!plate || !tin || !date || !amount) {
      return reply.code(400).send({
        error: "missing fields",
        need: ["plate", "tin", "date", "amount"],
        got: { plate, tin, date, amount },
      });
    }

    // Embed the camera photo into a single-page PDF sized to the image.
    const pdf = await PDFDocument.create();
    let img;
    if (imgMime.includes("png")) {
      img = await pdf.embedPng(imgBuf);
    } else {
      // pdf-lib only does PNG/JPEG natively. Browsers from phones tend to
      // capture JPEG by default; treat anything non-PNG as JPEG.
      img = await pdf.embedJpg(imgBuf);
    }
    const page = pdf.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    const bytes = await pdf.save();

    const filename = `${plate}-${tin}-${date}-${amount}.pdf`;
    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(Buffer.from(bytes));
  });

  return app;
}
