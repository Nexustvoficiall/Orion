# 🎯 Tarefa: Converter /api/gerar-video para Processamento Assíncrono

## Problema Atual

O endpoint `/api/gerar-video` é **bloqueante**: o cliente espera até o vídeo ficar pronto e então faz o download. Isso impede:
1. Mostrar progresso real durante o processamento
2. Cancelar a geração
3. Processar múltiplos vídeos simultaneamente

## Solução: Processamento Assíncrono + Socket.IO

### Arquitetura

```
Cliente                Backend                  Firestore
  │                      │                         │
  ├─POST /api/gerar-video─►                       │
  │                      │                         │
  │◄──jobId (202)───────┤                         │
  │                      │                         │
  ├─Socket.IO subscribe──►                        │
  │   (jobId)            │                         │
  │                      ├──Criar job──────────────►
  │                      │  (iniciado, 0%)         │
  │                      │                         │
  │                      ├──Processar vídeo────┐   │
  │                      │                      │   │
  │◄──progress event─────┤◄─────────────────────┘   │
  │   {percent: 25}      ├──Update job──────────────►
  │                      │  (processando, 25%)     │
  │                      │                         │
  │◄──progress event─────┤◄─────────────────────┐   │
  │   {percent: 50}      ├──Update job──────────────►
  │                      │  (processando, 50%)     │
  │                      │                         │
  │◄──progress event─────┤◄─────────────────────┐   │
  │   {percent: 100}     │                      │   │
  │   {url}              ├──Update job──────────────►
  │                      │  (completo, 100%, url)  │
  │                      │                         │
  ├─GET url (download)───►                        │
```

### Mudanças Necessárias

#### 1. Modificar endpoint para retornar jobId imediatamente

