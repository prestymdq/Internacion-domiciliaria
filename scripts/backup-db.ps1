param(
  [string]$OutputDir = "backups"
)

$ErrorActionPreference = "Stop"

if (-not $env:DATABASE_URL) {
  Write-Error "DATABASE_URL no esta configurada."
  exit 1
}

if (-not (Test-Path -LiteralPath $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = Join-Path $OutputDir "backup-$timestamp.dump"

& pg_dump --format=c --no-owner --no-acl --file $backupFile $env:DATABASE_URL
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Output "Backup creado: $backupFile"
