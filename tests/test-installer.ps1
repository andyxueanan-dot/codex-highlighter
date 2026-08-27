$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$testRoot = Join-Path $env:TEMP ('CodexHighlighter-install-test-' + [Guid]::NewGuid().ToString('N'))
$resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
$resolvedTemp = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
if (-not ($resolvedTestRoot.TrimEnd('\') + '\').StartsWith(
    $resolvedTemp,
    [StringComparison]::OrdinalIgnoreCase)) {
    throw "Test root escaped TEMP: $resolvedTestRoot"
}

try {
    New-Item -ItemType Directory -Path $resolvedTestRoot -Force | Out-Null
    $dataPath = Join-Path $resolvedTestRoot 'highlights.json'
    $testPrograms = Join-Path $resolvedTestRoot 'test-programs'
    $testStartup = Join-Path $resolvedTestRoot 'test-startup'
    $sentinel = '{"test":"preserve-me"}'
    [IO.File]::WriteAllText($dataPath, $sentinel, [Text.UTF8Encoding]::new($false))

    & (Join-Path $projectRoot 'install.ps1') `
        -InstallRoot $resolvedTestRoot -NoStart `
        -ProgramsDirectory $testPrograms -StartupDirectory $testStartup

    $installedExecutable = Join-Path $resolvedTestRoot 'app\CodexHighlighter.exe'
    if (-not (Test-Path -LiteralPath $installedExecutable)) {
        throw 'Installer did not copy CodexHighlighter.exe'
    }
    if ((Get-Content -LiteralPath $dataPath -Raw) -ne $sentinel) {
        throw 'Installer modified existing highlight data'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $resolvedTestRoot 'uninstall.ps1'))) {
        throw 'Installer did not copy uninstall.ps1'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $testPrograms 'Codex Highlighter.lnk'))) {
        throw 'Installer did not create the Start menu shortcut'
    }
    $startupShortcut = Join-Path $testStartup 'Codex Highlighter.lnk'
    if (-not (Test-Path -LiteralPath $startupShortcut)) {
        throw 'Installer did not create the startup shortcut'
    }
    $shortcutShell = New-Object -ComObject WScript.Shell
    $startupLink = $shortcutShell.CreateShortcut($startupShortcut)
    if ($startupLink.Arguments -ne '--startup') {
        throw 'Startup shortcut does not use background watch mode'
    }

    & (Join-Path $projectRoot 'uninstall.ps1') `
        -InstallRoot $resolvedTestRoot `
        -ProgramsDirectory $testPrograms -StartupDirectory $testStartup

    if (Test-Path -LiteralPath (Join-Path $resolvedTestRoot 'app')) {
        throw 'Default uninstall did not remove the app directory'
    }
    if (-not (Test-Path -LiteralPath $dataPath)) {
        throw 'Default uninstall removed highlight data'
    }
    if (Test-Path -LiteralPath (Join-Path $testPrograms 'Codex Highlighter.lnk')) {
        throw 'Uninstaller did not remove the Start menu shortcut'
    }
    if (Test-Path -LiteralPath $startupShortcut) {
        throw 'Uninstaller did not remove the startup shortcut'
    }

    & (Join-Path $projectRoot 'uninstall.ps1') `
        -InstallRoot $resolvedTestRoot -NoShortcut -NoStartup -PurgeData

    if (Test-Path -LiteralPath $resolvedTestRoot) {
        throw 'Purge uninstall did not remove the test root'
    }

    Write-Output 'PASS installer-update-preserve-uninstall-purge'
}
finally {
    if (Test-Path -LiteralPath $resolvedTestRoot) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}
