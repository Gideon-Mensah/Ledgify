import { useAuth } from "../../store/AuthContext";
import { useState } from "react";
import { Outlet } from "react-router-dom";
import Header from "./Header";
import Sidebar from "./Sidebar";

// Renders the main layout component.
function MainLayout() {
  const { selectedOrganisation } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Toggles sidebar.
  const toggleSidebar = () => {
    setCollapsed((currentValue) => !currentValue);
  };

  // Opens mobile menu.
  const openMobileMenu = () => {
    setMobileOpen(true);
  };

  // Closes mobile menu.
  const closeMobileMenu = () => {
    setMobileOpen(false);
  };

  return (
    <div
      className={[
        "app-layout",
        collapsed ? "app-layout-sidebar-collapsed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={toggleSidebar}
        mobileOpen={mobileOpen}
        onCloseMobile={closeMobileMenu}
      />

      <div className="app-content">
        <Header key={selectedOrganisation?.id || "loading"} onOpenMobileMenu={openMobileMenu} />

        <main className="main-content">
          <Outlet key={selectedOrganisation?.id || "loading"} />
        </main>
      </div>
    </div>
  );
}

export default MainLayout;