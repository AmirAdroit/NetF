[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\..\release\cores\xray-v26.3.27')
)

$ErrorActionPreference = 'Stop'

$version = 'v26.3.27'
$artifactName = 'Xray-windows-64.zip'
$expectedSha256 = 'd004c39288ce9ada487c6f398c7c545f7d749e44bdfdd59dbc9f865afba4e1ad'
$artifactUrl = "https://github.com/XTLS/Xray-core/releases/download/$version/$artifactName"
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)

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

if (Test-Path -LiteralPath $resolvedOutput) {
    throw "Output directory already exists: $resolvedOutput"
}

New-Item -ItemType Directory -Path $resolvedOutput | Out-Null
$archivePath = Join-Path $resolvedOutput $artifactName

Invoke-WebRequest -Uri $artifactUrl -OutFile $archivePath

$actualSha256 = Get-Sha256 $archivePath
if ($actualSha256 -ne $expectedSha256) {
    throw "Xray archive checksum mismatch. Expected $expectedSha256 but received $actualSha256."
}

$expandedPath = Join-Path $resolvedOutput 'expanded'
Expand-Archive -LiteralPath $archivePath -DestinationPath $expandedPath

$xrayPath = Join-Path $expandedPath 'xray.exe'
if (-not (Test-Path -LiteralPath $xrayPath -PathType Leaf)) {
    throw "Verified archive did not contain xray.exe at the expected path."
}

Write-Output $xrayPath
