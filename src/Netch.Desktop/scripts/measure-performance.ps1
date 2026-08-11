[CmdletBinding()]
param(
    [ValidateRange(3, 600)]
    [int]$SampleSeconds = 12
)

$ErrorActionPreference = 'Stop'
$desktopRoot = Split-Path $PSScriptRoot -Parent
$processNames = @('NetF', 'netch-engine-host', 'Netch.EngineHost', 'xray', 'tun2socks', 'pcap2socks')

function Get-NetFProcesses {
    Get-Process -ErrorAction SilentlyContinue |
        Where-Object ProcessName -In $processNames |
        Select-Object Id, ProcessName, CPU, WorkingSet64, PrivateMemorySize64, StartTime
}

$before = @(Get-NetFProcesses)
Start-Sleep -Seconds $SampleSeconds
$after = @(Get-NetFProcesses)

$samples = foreach ($process in $after) {
    $initial = $before | Where-Object Id -eq $process.Id | Select-Object -First 1
    $cpuDelta = if ($null -ne $initial -and $null -ne $initial.CPU -and $null -ne $process.CPU) {
        [double]$process.CPU - [double]$initial.CPU
    }
    else { $null }
    [ordered]@{
        process = $process.ProcessName
        id = $process.Id
        workingSetMiB = [math]::Round($process.WorkingSet64 / 1MB, 2)
        privateMemoryMiB = [math]::Round($process.PrivateMemorySize64 / 1MB, 2)
        cpuSecondsDuringSample = if ($null -eq $cpuDelta) { $null } else { [math]::Round($cpuDelta, 4) }
        averageCpuPercentOneCore = if ($null -eq $cpuDelta) { $null } else { [math]::Round(($cpuDelta / $SampleSeconds) * 100, 3) }
        uptimeSeconds = [math]::Round(((Get-Date) - $process.StartTime).TotalSeconds, 1)
    }
}

$artifactPatterns = @(
    'src-tauri\runtime-template',
    'src-tauri\binaries',
    'src-tauri\target\debug\NetF.exe',
    'src-tauri\target\debug\bundle\nsis\*.exe'
)
$artifacts = foreach ($pattern in $artifactPatterns) {
    $path = Join-Path $desktopRoot $pattern
    foreach ($item in @(Get-Item $path -ErrorAction SilentlyContinue)) {
        $bytes = if ($item.PSIsContainer) {
            (Get-ChildItem -LiteralPath $item.FullName -Recurse -File | Measure-Object Length -Sum).Sum
        }
        else { $item.Length }
        [ordered]@{ path = $item.FullName; sizeMiB = [math]::Round($bytes / 1MB, 2) }
    }
}

[ordered]@{
    capturedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    sampleSeconds = $SampleSeconds
    expectedThreeSecondHealthProbes = [math]::Floor($SampleSeconds / 3)
    processCount = $samples.Count
    processes = @($samples)
    artifacts = @($artifacts)
    note = 'Read-only sampler. CPU includes all work performed by each process during the interval; it does not launch, connect, disconnect, or modify NetF.'
} | ConvertTo-Json -Depth 5
