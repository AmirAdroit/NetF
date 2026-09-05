[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$desktopRoot = Split-Path $PSScriptRoot -Parent
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $desktopRoot '..\..'))
$tauriRoot = Join-Path $desktopRoot 'src-tauri'
$templateRoot = Join-Path $tauriRoot 'runtime-template'
$binRoot = Join-Path $templateRoot 'bin'
$licensesRoot = Join-Path $templateRoot 'licenses'

function Resolve-MSBuild {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere -PathType Leaf)) {
        throw 'Visual Studio Build Tools were not found. Install Desktop development with C++.'
    }

    $candidate = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1
    if (-not $candidate) {
        throw 'MSBuild was not found. Install Desktop development with C++.'
    }
    return $candidate
}

function Invoke-NativeBuild([string]$Project) {
    $msbuild = Resolve-MSBuild
    & $msbuild $Project -property:Configuration=Release -property:Platform=x64 -m
    if ($LASTEXITCODE -ne 0) {
        throw "Native build failed: $Project"
    }
}

function Copy-RequiredFile([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        throw "Required owned-runtime asset is missing: $Source"
    }
    New-Item -ItemType Directory -Path (Split-Path $Destination -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

function Get-Sha256([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
        }
        finally {
            $sha256.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

Invoke-NativeBuild (Join-Path $repositoryRoot 'Redirector\Redirector.vcxproj')
Invoke-NativeBuild (Join-Path $repositoryRoot 'RouteHelper\RouteHelper.vcxproj')

$xrayRelease = Join-Path $repositoryRoot 'Other\release\xray.exe'
$xrayExpanded = Join-Path $repositoryRoot 'Other\xray-core\src\expanded\xray.exe'
if (-not (Test-Path -LiteralPath $xrayRelease -PathType Leaf) -or
    -not (Test-Path -LiteralPath $xrayExpanded -PathType Leaf)) {
    & (Join-Path $repositoryRoot 'Other\xray-core\build.ps1')
    if ($LASTEXITCODE -ne 0) {
        throw "Checksum-verified Xray preparation failed with exit code $LASTEXITCODE"
    }
}

$pcapRelease = Join-Path $repositoryRoot 'Other\release\pcap2socks.exe'
if (-not (Test-Path -LiteralPath $pcapRelease -PathType Leaf)) {
    & (Join-Path $repositoryRoot 'Other\pcap2socks\build.ps1')
    if ($LASTEXITCODE -ne 0) {
        throw "Checksum-verified pcap2socks preparation failed with exit code $LASTEXITCODE"
    }
}

if (Test-Path -LiteralPath $templateRoot) {
    Get-ChildItem -LiteralPath $templateRoot -Force |
        Where-Object Name -ne '.gitignore' |
        Remove-Item -Recurse -Force
}
else {
    New-Item -ItemType Directory -Path $templateRoot | Out-Null
}
New-Item -ItemType Directory -Path $binRoot, $licensesRoot | Out-Null

Copy-Item -LiteralPath (Join-Path $repositoryRoot 'Storage\mode') -Destination $templateRoot -Recurse
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'Storage\i18n') -Destination $templateRoot -Recurse

$runtimeAssets = @(
    @{ Source = 'Storage\nfdriver.sys'; Destination = 'bin\nfdriver.sys' },
    @{ Source = 'Storage\tun2socks.bin'; Destination = 'bin\tun2socks.bin' },
    @{ Source = 'Storage\stun.txt'; Destination = 'bin\stun.txt' },
    @{ Source = 'Redirector\bin\Release\Redirector.bin'; Destination = 'bin\Redirector.bin' },
    @{ Source = 'Redirector\bin\Release\nfapi.dll'; Destination = 'bin\nfapi.dll' },
    @{ Source = 'RouteHelper\bin\Release\RouteHelper.bin'; Destination = 'bin\RouteHelper.bin' },
    @{ Source = 'Other\release\xray.exe'; Destination = 'bin\xray.exe' },
    @{ Source = 'Other\xray-core\src\expanded\wintun.dll'; Destination = 'bin\wintun.dll' },
    @{ Source = 'Other\release\pcap2socks.exe'; Destination = 'bin\pcap2socks.exe' },
    @{ Source = 'Other\release\xray-LICENSE.txt'; Destination = 'licenses\xray-LICENSE.txt' },
    @{ Source = 'Other\xray-core\src\expanded\LICENSE-wintun.txt'; Destination = 'licenses\wintun-LICENSE.txt' },
    @{ Source = 'Other\release\pcap2socks-LICENSE.txt'; Destination = 'licenses\pcap2socks-LICENSE.txt' },
    @{ Source = 'Storage\README.md'; Destination = 'licenses\legacy-runtime-provenance.md' }
)

foreach ($asset in $runtimeAssets) {
    Copy-RequiredFile `
        (Join-Path $repositoryRoot $asset.Source) `
        (Join-Path $templateRoot $asset.Destination)
}

New-Item -ItemType Directory -Path (Join-Path $templateRoot 'data'), (Join-Path $templateRoot 'mode\Custom'), (Join-Path $templateRoot 'logging') -Force | Out-Null

$manifestFiles = Get-ChildItem -LiteralPath $templateRoot -Recurse -File |
    Where-Object Name -ne '.gitignore' |
    ForEach-Object {
    $relativePath = $_.FullName.Substring($templateRoot.Length).TrimStart([char[]]@('\', '/'))
    [ordered]@{
        path = $relativePath.Replace('\', '/')
        length = $_.Length
        sha256 = Get-Sha256 $_.FullName
    }
}

$manifest = [ordered]@{
    schemaVersion = 1
    runtimeVersion = '0.2.0'
    files = @($manifestFiles | Sort-Object path)
}
$manifestJson = $manifest | ConvertTo-Json -Depth 4
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $templateRoot 'runtime-manifest.json'), $manifestJson, $utf8WithoutBom)

Write-Output "Prepared owned runtime template at $templateRoot"
