import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Spinner from "@cloudscape-design/components/spinner";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { JSX } from "react";
import type { ExportersState } from "./lazy";

/** What to show while the exporters chunk is not ready: a spinner, or the failure with Retry. */
export function ExporterStatus(props: { state: Pick<ExportersState, "status" | "retry"> }): JSX.Element | null {
  const { status, retry } = props.state;
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
