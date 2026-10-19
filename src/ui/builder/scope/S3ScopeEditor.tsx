import Checkbox from "@cloudscape-design/components/checkbox";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { JSX } from "react";
import type { Scope } from "../../../core/model/model";
import type { Issue } from "../../../core/types";
import { errorTextAt } from "../issues";
import { ScopeField, StringList, isRecord, str } from "./shared";

interface S3Fields {
  bucket: string;
  prefixes: string[];
  allowNavigation: boolean;
  kmsKeyArn: string;
}

function read(data: unknown): S3Fields {
  const d = isRecord(data) ? data : {};
  return {
    bucket: str(d.bucket),
    prefixes: Array.isArray(d.prefixes) ? d.prefixes.map(str) : [""],
    allowNavigation: d.allowNavigation === true,
    kmsKeyArn: str(d.kmsKeyArn),
  };
}

export function S3ScopeEditor(props: { data: unknown; issues: Issue[]; onChange(scope: Scope): void }): JSX.Element {
  const f = read(props.data);
  const err = (path: string) => errorTextAt(props.issues, path);
  const write = (patch: Partial<S3Fields>): void => {
    const { kmsKeyArn, ...rest } = { ...f, ...patch };
    // The empty prefix is meaningful (the whole bucket) and stays; a blank optional KMS key is removed.
    props.onChange({ type: "module", data: kmsKeyArn === "" ? rest : { ...rest, kmsKeyArn } });
  };
  return (
    <SpaceBetween size="m">
      <ScopeField label="Bucket" error={err("data.bucket")}>
        <Input value={f.bucket} placeholder="my-bucket" onChange={(e) => write({ bucket: e.detail.value })} />
      </ScopeField>
      <ScopeField
        label="Folders (prefixes)"
        description={
          <>
            Leave empty for the whole bucket. <code>{"${aws:username}"}</code> is allowed.
          </>
        }
        error={err("data.prefixes")}
      >
        <StringList
          item="Prefix"
          removeNoun="prefix"
          addLabel="Add prefix"
          values={f.prefixes}
          placeholder="Folder, e.g. reports/"
          focusLoneEmpty
          min={1}
          issues={props.issues}
          pathOf={(i) => `data.prefixes[${i}]`}
          onChange={(prefixes) => write({ prefixes })}
        />
      </ScopeField>
      <Checkbox checked={f.allowNavigation} onChange={(e) => write({ allowNavigation: e.detail.checked })}>
        Allow navigating to the folder
      </Checkbox>
      <ScopeField label="KMS key ARN (optional)" error={err("data.kmsKeyArn")}>
        <Input
          value={f.kmsKeyArn}
          placeholder="arn:aws:kms:us-east-1:123456789012:key/..."
          onChange={(e) => write({ kmsKeyArn: e.detail.value })}
        />
      </ScopeField>
    </SpaceBetween>
  );
}
