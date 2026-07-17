import type { Leader } from "../../db/schema";

type AdminLayoutProps = {
  title: string;
  leader: Leader;
  wide?: boolean;
  children: unknown;
};

export function AdminLayout({ title, leader, wide, children }: AdminLayoutProps) {
  return (
    <html lang="el">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} — program.lofos.gr</title>
        <link rel="stylesheet" href="/public/styles.css" />
        <script src="/public/vendor/htmx.min.js" defer />
      </head>
      <body class="admin">
        <header class="site-header">
          <a class="site-title" href="/admin" aria-label="Αρχική διαχειριστικού">
            <img
              class="site-logo"
              src="/public/images/%CE%9B%CE%BF%CE%B3%CF%8C%CF%84%CF%85%CF%80%CE%BF%20%CE%91%CF%80%CE%BB%CF%8C.png"
              alt=""
              aria-hidden="true"
            />
            4ο Σύστημα — Διαχειριστικό
          </a>
          <span class="admin-leader">{leader.name}</span>
          <form method="post" action="/auth/logout" class="admin-logout">
            <button type="submit" class="button">
              Αποσύνδεση
            </button>
          </form>
        </header>
        <main class={wide ? "admin-main admin-main--wide" : "admin-main"}>{children}</main>
      </body>
    </html>
  );
}
