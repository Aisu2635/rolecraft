#!/usr/bin/env bash
# Layer-4 export tooling checks: runs the real tools on the files `npm run export-fixtures` wrote.
# Same script in CI (.github/workflows/export-tooling.yml) and locally:
#   npm run export-fixtures && bash scripts/check-exports.sh
# Tool paths via env: SHELLCHECK, PWSH, TERRAFORM, CFN_LINT (default cfn-lint), PYTHON (default python3).
# Needs PSScriptAnalyzer installed for pwsh (scripts/check-powershell.ps1), and botocore + PyYAML for $PYTHON.
set -euo pipefail

SHELLCHECK=${SHELLCHECK:-shellcheck}
PWSH=${PWSH:-pwsh}
TERRAFORM=${TERRAFORM:-terraform}
CFN_LINT=${CFN_LINT:-cfn-lint}
PYTHON=${PYTHON:-python3}

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
exports=tmp/exports
work=tmp/tfcheck
export TF_PLUGIN_CACHE_DIR=${TF_PLUGIN_CACHE_DIR:-$root/$work/plugin-cache}
export TF_IN_AUTOMATION=1
mkdir -p "$TF_PLUGIN_CACHE_DIR"

step() { printf '\n=== %s\n' "$*"; }

shopt -s nullglob
sh_files=("$exports"/*/*.sh)
ps_files=("$exports"/*/*.ps1)
tf_files=("$exports"/*/main.tf)
cfn_files=()
for f in "$exports"/*/template.yaml; do
  # Comment-only templates ("Do not deploy this file.") have no resources to lint.
  if ! grep -q '^# Do not deploy this file\.$' "$f"; then cfn_files+=("$f"); fi
done
shopt -u nullglob
if [ "${#sh_files[@]}" -eq 0 ] || [ "${#ps_files[@]}" -eq 0 ] || [ "${#tf_files[@]}" -eq 0 ] || [ "${#cfn_files[@]}" -eq 0 ]; then
  echo "No exports under $exports: run npm run export-fixtures first." >&2
  exit 1
fi

step "shellcheck (${#sh_files[@]} files)"
"$SHELLCHECK" --version | sed -n 2p
"$SHELLCHECK" "${sh_files[@]}"
echo "OK: shellcheck found nothing in ${#sh_files[@]} files."

step "PSScriptAnalyzer + parser (${#ps_files[@]} files)"
"$PWSH" -NoProfile -NonInteractive -File scripts/check-powershell.ps1 -Path "$exports"

step "terraform (${#tf_files[@]} configurations, as generated and on the lowest allowed provider)"
"$TERRAFORM" version | head -n 1
rm -rf "$work/runs"
for pass in generated lowest; do
  for tf in "${tf_files[@]}"; do
    case_dir=$(dirname "$tf")
    dir="$work/runs/$pass/$(basename "$case_dir")"
    mkdir -p "$dir"
    cp "$case_dir/main.tf" "$dir/"
    if [ "$pass" = lowest ]; then
      # ">= 5.81, < 7.0" -> "= 5.81.0": users on the oldest provider the constraint allows must work too.
      sed -E -i 's/version = ">= ([0-9]+\.[0-9]+), < [0-9.]+"/version = "= \1.0"/' "$dir/main.tf"
      grep -Eq 'version = "= [0-9]+\.[0-9]+\.0"' "$dir/main.tf" || { echo "$tf: cannot pin the provider version" >&2; exit 1; }
    fi
    echo "--- $pass: $(basename "$case_dir")"
    "$TERRAFORM" -chdir="$dir" fmt -check -diff
    "$TERRAFORM" -chdir="$dir" init -backend=false -input=false -no-color >/dev/null
    echo "hashicorp/aws $(sed -nE 's/^ *version *= *"([^"]+)"/\1/p' "$dir/.terraform.lock.hcl")"
    "$TERRAFORM" -chdir="$dir" validate -no-color
  done
done
echo "OK: terraform fmt/init/validate passed for ${#tf_files[@]} configurations x 2 provider versions."

step "cfn-lint (${#cfn_files[@]} templates)"
"$CFN_LINT" --version
"$CFN_LINT" "${cfn_files[@]}"
echo "OK: cfn-lint found nothing in ${#cfn_files[@]} templates."

step "CloudFormation YAML round-trip (PyYAML)"
"$PYTHON" scripts/check_cfn_yaml.py "$exports"

step "AWS CLI model checker: unit tests"
"$PYTHON" -m unittest discover -s scripts -p 'test_*.py'

step "AWS CLI model checker"
"$PYTHON" -c 'import botocore; print("botocore", botocore.__version__)'
"$PYTHON" scripts/check_cli.py "$exports"

step "All export tooling checks passed."
