param(
  [string]$DbUser = "gestor",
  [string]$DbName = "turnos",
  [string]$AppUrl = "http://localhost/login.html",
  [switch]$EnsureUp,
  [switch]$Strict
)

$ErrorActionPreference = "Stop"
$ScriptStartUtc = (Get-Date).ToUniversalTime().ToString("o")

$Passed = 0
$Failed = 0
$Warnings = 0

function Pass([string]$msg) {
  $script:Passed++
  Write-Host "[PASS] $msg" -ForegroundColor Green
}

function Fail([string]$msg) {
  $script:Failed++
  Write-Host "[FAIL] $msg" -ForegroundColor Red
}

function Warn([string]$msg) {
  $script:Warnings++
  Write-Host "[WARN] $msg" -ForegroundColor Yellow
}

function Run-Step([string]$name, [scriptblock]$block) {
  Write-Host "\n== $name ==" -ForegroundColor Cyan
  try {
    & $block
  } catch {
    Fail "$name :: $($_.Exception.Message)"
  }
}

if ($EnsureUp) {
  Write-Host "\n== Pre-step: levantar servicios nginx/app/postgres ==" -ForegroundColor Cyan
  docker compose up -d postgres app nginx | Out-Null
}

Run-Step "1) Servicios arriba" {
  $raw = docker compose ps --format json
  if (-not $raw) { throw "No hay servicios en docker compose" }
  $ps = $raw | ConvertFrom-Json
  if (-not $ps) { throw "No hay servicios en docker compose" }

  $app = $ps | Where-Object { $_.Service -eq "app" }
  $pg = $ps | Where-Object { $_.Service -eq "postgres" }
  $nginx = $ps | Where-Object { $_.Service -eq "nginx" }

  if (-not $app -or -not $app.State -or $app.State -ne "running") {
    throw "Servicio app no esta running"
  }
  if (-not $pg -or -not $pg.State -or $pg.State -ne "running") {
    throw "Servicio postgres no esta running"
  }
  if (-not $nginx -or -not $nginx.State -or $nginx.State -ne "running") {
    throw "Servicio nginx no esta running"
  }

  Pass "nginx, app y postgres running"
}

Run-Step "2) Variables criticas en compose" {
  $cfg = docker compose config | Out-String
  if ($cfg -notmatch "POSTGRES_USER:") { throw "No aparece POSTGRES_USER en compose config" }
  if ($cfg -notmatch "POSTGRES_PASSWORD:") { throw "No aparece POSTGRES_PASSWORD en compose config" }
  if ($cfg -notmatch "POSTGRES_DB:") { throw "No aparece POSTGRES_DB en compose config" }

  $jwtMissing = ($cfg -notmatch "JWT_SECRET:")
  $jwtDefault = ($cfg -match "JWT_SECRET:\s*(supersecreto|change-this-secret-for-qnap|CHANGE_ME)")

  if ($jwtMissing -and $Strict) { throw "No aparece JWT_SECRET en compose config" }
  if ($jwtDefault -and $Strict) { throw "JWT_SECRET parece de ejemplo/default" }

  if ($cfg -notmatch "JWT_SECRET:") {
    Warn "No aparece JWT_SECRET en compose config (revisar origen de variables)"
  }

  if ($jwtDefault) {
    Warn "JWT_SECRET parece de ejemplo/default"
  } else {
    Pass "Variables criticas detectadas"
  }
}

Run-Step "3) HTTP login.html" {
  $maxAttempts = 30
  $statusCode = ""
  $lastError = ""

  for ($i = 1; $i -le $maxAttempts; $i++) {
    $raw = curl.exe -sS -o NUL -w "%{http_code}" $AppUrl 2>&1
    $out = ($raw | Out-String).Trim()

    if ($out -match "^\d{3}$") {
      $statusCode = $out
      $lastError = ""
      if ($statusCode -eq "200") { break }
    } else {
      $lastError = $out
      $statusCode = "000"
    }

    Start-Sleep -Seconds 1
  }

  if ($statusCode -ne "200") {
    if ($lastError) {
      throw "Sin 200 tras $maxAttempts intentos. Ultimo error: $lastError"
    }
    throw "Sin 200 tras $maxAttempts intentos. Ultimo status: $statusCode"
  }
  Pass "Endpoint login responde 200"
}

Run-Step "4) Conexion a PostgreSQL" {
  $out = docker compose exec -T postgres psql -U $DbUser -d $DbName -t -A -c "select 'ok';"
  if (($out | Out-String).Trim() -ne "ok") { throw "No se pudo validar conexion SQL" }
  Pass "Conexion SQL OK"
}

Run-Step "5) Esquema presente" {
  $tables = docker compose exec -T postgres psql -U $DbUser -d $DbName -t -A -c "select count(*) from information_schema.tables where table_schema='public';"
  $count = [int](($tables | Out-String).Trim())
  if ($count -le 0) { throw "No hay tablas en schema public" }
  Pass "Tablas public: $count"
}

Run-Step "6) Datos minimos" {
  $ag = docker compose exec -T postgres psql -U $DbUser -d $DbName -t -A -c "select count(*) from public.agentes;"
  $ac = docker compose exec -T postgres psql -U $DbUser -d $DbName -t -A -c "select count(*) from public.actividades;"
  $agCount = [int](($ag | Out-String).Trim())
  $acCount = [int](($ac | Out-String).Trim())

  if ($agCount -le 0) { throw "Sin agentes" }
  if ($acCount -le 0) { throw "Sin actividades" }

  Pass "agentes=$agCount, actividades=$acCount"
}

Run-Step "7) Logs app sin error critico" {
  # Evaluar solo logs emitidos durante esta corrida para evitar ruido historico.
  $logs = docker compose logs --since $ScriptStartUtc --tail 500 app
  if ($logs -match "UnhandledPromiseRejection|EADDRINUSE|ECONNREFUSED|FATAL|Error: listen") {
    if ($Strict) { throw "Detectados patrones de error potencial en logs app" }
    Warn "Detectados patrones de error potencial en logs app"
  } else {
    Pass "Sin errores criticos evidentes en logs app"
  }
}

Run-Step "8) Logs postgres sin error critico" {
  # Evaluar solo logs emitidos durante esta corrida para evitar ruido historico.
  $logs = docker compose logs --since $ScriptStartUtc --tail 500 postgres
  if ($logs -match "PANIC|FATAL|database system is shut down") {
    if ($Strict) { throw "Detectados patrones de error potencial en logs postgres" }
    Warn "Detectados patrones de error potencial en logs postgres"
  } else {
    Pass "Sin errores criticos evidentes en logs postgres"
  }
}

Write-Host "\n===== RESUMEN GO/NO-GO =====" -ForegroundColor Cyan
Write-Host "PASS: $Passed"
Write-Host "WARN: $Warnings"
Write-Host "FAIL: $Failed"

if ($Failed -gt 0) {
  Write-Host "Resultado: NO-GO" -ForegroundColor Red
  exit 1
}

if ($Warnings -gt 0) {
  if ($Strict) {
    Write-Host "Resultado: NO-GO (modo strict: WARN no permitido)" -ForegroundColor Red
    exit 1
  }
  Write-Host "Resultado: GO condicionado (revisar WARN)" -ForegroundColor Yellow
  exit 0
}

Write-Host "Resultado: GO" -ForegroundColor Green
exit 0
