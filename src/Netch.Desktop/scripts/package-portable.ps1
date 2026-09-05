[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release'
)

$ErrorActionPreference = 'Stop'

$desktopRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = (Resolve-Path (Join-Path $desktopRoot '..\..')).Path
$package = Get-Content -Raw (Join-Path $desktopRoot 'package.json') | ConvertFrom-Json
$version = [string]$package.version
if ($version -notmatch '^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$') {
    throw "Package version is not a safe artifact label: $version"
}

$deliverablesRoot = Join-Path $repositoryRoot 'deliverables'
$stagingRoot = Join-Path $deliverablesRoot 'staging'
$portableName = "NetF-$version-Windows-x64-Portable"
$portableRoot = Join-Path $stagingRoot $portableName
$archivePath = Join-Path $deliverablesRoot "$portableName.zip"
$targetProfile = $Configuration.ToLowerInvariant()
$appSource = Join-Path $desktopRoot "src-tauri\target\$targetProfile\NetF.exe"
$hostSource = Join-Path $desktopRoot 'src-tauri\binaries\netf-engine-host-x86_64-pc-windows-msvc.exe'
$runtimeSource = Join-Path $desktopRoot 'src-tauri\runtime-template'

foreach ($required in @($appSource, $hostSource, $runtimeSource)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Portable input does not exist: $required"
    }
}

New-Item -ItemType Directory -Path $deliverablesRoot -Force | Out-Null
$resolvedDeliverables = (Resolve-Path -LiteralPath $deliverablesRoot).Path.TrimEnd('\') + '\'
$resolvedStaging = [System.IO.Path]::GetFullPath($stagingRoot)
if (-not ($resolvedStaging + '\').StartsWith($resolvedDeliverables, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Portable staging path escaped the deliverables directory.'
}
if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}
if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}

New-Item -ItemType Directory -Path $portableRoot -Force | Out-Null
Copy-Item -LiteralPath $appSource -Destination (Join-Path $portableRoot 'NetF.exe')
Copy-Item -LiteralPath $hostSource -Destination (Join-Path $portableRoot 'netf-engine-host.exe')
Copy-Item -LiteralPath $runtimeSource -Destination (Join-Path $portableRoot 'runtime-template') -Recurse
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'LICENSE') -Destination (Join-Path $portableRoot 'LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'Netch\NOTICE.txt') -Destination (Join-Path $portableRoot 'NOTICE.txt')
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'README.md') -Destination (Join-Path $portableRoot 'README.md')

Compress-Archive -LiteralPath $portableRoot -DestinationPath $archivePath -CompressionLevel Optimal
Remove-Item -LiteralPath $stagingRoot -Recurse -Force

$archive = Get-Item -LiteralPath $archivePath
Write-Output "Portable archive: $($archive.FullName)"
Write-Output "Portable bytes: $($archive.Length)"
