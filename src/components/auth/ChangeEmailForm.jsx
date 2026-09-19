import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { normaliseApiError } from '../../services/apiError';
import { useAuth } from '../../store/AuthContext';

export default function ChangeEmailForm() {
  const auth = useAuth(), navigate = useNavigate(), guard = useRef(false);
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (guard.current) return;
    guard.current = true; setBusy(true); setError('');
    try {
      await api.post('auth/email-change/', { email, password });
      setPassword('');
      await auth.logout();
      navigate('/check-email', { replace: true });
    } catch (error) { setError(normaliseApiError(error)); }
    finally { guard.current = false; setBusy(false); }
  }
  return <form className="settings-form" onSubmit={submit}>
    <h3>Change account email</h3>
    <p>Your sessions will end. Verify the new address before signing in again.</p>
    {error && <p role="alert">{error}</p>}
    <label>New email address<input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)}/></label>
    <label>Current password<input type="password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)}/></label>
    <button className="page-primary-button" disabled={busy}>{busy ? 'Requesting…' : 'Request email change and sign out'}</button>
  </form>;
}
