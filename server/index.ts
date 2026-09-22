import { createApiServer } from "./app";
const port = Number(process.env.LUMA_API_PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("LUMA_API_PORT must be a valid TCP port.");
const server = createApiServer();
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Luma document API: http://127.0.0.1:${port}/api/v1 (local, in-memory)`,
  ),
);
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
