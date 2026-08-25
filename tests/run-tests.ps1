param(
    [switch]$SkipCodexCheck
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$runtimeRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node'
$bundledNode = Join-Path $runtimeRoot 'bin\node.exe'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$node = if ($nodeCommand) { $nodeCommand.Source } else { $bundledNode }
$projectNodeModules = Join-Path $projectRoot 'node_modules'
$bundledNodeModules = Join-Path $runtimeRoot 'node_modules'
$nodeModules = if (Test-Path -LiteralPath (Join-Path $projectNodeModules 'playwright')) {
    $projectNodeModules
} else {
    $bundledNodeModules
}
$browserCandidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe')
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
)
$chrome = $browserCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$script = Join-Path $projectRoot 'src\highlighter.js'
$executable = Join-Path $projectRoot 'dist\CodexHighlighter.exe'
$selfTestOutput = Join-Path $env:TEMP 'codex-highlighter-self-test.txt'

if (-not (Test-Path -LiteralPath $node)) { throw 'Node.js was not found' }
if (-not (Test-Path -LiteralPath (Join-Path $nodeModules 'playwright'))) {
    throw 'Playwright was not found. Install it under node_modules or use the Codex bundled runtime.'
}
if (-not $chrome) { throw 'Google Chrome or Microsoft Edge was not found' }

& $node --check $script
if ($LASTEXITCODE -ne 0) { throw 'JavaScript syntax check failed' }

& (Join-Path $projectRoot 'build.ps1')

$selfTestArguments = @('--self-test', '--self-test-output', $selfTestOutput)
if ($SkipCodexCheck) { $selfTestArguments += '--skip-codex-check' }
$selfTestProcess = Start-Process -FilePath $executable `
    -ArgumentList $selfTestArguments `
    -WindowStyle Hidden -Wait -PassThru
if ($selfTestProcess.ExitCode -ne 0) {
    Get-Content -LiteralPath $selfTestOutput
    throw 'Native self-test failed'
}
Get-Content -LiteralPath $selfTestOutput

& (Join-Path $projectRoot 'tests\test-installer.ps1')

$previousNodePath = $env:NODE_PATH
try {
    $env:NODE_PATH = $nodeModules
    & $node (Join-Path $projectRoot 'tests\highlighter.browser.test.js') $script $chrome
    if ($LASTEXITCODE -ne 0) { throw 'Browser behavior test failed' }
}
finally {
    $env:NODE_PATH = $previousNodePath
}

Write-Output 'ALL TESTS PASSED'
