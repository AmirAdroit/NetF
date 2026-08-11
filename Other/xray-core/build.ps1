Push-Location (Split-Path $MyInvocation.MyCommand.Path -Parent)

$ErrorActionPreference = 'Stop'

try {
    $sourcePath = Join-Path $PSScriptRoot 'src'
    New-Item -ItemType Directory -Path '..\release' -Force | Out-Null
    $xrayPath = & (Join-Path $PSScriptRoot 'fetch.ps1') -OutputDirectory $sourcePath

    Copy-Item -LiteralPath $xrayPath -Destination '..\release\xray.exe' -Force
    Copy-Item -LiteralPath (Join-Path $sourcePath 'expanded\LICENSE') `
        -Destination '..\release\xray-LICENSE.txt' -Force
}
finally {
    Pop-Location
}
