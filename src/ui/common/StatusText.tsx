import StatusIndicator, { type StatusIndicatorProps } from "@cloudscape-design/components/status-indicator";
import type { JSX, ReactNode } from "react";

export type StatusType = StatusIndicatorProps.Type;

/**
 * A Cloudscape StatusIndicator whose text wraps between words. Its default inline-block display breaks words
 * anywhere ("generate a polic" / "y."), so the wrapper class lets global.css restore normal wrapping.
 */
export function StatusText(props: { type: StatusType; children: ReactNode }): JSX.Element {
  return (
    <span className="rc-status-text">
      <StatusIndicator type={props.type}>{props.children}</StatusIndicator>
    </span>
  );
}
