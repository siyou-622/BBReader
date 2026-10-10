param(
  [string]$Directory = 'dist/desktop',
  [switch]$SkipSignatureUpdate
)
$ErrorActionPreference = 'Stop'
$scanRoot = (Resolve-Path -LiteralPath $Directory).Path
$packages = @(Get-ChildItem -LiteralPath $scanRoot -File -Filter '*.exe')
if ($packages.Count -eq 0) { throw 'No Windows release executables to scan' }
$platformRoot = Join-Path $env:ProgramData 'Microsoft/Windows Defender/Platform'
$scanner = $null
if (Test-Path -LiteralPath $platformRoot) {
  foreach ($platform in (Get-ChildItem -LiteralPath $platformRoot -Directory | Sort-Object Name -Descending)) {
    $candidate = Join-Path $platform.FullName 'MpCmdRun.exe'
    if (Test-Path -LiteralPath $candidate) { $scanner = $candidate; break }
  }
}
if (-not $scanner) { $scanner = Join-Path $env:ProgramFiles 'Windows Defender/MpCmdRun.exe' }
if (-not (Test-Path -LiteralPath $scanner)) { throw 'Microsoft Defender scanner is unavailable; release scan cannot pass' }
if (-not $SkipSignatureUpdate) {
  & $scanner -SignatureUpdate
  if ($LASTEXITCODE -ne 0) { throw 'Defender security intelligence update failed' }
}
$status = Get-MpComputerStatus
if (-not $status.AntivirusSignatureVersion -or $status.AntivirusSignatureLastUpdated -lt (Get-Date).AddDays(-2)) {
  throw 'Defender security intelligence is missing or stale'
}
$hashes = @($packages | ForEach-Object {
  [pscustomobject]@{name=$_.Name;size=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
})
# Microsoft's custom non-remediation scan ignores exclusions and scans archives.
# It does not restore files, add exclusions, or change real-time protection.
& $scanner -Scan -ScanType 3 -DisableRemediation -File $scanRoot
if ($LASTEXITCODE -ne 0) { throw 'Defender detected a threat or could not finish the release scan' }
foreach ($file in $hashes) {
  $filename = Join-Path $scanRoot $file.name
  if (-not (Test-Path -LiteralPath $filename) -or (Get-FileHash -LiteralPath $filename -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) {
    throw ('Release file changed or was quarantined: ' + $file.name)
  }
}
[pscustomobject]@{
  scannedAt=(Get-Date).ToUniversalTime().ToString('o')
  signatureVersion=$status.AntivirusSignatureVersion
  signatureUpdatedAt=$status.AntivirusSignatureLastUpdated.ToUniversalTime().ToString('o')
  scanExitCode=0
  packages=$hashes
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $scanRoot 'defender-scan.json') -Encoding utf8
Write-Output 'PASS: Windows release scan completed with no detections; executable hashes unchanged'
