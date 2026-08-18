import AppRoutes from "./routes/AppRoutes";
import AppErrorBoundary from "./components/common/AppErrorBoundary";

// Renders the app component.
function App() {
  return <AppErrorBoundary><AppRoutes /></AppErrorBoundary>;
}

export default App;
