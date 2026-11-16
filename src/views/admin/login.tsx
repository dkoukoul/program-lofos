type LoginFormProps = {
  error?: string;
  linkSent?: boolean;
  returnTo?: string;
};

export function LoginForm({ error, linkSent, returnTo = "/" }: LoginFormProps) {
  return (
    <div class="login-form">
      <h2>Σύνδεση βαθμοφόρων</h2>
      {error && <p class="error">{error}</p>}
      {linkSent ? (
        <p class="info">
          Αν το email υπάρχει στο σύστημα, θα λάβεις σύντομα ένα μήνυμα με σύνδεσμο σύνδεσης. Ο σύνδεσμος ισχύει
          για 15 λεπτά.
        </p>
      ) : (
        // Μία φόρμα, δύο τρόποι: το κύριο κουμπί (και το Enter) κάνει σύνδεση με κωδικό — με κενό κωδικό
        // ο server στέλνει σύνδεσμο· το δεύτερο κουμπί στέλνει πάντα σύνδεσμο (formaction).
        <form method="post" action="/auth/login-password">
          <label for="email">Email</label>
          <input type="email" id="email" name="email" autocomplete="username" required autofocus />
          <label for="password">Κωδικός</label>
          <input type="password" id="password" name="password" autocomplete="current-password" />
          <p class="login-hint">Δεν έχεις κωδικό; Άφησέ το κενό και θα σου στείλουμε σύνδεσμο.</p>
          <input type="hidden" name="returnTo" value={returnTo} />
          <button type="submit">Σύνδεση</button>
          <button type="submit" formaction="/auth/request-link" class="login-link-button">
            Αποστολή συνδέσμου στο email
          </button>
        </form>
      )}
    </div>
  );
}

export function LoginPage({ error, linkSent, returnTo }: LoginFormProps) {
  return (
    <html lang="el">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Σύνδεση — program.lofos.gr</title>
        <style>{`
          body { font-family: system-ui, sans-serif; max-width: 24rem; margin: 3rem auto; padding: 0 1rem; }
          input { width: 100%; padding: 0.75rem; font-size: 1rem; box-sizing: border-box; }
          button { width: 100%; padding: 0.75rem; font-size: 1rem; margin-top: 0.75rem; min-height: 44px; }
          .error { color: #b00020; margin-bottom: 1rem; }
          .info { margin-bottom: 1rem; }
          label { display: block; margin-top: 0.75rem; }
          .login-hint { font-size: 0.85rem; color: #555; margin: 0.25rem 0 0; }
        `}</style>
      </head>
      <body>
        <LoginForm error={error} linkSent={linkSent} returnTo={returnTo} />
      </body>
    </html>
  );
}
