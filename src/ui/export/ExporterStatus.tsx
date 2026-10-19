import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Spinner from "@cloudscape-design/components/spinner";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { JSX } from "react";
import { useBuilderStore } from "../../state/builder";
import { syncHash } from "../../state/share-sync";
import type { ExportersState } from "./lazy";

const UPDATED = "RoleCraft has been updated. Reload to continue.";
const TOO_LARGE = "This role is too large to keep in the link. Export or copy it before reloading.";

/** After a redeploy: Reload, with the role written into the link first so the reload restores it. */
function StaleNotice(props: { reload: () => void }): JSX.Element {
  const tooLarge = useBuilderStore((s) => s.shareStatus === "too-large");
  const reload = (): void => {
    // Flush now: the debounced hash write would be lost to the reload.
    const status = syncHash(useBuilderStore.getState().model, window.location, window.history);
    useBuilderStore.getState().setShareStatus(status);
    props.reload();
  };
  return (
    <SpaceBetween size="s">
      {tooLarge ? (
        <>
          <Box>{UPDATED}</Box>
          <Alert type="warning">{TOO_LARGE}</Alert>
        </>
      ) : (
        <Box>{UPDATED} Your role is kept in the link.</Box>
      )}
      <Button onClick={reload}>Reload</Button>
    </SpaceBetween>
  );
}

/** What to show while the exporters chunk is not ready: a spinner, the failure with Retry, or Reload after a redeploy. */
export function ExporterStatus(props: {
  state: Pick<ExportersState, "status" | "retry" | "stale">;
  /** Tests only: what Reload calls after writing the link. */
  reload?: () => void;
}): JSX.Element | null {
  const { status, retry, stale } = props.state;
  if (stale && status !== "ready") return <StaleNotice reload={props.reload ?? (() => window.location.reload())} />;
  if (status === "error") {
    return (
      <SpaceBetween size="s">
        <Box>Couldn&apos;t load the exporters. Check your connection and try again.</Box>
        <Button onClick={retry}>Retry</Button>
      </SpaceBetween>
    );
  }
  if (status === "idle" || status === "loading") {
    return (
      <Box textAlign="center" padding="l">
        <Spinner /> Loading exporters…
      </Box>
    );
  }
  return null;
}
