import { Builder } from "../builder/Builder";
import { BuilderErrorBoundary } from "../builder/BuilderErrorBoundary";
import { DesktopOnlyCard } from "../builder/DesktopOnlyCard";
import { useIsDesktop } from "../common/useIsDesktop";

export function BuilderPage() {
  return useIsDesktop() ? (
    <BuilderErrorBoundary>
      <Builder />
    </BuilderErrorBoundary>
  ) : (
    <DesktopOnlyCard />
  );
}
