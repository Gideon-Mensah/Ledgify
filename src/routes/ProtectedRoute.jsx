import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../store/AuthContext";

function ProtectedRoute() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.isLoading) return <div className="auth-loader">Restoring your session…</div>;
  if (!auth.isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (!auth.selectedOrganisation) {
    return <Navigate to="/select-organisation" replace />;
  }
  return <Outlet />;
}

export default ProtectedRoute;
