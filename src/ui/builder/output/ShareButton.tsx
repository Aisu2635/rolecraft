import Button from "@cloudscape-design/components/button";
import type { JSX } from "react";
import { useBuilderStore } from "../../../state/builder";
import { syncHash } from "../../../state/share-sync";
import { useCopy } from "../../common/clipboard";

const TOO_LARGE = "This role is too large to share as a link. Export it instead.";

/** Copies a link that restores this exact role. The URL is written right before copying, so a pending edit is included. */
export function ShareButton(): JSX.Element {
  const tooLarge = useBuilderStore((s) => s.shareStatus === "too-large");
  const { copy, modal } = useCopy();
  const share = (): void => {
    const status = syncHash(useBuilderStore.getState().model, window.location, window.history);
    useBuilderStore.getState().setShareStatus(status);
    if (status === "ok") void copy(window.location.href);
  };
  return (
    <>
      <Button iconName="share" disabled={tooLarge} ariaDescribedby={tooLarge ? "rc-share-note" : undefined} onClick={share}>
        Share
      </Button>
      {tooLarge && (
        <span id="rc-share-note" style={{ fontSize: 12 }}>
          {TOO_LARGE}
        </span>
      )}
      {modal}
    </>
  );
}
