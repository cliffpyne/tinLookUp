import { config } from "./config.js";
import { buildServer } from "./server.js";

async function main() {
  const app = await buildServer();
  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(
    `TIN-scan app listening on http://${config.HOST}:${config.PORT}  (open from your phone on the same Wi-Fi)`,
  );
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
