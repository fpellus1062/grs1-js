# kill-and-restart.ps1
Write-Host "Matando instancias de Node.js..." -ForegroundColor Yellow
taskkill /f /im node.exe 2>$null
Start-Sleep -Seconds 1

$remaining = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($remaining) {
    Write-Host "ERROR: aun hay procesos node activos" -ForegroundColor Red
    $remaining | Format-Table Id, ProcessName, StartTime
    exit 1
}

Write-Host "OK - ninguna instancia activa" -ForegroundColor Green
Write-Host "Arranca el servidor manualmente !" -ForegroundColor Yellow

Set-Location "c:\Desarrollo\node\grs1"
#node run dev