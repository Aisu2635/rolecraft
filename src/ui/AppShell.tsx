import TopNavigation from "@cloudscape-design/components/top-navigation";
import { Key, Moon, Sun } from "@phosphor-icons/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Outlet, useNavigate } from "react-router-dom";
import { useThemeStore } from "../state/theme";

const logoSrc = `data:image/svg+xml;utf8,${encodeURIComponent(
  renderToStaticMarkup(
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="6" fill="#ff9900" />
      <g transform="translate(6 6)">
        <Key size={20} weight="bold" color="#16191f" />
      </g>
    </svg>,
  ),
)}`;

export function AppShell() {
  const navigate = useNavigate();
  const mode = useThemeStore((s) => s.mode);
  const toggle = useThemeStore((s) => s.toggle);
  const go = (href: string) => (e: CustomEvent) => {
    e.preventDefault();
    void navigate(href);
  };
  return (
    <>
      <div id="top-nav">
        <TopNavigation
          identity={{
            href: "/",
            title: "RoleCraft",
            logo: { src: logoSrc, alt: "" },
            onFollow: go("/"),
          }}
          utilities={[
            { type: "button", text: "Templates", href: "/templates", onFollow: go("/templates") },
            { type: "button", text: "Builder", href: "/builder", onFollow: go("/builder") },
            {
              type: "button",
              text: "GitHub",
              href: "https://github.com/",
              external: true,
              externalIconAriaLabel: "(opens in a new tab)",
            },
            {
              type: "button",
              iconSvg: mode === "dark" ? <Sun size={16} /> : <Moon size={16} />,
              ariaLabel: mode === "dark" ? "Switch to light theme" : "Switch to dark theme",
              onClick: toggle,
            },
          ]}
        />
      </div>
      <Outlet />
    </>
  );
}
