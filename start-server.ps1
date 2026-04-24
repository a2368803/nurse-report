Set-Location $PSScriptRoot
if (-not (Test-Path "node_modules")) { npm install }
Start-Job { Start-Sleep 3; Start-Process "http://localhost:5000" } | Out-Null
node server.js
