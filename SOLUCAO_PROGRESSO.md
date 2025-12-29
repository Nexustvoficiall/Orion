# ⚡ Solução Rápida: Progresso via Headers Customizados

## Implementação Simples (sem SSE)

### Estratégia

Enviar progresso via headers `X-Progress-*` que o frontend pode ler via `XMLHttpRequest.onprogress`.

### Código Backend (server.js)

```javascript
app.post("/api/gerar-video", verificarAuth, videoLimiter, async (req, res) => {
  const tempFiles = [];
  
  // Função para enviar progresso
  const sendProgress = (percent, stage) => {
    console.log(`📊 Progresso: ${percent}% - ${stage}`);
    // Apenas logar, não há como enviar antes do download
  };
  
  try {
    // ... código existente ...
    
    sendProgress(5, 'Buscando metadados TMDB');
    // Buscar TMDB...
    
    sendProgress(10, 'Baixando trailer');
    // Baixar trailer...
    
    sendProgress(40, 'Processando imagens');
    // Processar Sharp...
    
    sendProgress(60, 'Cortando trailer');
    // FFmpeg corte...
    
    sendProgress(80, 'Codificando vídeo final');
    // FFmpeg composição...
    
    sendProgress(100, 'Concluído');
    
    // Enviar arquivo
    res.download(outputPath, outputFilename, ...);
  }
});
```

### Código Frontend (videos.html)

```javascript
function gerarVideo() {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/gerar-video');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', `Bearer ${userToken}`);
    xhr.responseType = 'blob';
    
    // Progresso do download (não do processamento)
    xhr.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = (e.loaded / e.total) * 100;
        progressBar.style.width = percent + '%';
      }
    };
    
    xhr.onload = () => {
      if (xhr.status === 200) {
        const blob = xhr.response;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'video.mp4';
        a.click();
        resolve();
      } else {
        reject(new Error('Erro ao gerar vídeo'));
      }
    };
    
    xhr.send(JSON.stringify({ tmdbId, tmdbTipo, duracao, qualidade }));
  });
}
```

**PROBLEMA**: Isso só mostra progresso do DOWNLOAD, não do PROCESSAMENTO.

---

## Solução REAL: WebSocket Simples

Muito mais simples que SSE. Vou implementar isso.

### 1. Instalar socket.io

```bash
npm install socket.io
```

### 2. Adicionar ao server.js

```javascript
import { createServer } from 'http';
import { Server } from 'socket.io';

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

// Namespace para progresso de vídeo
const videoNamespace = io.of('/video-progress');

videoNamespace.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

// No endpoint de geração, emitir progresso
app.post("/api/gerar-video", verificarAuth, videoLimiter, async (req, res) => {
  const jobId = `video_${Date.now()}`;
  const userId = req.uid;
  
  // Retornar jobId imediatamente
  res.status(202).json({ jobId });
  
  // Processar em background
  (async () => {
    videoNamespace.emit(`progress-${jobId}`, { percent: 5, stage: 'Iniciando...' });
    
    // ... processar vídeo ...
    
    videoNamespace.emit(`progress-${jobId}`, { percent: 100, url: videoUrl });
  })();
});

httpServer.listen(PORT);
```

### 3. Frontend (videos.html)

```html
<script src="/socket.io/socket.io.js"></script>
<script>
async function gerarVideo() {
  // 1. Solicitar geração
  const res = await fetch('/api/gerar-video', { method: 'POST', ... });
  const { jobId } = await res.json();
  
  // 2. Conectar ao WebSocket
  const socket = io('/video-progress');
  
  socket.on(`progress-${jobId}`, (data) => {
    progressBar.style.width = data.percent + '%';
    progressText.textContent = data.percent + '%';
    stageText.textContent = data.stage;
    
    if (data.percent === 100 && data.url) {
      window.location.href = data.url;
      socket.disconnect();
    }
  });
}
</script>
```

Esta é a solução CORRETA e mais simples!

