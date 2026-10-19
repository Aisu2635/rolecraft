import TopNavigation from "@cloudscape-design/components/top-navigation";
import { Moon, Sun } from "@phosphor-icons/react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useThemeStore } from "../state/theme";
import { requestTour } from "../state/tour";
import { useIsDesktop } from "./common/useIsDesktop";

const logoSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#ff9900"/><circle cx="23" cy="32" r="8" fill="none" stroke="#16191f" stroke-width="5"/><path d="M31 32h20M44 32v9M51 32v7" fill="none" stroke="#16191f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const logoSrc = `data:image/svg+xml;utf8,${encodeURIComponent(logoSvg)}`;

export function AppShell() {
  const navigate = useNavigate();
  const mode = useThemeStore((s) => s.mode);
  const toggle = useThemeStore((s) => s.toggle);
  // The builder (and so the tour) only exists on /builder at desktop widths.
  const desktop = useIsDesktop();
  const tourOffered = useLocation().pathname === "/builder" && desktop;
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
            ...(tourOffered ? [{ type: "button" as const, text: "Take the tour", onClick: requestTour }] : []),
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
