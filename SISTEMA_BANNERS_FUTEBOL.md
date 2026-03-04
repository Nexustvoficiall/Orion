# Sistema de Banners de Futebol - Documentação

## 📋 Visão Geral

Sistema completo para gerar banners personalizados de jogos de futebol com dados em tempo real.

## 🎯 Fluxo de Funcionamento

### 1. Frontend (`futebol.html`)

**Ao Carregar a Página:**
1. Chama `/api/football/jogos-hoje`
2. Recebe lista de TODOS os jogos do dia de TODAS as ligas configuradas
3. Exibe cards com:
   - Horário do jogo
   - Nome da liga
   - Times (com escudos)
   - VS no centro
   - Canal de transmissão
   - Botão "Gerar Banner"

**Ao Clicar em "Gerar Banner":**
1. Envia para `/api/gerar-banner-esporte` com payload:
```json
{
  "esporte": "futebol",
  "modelo": "modelo1",
  "cor": "ROXO",
  "homeTeam": "Sunderland",
  "awayTeam": "Burnley",
  "homeBadgeUrl": "https://...",
  "awayBadgeUrl": "https://...",
  "league": "English Premier League",
  "slug_liga": "premier_league",
  "date": "2025-02-02",
  "time": "20:00:00",
  "canal": "ESPN / Star+",
  "players": [...]
}
```
2. Recebe PNG do banner e abre em nova aba

### 2. Backend (`server.js`)

**Endpoint `/api/gerar-banner-esporte`:**

1. **Carrega Modelo Base:**
   - Busca PNG em: `public/images/modelos/futebol/modelo1/{COR}.png`
   - Valida existência do arquivo

2. **Busca Recursos Externos:**
   - Escudos dos times (via URLs do TMDB)
   - Fotos de jogadores (opcional, via `players` array)

3. **Composição com Sharp:**
   ```
   ┌─────────────────────────────────────┐
   │  HORÁRIO (topo branco)              │
   ├─────────────────────────────────────┤
   │ DATA    [Jogador1] [Jogador2]       │
   │ (vert)  [Jogador3] [Jogador4]       │
   │                                     │
   │         TIME1  VS  TIME2            │
   │         [🛡️]      [🛡️]              │
   │                                     │
   │         LIGA                        │
   ├─────────────────────────────────────┤
   │  📺 CANAL (rodapé preto)            │
   └─────────────────────────────────────┘
   ```

4. **Retorna PNG:**
   - Content-Type: `image/png`
   - Content-Disposition: `attachment; filename="banner_futebol_...png"`

### 3. API de Dados (`api/football-service.js`)

**Endpoint `/api/football/jogos-hoje`:**

1. Lê `config/leagues.json` (15 ligas configuradas)
2. Busca próximos jogos de cada liga via TheSportsDB
3. Filtra apenas jogos de hoje (`dateEvent === hoje`)
4. Enriquece com:
   - Escudos dos times (`homeBadgeUrl`, `awayBadgeUrl`)
   - Fotos de jogadores (`players` array com 2 por time)
   - Canal oficial (`canal_oficial` via `broadcasters.json`)
5. Ordena por horário
6. Retorna JSON:
```json
{
  "success": true,
  "date": "2025-02-02",
  "total": 12,
  "events": [...]
}
```

## 📁 Estrutura de Arquivos

```
public/images/modelos/
├── futebol/
│   └── modelo1/
│       ├── ROXO.png      ← Modelo roxo
│       ├── AZUL.png      ← Modelo azul
│       ├── VERDE.png
│       ├── VERMELHO.png
│       ├── LARANJA.png
│       ├── AMARELO.png
│       ├── DOURADO.png
│       ├── ROSA.png
│       └── PRATA.png
├── basquete/
├── tenis/
├── voley/
└── f1/
```

## 🔧 Configurações

### `config/leagues.json`
Mapeamento slug → ID do TheSportsDB:
```json
{
  "brasileirao_serie_a": 4351,
  "premier_league": 4328,
  "la_liga": 4335,
  ...
}
```

### `config/broadcasters.json`
Mapeamento slug → Canal de transmissão:
```json
{
  "brasileirao_serie_a": "Premiere / Globo",
  "premier_league": "ESPN / Star+",
  ...
}
```

## 🎨 Layout do Banner

### Dimensões
- **Padrão:** 1920x1080 px (Full HD)
- **Modelo Base:** PNG colorido com design personalizado

### Elementos Sobrepostos

| Elemento | Posição | Tamanho | Cor |
|----------|---------|---------|-----|
| **Horário** | Topo central (y=80) | 56px | Branco |
| **Data** | Esquerda vertical (x=100) | 32px | Roxo (#a855f7) |
| **Jogadores** | Lado esquerdo (y=25%) | 180x270px | - |
| **Nome Time Casa** | 25% largura | 48px | Branco |
| **VS** | Centro | 64px | Azul (#6366f1) |
| **Nome Time Visitante** | 75% largura | 48px | Branco |
| **Escudo Casa** | 25% largura (y=40%+80) | 120x120px | - |
| **Escudo Visitante** | 75% largura (y=40%+80) | 120x120px | - |
| **Liga** | Centro (y=height-120) | 32px | Roxo |
| **Canal** | Rodapé central (y=height-60) | 40px | Branco |

### Fontes
- **Títulos:** Arial Black, sans-serif
- **Textos:** Arial, sans-serif

## 🚀 Como Adicionar Novas Cores

1. **Criar PNG:**
   - Tamanho: 1920x1080 px
   - Nome: `{COR}.png` (MAIÚSCULAS)
   - Colocar em: `public/images/modelos/futebol/modelo1/`

2. **Atualizar Frontend:**
   ```html
   <!-- Em futebol.html, adicionar no grid de cores -->
   <div class="color-option" data-color="NOVA_COR">
     <div class="color-preview" style="background: #codigo;"></div>
     <span>Nova Cor</span>
   </div>
   ```

## 📊 Performance

### Cache
- **TMDB Cache:** 30 min (500 itens)
- **Image Cache:** 1h (200 itens)
- **TheSportsDB Cache:** 10 min (arquivo JSON em `storage/cache/tsdb/`)

### Rate Limits
- **TMDB:** 500 req/15min
- **Banners:** 20 req/5min
- **Uploads:** 20 req/hora

## 🔍 Troubleshooting

### Erro: "Modelo não encontrado"
**Causa:** Arquivo PNG não existe
**Solução:** 
```bash
# Verificar se arquivo existe
Test-Path "public/images/modelos/futebol/modelo1/ROXO.png"

# Listar cores disponíveis
Get-ChildItem "public/images/modelos/futebol/modelo1/"
```

### Erro: "Nenhum jogo encontrado"
**Causa:** Não há jogos hoje nas ligas configuradas
**Solução:** Verificar se há jogos em `leagues.json`:
```bash
# Testar endpoint
curl http://localhost:3000/api/football/jogos-hoje
```

### Escudos não aparecem
**Causa:** URL inválida ou erro ao baixar imagem
**Solução:** Verificar logs do servidor para erros de fetch

### Jogadores não aparecem
**Causa:** Array `players` vazio ou URLs inválidas
**Solução:** Verificar se TheSportsDB retornou jogadores com fotos

## 📝 TODO

- [ ] Adicionar seletor de cor antes de gerar banner
- [ ] Botão "Gerar Todos" para gerar banners de todos os jogos
- [ ] Preview do banner antes de baixar
- [ ] Histórico de banners gerados
- [ ] Suporte para outros esportes (basquete, tênis, etc)
- [ ] Upload de modelos personalizados via admin
- [ ] Edição de textos/posições via interface visual
