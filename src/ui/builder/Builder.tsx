import { useEnsureCatalog } from "../../state/useEnsureCatalog";
import { ExportButton } from "../export/ExportModal";
import { useFormatTabs } from "../export/FormatTabs";
import { OutputPanel } from "./output/OutputPanel";
import { ReviewStep } from "./review/ReviewStep";
import { BuilderWorkspace } from "./BuilderWorkspace";
import { PermissionsStep } from "./permissions/PermissionsStep";
import { TrustStep } from "./trust/TrustStep";
import { ServiceSidebar } from "./sidebar/ServiceSidebar";

/** Later tasks replace the placeholders below. */
export function Builder() {
  useEnsureCatalog();
  return (
    <BuilderWorkspace
      sidebar={<ServiceSidebar />}
      steps={[
        <TrustStep key="0" />,
        <PermissionsStep key="1" />,
        <ReviewStep key="2" />,
      ]}
      output={<OutputPanel useExtraTabs={useFormatTabs} actions={(input) => <ExportButton input={input} />} />}
    />
  );
}
