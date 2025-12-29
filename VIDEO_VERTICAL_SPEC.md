# 🎬 Especificação Técnica - Geração de Vídeo Vertical (1080x1920)

## Visão Geral

Sistema completo de geração automática de vídeos promocionais verticais para filmes e séries, integrado ao Orion Creator. Utiliza Sharp para composição gráfica e FFmpeg para renderização de vídeo.

---

## Especificações do Vídeo Final

| Propriedade | Valor |
|------------|-------|
| **Resolução** | 1080x1920 (vertical) |
| **Codec Vídeo** | H.264 (libx264) |
| **Codec Áudio** | AAC |
| **Taxa de Quadros** | 30 FPS |
| **Duração** | 30s, 60s ou 90s (configurável) |
| **Qualidade** | CRF 18 (alta qualidade) |
| **Bitrate Áudio** | 192 kbps |
| **Sample Rate** | 48000 Hz |

---

## Estrutura de Camadas (ordem de renderização)

```
┌─────────────────────────────────┐
│   1. BACKDROP (Fundo)           │  ← Backdrop TMDB 1080x1920
│      • Escurecido (35%)         │     (blur 3px aplicado)
│      • Blur aplicado            │
├─────────────────────────────────┤
│   2. POSTER DO FILME            │  ← Poster TMDB 720x1080
│      • Centralizado             │     Posição: x=180, y=400
│      • 720x1080px               │
├─────────────────────────────────┤
│   3. LOGO OFICIAL (TMDB)        │  ← Logo do filme (se disponível)
│      • Máx: 600x150px           │     Posição: topo, centralizada
│      • Prioridade: pt-BR        │     y=200
├─────────────────────────────────┤
│   4. TEXTOS SVG                 │  ← Título, Sinopse, Metadados
│      • Título (topo ou abaixo   │     Fontes: Arial Black, Arial
│        da logo se existir)      │     Com sombras e gradientes
│      • Sinopse (inferior)       │
│      • Metadados (rodapé)       │
├─────────────────────────────────┤
│   5. LOGO DO CLIENTE            │  ← Logo do usuário (Firebase)
│      • 200x200px máx            │     Posição: canto superior direito
│      • Canto superior direito   │     x=830, y=50
├─────────────────────────────────┤
│   6. TRAILER (Topo)             │  ← Vídeo YouTube (via FFmpeg)
│      • 1080x608px (16:9)        │     Posicionado: y=0 (topo)
│      • Horizontal mantido       │     Atrás do overlay
├─────────────────────────────────┤
│   7. OVERLAY PNG                │  ← Moldura/efeitos visuais
│      • 1080x1920px              │     Camada superior (alpha)
│      • Transparência mantida    │     Caminho: public/images/videos/overlay.png
└─────────────────────────────────┘
```

---

## Payload da Requisição (videos.html)

### Endpoint
```
POST /api/gerar-video
Authorization: Bearer <FIREBASE_ID_TOKEN>
Content-Type: application/json
```

### Corpo da Requisição
```json
{
  "tmdbId": 872585,
  "tmdbTipo": "movie",
  "duracao": 30,
  "qualidade": 480,
  "temporada": 1
}
```

### Parâmetros

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|------------|-----------|
| `tmdbId` | number | ✅ Sim | ID do filme/série no TMDB |
| `tmdbTipo` | string | ✅ Sim | Tipo: `movie` ou `tv` |
| `duracao` | number | ✅ Sim | Duração: `30`, `60` ou `90` segundos |
| `qualidade` | number | ❌ Não | Qualidade (para referência, não usado atualmente) |
| `temporada` | number | ❌ Não | Número da temporada (apenas para séries) |

---

## Pipeline de Processamento

### 1️⃣ Buscar Dados do TMDB
```javascript
GET /3/{tmdbTipo}/{tmdbId}?append_to_response=videos,images,credits
```
- Título, sinopse, gêneros, ano
- Nota média (vote_average)
- Runtime/duração
- Imagens: posters, backdrops, logos
- Vídeos: trailers do YouTube

### 2️⃣ Buscar Trailer do YouTube
- **Prioridade**: pt-BR → pt → en → qualquer disponível
- **Filtro**: Site = "YouTube" AND Type = "Trailer"
- **Download**: yt-dlp (com 4 estratégias de fallback)

