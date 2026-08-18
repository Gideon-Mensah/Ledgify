// Select the organisation that scopes every later API request and permission check.

import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../store/AuthContext";
import "../../styles/auth.css";

export default function OrganisationSelectionPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  if (auth.isLoading) return <div className="auth-loader">Loading organisations…</div>;
  if (!auth.isAuthenticated) return <Navigate to="/login" replace />;
  if (auth.selectedOrganisation) return <Navigate to="/" replace />;
  return <main className="auth-screen"><section className="auth-card organisation-card">
    <div className="auth-brand">Ledgify</div><h1>Select an organisation</h1>
    {auth.organisations.length === 0
      ? <p>Your account has no active organisation memberships.</p>
      : <div className="organisation-list">{auth.organisations.map((organisation) =>
        <button key={organisation.id} type="button" onClick={async () => {
          await auth.selectOrganisation(organisation); navigate("/", { replace: true });
        }}><strong>{organisation.name}</strong><span>{organisation.role}</span></button>)}</div>}
    <button className="auth-secondary" type="button" onClick={auth.logout}>Log out</button>
  </section></main>;
}
