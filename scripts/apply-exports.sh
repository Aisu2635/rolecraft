#!/usr/bin/env bash
# Apply every export to a local AWS emulator (moto) and compare the IAM state each format leaves.
# Run by .github/workflows/apply-exports.yml after `npm run export-fixtures`, with moto_server listening on
# $MOTO_URL and AWS_ENDPOINT_URL, dummy credentials and AWS_DEFAULT_REGION set.
#
# Per case (every directory under tmp/exports), each format starts from a fresh emulator
# (POST /moto-api/reset) plus the IAM user or group an attach-policy export expects to exist:
#   bash create-role.sh / attach-policy.sh   -> dump (the reference)
#   pwsh create-role.ps1 / attach-policy.ps1 -> dump, compared with bash's
#   terraform init + apply of main.tf, with a generated override.tf pointing the AWS provider at the
#   emulator (the export itself is never edited) -> dump, compared with bash's
#   cloudformation: the template's own "# Deploy:" command (aws cloudformation deploy), the stack must be
#   CREATE_COMPLETE, then the "# aws iam ..." commands its header says to run -> dump, compared with bash's
#   github-deploy only: terraform-oidc / cloudformation-oidc, the same with the GitHub OIDC provider
#   uncommented (derive_exports.py)
# scripts/iam_state.py dumps and compares. The run fails if an apply exits non-zero or a dump differs.
#
# moto has no EKS access entries, so `aws eks ...` goes to scripts/aws_stub.py (a shim named aws, first on
# PATH, for bash and pwsh): its first create-access-entry per principal fails with EKS's propagation
# error, so the scripts' retry path runs. Terraform's EKS resources are not applied (TF_SKIP_TYPES), and
# moto's CloudFormation skips AWS::EKS::AccessEntry, so neither is compared on eks_access_entries.
# moto's CloudFormation also ignores AWS::IAM::Role ManagedPolicyArns: for templates that use it, the
# comparison ignores roles[].attached_policies and policies[].attachment_count, and nothing else.
#
# Tool paths via env: PYTHON (default python3, needs boto3), PWSH, TERRAFORM. TF_PROVIDER_VERSION pins
# hashicorp/aws for the applies.
set -euo pipefail

