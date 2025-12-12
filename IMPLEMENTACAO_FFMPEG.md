# 🎬 Guia de Implementação FFmpeg - Vídeos Verticais 1080x1920

## 📐 Especificação do Layout

### Formato Final
- **Resolução**: 1080x1920 (vertical, formato Stories/Reels)
- **Duração**: 15s, 30s, 60s ou 90s (configurável)
- **FPS**: 30 fps
- **Codec**: H.264 (libx264)
- **Áudio**: AAC, 192 kbps

### Camadas (ordem de renderização)

```
┌─────────────────────┐
│                     │
│   1. BACKDROP       │  ← Trailer horizontal (1920x1080)
│   (Parte superior)  │     Cortado/escalado para topo
│   Blur + Escuro     │     Efeito: blur 3px, brightness 70%
│                     │
├─────────────────────┤
│                     │
│   2. OVERLAY        │  ← Arte base (public/images/videos/videos.png)
│   (Imagem PNG)      │     Dimensões: 1080x1920
│                     │     Gradientes, molduras, efeitos
│                     │
│   3. POSTER         │  ← Poster do filme (TMDB)
│   (350x520px)       │     Posição: Centro-superior
│   Centro superior   │     Left: 365px, Top: 650px
│                     │
│   4. TEXTOS         │  ← Renderizados com SVG/FFmpeg
│   Título            │     Título: Bebas Neue, 68px, branco
│   Metadados         │     Meta: Inter 600, 28px, dourado
│   Sinopse           │     Sinopse: Inter 400, 24px, cinza claro
│                     │
└─────────────────────┘
```

---

## 🛠️ Passo a Passo de Implementação

### **Fase 1: Instalar yt-dlp**

```powershell
# Opção 1: Via pip (se tiver Python)
pip install yt-dlp

# Opção 2: Baixar executável
# https://github.com/yt-dlp/yt-dlp/releases
# Colocar yt-dlp.exe na pasta do projeto ou PATH
```

### **Fase 2: Função para baixar trailer**

Adicionar no `server.js` após a linha 1800:

```javascript
// Função para baixar trailer do YouTube
async function downloadTrailer(trailerKey, outputPath) {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    
    const ytdlp = spawn('yt-dlp', [
      '-f', 'best[height<=1080]', // Melhor qualidade até 1080p
      '--no-playlist',
      '--no-warnings',
      '-o', outputPath,
      `https://youtube.com/watch?v=${trailerKey}`
    ]);

    ytdlp.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Trailer baixado: ${outputPath}`);
        resolve();
      } else {
        reject(new Error(`yt-dlp falhou com código ${code}`));
      }
    });

    ytdlp.on('error', (err) => {
      reject(new Error(`Erro ao executar yt-dlp: ${err.message}`));
    });
  });
}
```

### **Fase 3: Função para processar vídeo com FFmpeg**

```javascript
// Função para gerar vídeo vertical com FFmpeg
async function generateVideoFFmpeg(options) {
  return new Promise((resolve, reject) => {
    const {
      trailerPath,      // Caminho do trailer baixado
      backdropPath,     // Backdrop processado (1920x1080)
      framePath,        // Frame com overlay+poster+textos (1080x1920)
      outputPath,       // Caminho de saída
      duracao           // Duração em segundos
    } = options;

    ffmpeg()
      // ENTRADA 1: Backdrop (loop)
      .input(backdropPath)
      .inputOptions(['-loop 1', '-framerate 30'])
      .duration(duracao)

      // ENTRADA 2: Trailer
      .input(trailerPath)
      .inputOptions(['-t', duracao])

      // ENTRADA 3: Frame overlay (loop)
      .input(framePath)
      .inputOptions(['-loop 1', '-framerate 30'])
      .duration(duracao)

      // FILTROS COMPLEXOS
      .complexFilter([
        // 1. Processar trailer: escalar e cortar para 1920x1080
        '[1:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,fps=30[trailer]',
        
        // 2. Sobrepor trailer no backdrop (centro)
        '[0:v][trailer]overlay=(W-w)/2:(H-h)/2:shortest=1[bg]',
        
        // 3. Converter para formato vertical 1080x1920 (foco na parte superior)
        '[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:0:0[vertical]',
        
        // 4. Sobrepor frame final (overlay + poster + textos)
        '[vertical][2:v]overlay=0:0:shortest=1[final]'
      ])

      // MAPEAMENTO E CODECS
      .outputOptions([
        '-map', '[final]',          // Vídeo final
        '-map', '1:a?',             // Áudio do trailer (se existir)
        '-c:v', 'libx264',          // Codec H.264
        '-preset', 'fast',          // Velocidade de encoding
        '-crf', '23',               // Qualidade (18=alta, 23=boa, 28=baixa)
        '-c:a', 'aac',              // Codec de áudio
        '-b:a', '192k',             // Bitrate áudio
        '-t', duracao.toString(),   // Duração final
        '-pix_fmt', 'yuv420p'       // Compatibilidade máxima
      ])

      // SAÍDA
      .output(outputPath)

      // EVENTOS
      .on('start', (cmd) => {
        console.log(`🎬 FFmpeg iniciado: ${cmd}`);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log(`⏳ Progresso: ${progress.percent.toFixed(1)}%`);
        }
      })
      .on('end', () => {
        console.log(`✅ Vídeo gerado: ${outputPath}`);
        resolve();
      })
      .on('error', (err) => {
        console.error(`❌ Erro FFmpeg: ${err.message}`);
        reject(err);
      })
      .run();
  });
}
```

