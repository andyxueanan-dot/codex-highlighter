param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'CodexHighlighter'),
    [switch]$NoStart,
    [switch]$NoShortcut,
    [switch]$NoStartup,
    [string]$ProgramsDirectory = [Environment]::GetFolderPath('Programs'),
    [string]$StartupDirectory = [Environment]::GetFolderPath('Startup')
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

function New-CodexHighlighterShortcut {
    param(
        [string]$Path,
        [string]$Arguments = ''
    )
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    $shortcut.TargetPath = $targetExecutable
    $shortcut.Arguments = $Arguments
    $shortcut.WorkingDirectory = $appDirectory
    $shortcut.Description = 'Persistent text highlighting for Codex Desktop'
    $shortcut.Save()
}

function Start-CodexHighlighterDetached {
    $commandLine = '"' + $targetExecutable + '"'
    try {
        $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create `
            -Arguments @{ CommandLine = $commandLine }
        if ($result.ReturnValue -eq 0 -and $result.ProcessId -gt 0) {
            return
        }
        Write-Warning "Windows process service returned $($result.ReturnValue); using shell fallback."
    }
    catch {
        Write-Warning "Windows process service was unavailable; using shell fallback: $($_.Exception.Message)"
    }

    $shell = New-Object -ComObject Shell.Application
    try {
        # Normal desktop installs are already outside the Codex process tree.
        # Keep a shell fallback for systems where local WMI process creation is unavailable.
        $shell.ShellExecute($targetExecutable, '', $appDirectory, 'open', 1)
    }
    finally {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
    }
}

if (-not $NoShortcut) {
    New-Item -ItemType Directory -Path $ProgramsDirectory -Force | Out-Null
    New-CodexHighlighterShortcut `
        -Path (Join-Path $ProgramsDirectory 'Codex Highlighter.lnk')
}

if (-not $NoStartup) {
    New-Item -ItemType Directory -Path $StartupDirectory -Force | Out-Null
    New-CodexHighlighterShortcut `
        -Path (Join-Path $StartupDirectory 'Codex Highlighter.lnk') `
        -Arguments '--startup'
}

Write-Output "Installed Codex Highlighter to: $targetExecutable"
Write-Output "Saved highlights remain in: $(Join-Path $resolvedInstallRoot 'highlights.json')"
if (-not $NoStartup) { Write-Output 'Enabled current-user startup recovery.' }

if (-not $NoStart) {
    Start-CodexHighlighterDetached
}
