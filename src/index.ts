import { mkdirSync } from "node:fs";
import { config } from "./config.js";
import { startServer } from "./server.js";

mkdirSync(config.dataDir, { recursive: true });
mkdirSync(config.tvLibrary, { recursive: true });
mkdirSync(config.downloads, { recursive: true });

startServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