### 3️⃣ Buscar Logo Oficial do Filme
- Endpoint: `images.logos` do TMDB
- **Prioridade**: pt/pt-BR → en → null → primeiro disponível
- **Dimensões máximas**: 600x150px (mantendo proporção)

### 4️⃣ Buscar Poster do Filme
- **Para séries com temporada**: Buscar poster da temporada específica
- **Prioridade**: pt/pt-BR → en → null → primeiro disponível
- **Fallback**: `poster_path` do detalhe principal

### 5️⃣ Processar Backdrop (Sharp)
```javascript
sharp(backdropBuffer)
  .resize(1080, 1920, { fit: "cover", position: "center" })
  .modulate({ brightness: 0.35 })  // Escurecer 65%
  .blur(3)                          // Blur para legibilidade
  .toBuffer()
```

### 6️⃣ Gerar Composição Visual (Sharp)

#### Elementos compostos:
1. **Poster do filme**: 720x1080, posição (180, 400)
2. **Logo oficial** (se existir): max 600x150, topo centralizado
3. **Textos SVG**:
   - Título: 42-62px, branco, bold, com sombra
   - Sinopse: 26px, 5 linhas máx, quebra automática
   - Metadados: 30px, gradiente dourado, formato: `★ 8.5 • Ação, Drama • 2024`
4. **Logo do cliente**: 200x200 máx, canto superior direito

#### SVG Template:
```svg
<svg width="1080" height="1920">
  <defs>
    <linearGradient id="goldGrad">...</linearGradient>
    <filter id="textShadow">...</filter>
  </defs>
  
  <text class="title">TÍTULO</text>
  <text class="synop">Linha 1 da sinopse...</text>
  <text class="meta">★ 8.5 • Ação, Drama • 2024</text>
</svg>
```

### 7️⃣ Processar Trailer com yt-dlp

#### Estratégias de Download (em ordem):
1. **yt-dlp best**: `-f 'best[height<=1080]'`
2. **yt-dlp mp4**: `-f 'mp4'`
3. **youtube-dl**: fallback legacy
4. **Placeholder**: Vídeo preto 30s (se tudo falhar)

#### Cortar Trailer:
```bash
ffmpeg -i trailer.mp4 -t {duracao} -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k trailer_trimmed.mp4
```

### 8️⃣ Composição Final com FFmpeg

```bash
ffmpeg \
  -loop 1 -framerate 30 -i frame.png \      # Frame com backdrop + elementos
  -i trailer_trimmed.mp4 \                   # Trailer cortado
  -loop 1 -framerate 30 -i overlay.png \    # Overlay PNG
  -filter_complex "
    [1:v]scale=1080:608:force_original_aspect_ratio=decrease,setsar=1,fps=30[trailer];
    [0:v][trailer]overlay=(W-w)/2:0:shortest=1[with_trailer];
    [with_trailer][2:v]overlay=0:0:shortest=1[final]
  " \
  -map '[final]' -map '1:a?' \
  -t {duracao} \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 \
  -c:a aac -b:a 192k -ar 48000 \
  -movflags +faststart \
  video_output.mp4
```

---

## Arquivos Importantes

| Arquivo | Descrição |
|---------|-----------|
| `server.js` (linha 1375) | Endpoint `/api/gerar-video` |
| `public/videos.html` (linha 2500) | Frontend que envia requisição |
| `public/images/videos/overlay.png` | Overlay PNG (1080x1920) |
| `temp/` | Diretório temporário (auto-criado) |
| `public/videos/` | Diretório de saída dos vídeos |

---

## Dependências Externas

### Obrigatórias
- **FFmpeg** (mínimo v4.x)
- **yt-dlp** (preferencial) ou youtube-dl

### Instalação (Linux/Ubuntu)
```bash
sudo apt update
sudo apt install ffmpeg yt-dlp
```

### Instalação (Windows)
```powershell
# FFmpeg: https://ffmpeg.org/download.html
# yt-dlp: https://github.com/yt-dlp/yt-dlp/releases
```

---

## Tratamento de Erros

