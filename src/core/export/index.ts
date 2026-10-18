import { hasErrors } from "../generate";
import { exportCliBash } from "./cli-bash";
import { exportCliPowerShell } from "./cli-ps";
import { exportCloudFormation } from "./cloudformation";
import { exportJson } from "./json";
import { exportReadme } from "./readme";
import { exportTerraform } from "./terraform";
import { exportable, type ExportInput, type ExportOutcome } from "./types";

export type { ExportFile } from "./json";
export type { ExportInput, ExportOutcome } from "./types";
export { exportZip } from "./zip";

/** Every export file, in download order — or a refusal while the result has errors or nothing to export. */
export function exportAll(input: ExportInput): ExportOutcome {
  if (hasErrors(input.result.issues)) return { ok: false, reason: "Fix the errors before exporting." };
  if (!exportable(input.result, input.model)) return { ok: false, reason: "Add a permission before exporting." };
  return {
    ok: true,
    files: [
      ...exportJson(input.result),
      exportCliBash(input),
      exportCliPowerShell(input),
      exportTerraform(input),
      exportCloudFormation(input),
      exportReadme(input),
    ],
  };
}
