$host.UI.RawUI.WindowTitle = "護理讀書報告生成器"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host "  護理讀書報告生成器  啟動中..."           -ForegroundColor Cyan
Write-Host "========================================"  -ForegroundColor Cyan
Write-Host ""

# Install packages if needed
if (-not (Test-Path "node_modules")) {
    Write-Host "首次啟動，安裝套件中，請稍候..." -ForegroundColor Yellow
    npm install
}

Write-Host "✅ 伺服器啟動中..." -ForegroundColor Green
Write-Host "   網址：http://localhost:5000" -ForegroundColor White
Write-Host "   按 Ctrl+C 可停止" -ForegroundColor Gray
Write-Host ""

node server.js
