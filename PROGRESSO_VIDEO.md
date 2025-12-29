# 📊 Sistema de Progresso para Geração de Vídeo

## Problema Atual

A geração de vídeo é bloqueante e não fornece feedback em tempo real. O usuário não sabe qual % do processo foi concluído.

## Solução Implementada

### 1. Arquitetura com Server-Sent Events (SSE)

```
Frontend (videos.html)
   │
   ├── POST /api/gerar-video (retorna jobId)
   │   Response 202: { "jobId": "video_123456789_abc" }
   │
   └── GET /api/video-progress/:jobId (SSE stream)
       Events: 
       - {status: "downloading", percent: 25, stage: "Baixando trailer..."}
       - {status: "processing", percent: 50, stage: "Processando imagens..."}
       - {status: "encoding", percent: 75, stage: "Codificando vídeo..."}
       - {status: "complete", percent: 100, url: "https://..."}
```

### 2. Fases de Progresso

| Fase | % | Descrição |
|------|---|-----------|
| Iniciando | 0-5% | Validação e setup |
| Buscando metadados | 5-10% | TMDB API |
| Baixando trailer | 10-35% | yt-dlp (30-50% do tempo) |
| Processando imagens | 35-50% | Sharp (backdrop, poster, logos) |
| Cortando trailer | 50-60% | FFmpeg corte |
| Codificando vídeo | 60-95% | FFmpeg composição |
| Finalizando | 95-100% | Upload e cleanup |

### 3. Endpoints

#### POST /api/gerar-video
- **Entrada**: `{ tmdbId, tmdbTipo, duracao, qualidade, temporada? }`
- **Saída**: `{ jobId, message }`
- **Status**: 202 Accepted
- **Comportamento**: Retorna imediatamente e processa em background

#### GET /api/video-progress/:jobId
- **Headers**: `text/event-stream`
- **Auth**: Bearer token (verifica se jobId pertence ao usuário)
- **Formato**: `data: {"status":"...", "percent":50, "stage":"..."}\n\n`
- **Eventos**:
  - `status: "iniciado"` - Processo começou
  - `status: "downloading"` - Baixando trailer
  - `status: "processing"` - Processando imagens
  - `status: "encoding"` - Codificando vídeo
  - `status: "complete"` - Concluído (inclui URL)
  - `status: "error"` - Falha (inclui mensagem)

### 4. Armazenamento de Jobs

Salvar no Firestore em `videoJobs/{jobId}`:
```javascript
{
  userId: "abc123",
  tmdbId: 12345,
  status: "processing", // iniciado|processing|complete|error
  percent: 50,
  stage: "Processando imagens...",
  createdAt: Timestamp,
  completedAt: Timestamp?,
  videoUrl: "https://res.cloudinary.com/...",
  error: "Mensagem de erro"?
}
```

### 5. Modificações no Frontend (videos.html)

```javascript
async function gerarVideo() {
  // 1. Solicitar geração
  const res = await fetch('/api/gerar-video', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userToken}`
    },
    body: JSON.stringify({ tmdbId, tmdbTipo, duracao, qualidade })
  });
  
  const { jobId } = await res.json();
  
  // 2. Conectar ao SSE
  const eventSource = new EventSource(`/api/video-progress/${jobId}?token=${userToken}`);
  
  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    // Atualizar progress bar
    progressBar.style.width = data.percent + '%';
    progressText.textContent = data.percent + '%';
    stageText.textContent = data.stage;
    
    if (data.status === 'complete') {
      eventSource.close();
      // Download do vídeo
      window.location.href = data.url;
    }
    
    if (data.status === 'error') {
      eventSource.close();
      alert('Erro: ' + data.error);
    }
  };
}
```

### 6. Cálculo de Progresso por Etapa

No `server.js`:

```javascript
function updateProgress(jobId, userId, stage, basePercent, currentPercent = 0) {
  const percent = Math.min(basePercent + currentPercent, 100);
  sendProgress(userId, jobId, {
    status: 'processing',
    percent,
    stage
  });
  
  // Salvar no Firestore
  db.collection('videoJobs').doc(jobId).update({
    percent,
    stage,
    status: 'processing'
  });
}

// Exemplo de uso:
updateProgress(jobId, userId, 'Buscando metadados TMDB...', 5);
updateProgress(jobId, userId, 'Baixando trailer do YouTube...', 10);

// Durante download do yt-dlp:
const ytdlpProcess = spawn('yt-dlp', [...]);
ytdlpProcess.stdout.on('data', (data) => {
  const match = data.toString().match(/(\d+\.\d+)%/);
  if (match) {
    const downloadPercent = parseFloat(match[1]);
    const progressPercent = 10 + (downloadPercent / 100) * 25; // 10-35%
    updateProgress(jobId, userId, 'Baixando trailer...', 0, progressPercent);
  }
});
```

### 7. Otimizações de Velocidade Aplicadas

Para reduzir o tempo total de processamento:

#### Download Paralelo
- `--concurrent-fragments 4` no yt-dlp
- Reduz tempo de download em 3-4x

#### Qualidade Adaptativa
- 480p requisição → baixa apenas 480p
- Evita processar 1080p para depois redimensionar

#### FFmpeg Ultrafast
- Preset `ultrafast` para 480p
- Preset `veryfast` para 720p
- Preset `fast` para 1080p
- **Economia**: 2-3x mais rápido

#### CRF Otimizado
- CRF 28 (480p), 26 (720p), 23 (1080p)
- Qualidade visual aceitável, velocidade máxima

#### Processamento Sharp
- Redimensionamento com `cubic` kernel (mais rápido que `lanczos3`)
- Cache de imagens processadas por tmdbId
- Compressão PNG com `compressionLevel: 6` (padrão é 9)

### 8. Tempo Esperado por Etapa (30s de vídeo)

| Etapa | 480p | 720p | 1080p |
|-------|------|------|-------|
| Metadados TMDB | 1-2s | 1-2s | 1-2s |
| Download trailer | 5-10s | 8-15s | 12-20s |
| Processar imagens | 3-5s | 4-6s | 5-8s |
| Cortar trailer | 2-3s | 3-5s | 5-8s |
| Codificar vídeo | 10-15s | 20-30s | 40-60s |
| Upload Cloudinary | 3-5s | 5-8s | 8-12s |
| **TOTAL** | **25-40s** | **45-66s** | **75-110s** |

### 9. Próximos Passos para Implementação

1. ✅ Adicionar Map de conexões SSE
2. ✅ Criar endpoint GET /api/video-progress/:jobId
3. ⏳ Modificar /api/gerar-video para processar em background
4. ⏳ Adicionar calls para `sendProgress()` em cada etapa
5. ⏳ Salvar vídeo final no Cloudinary
6. ⏳ Modificar frontend para conectar ao SSE
7. ⏳ Testar fluxo completo

### 10. Código de Referência

Ver implementações em:
- `server.js` linha ~1379: função `spawnProcessWithProgress`
- `server.js` linha ~1420: endpoint SSE `/api/video-progress/:jobId`
- `server.js` linha ~1458: função `sendProgress`
- `server.js` linha ~1462: endpoint POST `/api/gerar-video`

---

**Status**: Parcialmente implementado (infraestrutura SSE pronta, falta integrar com o pipeline de geração)  
**Prioridade**: Alta - Requisito explícito do usuário  
**Complexidade**: Média - Requer refatoração do endpoint bloqueante para assíncrono
