param(
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

function Read-EnvPort {
  param(
    [string]$EnvFilePath,
    [int]$DefaultPort = 3000
  )

  if (-not (Test-Path $EnvFilePath)) {
    return $DefaultPort
  }

  $line = Get-Content $EnvFilePath |
    Where-Object { $_ -match '^\s*PORT\s*=' } |
    Select-Object -First 1

  if (-not $line) {
    return $DefaultPort
  }

  $raw = ($line -replace '^\s*PORT\s*=\s*', '').Trim()
  if (-not $raw) {
    return $DefaultPort
  }

  $raw = $raw.Trim('"').Trim("'")
  $parsed = 0
  if ([int]::TryParse($raw, [ref]$parsed) -and $parsed -gt 0) {
    return $parsed
  }

  return $DefaultPort
}

function Get-ListeningProcess {
  param([int]$Port)

  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1

  if (-not $conn) {
    return $null
  }

  $procId = [int]$conn.OwningProcess
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue

  if (-not $proc) {
    return [pscustomobject]@{
      ProcessId = $procId
      Name = 'desconocido'
      CommandLine = ''
    }
  }

  return [pscustomobject]@{
    ProcessId = $procId
    Name = $proc.Name
    CommandLine = [string]$proc.CommandLine
  }
}

function Test-Grs1LoginSignature {
  param([int]$Port)

  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/login.html" -f $Port) -TimeoutSec 2
    if (-not $resp -or -not $resp.Content) {
      return $false
    }

    $html = [string]$resp.Content
    return ($html -like '*id="loginForm"*' -and $html -like '*/api/auth/login*')
  } catch {
    return $false
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$packageJsonPath = Join-Path $repoRoot 'package.json'
$envPath = Join-Path $repoRoot '.env'

if (-not (Test-Path $packageJsonPath)) {
  Write-Error "No se encontro package.json en $repoRoot"
  exit 1
}

$pkg = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
if ($pkg.name -ne 'grs1-js') {
  Write-Error "Este script solo aplica para grs1-js. Repo detectado: $($pkg.name)"
  exit 1
}

$targetPort = Read-EnvPort -EnvFilePath $envPath -DefaultPort 3000
$env:PORT = [string]$targetPort

Write-Host "Repo validado: grs1-js"
Write-Host "Puerto objetivo: $targetPort"

$targetOwner = Get-ListeningProcess -Port $targetPort
if ($targetOwner) {
  $cmd = [string]$targetOwner.CommandLine
  if (-not $cmd) {
    $cmd = ''
  }
  $cmd = $cmd.ToLowerInvariant()
  $rootNorm = $repoRoot.ToLowerInvariant()

  if ($cmd -like "*$rootNorm*") {
    Write-Host "Ya hay una instancia de este repo en el puerto $targetPort (PID $($targetOwner.ProcessId))."
    Write-Host 'No se inicia otra instancia para evitar duplicados.'
    exit 0
  }

  if (Test-Grs1LoginSignature -Port $targetPort) {
    Write-Host "Puerto $targetPort ya responde con el login de grs1-js (PID $($targetOwner.ProcessId))."
    Write-Host 'No se inicia otra instancia para evitar duplicados.'
    exit 0
  }

  Write-Error (
    "Puerto $targetPort ocupado por otro proceso: " +
    "PID $($targetOwner.ProcessId) $($targetOwner.Name). " +
    'Libera ese puerto o cambia PORT en .env.'
  )
  exit 1
}

$altOwner = Get-ListeningProcess -Port 5000
if ($altOwner) {
  Write-Host (
    "Aviso: detectado servicio en 5000 (PID $($altOwner.ProcessId) $($altOwner.Name)). " +
    'Puede ser otro proyecto.'
  )
}

if ($CheckOnly) {
  Write-Host 'Check OK. Sin iniciar servidor por -CheckOnly.'
  exit 0
}

Set-Location $repoRoot
npm run dev
exit $LASTEXITCODE
