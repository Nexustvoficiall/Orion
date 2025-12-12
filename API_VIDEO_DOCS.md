# 🎬 API de Geração de Vídeos - Orion Creator

## Endpoint: `/api/gerar-video`

### Descrição
Gera vídeos automáticos combinando:
- ✅ Trailer oficial do filme/série (TMDB YouTube)
- ✅ Banner customizado com arte base
- ✅ Textos animados (título, sinopse, metadados)
- ✅ Corte na duração especificada

---

## Requisição

### **POST** `/api/gerar-video`

#### Headers
```
Authorization: Bearer <FIREBASE_ID_TOKEN>
Content-Type: application/json
```

#### Body
```json
{
  "tmdbId": 872585,
  "tmdbTipo": "movie",
  "duracao": 30,
  "temporada": 1
}
```

#### Parâmetros

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `tmdbId` | number | ✅ Sim | ID do filme/série no TMDB |
| `tmdbTipo` | string | ✅ Sim | Tipo: `movie` ou `tv` |
| `duracao` | number | ❌ Não | Duração do vídeo: `15`, `30`, `60` ou `90` segundos (padrão: 30) |
| `temporada` | number | ❌ Não | Número da temporada (apenas para séries) |

---

## Resposta

### Sucesso (200)
Retorna o vídeo MP4 renderizado ou preview PNG (enquanto em desenvolvimento).

```
Content-Type: image/png (preview) ou video/mp4 (final)
Content-Disposition: attachment; filename="video_NomeDOFilme.mp4"
```

### Erro (400)
```json
{
  "error": "tmdbId e tmdbTipo são obrigatórios"
}
```

### Erro (404)
```json
{
  "error": "Nenhum trailer encontrado para este título"
}
```

### Erro (500)
```json
{
  "error": "Erro ao gerar vídeo",
  "message": "Detalhes do erro"
}
```

---

## Fluxo de Processamento

### 1️⃣ Buscar Dados do TMDB
- Título, sinopse, gênero, ano, nota
- Poster e backdrop

### 2️⃣ Buscar Trailer do YouTube
- Prioriza trailers em PT-BR
- Fallback para EN-US se necessário
- Retorna erro 404 se não encontrar

### 3️⃣ Gerar Banner Customizado
- Carrega arte base: `public/images/videos/videos.png`
- Adiciona textos com Sharp:
  - Título (72px, bold)
  - Metadados (⭐ Nota | Ano | Gênero)
  - Sinopse (2 linhas, 28px)
- Dimensões: **1920x1080** (Full HD)

### 4️⃣ Baixar Trailer (TODO)
```bash
# Requer yt-dlp instalado
yt-dlp -f "best[height<=1080]" \
  -o "temp_trailer.mp4" \
  "https://youtube.com/watch?v=TRAILER_KEY"
```

### 5️⃣ Processar com FFmpeg (TODO)
```bash
ffmpeg -i temp_trailer.mp4 \
  -loop 1 -t 5 -i temp_banner.png \
  -filter_complex "[1:v]fade=out:st=4:d=1[banner]; \
                   [0:v][banner]concat=n=2:v=1:a=0, \
                   trim=duration=30" \
  -c:v libx264 -crf 23 -preset fast \
  -c:a aac -b:a 192k \
  output.mp4
```

### 6️⃣ Upload para Cloudinary (TODO)
```javascript
const result = await cloudinary.uploader.upload(outputPath, {
  resource_type: "video",
  folder: "orion-videos",
  public_id: `video_${tmdbId}_${Date.now()}`
});
```

### 7️⃣ Salvar no Firestore
```javascript
{
  userId: "firebase_uid",
  titulo: "Nome do Filme",
  tmdbId: 872585,
  tmdbTipo: "movie",
  duracao: 30,
  trailerKey: "YOUTUBE_KEY",
  videoUrl: "cloudinary_url",
  thumbnailUrl: "banner_url",
  criadoEm: "2025-12-09T...",
  sinopse: "...",
  nota: 8.5,
  ano: "2024",
  genero: "Ação"
}
```

