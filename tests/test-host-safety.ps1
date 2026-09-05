$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$source = Get-Content -LiteralPath (Join-Path $projectRoot 'src\CodexHighlighter.cs') -Raw
$failureHandler = [regex]::Match(
    $source,
    'private void HandleMonitorFailure\(Exception exception\)(?<body>[\s\S]*?)\r?\n\s*internal void ForceReinject\(')

if (-not $failureHandler.Success) {
    throw 'Could not locate HandleMonitorFailure for the non-destructive recovery check'
}

$body = $failureHandler.Groups['body'].Value
if ($body -match 'CodexProcessManager\.(Close|Launch)' -or
    $body -match 'Process\.(Kill|CloseMainWindow)') {
    throw 'Background monitor failure handling can still close or relaunch Codex'
}
if ($body -notmatch '不会自动重启 Codex') {
    throw 'Background monitor failure status does not explain the non-destructive policy'
}

$interactiveConnect = [regex]::Match(
    $source,
    'private void EnsureConnectedCore\(bool interactive\)(?<body>[\s\S]*?)\r?\n\s*internal void StartWatching\(')
if (-not $interactiveConnect.Success -or
    $interactiveConnect.Groups['body'].Value -notmatch 'MessageBox\.Show' -or
    $interactiveConnect.Groups['body'].Value -notmatch 'CodexProcessManager\.Close' -or
    $interactiveConnect.Groups['body'].Value -notmatch 'CodexProcessManager\.Launch') {
    throw 'The explicit confirmed reconnect path could not be verified'
}
if ([regex]::Matches($source, 'CodexProcessManager\.Close').Count -ne 1 -or
    [regex]::Matches($source, 'CodexProcessManager\.Launch').Count -ne 2) {
    throw 'Unexpected process restart or launch paths'
}

$monitorBody = [regex]::Match($source,
    'private void MonitorTick\(object state\)(?<body>[\s\S]*?)internal static bool IsMainRendererTarget').Groups['body'].Value
if (-not $monitorBody -or $monitorBody -match 'CodexProcessManager\.(Close|Launch)|EnsureConnected|OpenCodex') {
    throw 'Background watcher must never request an app launch or restart'
}
$processManager = [regex]::Match($source,
    'internal static class CodexProcessManager(?<body>[\s\S]*?)internal sealed class CdpTarget').Groups['body'].Value
if (-not $processManager -or $processManager -match '\.Kill\(') {
    throw 'Even explicit reconnects must never force-kill Codex'
}

Write-Output 'PASS host-background-recovery-is-non-destructive'
