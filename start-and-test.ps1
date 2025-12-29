# Script PowerShell para iniciar servidor e executar testes
# Uso: .\start-and-test.ps1

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "   ORION CREATOR - INICIALIZACAO E TESTES" -ForegroundColor Cyan
Write-Host "================================================================`n" -ForegroundColor Cyan

# Verificar se .env existe
if (-not (Test-Path ".env")) {
    Write-Host "[ERRO] Arquivo .env nao encontrado!" -ForegroundColor Red
    Write-Host "       Crie um arquivo .env com as variaveis necessarias." -ForegroundColor Yellow
    exit 1
}

# Verificar se o servidor já está rodando
Write-Host "[INFO] Verificando se o servidor ja esta rodando..." -ForegroundColor Yellow
$existingProcess = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
    (Get-NetTCPConnection -OwningProcess $_.Id -ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -eq 3000})
}

if ($existingProcess) {
    Write-Host "[OK] Servidor ja esta rodando (PID: $($existingProcess.Id))" -ForegroundColor Green
    $useExisting = Read-Host "Deseja usar o servidor existente? (S/n)"
    
    if ($useExisting -eq "n" -or $useExisting -eq "N") {
        Write-Host "[ACAO] Encerrando servidor existente..." -ForegroundColor Yellow
        Stop-Process -Id $existingProcess.Id -Force
        Start-Sleep -Seconds 2
        Write-Host "[OK] Servidor encerrado" -ForegroundColor Green
    } else {
        Write-Host "[OK] Usando servidor existente" -ForegroundColor Green
        $skipStart = $true
    }
}

# Iniciar servidor se necessário
if (-not $skipStart) {
    Write-Host "`n[ACAO] Iniciando servidor..." -ForegroundColor Cyan
    
    # Iniciar servidor em background
    $serverJob = Start-Job -ScriptBlock {
        Set-Location $using:PWD
        node server.js
    }
    
    Write-Host "[INFO] Aguardando servidor inicializar (10 segundos)..." -ForegroundColor Yellow
    Start-Sleep -Seconds 10
    
    # Verificar se iniciou
    $serverRunning = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
        (Get-NetTCPConnection -OwningProcess $_.Id -ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -eq 3000})
    }
    
    if ($serverRunning) {
        Write-Host "[OK] Servidor iniciado com sucesso (PID: $($serverRunning.Id))" -ForegroundColor Green
    } else {
        Write-Host "[ERRO] Falha ao iniciar servidor!" -ForegroundColor Red
        Write-Host "       Verifique os logs acima para detalhes." -ForegroundColor Yellow
        Receive-Job -Job $serverJob
        Remove-Job -Job $serverJob -Force
        exit 1
    }
}

# Verificar FFmpeg
Write-Host "`n[INFO] Verificando dependencias..." -ForegroundColor Cyan
try {
    $ffmpegVersion = ffmpeg -version 2>&1 | Select-Object -First 1
    Write-Host "[OK] FFmpeg: $ffmpegVersion" -ForegroundColor Green
} catch {
    Write-Host "[AVISO] FFmpeg nao encontrado no PATH" -ForegroundColor Yellow
    Write-Host "        Baixe em: https://ffmpeg.org/download.html" -ForegroundColor Gray
}

# Verificar yt-dlp
try {
    $ytdlpVersion = yt-dlp --version 2>&1
    Write-Host "[OK] yt-dlp: v$ytdlpVersion" -ForegroundColor Green
} catch {
    Write-Host "[AVISO] yt-dlp nao encontrado no PATH" -ForegroundColor Yellow
    Write-Host "        Baixe em: https://github.com/yt-dlp/yt-dlp/releases" -ForegroundColor Gray
}

# Perguntar se deseja executar testes
Write-Host "`n"
$runTests = Read-Host "Deseja executar os testes agora? (S/n)"

if ($runTests -ne "n" -and $runTests -ne "N") {
    Write-Host "`n[TESTE] Executando testes..." -ForegroundColor Cyan
    Write-Host "================================================================`n" -ForegroundColor Gray
    
    node test-video-generation.js
    
    Write-Host "`n================================================================" -ForegroundColor Gray
}

# Perguntar se deseja manter servidor rodando
if (-not $skipStart) {
    Write-Host "`n"
    $keepRunning = Read-Host "Deseja manter o servidor rodando? (S/n)"
    
    if ($keepRunning -eq "n" -or $keepRunning -eq "N") {
        Write-Host "[ACAO] Encerrando servidor..." -ForegroundColor Yellow
        if ($serverJob) {
            Stop-Job -Job $serverJob
            Remove-Job -Job $serverJob -Force
        }
        
        $serverProcess = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
            (Get-NetTCPConnection -OwningProcess $_.Id -ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -eq 3000})
        }
        if ($serverProcess) {
            Stop-Process -Id $serverProcess.Id -Force
        }
        
        Write-Host "[OK] Servidor encerrado" -ForegroundColor Green
    } else {
        Write-Host "[OK] Servidor continua rodando em background" -ForegroundColor Green
        Write-Host "     Para parar: Get-Process -Name node | Stop-Process" -ForegroundColor Gray
        Write-Host "     Acesse: http://localhost:3000" -ForegroundColor Cyan
    }
}

Write-Host "`n[CONCLUIDO] Processo finalizado!`n" -ForegroundColor Green