### **Fase 4: Integrar no endpoint `/api/gerar-video`**

Substituir o bloco de TODO (linha ~1880) por:

```javascript
// 9. Baixar trailer do YouTube
const trailerTempPath = path.join(__dirname, `temp_trailer_${Date.now()}.mp4`);
tempFiles.push(trailerTempPath);

try {
  await downloadTrailer(trailerKey, trailerTempPath);
} catch (err) {
  return res.status(500).json({ 
    error: "Erro ao baixar trailer", 
    message: err.message 
  });
}

// 10. Processar vídeo com FFmpeg
const outputPath = path.join(__dirname, `video_${Date.now()}.mp4`);
tempFiles.push(outputPath);

try {
  await generateVideoFFmpeg({
    trailerPath: trailerTempPath,
    backdropPath: backdropProcessedPath,
    framePath: framePath,
    outputPath: outputPath,
    duracao: parseInt(duracao)
  });
} catch (err) {
  return res.status(500).json({ 
    error: "Erro ao processar vídeo", 
    message: err.message 
  });
}

// 11. Ler vídeo e retornar
const videoBuffer = await fsPromises.readFile(outputPath);
const safeTitle = titulo.replace(/[^a-zA-Z0-9]/g, '_');

res.set("Content-Type", "video/mp4");
res.set("Content-Disposition", `attachment; filename="video_${safeTitle}_${duracao}s.mp4"`);
res.send(videoBuffer);
```

---

## 🧪 Testando

### Teste Manual (sem yt-dlp ainda)

1. Baixe um trailer manualmente:
```powershell
# Exemplo: trailer de Oppenheimer
yt-dlp -f "best[height<=1080]" -o trailer_test.mp4 "https://youtube.com/watch?v=uYPbbksJxIg"
```

2. Teste o processamento FFmpeg:
```powershell
ffmpeg -loop 1 -framerate 30 -t 30 -i temp_backdrop_XXX.png `
  -i trailer_test.mp4 `
  -loop 1 -framerate 30 -t 30 -i temp_frame_XXX.png `
  -filter_complex "[1:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,fps=30[trailer]; `
  [0:v][trailer]overlay=(W-w)/2:(H-h)/2:shortest=1[bg]; `
  [bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:0:0[vertical]; `
  [vertical][2:v]overlay=0:0:shortest=1[final]" `
  -map "[final]" -map 1:a? -c:v libx264 -preset fast -crf 23 `
  -c:a aac -b:a 192k -t 30 -pix_fmt yuv420p output_test.mp4
```

### Teste via API

```javascript
// Frontend: Gerar vídeo de 30s
const response = await fetch('/api/gerar-video', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${userToken}`
  },
  body: JSON.stringify({
    tmdbId: 872585,
    tmdbTipo: 'movie',
    duracao: 30
  })
});

