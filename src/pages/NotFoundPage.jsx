import { Link } from "react-router-dom";

// Renders the not found page component.
function NotFoundPage() {
  return (
    <div className="not-found-page">
      <div className="not-found-content">
        <span className="not-found-code">404</span>

        <h1>Page not found</h1>

        <p>
          The page you’re looking for doesn’t exist or may have been moved.
        </p>

        <Link to="/" className="not-found-button">
          Return to dashboard
        </Link>
      </div>
    </div>
  );
}

export default NotFoundPage;