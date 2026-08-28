param(
    [string]$Version = '1.2.0'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$distRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'dist'))
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $distRoot 'release'))
$packageName = "codex-highlighter-v$Version-windows-x64"
$packageDirectory = [IO.Path]::GetFullPath((Join-Path $releaseRoot $packageName))
$archivePath = [IO.Path]::GetFullPath((Join-Path $distRoot "$packageName.zip"))
$checksumPath = "$archivePath.sha256"

foreach ($target in @($releaseRoot, $packageDirectory, $archivePath)) {
    if (-not ($target.TrimEnd('\') + '\').StartsWith(
        $distRoot.TrimEnd('\') + '\',
        [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to package outside dist: $target"
    }
}

& (Join-Path $projectRoot 'build.ps1')

if (Test-Path -LiteralPath $packageDirectory) {
    Remove-Item -LiteralPath $packageDirectory -Recurse -Force
}
New-Item -ItemType Directory -Path $packageDirectory -Force | Out-Null

$files = @(
    @{ Source = 'dist\CodexHighlighter.exe'; Destination = 'CodexHighlighter.exe' }
    @{ Source = 'Start-Codex-Highlighter.cmd'; Destination = 'Start-Codex-Highlighter.cmd' }
    @{ Source = 'install.ps1'; Destination = 'install.ps1' }
    @{ Source = 'uninstall.ps1'; Destination = 'uninstall.ps1' }
    @{ Source = 'README.md'; Destination = 'README.md' }
    @{ Source = 'README.zh-CN.md'; Destination = 'README.zh-CN.md' }
    @{ Source = 'LICENSE'; Destination = 'LICENSE' }
    @{ Source = 'SECURITY.md'; Destination = 'SECURITY.md' }
    @{ Source = 'CHANGELOG.md'; Destination = 'CHANGELOG.md' }
    @{ Source = 'licenses\THIRD_PARTY_NOTICES.md'; Destination = 'THIRD_PARTY_NOTICES.md' }
)

foreach ($file in $files) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $file.Source) `
        -Destination (Join-Path $packageDirectory $file.Destination) -Force
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'assets') `
    -Destination (Join-Path $packageDirectory 'assets') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs') `
    -Destination (Join-Path $packageDirectory 'docs') -Recurse -Force

if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
if (Test-Path -LiteralPath $checksumPath) { Remove-Item -LiteralPath $checksumPath -Force }
Compress-Archive -LiteralPath $packageDirectory -DestinationPath $archivePath -CompressionLevel Optimal

$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(
    $checksumPath,
    "$hash  $([IO.Path]::GetFileName($archivePath))`n",
    [Text.UTF8Encoding]::new($false))

Write-Output "Package: $archivePath"
Write-Output "Checksum: $checksumPath"
Write-Output "SHA256: $hash"
