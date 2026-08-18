import { useState } from "react";
import { Outlet } from "react-router-dom";
import Header from "./Header";
import Sidebar from "./Sidebar";

// Renders the main layout component.
function MainLayout() {
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
        <Header onOpenMobileMenu={openMobileMenu} />

        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default MainLayout;