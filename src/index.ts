import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { csrf } from "hono/csrf";
import { syncLeadersFromConfig } from "./db/syncLeaders";
import admin from "./routes/admin";
import auth from "./routes/auth";
import publicRoutes from "./routes/public";

// Πηγή αλήθειας για ποιοι έχουν πρόσβαση είναι το config/leaders.json (§6 architecture doc) —
// συγχρονίζεται στο leaders table σε κάθε εκκίνηση/restart του server.
await syncLeadersFromConfig();

const app = new Hono();

app.use(csrf());
app.use("/public/*", serveStatic({ root: "./" }));

app.get("/healthz", (c) => c.json({ status: "ok" }));

app.route("/auth", auth);
app.route("/admin", admin);
app.route("/", publicRoutes);

const port = Number(process.env.PORT ?? 3010);

export default {
  port,
  fetch: app.fetch,
};

console.log(`program-lofos listening on http://localhost:${port}`);