PYTHON=${PYTHON:-python3}
PWSH=${PWSH:-pwsh}
TERRAFORM=${TERRAFORM:-terraform}
MOTO_URL=${MOTO_URL:-http://127.0.0.1:5000}
TF_PROVIDER_VERSION=${TF_PROVIDER_VERSION:-6.69.1}

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
exports=$root/tmp/exports
work=$root/tmp/apply
export TF_IN_AUTOMATION=1
export TF_PLUGIN_CACHE_DIR=${TF_PLUGIN_CACHE_DIR:-$work/plugin-cache}
# No lock files here: let init reuse the cached provider anyway.
export TF_PLUGIN_CACHE_MAY_BREAK_DEPENDENCY_LOCK_FILE=true
export TF_VAR_region=${AWS_DEFAULT_REGION:?set AWS_DEFAULT_REGION}
: "${AWS_ENDPOINT_URL:?set AWS_ENDPOINT_URL to the emulator}"

# Terraform resource types not applied: moto 5.2 has no EKS access entries. The CLI scripts' EKS steps run
# against scripts/aws_stub.py instead; the stub tests the retry logic, not EKS.
TF_SKIP_TYPES='^aws_eks_access_(entry|policy_association)$'
# Formats not applied for a case: "<case>/<format>" -> why (with evidence). None today.
declare -A SKIP=()
# Dump paths a format is expected to differ on by design (iam_state.py --ignore): "<case>/<format>" -> paths.
declare -A IGNORE=(
  # main.tf / template.yaml leave the GitHub OIDC provider commented out (most accounts have one); the -oidc
  # formats apply it and are compared in full.
  ["github-deploy/terraform"]="oidc_providers"
  ["github-deploy/cloudformation"]="oidc_providers"
  # moto gap: its CloudFormation has no AWS::IAM::OIDCProvider (the stack completes without it; no
  # cloudformation_type for it in moto/iam/models.py). The run still checks the derived template deploys.
  ["github-deploy/cloudformation-oidc"]="oidc_providers"
)
# moto gap: its AWS::IAM::Role ignores ManagedPolicyArns (moto/iam/models.py Role.create_from_cloudformation_json).
CFN_MANAGED_POLICY_ARNS_GAP="roles[].attached_policies policies[].attachment_count"

if [ ! -f "$exports/manifest.json" ]; then
  echo "No $exports/manifest.json: run npm run export-fixtures first." >&2
  exit 1
fi
rm -rf "$work/runs" "$work/dumps" "$work/bin"
mkdir -p "$work/runs" "$work/dumps" "$work/bin" "$TF_PLUGIN_CACHE_DIR"

# The aws shim: EKS access-entry commands go to the stub, everything else to the real CLI.
REAL_AWS=$(command -v aws)
export REAL_AWS
python_abs=$(command -v "$PYTHON")
printf '#!/bin/sh\nexec "%s" "%s" "$@"\n' "$python_abs" "$root/scripts/aws_stub.py" >"$work/bin/aws"
chmod +x "$work/bin/aws"
export PATH="$work/bin:$PATH"
[ "$(command -v aws)" = "$work/bin/aws" ] || { echo "the aws shim is not first on PATH" >&2; exit 1; }
"$REAL_AWS" --version
"$TERRAFORM" version | sed -n 1p
"$PWSH" -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'
"$PYTHON" -c 'import boto3, moto; print("boto3", boto3.__version__, "moto", moto.__version__)'

reset() { curl -sSf -X POST "$MOTO_URL/moto-api/reset" >/dev/null; }

# The IAM user or group an attach-policy export attaches to: "user <name>" / "group <name>", or nothing.
principal_of() {
  local sh=$1/attach-policy.sh kind name
  [ -f "$sh" ] || return 0
  kind=$(sed -nE 's/^# .* to an existing IAM (user|group)\.$/\1/p' "$sh")
  name=$(sed -nE "s/^PRINCIPAL_NAME='([^']+)'$/\1/p" "$sh")
  if [ -z "$kind" ] || [ -z "$name" ]; then
    echo "$sh: cannot find the existing IAM user/group it attaches to" >&2
    return 1
  fi
  echo "$kind $name"
}

seed() {
  local principal kind name
  principal=$(principal_of "$1")
  [ -n "$principal" ] || return 0
  read -r kind name <<<"$principal"
  "$REAL_AWS" iam "create-$kind" "--$kind-name=$name" >/dev/null
}

write_override() {
  cat >"$1/override.tf" <<EOF
# Generated by scripts/apply-exports.sh: point the AWS provider at the emulator.
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= $TF_PROVIDER_VERSION"
    }
  }
}

provider "aws" {
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_region_validation      = true

  endpoints {
    iam = "$AWS_ENDPOINT_URL"
    sts = "$AWS_ENDPOINT_URL"
    eks = "$AWS_ENDPOINT_URL"
  }
}
EOF
}

