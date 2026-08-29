import { useState } from "react";
import { Link } from "react-router-dom";
import { authService } from "../../services/authService";
import "../../styles/auth.css";
import "../../styles/authReset.css";

const CONFIRMATION = "If an account exists for that email address, we’ve sent a password reset link.";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  async function submit(event) {
    event.preventDefault();
    const normalisedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalisedEmail)) {
      setError("Enter a valid email address."); return;
    }
    setSubmitting(true); setError("");
    try { await authService.requestPasswordReset(normalisedEmail); setSubmitted(true); }
    catch { setError("We could not submit your request. Please try again shortly."); }
    finally { setSubmitting(false); }
  }
  return <main className="auth-screen"><section className="auth-card">
    <div className="auth-brand">Ledgify</div><h1>Forgot your password?</h1>
    {submitted ? <div className="auth-success" role="status"><p>{CONFIRMATION}</p></div> : <>
      <p>Enter the email connected to your account and we’ll send you a secure reset link.</p>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <form onSubmit={submit} noValidate>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} autoComplete="email" /></label>
        <button type="submit" disabled={submitting}>{submitting ? "Sending…" : "Send reset link"}</button>
      </form>
    </>}
    <Link className="auth-back-link" to="/login">Back to Login</Link>
  </section></main>;
}
