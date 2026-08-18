import { useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { mainNavigation } from "../../routes/routeConfig";
import { useAuth } from "../../store/AuthContext";

// Renders the sidebar component.
function Sidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
}) {
  const auth = useAuth();
  const [openSections, setOpenSections] = useState({
    Sales: true,
    "Fixed Assets": true,
  });

  // Toggles section.
  const toggleSection = (label) => {
    if (collapsed) {
      return;
    }

    setOpenSections((currentSections) => ({
      ...currentSections,
      [label]: !currentSections[label],
    }));
  };

  // Handles navigation.
  const handleNavigation = () => {
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          className="sidebar-overlay"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
        />
      )}

      <aside
        className={[
          "sidebar",
          collapsed ? "sidebar-collapsed" : "",
          mobileOpen ? "sidebar-mobile-open" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="sidebar-brand">
          <div className="sidebar-logo">L</div>

          {!collapsed && (
            <div className="sidebar-brand-text">
              <strong>Ledgify</strong>
              <span>Accounting</span>
            </div>
          )}

          <button
            type="button"
            className="sidebar-mobile-close"
            onClick={onCloseMobile}
            aria-label="Close navigation menu"
          >
            <X size={20} />
          </button>
        </div>

        <nav
          className="sidebar-navigation"
          aria-label="Main navigation"
        >
          {mainNavigation.filter((item) => !item.permission || auth.hasPermission(item.permission)).map((item) => {
            const Icon = item.icon;
            const isSectionOpen = openSections[item.label];

            if (item.children) {
              return (
                <div
                  key={item.label}
                  className="sidebar-section"
                >
                  <button
                    type="button"
                    className="sidebar-link sidebar-section-button"
                    onClick={() => toggleSection(item.label)}
                    title={collapsed ? item.label : undefined}
                    aria-expanded={isSectionOpen}
                  >
                    <span className="sidebar-link-content">
                      <Icon size={20} />

                      {!collapsed && (
                        <span className="sidebar-link-label">
                          {item.label}
                        </span>
                      )}
                    </span>

                    {!collapsed && (
                      <ChevronDown
                        size={17}
                        className={
                          isSectionOpen
                            ? "sidebar-chevron sidebar-chevron-open"
                            : "sidebar-chevron"
                        }
                      />
                    )}
                  </button>

                  {!collapsed && isSectionOpen && (
                    <div className="sidebar-submenu">
                      {item.children.map((child) => (
                        <NavLink
                          key={child.path}
                          to={child.path}
                          onClick={handleNavigation}
                          className={({ isActive }) =>
                            isActive
                              ? "sidebar-sublink sidebar-sublink-active"
                              : "sidebar-sublink"
                          }
                        >
                          <span className="sidebar-submenu-dot" />

                          <span>{child.label}</span>
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                onClick={handleNavigation}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  isActive
                    ? "sidebar-link sidebar-link-active"
                    : "sidebar-link"
                }
              >
                <span className="sidebar-link-content">
                  <Icon size={20} />

                  {!collapsed && (
                    <span className="sidebar-link-label">
                      {item.label}
                    </span>
                  )}
                </span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          {!collapsed && (
            <div className="sidebar-company-card">
              <div className="sidebar-company-avatar">
                LD
              </div>

              <div className="sidebar-company-details">
                <strong>{auth.selectedOrganisation?.name || "Select organisation"}</strong>
                <span>{auth.selectedOrganisation?.base_currency || ""} accounting</span>
              </div>
            </div>
          )}

          <button
            type="button"
            className="sidebar-collapse-button"
            onClick={onToggleCollapse}
            aria-label={
              collapsed
                ? "Expand sidebar"
                : "Collapse sidebar"
            }
          >
            {collapsed ? (
              <ChevronRight size={18} />
            ) : (
              <>
                <ChevronLeft size={18} />
                <span>Collapse sidebar</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
