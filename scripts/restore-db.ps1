param(
  [Parameter(Mandatory = $true)]
  [string]$InputFile
)

$ErrorActionPreference = "Stop"

if (-not $env:DATABASE_URL) {
  Write-Error "DATABASE_URL no esta configurada."
  exit 1
}

if (-not (Test-Path -LiteralPath $InputFile)) {
  Write-Error "No existe el archivo de backup: $InputFile"
  exit 1
}

& pg_restore --clean --if-exists --no-owner --no-acl --dbname $env:DATABASE_URL $InputFile
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Output "Restore completado desde: $InputFile"
