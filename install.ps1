param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'CodexHighlighter'),
    [switch]$NoStart,
    [switch]$NoShortcut
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$resolvedInstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$localAppDataRoot = [IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\') + '\'
if (-not ($resolvedInstallRoot.TrimEnd('\') + '\').StartsWith($localAppDataRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "InstallRoot must stay under LOCALAPPDATA: $localAppDataRoot"
}

$sourceCandidates = @(
    (Join-Path $sourceRoot 'CodexHighlighter.exe')
    (Join-Path $sourceRoot 'dist\CodexHighlighter.exe')
)
$sourceExecutable = $sourceCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $sourceExecutable) {
    $buildScript = Join-Path $sourceRoot 'build.ps1'
    if (-not (Test-Path -LiteralPath $buildScript)) {
        throw 'CodexHighlighter.exe and build.ps1 were not found.'
    }
    & $buildScript
    $sourceExecutable = Join-Path $sourceRoot 'dist\CodexHighlighter.exe'
}

$appDirectory = Join-Path $resolvedInstallRoot 'app'
$targetExecutable = Join-Path $appDirectory 'CodexHighlighter.exe'
New-Item -ItemType Directory -Path $appDirectory -Force | Out-Null

$running = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ExecutablePath -and
    [IO.Path]::GetFullPath($_.ExecutablePath).Equals($targetExecutable, [StringComparison]::OrdinalIgnoreCase)
})
foreach ($process in $running) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Copy-Item -LiteralPath $sourceExecutable -Destination $targetExecutable -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'uninstall.ps1') `
    -Destination (Join-Path $resolvedInstallRoot 'uninstall.ps1') -Force

foreach ($name in @('LICENSE', 'SECURITY.md')) {
    $source = Join-Path $sourceRoot $name
    if (Test-Path -LiteralPath $source) {
        Copy-Item -LiteralPath $source -Destination (Join-Path $resolvedInstallRoot $name) -Force
    }
}

if (-not $NoShortcut) {
    $programs = [Environment]::GetFolderPath('Programs')
    $shortcutPath = Join-Path $programs 'Codex Highlighter.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $targetExecutable
    $shortcut.WorkingDirectory = $appDirectory
    $shortcut.Description = 'Persistent text highlighting for Codex Desktop'
    $shortcut.Save()
}

Write-Output "Installed Codex Highlighter to: $targetExecutable"
Write-Output "Saved highlights remain in: $(Join-Path $resolvedInstallRoot 'highlights.json')"

if (-not $NoStart) {
    Start-Process -FilePath $targetExecutable
}
