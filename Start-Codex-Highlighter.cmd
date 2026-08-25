@echo off
setlocal
set "APP=%~dp0dist\CodexHighlighter.exe"
if not exist "%APP%" (
  echo CodexHighlighter.exe was not found. Run build.ps1 first.
  pause
  exit /b 1
)
start "Codex Highlighter" "%APP%"
endlocal
