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
        <form method="post" action="/auth/request-link">
          <label for="email">Email</label>
          <input type="email" id="email" name="email" required autofocus />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button type="submit">Αποστολή συνδέσμου σύνδεσης</button>
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
        `}</style>
      </head>
      <body>
        <LoginForm error={error} linkSent={linkSent} returnTo={returnTo} />
      </body>
    </html>
  );
}
