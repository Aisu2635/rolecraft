import { useEnsureCatalog } from "../../state/useEnsureCatalog";
import { BuilderWorkspace } from "./BuilderWorkspace";
import { ServiceSidebar } from "./sidebar/ServiceSidebar";

/** Later tasks replace the placeholders below. */
export function Builder() {
  useEnsureCatalog();
  return (
    <BuilderWorkspace
      sidebar={<ServiceSidebar />}
      steps={[
        <p key="0">Trusted entity step</p>,
        <p key="1">Permissions step</p>,
        <p key="2">Review step</p>,
      ]}
      output={<p>Output</p>}
    />
  );
}
