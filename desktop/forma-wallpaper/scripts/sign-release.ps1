param(
    [string]$InstallerPath = "",
    [string]$TimestampUrl = "http://timestamp.digicert.com",
    [string]$CertThumbprint = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($CertThumbprint)) {
    $CertThumbprint = $env:FORMA_SIGN_CERT_THUMBPRINT
}

if ([string]::IsNullOrWhiteSpace($CertThumbprint)) {
    throw "Missing certificate thumbprint. Pass -CertThumbprint or set FORMA_SIGN_CERT_THUMBPRINT."
}

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

$signtool = (Get-Command signtool.exe -ErrorAction SilentlyContinue)?.Source
if (-not $signtool) {
    throw "signtool.exe not found in PATH. Install Windows SDK Signing Tools."
}

Write-Host "Signing installer: $InstallerPath"
& $signtool sign /sha1 $CertThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 "$InstallerPath"

Write-Host "Verifying signature..."
& $signtool verify /pa "$InstallerPath"

Write-Host "Signature complete."