# Applies one format in $dir (a copy of the case directory). Prints a note for the matrix, if any.
apply() {
  local fmt=$1 dir=$2 stem
  stem=$( [ -f "$dir/create-role.sh" ] && echo create-role || echo attach-policy )
  case "$fmt" in
    bash) (cd "$dir" && bash "./$stem.sh") >&2 || return 1 ;;
    pwsh) (cd "$dir" && "$PWSH" -NoProfile -NonInteractive -File "./$stem.ps1") >&2 || return 1 ;;
    terraform | terraform-oidc)
      write_override "$dir" || return 1
      local targets=() skipped=() type label
      while read -r type label; do
        if [[ $type =~ $TF_SKIP_TYPES ]]; then skipped+=("$type.$label"); else targets+=("-target=$type.$label"); fi
      done < <(sed -nE 's/^resource "([a-z0-9_]+)" "([A-Za-z0-9_-]+)" \{$/\1 \2/p' "$dir/main.tf")
      [ "${#targets[@]}" -gt 0 ] || { echo "$dir/main.tf: no resources found" >&2; return 1; }
      "$TERRAFORM" -chdir="$dir" init -input=false -no-color >/dev/null || return 1
      if [ "${#skipped[@]}" -gt 0 ]; then
        echo "terraform: not applied (EKS, not in moto): ${skipped[*]}" >&2
        "$TERRAFORM" -chdir="$dir" apply -auto-approve -input=false -no-color "${targets[@]}" >&2 || return 1
        echo "${#skipped[@]} EKS resources not applied"
      else
        "$TERRAFORM" -chdir="$dir" apply -auto-approve -input=false -no-color >&2 || return 1
      fi
      ;;
    cloudformation | cloudformation-oidc)
      local tpl=$dir/template.yaml deploy stack region status cmd notes=()
      deploy=$(sed -n 's/^# Deploy: //p' "$tpl")
      if grep -q '^# Do not deploy this file\.$' "$tpl"; then
        [ -z "$deploy" ] || { echo "$tpl: both a Deploy command and 'Do not deploy'" >&2; return 1; }
        notes+=("no stack (the template says do not deploy)")
      else
        if [[ $deploy != "aws cloudformation deploy --template-file template.yaml --stack-name "* ]]; then
          echo "$tpl: no '# Deploy: aws cloudformation deploy ...' line" >&2
          return 1
        fi
        # The command exactly as the template tells the user to run it.
        echo "+ $deploy" >&2
        (cd "$dir" && eval "$deploy") >&2 || return 1
        stack=$(sed -nE 's/.* --stack-name ([^ ]+) .*/\1/p' <<<"$deploy")
        region=$(sed -nE "s/.* --region '([^']+)'.*/\1/p" <<<"$deploy")
        status=$(aws cloudformation describe-stacks --stack-name "$stack" ${region:+--region "$region"} \
          --query 'Stacks[0].StackStatus' --output text) || return 1
        if [ "$status" != CREATE_COMPLETE ]; then
          echo "$tpl: stack $stack is $status, not CREATE_COMPLETE" >&2
          return 1
        fi
        echo "stack $stack: $status" >&2
        notes+=("stack CREATE_COMPLETE")
        if grep -q 'Type: AWS::EKS::AccessEntry' "$tpl"; then notes+=("EKS access entries not in moto"); fi
      fi
      # Follow-up commands the header tells the user to run ("# aws iam ...", before the template body).
      while IFS= read -r cmd; do
        echo "+ $cmd" >&2
        (cd "$dir" && eval "$cmd") >&2 || return 1
        notes+=("ran the header's follow-up command")
      done < <(sed -n '/^AWSTemplateFormatVersion/q; s/^# \(aws iam .*\)$/\1/p' "$tpl")
      local IFS=';'
      echo "${notes[*]}"
      ;;
    *) echo "unknown format $fmt" >&2; return 1 ;;
  esac
}

# Checks the EKS stub saw every cluster the case's bash script(s) name: one rejected call (the retry ran),
# one create and one policy association each. Fails if the scripts name no cluster.
check_eks() {
  local dump=$1 case_dir=$2 clusters
  clusters=$(cat "$case_dir"*.sh | grep -oE "create-access-entry --cluster-name='[^']+'" |
    sed -E "s/.*cluster-name=//; s/'//g" | sort -u | paste -sd, -)
  "$PYTHON" - "$dump" "$clusters" <<'PY'
import json, sys
entries = json.load(open(sys.argv[1]))["eks_access_entries"]
want = sorted(c for c in sys.argv[2].split(",") if c)
if not want:
    sys.exit("EKS check: the scripts create access entries but no --cluster-name='...' was found")
got = sorted(e["cluster"] for e in entries)
bad = [e for e in entries if (e["rejected_calls"], e["create_calls"], len(e["policies"])) != (1, 1, 1)]
if got != want or bad:
    sys.exit(f"EKS stub: clusters {got}, expected {want}; entries not rejected/created/associated once: {bad}")
print(f"EKS stub: {len(got)} access entries, each rejected once, created once and associated once")
PY
}

# iam_state.py --ignore paths for a case and format (see IGNORE and the header).
ignores_for() {
  local case_id=$1 fmt=$2 dir=$3 paths
  paths=${IGNORE["$case_id/$fmt"]:-}
  case "$fmt" in
    terraform*) paths+=" eks_access_entries" ;;
    cloudformation*)
      paths+=" eks_access_entries"
      if grep -q '^      ManagedPolicyArns:$' "$dir/template.yaml"; then paths+=" $CFN_MANAGED_POLICY_ARNS_GAP"; fi
      ;;
  esac
  echo "$paths"
}

