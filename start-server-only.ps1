# Script PowerShell para apenas iniciar o servidor
# Uso: .\start-server-only.ps1

Write-Host "`n[ACAO] Iniciando Orion Creator Server...`n" -ForegroundColor Cyan

# Verificar se .env existe
if (-not (Test-Path ".env")) {
    Write-Host "[ERRO] Arquivo .env nao encontrado!" -ForegroundColor Red
    exit 1
}

# Verificar se já está rodando
$existingProcess = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
    (Get-NetTCPConnection -OwningProcess $_.Id -ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -eq 3000})
}

if ($existingProcess) {
    Write-Host "[AVISO] Servidor ja esta rodando na porta 3000 (PID: $($existingProcess.Id))" -ForegroundColor Yellow
    Write-Host "        Acesse: http://localhost:3000" -ForegroundColor Cyan
    exit 0
}

# Iniciar servidor
Write-Host "[INFO] Iniciando servidor na porta 3000..." -ForegroundColor Yellow
node server.js
