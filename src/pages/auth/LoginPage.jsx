// Authenticate the user, then continue into organisation selection or the application.

import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { normaliseApiError } from "../../services/apiError";
import { useAuth } from "../../store/AuthContext";
import "../../styles/auth.css";

export default function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  if (!auth.isLoading && auth.isAuthenticated) {
    return <Navigate to={auth.selectedOrganisation ? "/" : "/select-organisation"} replace />;
  }
  async function submit(event) {
    event.preventDefault();
    setSubmitting(true); setError("");
    try {
      const result = await auth.login({ email, password });
      navigate(result.selected ? (location.state?.from?.pathname || "/") : "/select-organisation", {
        replace: true,
      });
    } catch (requestError) {
      setError(normaliseApiError(requestError, "Email or password is incorrect."));
    } finally { setSubmitting(false); }
  }
  return <main className="auth-screen"><form className="auth-card" onSubmit={submit}>
    <div className="auth-brand">Ledgify</div>
    <h1>Welcome back</h1><p>Sign in to continue to your accounts.</p>
    {error && <div className="auth-error" role="alert">{error}</div>}
    <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
    <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></label>
    <button type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>
  </form></main>;
}
