import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { csrf } from "hono/csrf";
import auth from "./routes/auth";
import publicRoutes from "./routes/public";

const app = new Hono();

app.use(csrf());
app.use("/public/*", serveStatic({ root: "./" }));

app.get("/healthz", (c) => c.json({ status: "ok" }));

app.route("/auth", auth);
app.route("/", publicRoutes);

const port = Number(process.env.PORT ?? 3010);

export default {
  port,
  fetch: app.fetch,
};

console.log(`program-lofos listening on http://localhost:${port}`);
