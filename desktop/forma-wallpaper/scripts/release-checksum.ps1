param(
    [string]$InstallerPath = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$installerDir = Join-Path $repoRoot "dist\installer"

if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
    $latest = Get-ChildItem -Path $installerDir -Filter "FormaWallpaper-Setup-*.exe" -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $latest) {
        throw "No installer found in $installerDir"
    }
    $InstallerPath = $latest.FullName
}

if (-not (Test-Path $InstallerPath)) {
    throw "Installer not found: $InstallerPath"
}

$hash = Get-FileHash -Path $InstallerPath -Algorithm SHA256
$hashFile = Join-Path $installerDir "SHA256SUMS.txt"
$line = "{0}  {1}" -f $hash.Hash.ToLowerInvariant(), (Split-Path $InstallerPath -Leaf)

$line | Out-File -FilePath $hashFile -Encoding ascii

Write-Host "Wrote checksum:"
Write-Host "  file: $InstallerPath"
Write-Host "  sha256: $($hash.Hash.ToLowerInvariant())"
Write-Host "  output: $hashFile"