| Erro | Código | Descrição |
|------|--------|-----------|
| tmdbId ausente | 400 | Campo obrigatório não enviado |
| tmdbTipo inválido | 400 | Deve ser 'movie' ou 'tv' |
| Duração inválida | 400 | Deve ser 30, 60 ou 90 |
| Filme não encontrado | 404 | TMDB não retornou dados |
| Trailer indisponível | 404 | Nenhum trailer no YouTube |
| Poster indisponível | 404 | Nenhum poster no TMDB |
| Overlay não encontrado | 404 | Arquivo overlay.png ausente |
| Falha no download | 500 | yt-dlp/youtube-dl falharam |
| Falha no FFmpeg | 500 | Erro na composição do vídeo |

---

## Otimizações Implementadas

### Performance
- ✅ Cache de imagens (1h TTL)
- ✅ Cache de respostas TMDB (30min TTL)
- ✅ Rate limiting por tipo de operação
- ✅ Limpeza automática de arquivos temporários
- ✅ Auto-delete de vídeos após 5 minutos

### Qualidade
- ✅ CRF 18 (alta qualidade visual)
- ✅ Bitrate áudio 192 kbps
- ✅ Faststart flag (streaming otimizado)
- ✅ Backdrop escurecido e blur para legibilidade

### Segurança
- ✅ Autenticação Firebase obrigatória
- ✅ Validação de URLs de imagens
- ✅ Domínios permitidos (whitelist)
- ✅ Rate limiting: 3 vídeos/min por usuário

---

## Logs de Debug

### Exemplo de Log Completo:
```
🎬 ==========================================
   GERAÇÃO DE VÍDEO INICIADA
   TMDB ID: 872585 | Tipo: movie
   Duração: 30s | Qualidade: 480p
==========================================

📡 1/8 - Buscando dados no TMDB...
✅ Dados: "Megan" (2022)

🎥 2/8 - Buscando trailer no YouTube...
✅ Trailer: dQw4w9WgXcQ (pt-BR)

⬇️ 3/8 - Baixando trailer do YouTube...
   Tentativa 1: yt-dlp com formato best...
   ✅ Sucesso com yt-dlp (best)
✅ Trailer obtido com sucesso

🎨 4/8 - Buscando logo oficial do filme (TMDB)...
✅ Logo oficial encontrada (en)

🖼️ 5/8 - Buscando poster do filme...
✅ Poster obtido do TMDB

🌌 6/8 - Processando backdrop (1080x1920)...
✅ Backdrop processado (1080x1920, escurecido e blur aplicado)

🖌️ 7/8 - Gerando composição visual com Sharp...
✅ Logo oficial adicionada (450x120)
✅ Logo do cliente adicionada
✅ Frame visual gerado (1080x1920)

✂️ 8/8 - Cortando e processando trailer...
✅ Trailer cortado para 30s

🎬 9/9 - Compondo vídeo final com FFmpeg...
✅ Vídeo gerado com sucesso!

✅ ==========================================
   VÍDEO GERADO COM SUCESSO!
   Arquivo: video_872585_1735410234567.mp4
   Resolução: 1080x1920 (vertical)
   Duração: 30s
==========================================
```

---

## Próximos Passos / Melhorias Futuras

### Funcionalidades
- [ ] Suporte a múltiplos idiomas de legendas
- [ ] Efeitos de transição animados
- [ ] Música de fundo customizável
- [ ] Templates de overlay variados
- [ ] Marca d'água dinâmica

### Performance
- [ ] Processamento em fila (queue system)
- [ ] Geração assíncrona com notificação
- [ ] Cache de vídeos gerados (24h)
- [ ] Compressão adaptativa baseada em qualidade

### Experiência
- [ ] Preview em tempo real (frames estáticos)
- [ ] Progresso real do FFmpeg
- [ ] Histórico de vídeos gerados
- [ ] Download em lote

---

## Contato e Suporte

Para problemas ou melhorias, verificar:
1. Logs do servidor (`console.log`)
2. Arquivos temporários em `temp/`
3. Existência do overlay em `public/images/videos/overlay.png`
4. Instalação de FFmpeg e yt-dlp

---

**Versão**: 2.8.21  
**Última atualização**: 28/12/2025  
**Autor**: Orion Creator Development Team
