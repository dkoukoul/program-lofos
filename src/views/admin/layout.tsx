import type { Leader } from "../../db/schema";

type AdminLayoutProps = {
  title: string;
  leader: Leader;
  children: unknown;
};

export function AdminLayout({ title, leader, children }: AdminLayoutProps) {
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
          <a class="site-title" href="/admin/programs">
            4ο Σύστημα — Διαχειριστικό
          </a>
          <span class="admin-leader">{leader.name}</span>
          <form method="post" action="/auth/logout">
            <button type="submit" class="link-button">
              Αποσύνδεση
            </button>
          </form>
        </header>
        <main class="admin-main">{children}</main>
      </body>
    </html>
  );
}
