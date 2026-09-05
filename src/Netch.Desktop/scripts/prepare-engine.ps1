[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$desktopRoot = Split-Path $PSScriptRoot -Parent
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $desktopRoot '..\..'))
$project = Join-Path $repositoryRoot 'Netch.EngineHost\Netch.EngineHost.csproj'
$publishDirectory = Join-Path $repositoryRoot 'Netch.EngineHost\bin\Tauri'
$binaryDirectory = Join-Path $desktopRoot 'src-tauri\binaries'

New-Item -ItemType Directory -Path $binaryDirectory -Force | Out-Null

dotnet publish $project `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:EnableCompressionInSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -o $publishDirectory
if (-not $?) {
    exit $LASTEXITCODE
}

$publishedHost = Join-Path $publishDirectory 'netf-engine-host.exe'
if (-not (Test-Path -LiteralPath $publishedHost -PathType Leaf)) {
    throw "Engine host publish did not produce $publishedHost"
}

Copy-Item -LiteralPath $publishedHost `
    -Destination (Join-Path $binaryDirectory 'netf-engine-host-x86_64-pc-windows-msvc.exe') -Force

foreach ($obsoleteName in @('netch-engine-host.exe', 'netch-engine-host-x86_64-pc-windows-msvc.exe')) {
    $obsoleteHost = Join-Path $binaryDirectory $obsoleteName
    if (Test-Path -LiteralPath $obsoleteHost -PathType Leaf) {
        Remove-Item -LiteralPath $obsoleteHost -Force
    }
}
