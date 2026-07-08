$origen = "C:\Desarrollo\node\arsweb\grs1-js"
$destino = "E:\Desarrollo\Proyecto_ARS\grs1-js"

New-Item -ItemType Directory -Path $destino -Force | Out-Null

robocopy $origen $destino /E /XD "node_modules" /R:2 /W:2 /NFL /NDL /NP /TEE

if ($LASTEXITCODE -le 7) {
Write-Host "Copia completada correctamente. ExitCode: $LASTEXITCODE" -ForegroundColor Green
} else {
Write-Host "Error en la copia. ExitCode: $LASTEXITCODE" -ForegroundColor Red
exit $LASTEXITCODE
}
