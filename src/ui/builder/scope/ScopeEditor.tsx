import type { JSX } from "react";
import type { BuildContext } from "../../../core/arn";
import type { Grant, Scope } from "../../../core/model/model";
import type { Issue, SlimService } from "../../../core/types";
import { useBuilderStore } from "../../../state/builder";
import { ArnScopeEditor } from "./ArnScopeEditor";
import { Ec2ScopeEditor } from "./Ec2ScopeEditor";
import { FieldsScopeEditor } from "./FieldsScopeEditor";
import { MODULE_FIELDS } from "./module-fields";
import { S3ScopeEditor } from "./S3ScopeEditor";

const hasFields = (id: string | undefined): id is keyof typeof MODULE_FIELDS =>
  id !== undefined && Object.hasOwn(MODULE_FIELDS, id);

/** Picks the scope editor for a grant: a module's own form, or the generic ARN picker. */
export function ScopeEditor(props: {
  grant: Grant;
  svc: SlimService;
  issues: Issue[];
  onChange(scope: Scope): void;
}): JSX.Element {
  const { grant, svc, issues, onChange } = props;
  const accountId = useBuilderStore((s) => s.model.accountId);
  const region = useBuilderStore((s) => s.model.region);
  const scope = grant.scope;
  if (scope.type === "module") {
    if (grant.module === "s3") return <S3ScopeEditor data={scope.data} issues={issues} onChange={onChange} />;
    if (grant.module === "ec2") return <Ec2ScopeEditor data={scope.data} issues={issues} onChange={onChange} />;
    if (hasFields(grant.module)) {
      return <FieldsScopeEditor moduleId={grant.module} data={scope.data} issues={issues} onChange={onChange} />;
    }
  }
  const ctx: BuildContext = {
    partition: "aws",
    ...(accountId ? { accountId } : {}),
    ...(region ? { region } : {}),
  };
  // A module scope on a grant without an editor falls back to the ARN picker, which replaces it on first edit.
  return <ArnScopeEditor scope={scope.type === "module" ? { type: "arns", arns: [] } : scope} svc={svc} ctx={ctx} onChange={onChange} />;
}
