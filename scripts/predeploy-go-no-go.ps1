param(
  [string]$DbUser = "gestor",
  [string]$DbName = "turnos",
  [string]$AppUrl = "http://localhost/login.html",
  [switch]$EnsureUp,
  [switch]$Strict
)

$ErrorActionPreference = "Stop"
$ScriptStartUtc = (Get-Date).ToUniversalTime().ToString("o")

# Forzar builder clasico para evitar attestations/OCI artifacts en builds locales de compose.
$env:DOCKER_BUILDKIT = "0"
$env:COMPOSE_DOCKER_CLI_BUILD = "0"

$ComposeFile = if (Test-Path "compose.yaml") {
  "compose.yaml"
} elseif (Test-Path "docker-compose.yml") {
  "docker-compose.yml"
} else {
  $null
}

$ComposeArgs = @()
if ($ComposeFile) {
  $ComposeArgs = @("-f", $ComposeFile)
}

function ComposeOut {
  param(
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$CommandArgs
  )

  $output = & docker compose @ComposeArgs @CommandArgs
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($CommandArgs -join ' ') fallo con exit code $LASTEXITCODE"
  }
  return $output
}

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

function Get-FirstFreeLoopbackPort([int[]]$Candidates) {
  foreach ($port in $Candidates) {
    $listener = $null
    try {
      $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
      $listener.Start()
      $listener.Stop()
      return $port
    } catch {
      if ($listener) {
        try { $listener.Stop() } catch {}
      }
    }
  }
  return $null
}

function Test-CoreSchemaPresent {
  $query = "select ((to_regclass('public.agentes') is not null) and (to_regclass('public.actividades') is not null) and (to_regclass('public.asignaciones_borradores') is not null))::int;"
  $result = & docker compose @ComposeArgs exec -T postgres psql -U $DbUser -d $DbName -t -A -c $query
  if ($LASTEXITCODE -ne 0) {
    return $false
  }

  return (($result | Out-String).Trim() -eq "1")
}

if ($EnsureUp) {
  if (-not $env:DB_PUBLISHED_PORT) {
    $fallbackPort = Get-FirstFreeLoopbackPort @(5432, 15432, 25432, 35432)
    if (-not $fallbackPort) {
      throw "No se encontro un puerto libre para DB_PUBLISHED_PORT"
    }
    $env:DB_PUBLISHED_PORT = [string]$fallbackPort
    Write-Host "Usando DB_PUBLISHED_PORT=$fallbackPort para esta ejecucion" -ForegroundColor Yellow
  }
  Write-Host "\n== Pre-step: levantar servicios nginx/app/postgres ==" -ForegroundColor Cyan
  ComposeOut up -d postgres app nginx | Out-Null

  if (Test-CoreSchemaPresent) {
    Write-Host "\n== Pre-step: migraciones bootstrap omitidas (esquema base ya presente) ==" -ForegroundColor Cyan
  } else {
    Write-Host "\n== Pre-step: aplicar migraciones (perfil bootstrap) ==" -ForegroundColor Cyan
    ComposeOut --profile bootstrap run --rm migrate | Out-Null
  }
}

Run-Step "1) Servicios arriba" {
  $servicesRaw = ComposeOut config --services
  $declaredServices = @($servicesRaw | ForEach-Object { ($_ | Out-String).Trim() } | Where-Object { $_ })
  if (-not $declaredServices -or $declaredServices.Count -eq 0) { throw "No hay servicios en docker compose" }

  $runningRaw = ComposeOut ps --services --status running
  $runningServices = @($runningRaw | ForEach-Object { ($_ | Out-String).Trim() } | Where-Object { $_ })

  if (-not ($runningServices -contains "app")) {
    throw "Servicio app no esta running"
  }
  if (-not ($runningServices -contains "postgres")) {
    throw "Servicio postgres no esta running"
  }
  if (-not ($runningServices -contains "nginx")) {
    throw "Servicio nginx no esta running"
  }

  Pass "nginx, app y postgres running"
}

Run-Step "2) Variables criticas en compose" {
  $cfg = ComposeOut config | Out-String
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
  $effectiveAppUrl = $AppUrl
  if ($AppUrl -eq "http://localhost/login.html") {
    $nginxPs = (ComposeOut ps nginx | Out-String)
    if ($nginxPs -match ":(\d+)->80/tcp") {
      $publishedHttpPort = $Matches[1]
      $effectiveAppUrl = "http://localhost:$publishedHttpPort/login.html"
    } elseif ($env:HTTP_PORT) {
      $effectiveAppUrl = "http://localhost:$($env:HTTP_PORT)/login.html"
    }
  }

  $maxAttempts = 30
  $statusCode = ""
  $lastError = ""

  for ($i = 1; $i -le $maxAttempts; $i++) {
    $raw = curl.exe -sS -o NUL -w "%{http_code}" $effectiveAppUrl 2>&1
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
      throw "Sin 200 en $effectiveAppUrl tras $maxAttempts intentos. Ultimo error: $lastError"
    }
    throw "Sin 200 en $effectiveAppUrl tras $maxAttempts intentos. Ultimo status: $statusCode"
  }
  Pass "Endpoint login responde 200"
}

Run-Step "4) Conexion a PostgreSQL" {
  $out = & docker compose @ComposeArgs exec -T postgres psql -U $DbUser -d $DbName -t -A -c "select 'ok';"
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose exec postgres psql fallo con exit code $LASTEXITCODE"
  }
  if (($out | Out-String).Trim() -ne "ok") { throw "No se pudo validar conexion SQL" }
  Pass "Conexion SQL OK"
}

Run-Step "5) Esquema presente" {
  $tables = & docker compose @ComposeArgs exec -T postgres psql -U $DbUser -d $DbName -t -A -c "select count(*) from information_schema.tables where table_schema='public';"
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose exec postgres psql fallo con exit code $LASTEXITCODE"
  }
  $count = [int](($tables | Out-String).Trim())
  if ($count -le 0) { throw "No hay tablas en schema public" }
  Pass "Tablas public: $count"
}

Run-Step "6) Datos minimos" {
  $ag = & docker compose @ComposeArgs exec -T postgres psql -U $DbUser -d $DbName -t -A -c "select count(*) from public.agentes;"
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose exec postgres psql fallo con exit code $LASTEXITCODE"
  }
  $ac = & docker compose @ComposeArgs exec -T postgres psql -U $DbUser -d $DbName -t -A -c "select count(*) from public.actividades;"
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose exec postgres psql fallo con exit code $LASTEXITCODE"
  }
  $agCount = [int](($ag | Out-String).Trim())
  $acCount = [int](($ac | Out-String).Trim())

  if ($agCount -le 0) { throw "Sin agentes" }
  if ($acCount -le 0) { throw "Sin actividades" }

  Pass "agentes=$agCount, actividades=$acCount"
}

Run-Step "7) Logs app sin error critico" {
  # Evaluar solo logs emitidos durante esta corrida para evitar ruido historico.
  $logs = ComposeOut logs --since $ScriptStartUtc --tail 500 app
  if ($logs -match "UnhandledPromiseRejection|EADDRINUSE|ECONNREFUSED|FATAL|Error: listen") {
    if ($Strict) { throw "Detectados patrones de error potencial en logs app" }
    Warn "Detectados patrones de error potencial en logs app"
  } else {
    Pass "Sin errores criticos evidentes en logs app"
  }
}

Run-Step "8) Logs postgres sin error critico" {
  # Evaluar solo logs emitidos durante esta corrida para evitar ruido historico.
  $logs = ComposeOut logs --since $ScriptStartUtc --tail 500 postgres
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
