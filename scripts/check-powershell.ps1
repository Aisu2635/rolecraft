# Layer-4 check (called by check-exports.sh): every .ps1 under the given folders must be pure ASCII
# (Windows PowerShell 5.1 reads BOM-less files as ANSI), parse without errors, and have no
# PSScriptAnalyzer Error/Warning finding, including syntax and command compatibility with
# Windows PowerShell 5.1 and PowerShell 7 (the README promises both).
param([Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)][string[]]$Path)
$ErrorActionPreference = 'Stop'
Import-Module PSScriptAnalyzer -RequiredVersion 1.25.0
Write-Output ("PSScriptAnalyzer " + (Get-Module PSScriptAnalyzer).Version)

$settings = @{
  Severity            = @('Error', 'Warning')
  IncludeDefaultRules = $true
  Rules               = @{
    PSUseCompatibleSyntax   = @{
      Enable         = $true
      TargetVersions = @('5.1', '7.0')
    }
    PSUseCompatibleCommands = @{
      Enable         = $true
      TargetProfiles = @(
        # Windows Server 2019, Windows PowerShell 5.1
        'win-8_x64_10.0.17763.0_5.1.17763.316_x64_4.0.30319.42000_framework',
        # Windows Server 2019, PowerShell 7.0
        'win-8_x64_10.0.17763.0_7.0.0_x64_3.1.2_core',
        # Ubuntu 18.04, PowerShell 7.0
        'ubuntu_x64_18.04_7.0.0_x64_3.1.2_core'
      )
    }
  }
}

$files = @($Path | ForEach-Object { Get-ChildItem -Path $_ -Recurse -Filter *.ps1 })
$problems = 0
foreach ($f in $files) {
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
  for ($i = 0; $i -lt $bytes.Length; $i++) {
    if ($bytes[$i] -gt 0x7e -or ($bytes[$i] -lt 0x20 -and $bytes[$i] -ne 0x0a -and $bytes[$i] -ne 0x0d -and $bytes[$i] -ne 0x09)) {
      Write-Output ("{0}: byte 0x{1:x2} at offset {2} is not printable ASCII" -f $f.FullName, $bytes[$i], $i)
      $problems++
      break
    }
  }
  $tokens = $null
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$tokens, [ref]$errors)
  foreach ($e in $errors) {
    Write-Output ("{0}:{1}: parse error: {2}" -f $f.FullName, $e.Extent.StartLineNumber, $e.Message)
    $problems++
  }
  foreach ($r in @(Invoke-ScriptAnalyzer -Path $f.FullName -Settings $settings)) {
    Write-Output ("{0}:{1}: {2} {3}: {4}" -f $r.ScriptPath, $r.Line, $r.Severity, $r.RuleName, $r.Message)
    $problems++
  }
}
Write-Output ("Checked {0} files (ASCII, parser, PSScriptAnalyzer incl. 5.1/7 compatibility): {1} problems." -f $files.Count, $problems)
if ($files.Count -eq 0 -or $problems -gt 0) { exit 1 }
