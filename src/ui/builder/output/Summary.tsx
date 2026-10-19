import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { JSX } from "react";
import type { ExportInput } from "../../../core/export/types";
import { StatusText } from "../../common/StatusText";

const listStyle = { margin: 0, paddingLeft: 0, listStyle: "none" } as const;

/** Plain-English list of what the role can and cannot do. The headings carry the meaning, not just the colour. */
export function Summary(props: { summary: ExportInput["summary"] }): JSX.Element {
  const { can, cannot } = props.summary;
  if (can.length === 0 && cannot.length === 0) {
    return <Box color="text-body-secondary">Nothing yet. Add a permission to see what this role can do.</Box>;
  }
  return (
    <SpaceBetween size="s">
      {can.length > 0 && (
        <div>
          <Box variant="h3">Can</Box>
          <ul style={listStyle}>
            {can.map((c) => (
              <li key={c.grantId + c.text}>
                <StatusText type="success">{c.text}</StatusText>
              </li>
            ))}
          </ul>
        </div>
      )}
      {cannot.length > 0 && (
        <div>
          <Box variant="h3">Cannot</Box>
          <ul style={listStyle}>
            {cannot.map((c) => (
              <li key={c}>
                <StatusText type="stopped">{c}</StatusText>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SpaceBetween>
  );
}
