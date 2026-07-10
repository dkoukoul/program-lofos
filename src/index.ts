import { Hono } from "hono";

const app = new Hono();

app.get("/healthz", (c) => c.json({ status: "ok" }));

app.get("/", (c) =>
  c.html(
    "<!doctype html><html lang=\"el\"><head><meta charset=\"utf-8\"><title>program.lofos.gr</title></head>" +
      "<body><h1>4ο Σύστημα Αεροπροσκόπων Ηρακλείου</h1><p>Το πρόγραμμα έρχεται σύντομα.</p></body></html>",
  ),
);

const port = Number(process.env.PORT ?? 3010);

export default {
  port,
  fetch: app.fetch,
};

console.log(`program-lofos listening on http://localhost:${port}`);
