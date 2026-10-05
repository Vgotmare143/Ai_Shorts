import { config } from "./config.js";
import { buildServer } from "./server.js";

const app = await buildServer();

try {
  await app.listen({ port: config.API_PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}