param(
    [string]$ExePath = "",
    [int]$DurationMinutes = 120,
    [int]$SampleSeconds = 30,
    [switch]$KeepRunning
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$defaultExe = Join-Path $repoRoot "desktop\forma-wallpaper\target\release\forma-wallpaper.exe"
if ([string]::IsNullOrWhiteSpace($ExePath)) {
    $ExePath = $defaultExe
}

if (-not (Test-Path $ExePath)) {
    throw "Executable not found: $ExePath"
}

$outDir = Join-Path $repoRoot "dist\soak"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$csvPath = Join-Path $outDir "soak-$stamp.csv"

Write-Host "Starting soak test:"
Write-Host "  exe: $ExePath"
Write-Host "  duration: $DurationMinutes minutes"
Write-Host "  sample: every $SampleSeconds seconds"
Write-Host "  output: $csvPath"

$proc = Start-Process -FilePath $ExePath -PassThru

"timestamp,pid,alive,cpu_seconds,working_set_mb,private_mem_mb" | Out-File -FilePath $csvPath -Encoding utf8

$endAt = (Get-Date).AddMinutes($DurationMinutes)
while ((Get-Date) -lt $endAt) {
    Start-Sleep -Seconds $SampleSeconds

    $alive = $false
    $cpu = ""
    $wsMb = ""
    $pmMb = ""

    try {
        $p = Get-Process -Id $proc.Id -ErrorAction Stop
        $alive = $true
        $cpu = [Math]::Round($p.CPU, 2)
        $wsMb = [Math]::Round($p.WorkingSet64 / 1MB, 2)
        $pmMb = [Math]::Round($p.PrivateMemorySize64 / 1MB, 2)
    }
    catch {
        $alive = $false
    }

    "$((Get-Date).ToString('o')),$($proc.Id),$alive,$cpu,$wsMb,$pmMb" | Add-Content -Path $csvPath

    if (-not $alive) {
        Write-Warning "Process exited before soak completed."
        break
    }
}

if (-not $KeepRunning) {
    try {
        Stop-Process -Id $proc.Id -Force -ErrorAction Stop
    }
    catch {
        # already exited
    }
}

Write-Host "Soak run complete. CSV: $csvPath"
