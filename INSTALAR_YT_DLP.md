# Como Instalar yt-dlp no Windows

## Método 1: Download Direto (Mais Rápido)

1. **Baixar o executável:**
   - Acesse: https://github.com/yt-dlp/yt-dlp/releases/latest
   - Baixe o arquivo: `yt-dlp.exe`

2. **Colocar na pasta do projeto:**
   ```powershell
   # Mova o arquivo baixado para a pasta do projeto
   Move-Item "$env:USERPROFILE\Downloads\yt-dlp.exe" "C:\Users\charl\OneDrive\Desktop\orionlab\"
   ```

3. **Testar:**
   ```powershell
   .\yt-dlp.exe --version
   ```

---

## Método 2: Adicionar ao PATH do Sistema

1. **Baixar yt-dlp.exe** (mesmo link acima)

2. **Criar pasta para executáveis:**
   ```powershell
   mkdir C:\bin
   Move-Item "$env:USERPROFILE\Downloads\yt-dlp.exe" "C:\bin\"
   ```

3. **Adicionar ao PATH:**
   ```powershell
   # Adicionar ao PATH do usuário
   $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
   [Environment]::SetEnvironmentVariable("Path", "$userPath;C:\bin", "User")
   ```

4. **Reiniciar PowerShell e testar:**
   ```powershell
   yt-dlp --version
   ```

---

## Método 3: Via Chocolatey (Se tiver instalado)

```powershell
choco install yt-dlp
```

---

## Método 4: Via Python pip (Se tiver Python)

```powershell
pip install yt-dlp
```

---

## Verificar Instalação

Após instalar, execute:

```powershell
# Se instalou na pasta do projeto
.\yt-dlp.exe --version

# Se instalou no PATH
yt-dlp --version
```

---

## Atualizar yt-dlp

```powershell
# Se baixou o executável
.\yt-dlp.exe -U

# Se instalou via pip
pip install -U yt-dlp
```

---

## Testar Download de Vídeo

```powershell
# Testar com um vídeo curto
yt-dlp "https://www.youtube.com/watch?v=jNQXAC9IVRw" -f "best[height<=720]" --no-playlist
```

---

## Configurar no Projeto

Se instalou na **pasta do projeto**, o servidor já vai encontrar automaticamente.

Se instalou no **PATH do sistema**, reinicie o servidor:

```powershell
# Parar servidor
Get-Process -Name node | Stop-Process

# Iniciar novamente
npm start
```

---

## Solução de Problemas

### "yt-dlp não é reconhecido como comando"

**Solução 1:** Use o caminho completo:
```powershell
C:\Users\charl\OneDrive\Desktop\orionlab\yt-dlp.exe --version
```

**Solução 2:** Verifique o PATH:
```powershell
$env:Path -split ";" | Select-String "bin"
```

### "Erro ao baixar vídeo"

Execute com mais detalhes:
```powershell
yt-dlp --verbose "URL_DO_VIDEO"
```

---

## Links Úteis

- **Releases:** https://github.com/yt-dlp/yt-dlp/releases
- **Documentação:** https://github.com/yt-dlp/yt-dlp#readme
- **Comandos:** https://github.com/yt-dlp/yt-dlp#usage-and-options
