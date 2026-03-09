param(
    [switch]$SkipWasm,
    [switch]$SkipRelease,
    [string]$IsccPath
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$desktopRoot = Join-Path $repoRoot "desktop\forma-wallpaper"
$issFile = Join-Path $desktopRoot "installer\FormaWallpaper.iss"

function Resolve-Iscc([string]$candidate) {
    if ($candidate -and (Test-Path $candidate)) {
        return (Resolve-Path $candidate).Path
    }

    $cmd = Get-Command iscc -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    $commonPaths = @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
        "${env:LOCALAPPDATA}\Programs\Inno Setup 6\ISCC.exe",
        "${env:LOCALAPPDATA}\Inno Setup 6\ISCC.exe"
    )
    foreach ($path in $commonPaths) {
        if ($path -and (Test-Path $path)) {
            return (Resolve-Path $path).Path
        }
    }

    throw "ISCC.exe not found. Install Inno Setup 6 or pass -IsccPath <path-to-ISCC.exe>."
}

Push-Location $repoRoot
try {
    if (-not $SkipWasm) {
        Write-Host "[1/3] Building wasm assets..."
        wasm-pack build --target web --out-dir www/pkg
    }

    if (-not $SkipRelease) {
        Write-Host "[2/3] Building release desktop binary..."
        cargo build --release --manifest-path desktop/forma-wallpaper/Cargo.toml
    }

    Write-Host "[3/3] Building installer..."
    $iscc = Resolve-Iscc $IsccPath
    & $iscc $issFile
}
finally {
    Pop-Location
}
