$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$outputDirectory = Join-Path $projectRoot 'dist'
$outputFile = Join-Path $outputDirectory 'CodexHighlighter.exe'
$sourceFiles = @(
    (Join-Path $projectRoot 'src\CodexHighlighter.cs')
    (Join-Path $projectRoot 'src\HighlightManagerForm.cs')
)
$scriptFile = Join-Path $projectRoot 'src\highlighter.js'

if (-not (Test-Path -LiteralPath $compiler)) {
    throw "Windows .NET Framework compiler was not found: $compiler"
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$compilerArguments = @(
    '/nologo'
    '/target:winexe'
    '/platform:anycpu'
    '/optimize+'
    '/debug:pdbonly'
    "/out:$outputFile"
    '/reference:System.dll'
    '/reference:System.Core.dll'
    '/reference:System.Drawing.dll'
    '/reference:System.Web.Extensions.dll'
    '/reference:System.Windows.Forms.dll'
    "/resource:$scriptFile,CodexHighlighter.highlighter.js"
    $sourceFiles
)

& $compiler @compilerArguments
if ($LASTEXITCODE -ne 0) {
    throw "C# compilation failed with exit code $LASTEXITCODE"
}

Write-Output "Built: $outputFile"