```javascript
app.post("/api/gerar-video", verificarAuth, videoLimiter, async (req, res) => {
  const { tmdbId, tmdbTipo, duracao, temporada, qualidade } = req.body || {};
  
  // Validações
  if (!tmdbId) return res.status(400).json({ error: "tmdbId obrigatório" });
  // ...
  
  // Gerar jobId único
  const jobId = `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const userId = req.uid;
  
  // Criar documento no Firestore
  await db.collection("videoJobs").doc(jobId).set({
    userId,
    tmdbId,
    tmdbTipo,
    duracao: parseInt(duracao),
    temporada,
    qualidade: parseInt(qualidade),
    status: "iniciado",
    percent: 0,
    stage: "Preparando...",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    videoUrl: null,
    error: null
  });
  
  // Retornar jobId imediatamente
  res.status(202).json({ 
    jobId,
    message: "Vídeo em processamento. Conecte-se via Socket.IO para acompanhar."
  });
  
  // Processar em background (não await!)
  processarVideo(jobId, userId, { tmdbId, tmdbTipo, duracao: parseInt(duracao), temporada, qualidade: parseInt(qualidade) })
    .catch(err => {
      console.error(`❌ Erro ao processar vídeo ${jobId}:`, err);
      db.collection("videoJobs").doc(jobId).update({
        status: "erro",
        error: err.message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Notificar via Socket.IO
      global.emitVideoProgress(jobId, {
        status: "erro",
        percent: 0,
        error: err.message
      });
    });
});
```

#### 2. Criar função processarVideo

```javascript
async function processarVideo(jobId, userId, { tmdbId, tmdbTipo, duracao, temporada, qualidade }) {
  const tempFiles = [];
  
  try {
    const emitProgress = (percent, stage) => {
      console.log(`📊 ${jobId}: ${percent}% - ${stage}`);
      
      // Atualizar Firestore
      db.collection("videoJobs").doc(jobId).update({
        percent,
        stage,
        status: "processando",
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch(err => console.warn("Erro ao atualizar Firestore:", err));
      
      // Emitir via Socket.IO
      global.emitVideoProgress(jobId, {
        status: "processando",
        percent,
        stage
      });
    };
    
    emitProgress(5, "Buscando metadados TMDB...");
    
    const tempDir = path.join(__dirname, "temp");
    const outputDir = path.join(__dirname, "public", "videos");
    await fsPromises.mkdir(tempDir, { recursive: true });
    await fsPromises.mkdir(outputDir, { recursive: true });
    
    // 1. Buscar TMDB
    const detailsUrl = buildTMDBUrl(`/${tmdbTipo}/${tmdbId}`, {
      append_to_response: "videos,images,credits"
    });
    const detailsResp = await fetchWithTimeout(detailsUrl, {}, 15000);
    if (!detailsResp.ok) throw new Error("Filme/Série não encontrado no TMDB");
    const details = await detailsResp.json();
    
    const titulo = details.title || details.name || "Título Desconhecido";
    
    emitProgress(10, "Baixando trailer do YouTube...");
    
    // 2. Baixar trailer
    const videos = details.videos?.results || [];
    const findTrailer = (lang) => videos.find(v => v.site === "YouTube" && v.type === "Trailer" && v.iso_639_1 === lang);
    let trailer = findTrailer("pt-BR") || findTrailer("pt") || findTrailer("en") || videos.find(v => v.site === "YouTube");
    
    if (!trailer) throw new Error("Nenhum trailer disponível");
    
    const trailerKey = trailer.key;
    const trailerPath = path.join(tempDir, `trailer_${trailerKey}.mp4`);
    tempFiles.push(trailerPath);
    
    // ... continuar com download, etc ...
    
    // Durante download do yt-dlp, emitir progresso:
    const ytdlpProcess = spawn('yt-dlp', [...args]);
    ytdlpProcess.stdout.on('data', (data) => {
      const text = data.toString();
      const match = text.match(/(\d+\.\d+)%/);
      if (match) {
        const downloadPercent = parseFloat(match[1]);
        const progressPercent = 10 + (downloadPercent / 100) * 25; // 10-35%
        emitProgress(Math.floor(progressPercent), `Baixando trailer... ${downloadPercent.toFixed(1)}%`);
      }
    });
    
    emitProgress(40, "Processando imagens...");
    
    // 3. Processar backdrop, poster, logos (Sharp)
    // ... código existente ...
    
    emitProgress(60, "Cortando trailer...");
    
    // 4. Cortar trailer (FFmpeg)
    // ... código existente ...
    
    emitProgress(75, "Codificando vídeo final...");
    
    // 5. Compor vídeo final (FFmpeg)
    // ... código existente ...
    
    emitProgress(90, "Fazendo upload para Cloudinary...");
    
    // 6. Upload para Cloudinary
    const uploadResult = await cloudinary.uploader.upload(outputPath, {
      resource_type: 'video',
      folder: 'videos',
      public_id: `video_${tmdbId}_${Date.now()}`,
      overwrite: true
    });
    
    const videoUrl = uploadResult.secure_url;
    
    emitProgress(100, "Concluído!");
    
    // 7. Atualizar Firestore com resultado final
    await db.collection("videoJobs").doc(jobId).update({
      status: "completo",
      percent: 100,
      stage: "Concluído",
      videoUrl,
      completedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // 8. Emitir evento de conclusão via Socket.IO
    global.emitVideoProgress(jobId, {
      status: "completo",
      percent: 100,
      stage: "Concluído",
      videoUrl
    });
    
    // 9. Limpar arquivos temporários
    await Promise.all(tempFiles.map(f => fsPromises.unlink(f).catch(() => {})));
    await fsPromises.unlink(outputPath).catch(() => {});
    
    console.log(`✅ Vídeo ${jobId} processado com sucesso!`);
    
  } catch (err) {
    console.error(`❌ Erro ao processar vídeo ${jobId}:`, err);
    
    // Limpar arquivos temp
    await Promise.all(tempFiles.map(f => fsPromises.unlink(f).catch(() => {})));
    
    // Atualizar Firestore com erro
    await db.collection("videoJobs").doc(jobId).update({
      status: "erro",
      error: err.message,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Emitir erro via Socket.IO
    global.emitVideoProgress(jobId, {
      status: "erro",
      percent: 0,
      error: err.message
    });
    
    throw err;
  }
}
```

#### 3. Criar endpoint para servir vídeos do Cloudinary

```javascript
app.get("/api/video/:jobId", verificarAuth, async (req, res) => {
  const { jobId } = req.params;
  const userId = req.uid;
  
  try {
    const jobDoc = await db.collection("videoJobs").doc(jobId).get();
    
    if (!jobDoc.exists) {
      return res.status(404).json({ error: "Job não encontrado" });
    }
    
    const job = jobDoc.data();
    
    // Verificar se pertence ao usuário
    if (job.userId !== userId) {
      return res.status(403).json({ error: "Acesso negado" });
    }
    
    // Verificar se está completo
    if (job.status !== "completo") {
      return res.status(404).json({ 
        error: "Vídeo ainda não está pronto", 
        status: job.status,
        percent: job.percent
      });
    }
    
    // Redirecionar para Cloudinary
    res.redirect(job.videoUrl);
    
  } catch (err) {
    console.error("❌ Erro ao buscar vídeo:", err);
    res.status(500).json({ error: "Erro ao buscar vídeo" });
  }
});
```

### Frontend (videos.html)

```html
<!DOCTYPE html>
<html>
<head>
  <!-- ... -->
  <script src="/socket.io/socket.io.js"></script>
</head>
<body>
  <!-- ... -->
  
  <script>
    let videoSocket = null;
    let currentJobId = null;
    
    function conectarSocket() {
      if (!videoSocket) {
        videoSocket = io('/video-progress');
        
        videoSocket.on('connect', () => {
          console.log('✅ Socket.IO conectado');
          if (currentJobId) {
            videoSocket.emit('subscribe', currentJobId);
          }
        });
        
        videoSocket.on('progress', (data) => {
          console.log('📊 Progresso:', data);
          
          // Atualizar UI
          const progressBar = document.getElementById('progressBar');
          const progressText = document.getElementById('progressText');
          const stageText = document.getElementById('stageText');
          
          if (progressBar) progressBar.style.width = data.percent + '%';
          if (progressText) progressText.textContent = data.percent + '%';
          if (stageText) stageText.textContent = data.stage;
          
          // Se completo, fazer download
          if (data.status === 'completo' && data.videoUrl) {
            setTimeout(() => {
              window.location.href = data.videoUrl;
              fecharModalGeracao();
            }, 500);
          }
          
          // Se erro, mostrar mensagem
          if (data.status === 'erro') {
            alert('Erro ao gerar vídeo: ' + data.error);
            fecharModalGeracao();
          }
        });
      }
    }
    
    async function gerarVideo() {
      conectarSocket();
      
      const payload = {
        tmdbId: currentData.tmdbId,
        tmdbTipo: currentData.type,
        duracao: duracao,
        qualidade: qualidade
      };
      
      if (currentData.type === 'tv' && currentData.selectedSeason) {
        payload.temporada = currentData.selectedSeason;
      }
      
      console.log('🌐 Solicitando geração de vídeo...');
      
      const res = await fetch('/api/gerar-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userToken}`
        },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      
      if (res.status === 202) {
        currentJobId = data.jobId;
        console.log('✅ Job criado:', currentJobId);
        
        // Inscrever no progresso
        videoSocket.emit('subscribe', currentJobId);
        
        // Mostrar modal de progresso
        abrirModalGeracao();
        
      } else {
        throw new Error(data.error || 'Erro ao solicitar geração');
      }
    }
  </script>
</body>
</html>
```

## Próximos Passos

1. ✅ Socket.IO instalado
2. ✅ HTTP server + Socket.IO configurado
3. ⏳ Refatorar `/api/gerar-video` para retornar jobId
4. ⏳ Criar função `processarVideo` assíncrona
5. ⏳ Adicionar calls `emitProgress` em cada etapa
6. ⏳ Upload para Cloudinary ao invés de salvar local
7. ⏳ Modificar frontend para conectar Socket.IO
8. ⏳ Testar fluxo completo

**Status**: Infraestrutura pronta, precisa refatorar lógica de processamento