const blob = await response.blob();
const url = URL.createObjectURL(blob);
// Baixar ou reproduzir
```

---

## 📊 Geração em Massa (5 vídeos)

### Frontend já está pronto!
- Limite de 5 seleções
- Modal atualizado
- Botão "Gerar Vídeos" configurado

### Backend: Processar em sequência

No frontend (videos.html), a função `generateSingleBanner` deve ser atualizada para chamar `/api/gerar-video`:

```javascript
async function generateSingleVideo(item, duracao) {
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Não autenticado');
    
    const response = await fetch('/api/gerar-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        tmdbId: item.id,
        tmdbTipo: item.type,
        duracao: duracao
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message);
    }
    
    return await response.blob();
    
  } catch (error) {
    console.error('Erro ao gerar vídeo:', error);
    return null;
  }
}
```

---

## 🚀 Melhorias Futuras

### Fase 5: Otimizações
- [ ] Cache de trailers baixados (evitar re-download)
- [ ] Processamento paralelo (até 3 vídeos simultâneos)
- [ ] Preview em tempo real (WebSocket)
- [ ] Compressão otimizada (CRF adaptativo)

### Fase 6: Recursos Avançados
- [ ] Legendas automáticas (speech-to-text)
- [ ] Música de fundo customizável
- [ ] Transições animadas entre cenas
- [ ] Efeitos de zoom/pan no poster
- [ ] Marca d'água do usuário

### Fase 7: Performance
- [ ] Fila de processamento (Bull + Redis)
- [ ] Worker dedicado para FFmpeg
- [ ] Resumo de vídeo inteligente (cortes nas melhores cenas)
- [ ] Múltiplas resoluções (480p, 720p, 1080p)

---

## ⚠️ Requisitos do Sistema

### Software
- **FFmpeg**: 4.4+ (com libx264, libfdk_aac)
- **yt-dlp**: Última versão
- **Node.js**: 18.x ou superior
- **RAM**: Mínimo 4GB (8GB recomendado)

### Windows
```powershell
# Instalar FFmpeg via Chocolatey
choco install ffmpeg

# Verificar instalação
ffmpeg -version
yt-dlp --version
```

### Tempo de Processamento Estimado
- **15s**: ~10-15 segundos
- **30s**: ~20-30 segundos
- **60s**: ~40-60 segundos
- **90s**: ~60-90 segundos

**Nota**: Tempo varia com CPU e preset do FFmpeg

---

## 🎯 Status Atual

### ✅ Implementado
- [x] Endpoint `/api/gerar-video`
- [x] Busca de trailers TMDB (PT-BR + EN-US)
- [x] Download de poster e backdrop
- [x] Processamento de backdrop (1920x1080, blur, dark)
- [x] Criação de frame overlay (1080x1920)
- [x] SVG com título, metadados e sinopse
- [x] Retorno de preview PNG
- [x] Frontend ajustado (5 vídeos, seletor duração)

### ⏳ Pendente
- [ ] Integrar função `downloadTrailer`
- [ ] Integrar função `generateVideoFFmpeg`
- [ ] Retornar vídeo MP4 final
- [ ] Testar com diferentes filmes/séries
- [ ] Otimizar performance

### 🔜 Próximo Passo
**Adicionar funções `downloadTrailer` e `generateVideoFFmpeg` no server.js**

---

## 📞 Suporte

Em caso de erro, verificar:
1. FFmpeg instalado: `ffmpeg -version`
2. yt-dlp instalado: `yt-dlp --version`
3. Logs do servidor: `npm start`
4. Arquivos temporários limpos: `temp_*.mp4`, `temp_*.png`

**Logs importantes:**
```
🎬 === INICIANDO GERAÇÃO DE VÍDEO VERTICAL (1080x1920) ===
✅ Dados carregados: [título]
🎥 Trailer: https://youtube.com/watch?v=[key]
✅ Poster baixado: XXX KB
✅ Backdrop baixado: XXX KB
✅ Backdrop processado: 1920x1080
✅ Frame criado: 1080x1920
✅ Trailer baixado: temp_trailer_XXX.mp4
🎬 FFmpeg iniciado: [comando]
⏳ Progresso: 50.0%
✅ Vídeo gerado: video_XXX.mp4
```
