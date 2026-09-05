$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$testExe = Join-Path $projectRoot 'dist\LauncherTests.exe'
& $compiler /nologo /target:exe /main:CodexHighlighter.LauncherTests "/out:$testExe" `
    /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll `
    /reference:System.Web.Extensions.dll /reference:System.Windows.Forms.dll `
    (Join-Path $projectRoot 'src\CodexLauncher.cs') `
    (Join-Path $projectRoot 'src\CodexHighlighter.cs') `
    (Join-Path $projectRoot 'src\HighlightManagerForm.cs') `
    (Join-Path $projectRoot 'tests\LauncherTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher test compilation failed' }
& $testExe
if ($LASTEXITCODE -ne 0) { throw 'Launcher behavior tests failed' }