---

## Status Atual

### ✅ Implementado
- [x] Autenticação Firebase
- [x] Busca de dados do TMDB
- [x] Busca de trailers (PT-BR + EN-US)
- [x] Geração de banner customizado com Sharp
- [x] Validação de parâmetros
- [x] Salvamento no Firestore
- [x] Limpeza de arquivos temporários

### ⏳ Em Desenvolvimento
- [ ] Download de trailer do YouTube (yt-dlp)
- [ ] Processamento com FFmpeg
- [ ] Upload de vídeo para Cloudinary
- [ ] Retornar vídeo MP4 final

### 🔜 Próximas Melhorias
- [ ] Adicionar legendas ao vídeo
- [ ] Efeitos de transição customizados
- [ ] Música de fundo (biblioteca livre)
- [ ] Preview em tempo real (WebSocket)
- [ ] Fila de processamento (Bull/Redis)

---

## Exemplo de Uso (Frontend)

```javascript
async function gerarVideo(tmdbId, tmdbTipo, duracao) {
  const token = await auth.currentUser.getIdToken();
  
  const response = await fetch('/api/gerar-video', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      tmdbId,
      tmdbTipo,
      duracao
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message);
  }
  
  // Baixar vídeo/preview
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `video_${tmdbId}.mp4`;
  a.click();
}

// Uso
gerarVideo(872585, 'movie', 30);
```

---

## Dependências Necessárias

### Instaladas
```bash
npm install fluent-ffmpeg
```

### Pendentes
```bash
# Instalar yt-dlp (Python)
pip install yt-dlp

# Ou baixar binário
# Windows: https://github.com/yt-dlp/yt-dlp/releases
# Linux/Mac: brew install yt-dlp
```

---

## Arquivos Temporários

Todos os arquivos temporários são criados em:
```
orionlab/
├── temp_banner_1234567890.png  (deletado após 5s)
├── temp_trailer_1234567890.mp4 (deletado após 5s)
└── video_1234567890.mp4        (deletado após 5s)
```

**Nota:** Arquivos são automaticamente deletados após processamento.

---

## Logs do Console

```
🎬 === INICIANDO GERAÇÃO DE VÍDEO ===
📋 TMDB ID: 872585 | Tipo: movie | Duração: 30s
✅ Dados do TMDB carregados: Exemplo de Filme
🎥 Trailer encontrado: https://youtube.com/watch?v=ABCD1234
📝 Título: Exemplo de Filme
⭐ Nota: 8.5 | 📅 Ano: 2024 | 🎭 Gênero: Ação
🎨 Arte base carregada: C:\...\public\images\videos\videos.png
✅ Banner customizado criado (450.32 KB)
⏳ [PLACEHOLDER] Baixar trailer: https://youtube.com/watch?v=ABCD1234
💡 Implementar download com yt-dlp ou youtube-dl
🎬 Processando vídeo com FFmpeg...
⏱️ Duração solicitada: 30s
⚠️ [DESENVOLVIMENTO] Processamento FFmpeg será implementado
☁️ [PLACEHOLDER] Upload para Cloudinary
✅ Vídeo salvo no Firestore: abc123def456
⏱️ Tempo total: 2.45s
```

---

## Roadmap

### Fase 1: MVP (Atual) ✅
- Banner customizado com metadados
- Preview PNG para testes

### Fase 2: Integração FFmpeg 🔄
- Download de trailers
- Corte e junção de vídeos
- Renderização MP4

### Fase 3: Otimização ⏳
- Cache de trailers
- Fila de processamento
- Compressão otimizada

### Fase 4: Recursos Avançados 🔮
- Legendas automáticas
- Efeitos visuais
- Templates customizáveis
