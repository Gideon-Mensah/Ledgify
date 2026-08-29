import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { authService } from "../../services/authService";
import "../../styles/auth.css";
import "../../styles/authReset.css";

function strengthFor(password) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return ["Too weak", "Weak", "Fair", "Good", "Strong"][score];
}

export default function ResetPasswordPage() {
  const { uid, token } = useParams();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const invalidRoute = !uid || !token || uid.length > 128 || token.length > 256;
  const strength = useMemo(() => strengthFor(password), [password]);
  useEffect(() => {
    const meta = document.querySelector('meta[name="referrer"]');
    const previous = meta?.content;
    if (meta) meta.content = "no-referrer";
    return () => { if (meta) meta.content = previous || "strict-origin-when-cross-origin"; };
  }, []);
  async function submit(event) {
    event.preventDefault();
    if (password !== confirmation) { setError("The passwords do not match."); return; }
    setSubmitting(true); setError("");
    try {
      await authService.confirmPasswordReset({ uid, token, new_password: password, confirm_password: confirmation });
      setPassword(""); setConfirmation(""); setSuccess(true);
    } catch (requestError) {
      const data = requestError?.data || {};
      const messages = Object.values(data).flat().map(String);
      setError(data.token || data.uid ? "This password reset link is invalid or has expired." : (messages.join(" ") || "We could not reset your password. Please try again."));
    } finally { setSubmitting(false); }
  }
  if (invalidRoute) return <main className="auth-screen"><section className="auth-card">
    <div className="auth-brand">Ledgify</div><h1>Invalid reset link</h1><div className="auth-error" role="alert">This password reset link is invalid or has expired.</div>
    <Link className="auth-primary-link" to="/forgot-password">Request another reset link</Link><Link className="auth-back-link" to="/login">Return to Login</Link>
  </section></main>;
  if (success) return <main className="auth-screen"><section className="auth-card">
    <div className="auth-brand">Ledgify</div><h1>Password reset complete</h1><div className="auth-success" role="status"><p>Your password has been reset successfully. You can now sign in with your new password.</p></div>
    <Link className="auth-primary-link" to="/login">Return to Login</Link>
  </section></main>;
  return <main className="auth-screen"><section className="auth-card">
    <div className="auth-brand">Ledgify</div><h1>Reset your password</h1><p>Choose a strong password that you haven’t used for this account before.</p>
    {error && <div className="auth-error" role="alert">{error}</div>}
    <form onSubmit={submit}>
      <label>New password<input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" /></label>
      <label>Confirm password<input type={showPassword ? "text" : "password"} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" /></label>
      <label className="auth-check"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} /> Show passwords</label>
      <div className="password-guidance" aria-live="polite"><strong>Strength: {strength}</strong><span>Use at least 8 characters. Avoid common, entirely numeric, or account-related passwords.</span></div>
      <button type="submit" disabled={submitting}>{submitting ? "Resetting…" : "Reset password"}</button>
    </form>
    <Link className="auth-back-link" to="/forgot-password">Request another reset link</Link><Link className="auth-back-link" to="/login">Return to Login</Link>
  </section></main>;
}
