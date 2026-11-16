import type { Leader } from "../../db/schema";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type AuthMethod } from "../../lib/auth";
import { InfoTip } from "./info-tip";
import { AdminLayout } from "./layout";

type AccountPageProps = {
  leader: Leader;
  authMethod: AuthMethod;
  error?: string;
  saved?: boolean;
};

/** Ζητάμε τον τρέχοντα κωδικό μόνο αν υπάρχει κωδικός ΚΑΙ η σύνδεση έγινε με κωδικό (§5 architecture doc). */
export function requiresCurrentPassword(leader: Leader, authMethod: AuthMethod): boolean {
  return !!leader.passwordHash && authMethod === "password";
}

export function AccountPage({ leader, authMethod, error, saved }: AccountPageProps) {
  const hasPassword = !!leader.passwordHash;
  const needsCurrent = requiresCurrentPassword(leader, authMethod);

  return (
    <AdminLayout title="Ο λογαριασμός μου" leader={leader}>
      <h1>Ο λογαριασμός μου</h1>
      <p>
        Συνδέεσαι ως <strong>{leader.name}</strong> ({leader.email}).
      </p>

      <section class="account-section">
        <h2>
          Κωδικός σύνδεσης{" "}
          <InfoTip text="Ο κωδικός είναι προαιρετικός. Με αυτόν συνδέεσαι αμέσως με το email σου + κωδικό, χωρίς να περιμένεις σύνδεσμο στο email. Ο σύνδεσμος στο email παραμένει πάντα διαθέσιμος — αν ξεχάσεις τον κωδικό, συνδέσου με σύνδεσμο και όρισε νέο εδώ." />
        </h2>
        {saved && <p class="success">Ο κωδικός αποθηκεύτηκε. Οι υπόλοιπες συνδέσεις σου (άλλες συσκευές) αποσυνδέθηκαν.</p>}
        {error && <p class="error">{error}</p>}
        <p class="hint">
          {hasPassword
            ? "Έχεις ορίσει κωδικό. Μπορείς να τον αλλάξεις παρακάτω."
            : "Δεν έχεις ορίσει κωδικό ακόμα — συνδέεσαι μόνο με σύνδεσμο στο email."}
        </p>

        <form method="post" action="/admin/account/password" class="account-form">
          {/* Για τους password managers: συνδέει τον νέο κωδικό με το σωστό username. */}
          <input type="email" name="username" value={leader.email} autocomplete="username" readonly hidden />
          {needsCurrent && (
            <>
              <label for="currentPassword">Τρέχων κωδικός</label>
              <input
                type="password"
                id="currentPassword"
                name="currentPassword"
                autocomplete="current-password"
                required
              />
            </>
          )}
          <label for="newPassword">{hasPassword ? "Νέος κωδικός" : "Κωδικός"}</label>
          <input
            type="password"
            id="newPassword"
            name="newPassword"
            autocomplete="new-password"
            minlength={PASSWORD_MIN_LENGTH}
            maxlength={PASSWORD_MAX_LENGTH}
            required
          />
          <p class="hint">Τουλάχιστον {PASSWORD_MIN_LENGTH} χαρακτήρες.</p>
          <label for="confirmPassword">Επανάληψη κωδικού</label>
          <input
            type="password"
            id="confirmPassword"
            name="confirmPassword"
            autocomplete="new-password"
            minlength={PASSWORD_MIN_LENGTH}
            maxlength={PASSWORD_MAX_LENGTH}
            required
          />
          <button type="submit" class="button button-primary">
            {hasPassword ? "Αλλαγή κωδικού" : "Ορισμός κωδικού"}
          </button>
        </form>
      </section>
    </AdminLayout>
  );
}
