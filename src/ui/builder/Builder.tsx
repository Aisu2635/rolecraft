import Flashbar from "@cloudscape-design/components/flashbar";
import { useShareSync } from "../../state/share-sync";
import { useEnsureCatalog } from "../../state/useEnsureCatalog";
import { ExportButton } from "../export/ExportModal";
import { useFormatTabs } from "../export/FormatTabs";
import { OutputPanel } from "./output/OutputPanel";
import { ShareButton } from "./output/ShareButton";
import { ReviewStep } from "./review/ReviewStep";
import { BuilderWorkspace } from "./BuilderWorkspace";
import { PermissionsStep } from "./permissions/PermissionsStep";
import { TrustStep } from "./trust/TrustStep";
import { ServiceSidebar } from "./sidebar/ServiceSidebar";

const INVALID_LINK =
  "This share link couldn't be opened. It may be incomplete or from a newer version of RoleCraft. Starting with an empty role.";

/** Later tasks replace the placeholders below. */
export function Builder() {
  useEnsureCatalog();
  const { invalidLink, dismiss } = useShareSync();
  return (
    <BuilderWorkspace
      banner={
        invalidLink && (
          <Flashbar
            items={[
              {
                type: "warning",
                dismissible: true,
                onDismiss: dismiss,
                dismissLabel: "Dismiss",
                content: INVALID_LINK,
              },
            ]}
          />
        )
      }
      sidebar={<ServiceSidebar />}
      steps={[
        <TrustStep key="0" />,
        <PermissionsStep key="1" />,
        <ReviewStep key="2" />,
      ]}
      output={
        <OutputPanel
          useExtraTabs={useFormatTabs}
          actions={(input) => <ExportButton input={input} />}
          share={<ShareButton />}
        />
      }
    />
  );
}