declare -a rows=()
failures=0
for case_dir in "$exports"/*/; do
  case_id=$(basename "$case_dir")
  formats=(bash pwsh terraform cloudformation)
  [ "$case_id" = github-deploy ] && formats+=(terraform-oidc cloudformation-oidc)
  row="| $case_id |"
  baseline=$work/dumps/$case_id.seed.json
  reset
  seed "$case_dir"
  "$PYTHON" "$root/scripts/iam_state.py" dump >"$baseline"
  for fmt in "${formats[@]}"; do
    reason=${SKIP["$case_id/$fmt"]:-}
    if [ -n "$reason" ]; then
      row+=" skipped |"
      continue
    fi
    printf '\n=== %s: %s\n' "$case_id" "$fmt"
    dir=$work/runs/$case_id/$fmt
    mkdir -p "$dir"
    if [[ $fmt == *-oidc ]]; then
      "$PYTHON" "$root/scripts/derive_exports.py" github-oidc "$case_dir" "$dir"
    else
      cp -R "$case_dir". "$dir/"
    fi
    dump=$work/dumps/$case_id.$fmt.json
    eks_log=$work/runs/$case_id/$fmt.eks.jsonl
    export EKS_STUB_LOG=$eks_log
    reset
    seed "$case_dir"
    if ! note=$(apply "$fmt" "$dir"); then
      echo "FAIL: $case_id/$fmt: apply exited non-zero" >&2
      row+=" **FAIL (apply)** |"
      failures=$((failures + 1))
      continue
    fi
    if [ "$fmt" = bash ] || [ "$fmt" = pwsh ]; then
      "$PYTHON" "$root/scripts/iam_state.py" dump --eks-log "$eks_log" >"$dump"
    else
      if [ -s "$eks_log" ]; then
        echo "FAIL: $case_id/$fmt called the EKS stub" >&2
        failures=$((failures + 1))
      fi
      "$PYTHON" "$root/scripts/iam_state.py" dump >"$dump"
    fi
    if [ "$fmt" = bash ]; then
      if "$PYTHON" "$root/scripts/iam_state.py" diff "$baseline" "$dump" --ignore eks_access_entries >/dev/null; then
        echo "FAIL: $case_id/bash changed nothing in IAM" >&2
        status="**FAIL (no change)**"
        failures=$((failures + 1))
      elif grep -q create-access-entry "$case_dir"*.sh && ! check_eks "$dump" "$case_dir"; then
        status="**FAIL (EKS)**"
        failures=$((failures + 1))
      else
        status="applied (reference)"
      fi
      echo "--- $case_id: bash dump"
      cat "$dump"
    else
      read -ra paths <<<"$(ignores_for "$case_id" "$fmt" "$dir")"
      ignore=()
      for path in "${paths[@]}"; do ignore+=(--ignore "$path"); done
      if "$PYTHON" "$root/scripts/iam_state.py" diff "$work/dumps/$case_id.bash.json" "$dump" "${ignore[@]}"; then
        status="same as bash"
        for path in "${paths[@]}"; do
          if [ "$path" != eks_access_entries ]; then status+=", except $path"; fi
        done
      else
        echo "FAIL: $case_id/$fmt: IAM state differs from bash's (diff above)" >&2
        status="**FAIL (differs)**"
        failures=$((failures + 1))
      fi
    fi
    [ -z "$note" ] || status+="; $note"
    row+=" $status |"
  done
  [ "$case_id" = github-deploy ] || row+=" n/a | n/a |"
  rows+=("$row")
done

{
  echo "## Apply exports to moto"
  echo
  echo "| case | bash | pwsh | terraform | cloudformation | terraform + OIDC provider | cloudformation + OIDC provider |"
  echo "| --- | --- | --- | --- | --- | --- | --- |"
  printf '%s\n' "${rows[@]}"
  echo
  echo "Not applied or not compared:"
  for key in "${!SKIP[@]}"; do echo "- $key: ${SKIP[$key]}"; done
  echo "- terraform aws_eks_access_entry / aws_eks_access_policy_association and CloudFormation AWS::EKS::AccessEntry: not in moto; the CLI scripts' EKS steps run against scripts/aws_stub.py (tests the retry logic, not EKS)."
  echo "- CloudFormation templates with ManagedPolicyArns on the role: roles[].attached_policies and policies[].attachment_count are not compared (moto's AWS::IAM::Role ignores ManagedPolicyArns)."
} | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"

if [ "$failures" -gt 0 ]; then
  echo "FAILED: $failures applies failed or differ from bash." >&2
  exit 1
fi
echo "OK: every export applied and matched bash's IAM state."
