import Flashbar from "@cloudscape-design/components/flashbar";
import { DerivedProvider } from "../../state/derive";
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
import { Tour } from "./tour/Tour";

const INVALID_LINK =
  "This share link couldn't be opened. It may be incomplete or from a newer version of RoleCraft. Starting with an empty role.";

/** Later tasks replace the placeholders below. */
export function Builder() {
  useEnsureCatalog();
  const { invalidLink, dismiss } = useShareSync();
  return (
    <DerivedProvider>
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
      <Tour />
    </DerivedProvider>
  );
}
