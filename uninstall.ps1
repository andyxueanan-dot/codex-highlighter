param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'CodexHighlighter'),
    [switch]$PurgeData,
    [switch]$NoShortcut
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$resolvedInstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$localAppDataRoot = [IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\') + '\'
if (-not ($resolvedInstallRoot.TrimEnd('\') + '\').StartsWith($localAppDataRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "InstallRoot must stay under LOCALAPPDATA: $localAppDataRoot"
}

$appDirectory = [IO.Path]::GetFullPath((Join-Path $resolvedInstallRoot 'app'))
$targetExecutable = Join-Path $appDirectory 'CodexHighlighter.exe'
if (-not ($appDirectory.TrimEnd('\') + '\').StartsWith(
    $resolvedInstallRoot.TrimEnd('\') + '\',
    [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove an app directory outside InstallRoot: $appDirectory"
}

$running = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ExecutablePath -and
    [IO.Path]::GetFullPath($_.ExecutablePath).Equals($targetExecutable, [StringComparison]::OrdinalIgnoreCase)
})
foreach ($process in $running) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 300

if (Test-Path -LiteralPath $appDirectory) {
    Remove-Item -LiteralPath $appDirectory -Recurse -Force
}

if (-not $NoShortcut) {
    $shortcutPath = Join-Path ([Environment]::GetFolderPath('Programs')) 'Codex Highlighter.lnk'
    if (Test-Path -LiteralPath $shortcutPath) {
        Remove-Item -LiteralPath $shortcutPath -Force
    }
}

if ($PurgeData) {
    if (Test-Path -LiteralPath $resolvedInstallRoot) {
        Remove-Item -LiteralPath $resolvedInstallRoot -Recurse -Force
    }
    Write-Output 'Codex Highlighter and all saved highlight data were removed.'
} else {
    foreach ($name in @('uninstall.ps1', 'LICENSE', 'SECURITY.md')) {
        $path = Join-Path $resolvedInstallRoot $name
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    }
    Write-Output 'Codex Highlighter was removed. Saved highlight data was preserved.'
    Write-Output "To remove it later: $resolvedInstallRoot"
}
