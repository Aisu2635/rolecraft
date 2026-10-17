# Layer-4 check (called by check-exports.sh): parse every .ps1 under the given folder and run
# PSScriptAnalyzer (Error + Warning). Fails on any parse error or any finding.
param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
Import-Module PSScriptAnalyzer
Write-Output ("PSScriptAnalyzer " + (Get-Module PSScriptAnalyzer).Version)
$files = @(Get-ChildItem -Path $Path -Recurse -Filter *.ps1)
$parseErrors = 0
foreach ($f in $files) {
  $tokens = $null
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$tokens, [ref]$errors)
  foreach ($e in $errors) {
    Write-Output ("{0}:{1}: parse error: {2}" -f $f.FullName, $e.Extent.StartLineNumber, $e.Message)
    $parseErrors++
  }
}
$results = @(Invoke-ScriptAnalyzer -Path $Path -Recurse -Severity Error, Warning)
foreach ($r in $results) {
  Write-Output ("{0}:{1}: {2} {3}: {4}" -f $r.ScriptPath, $r.Line, $r.Severity, $r.RuleName, $r.Message)
}
Write-Output ("Parsed {0} files: {1} parse errors; PSScriptAnalyzer: {2} findings." -f $files.Count, $parseErrors, $results.Count)
if ($files.Count -eq 0 -or $parseErrors -gt 0 -or $results.Count -gt 0) { exit 1 }
