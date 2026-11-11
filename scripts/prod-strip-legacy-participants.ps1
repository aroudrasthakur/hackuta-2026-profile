# Runs migrations:stripLegacyParticipantFields on production (phase 2 only).
# Usage:
#   $env:CONVEX_DEPLOY_KEY = "<prod key>"
#   .\scripts\prod-strip-legacy-participants.ps1
# Or:
#   .\scripts\prod-strip-legacy-participants.ps1 -DeployKey "<prod key>"

param(
  [string]$DeployKey = $env:CONVEX_DEPLOY_KEY
)

$ErrorActionPreference = "Stop"
$ProfileRoot = Split-Path $PSScriptRoot -Parent
Set-Location $ProfileRoot

if (-not $DeployKey) {
  Write-Error "Set CONVEX_DEPLOY_KEY or pass -DeployKey. See scripts/prod-strip-legacy-participants.md"
}

$env:CONVEX_DEPLOYMENT = $null
$env:CONVEX_DEPLOY_KEY = $DeployKey

Write-Host "Running migrations:stripLegacyParticipantFields on deployment for this deploy key..."
npx convex run migrations:stripLegacyParticipantFields

Remove-Item Env:CONVEX_DEPLOY_KEY -ErrorAction SilentlyContinue
Write-Host "Done. Verify participants in the Convex dashboard, then deploy phase 3 (slim schema)."
