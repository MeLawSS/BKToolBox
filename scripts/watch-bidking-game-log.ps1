param(
    [Parameter(Position = 0)]
    [string]$GameRoot,

    [int]$IntervalMs = 1000,

    [string]$DataDir,

    [switch]$Once,

    [switch]$Ads,

    [switch]$NoAds,

    [switch]$NoPlayerLog
)

$ErrorActionPreference = "Stop"

if ($Ads -and $NoAds) {
    throw "Use only one of -Ads or -NoAds."
}

if (-not $GameRoot) {
    $repoRoot = Split-Path $PSScriptRoot -Parent
    $GameRoot = Join-Path $repoRoot "Archive\BidKing"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is required. Install Node.js or run this script from an environment where node is on PATH."
}

$scriptPath = Join-Path $PSScriptRoot "watch-bidking-game-log.mjs"
if (-not (Test-Path $scriptPath)) {
    throw "Cannot find $scriptPath"
}

$nodeArgs = @($scriptPath, "--game-root", $GameRoot, "--interval", "$IntervalMs")
if ($DataDir) {
    $nodeArgs += @("--data-dir", $DataDir)
}
if ($Once) {
    $nodeArgs += "--once"
}
if ($Ads) {
    $nodeArgs += "--ads"
}
if ($NoAds) {
    $nodeArgs += "--no-ads"
}
if ($NoPlayerLog) {
    $nodeArgs += "--no-player-log"
}

& node @nodeArgs
exit $LASTEXITCODE
