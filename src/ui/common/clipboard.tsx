import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";

export async function copyText(
  text: string,
  nav: Pick<Navigator, "clipboard"> = navigator,
): Promise<"copied" | "fallback"> {
  if (!nav.clipboard || typeof nav.clipboard.writeText !== "function")
    return "fallback";
  try {
    await nav.clipboard.writeText(text);
    return "copied";
  } catch {
    return "fallback";
  }
}

export function CopyFallbackModal(props: {
  text: string | null;
  onDismiss(): void;
}): JSX.Element {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const open = props.text !== null;
  useEffect(() => {
    if (!open) return;
    // The modal's focus handling runs after mount, so select on the next tick to win.
    const t = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, [open]);
  return (
    <Modal
      visible={open}
      onDismiss={props.onDismiss}
      header="Copy manually"
      closeAriaLabel="Close"
      footer={
        <Box float="right">
          <Button variant="primary" onClick={props.onDismiss}>
            Done
          </Button>
        </Box>
      }
    >
      {open && (
        <SpaceBetween size="s">
          <Box>
            Your browser blocked automatic copying. The text is selected below;
            press Ctrl+C (Cmd+C on Mac).
          </Box>
          <textarea
            ref={ref}
            readOnly
            aria-label="Text to copy"
            value={props.text ?? ""}
            rows={8}
            style={{
              width: "100%",
              boxSizing: "border-box",
              fontFamily: "var(--rc-mono, monospace)",
              fontSize: 12,
            }}
          />
        </SpaceBetween>
      )}
    </Modal>
  );
}

export function useCopy(): {
  copy(text: string): Promise<void>;
  modal: JSX.Element;
} {
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(async (text: string) => {
    if ((await copyText(text)) === "copied") {
      setFlash(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setFlash(false), 2000);
    } else {
      setFallbackText(text);
    }
  }, []);
  const modal = (
    <>
      <span role="status" aria-live="polite" className="rc-copied">
        {flash ? "Copied" : ""}
      </span>
      <CopyFallbackModal
        text={fallbackText}
        onDismiss={() => setFallbackText(null)}
      />
    </>
  );
  return { copy, modal };
}
