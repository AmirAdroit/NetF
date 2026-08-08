[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$version = 'v0.6.2'
$archiveName = 'pcap2socks-v0.6.2-windows-amd64.zip'
$archiveSha256 = '59b3a2e5054c5a0252f3ac5f10b2862aa53a91e65b2e56e76d5706838d291953'
$executableSha256 = 'de84f4a32c8c9d4888197345d52ba793e4bdf510614852e76f336f627e43def3'
$licenseSha256 = 'd158ad6315478a154d5415b22e24a6c567e715b18280865a3dd48355e7033294'
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\release'))
$workRoot = Join-Path $PSScriptRoot 'src'

function Get-Sha256([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
        }
        finally { $sha256.Dispose() }
    }
    finally { $stream.Dispose() }
}

if (Test-Path -LiteralPath $workRoot) {
    Remove-Item -LiteralPath $workRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $workRoot, $releaseRoot -Force | Out-Null

try {
    $archive = Join-Path $workRoot $archiveName
    Invoke-WebRequest `
        -Uri "https://github.com/zhxie/pcap2socks/releases/download/$version/$archiveName" `
        -OutFile $archive
    if ((Get-Sha256 $archive) -ne $archiveSha256) {
        throw 'pcap2socks archive checksum mismatch.'
    }

    $expanded = Join-Path $workRoot 'expanded'
    Expand-Archive -LiteralPath $archive -DestinationPath $expanded
    $executable = Get-ChildItem -LiteralPath $expanded -Recurse -Filter 'pcap2socks.exe' -File | Select-Object -First 1
    if (-not $executable -or (Get-Sha256 $executable.FullName) -ne $executableSha256) {
        throw 'pcap2socks executable checksum mismatch.'
    }

    $license = Join-Path $workRoot 'LICENSE'
    Invoke-WebRequest `
        -Uri "https://raw.githubusercontent.com/zhxie/pcap2socks/$version/LICENSE" `
        -OutFile $license
    if ((Get-Sha256 $license) -ne $licenseSha256) {
        throw 'pcap2socks license checksum mismatch.'
    }

    Copy-Item -LiteralPath $executable.FullName -Destination (Join-Path $releaseRoot 'pcap2socks.exe') -Force
    Copy-Item -LiteralPath $license -Destination (Join-Path $releaseRoot 'pcap2socks-LICENSE.txt') -Force
}
finally {
    if (Test-Path -LiteralPath $workRoot) {
        Remove-Item -LiteralPath $workRoot -Recurse -Force
    }
}
