# 🚀 Como Executar os Testes de Vídeo

## Opção 1: Script Automático (Recomendado)

Execute o script que inicia o servidor E executa os testes automaticamente:

```powershell
.\start-and-test.ps1
```

Este script irá:
1. ✅ Verificar se o servidor já está rodando
2. ✅ Iniciar o servidor automaticamente (se necessário)
3. ✅ Verificar FFmpeg e yt-dlp
4. ✅ Executar os testes
5. ✅ Perguntar se deseja manter o servidor rodando

---

## Opção 2: Manualmente (Passo a Passo)

### Passo 1: Iniciar o Servidor

**Em um terminal:**
```powershell
npm start
# ou
node server.js
# ou
.\start-server-only.ps1
```

Aguarde até ver a mensagem:
```
╔═══════════════════════════════════════╗
║   🚀 ORION CREATOR SERVER 2.8.21     ║
╚═══════════════════════════════════════╝
Porta: 3000
```

### Passo 2: Executar os Testes

**Em outro terminal:**
```powershell
node test-video-generation.js
```

---

## Opção 3: Usar Interface Web

1. Inicie o servidor:
   ```powershell
   npm start
   ```

2. Acesse no navegador:
   ```
   http://localhost:3000/videos.html
   ```

3. Faça login com Firebase

4. Busque um filme e clique em "Gerar Vídeo"

---

## 🔧 Resolver Problemas

### Erro: "Servidor não está rodando"
```powershell
# Iniciar servidor
npm start
```

### Erro: "Porta 3000 já em uso"
```powershell
# Encontrar processo na porta 3000
Get-Process -Name node | Where-Object {
    (Get-NetTCPConnection -OwningProcess $_.Id | Where-Object {$_.LocalPort -eq 3000})
}

# Encerrar processo
Stop-Process -Name node -Force
```

### Erro: "FFmpeg não encontrado"
1. Baixe FFmpeg: https://ffmpeg.org/download.html
2. Adicione ao PATH do Windows
3. Teste: `ffmpeg -version`

### Erro: "yt-dlp não encontrado"
1. Baixe yt-dlp: https://github.com/yt-dlp/yt-dlp/releases
2. Coloque `yt-dlp.exe` na pasta do projeto ou no PATH
3. Teste: `yt-dlp --version`

---

## 📊 Ordem de Execução Correta

```
┌─────────────────────────────────────┐
│  1. Verificar dependências          │
│     ffmpeg --version                │
│     yt-dlp --version                │
├─────────────────────────────────────┤
│  2. Iniciar servidor                │
│     npm start  (terminal 1)         │
│     Aguardar mensagem de sucesso    │
├─────────────────────────────────────┤
│  3. Executar testes                 │
│     node test-video-generation.js   │
│     (terminal 2, opcional)          │
├─────────────────────────────────────┤
│  4. OU usar interface web           │
│     http://localhost:3000/videos.html│
└─────────────────────────────────────┘
```

---

## ⚡ Comando Rápido

Se quiser fazer tudo de uma vez:

```powershell
.\start-and-test.ps1
```

Pressione Enter quando solicitado para aceitar as opções padrão.
