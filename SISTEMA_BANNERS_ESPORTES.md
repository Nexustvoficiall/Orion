# 🎨 Sistema de Banners de Esportes - Orion Creator

## 📁 Estrutura de Modelos

O sistema permite criar banners personalizados para diferentes esportes usando modelos PNG como base.

### Estrutura de Pastas

```
public/images/modelos/
├── futebol/
│   ├── modelo1.png
│   ├── modelo2.png
│   └── modelo3.png
├── basquete/
│   └── modelo1.png
├── tenis/
│   └── modelo1.png
├── voley/
│   └── modelo1.png
└── f1/
    └── modelo1.png
```

### ⚡ Fallback (Compatibilidade)

Se um modelo não for encontrado em `modelos/{esporte}/`, o sistema busca automaticamente em:
```
public/images/modelos futebol/{modelo}/{COR}.png
```

Exemplo: `modelos futebol/modelo1/ROXO.png`

## 🎨 Como Criar um Novo Modelo

### 1. Especificações Técnicas

- **Formato**: PNG com transparência
- **Dimensões recomendadas**: 
  - Horizontal: 1920x1080px
  - Vertical: 1080x1920px
  - Quadrado: 1080x1080px
- **Cores disponíveis**: ROXO, AZUL, VERDE, VERMELHO, LARANJA, AMARELO, DOURADO, ROSA, PRATA

### 2. Criando o Design Base

O modelo PNG deve conter:
- ✅ Background com cores/gradientes do tema escolhido
- ✅ Áreas vazias para escudos dos times (esquerda e direita)
- ✅ Espaço central para "VS"
- ✅ Área superior para nome da liga
- ✅ Área inferior para data/hora/local

**Elementos que o sistema adiciona automaticamente:**
- Escudos dos times (buscados do TheSportsDB)
- Nomes dos times
- Liga/Campeonato
- Data e horário
- Local do jogo

### 3. Posicionamento dos Elementos (Código)

O sistema usa as seguintes proporções:

```javascript
// Escudos
escudoSize = 180px
escudoY = height * 0.35 (35% da altura)
escudoHomeX = width * 0.15 (15% da largura, lado esquerdo)
escudoAwayX = width * 0.85 (85% da largura, lado direito)

// Textos
teamNameY = escudoY + escudoSize + 60px
vsY = height / 2 (centro vertical)
leagueY = 120px (topo)
dateTimeY = height - 120px
venueY = height - 70px (rodapé)
```

### 4. Adicionando um Novo Modelo

#### Passo 1: Criar o PNG
Crie o design no Photoshop/GIMP/Figma seguindo as especificações acima.

#### Passo 2: Salvar na Pasta Correta
```bash
# Exemplo para futebol
public/images/modelos/futebol/modelo4.png
```

#### Passo 3: Registrar no Frontend
Edite [futebol.html](public/futebol.html) linha ~515:

```javascript
const sportModels = {
  futebol: [
    { id: 'modelo1', name: 'Modelo 1 - Clássico', preview: '/images/modelos futebol/modelo1/ROXO.png' },
    { id: 'modelo2', name: 'Modelo 2 - Moderno', preview: '/images/placeholder_poster.png' },
    { id: 'modelo3', name: 'Modelo 3 - Elegante', preview: '/images/placeholder_poster.png' },
    { id: 'modelo4', name: 'Modelo 4 - Seu Modelo', preview: '/images/modelos/futebol/modelo4.png' } // NOVO
  ],
  // ...
};
```

## 🏀 Adicionando Novos Esportes

### Passo 1: Criar Pasta do Esporte
```bash
mkdir public/images/modelos/handball
```

### Passo 2: Adicionar Modelos PNG
```bash
# Criar pelo menos 1 modelo
public/images/modelos/handball/modelo1.png
```

### Passo 3: Adicionar no Frontend
Editar [futebol.html](public/futebol.html):

```html
<!-- Adicionar card na grid de esportes (linha ~417) -->
<div class="sport-card" data-sport="handball">
  <span class="sport-icon">🤾</span>
  <div class="sport-name">Handebol</div>
</div>
```

```javascript
// Adicionar configuração de modelos (linha ~515)
const sportModels = {
  // ...outros esportes...
  handball: [
    { id: 'modelo1', name: 'Modelo 1', preview: '/images/modelos/handball/modelo1.png' }
  ]
};
```

### Passo 4: Integrar API de Dados (Opcional)
Se o esporte tiver dados no TheSportsDB, edite função `fetchSportData()` em [futebol.html](public/futebol.html) linha ~620.

## 🎨 Cores Disponíveis

O sistema usa as seguintes cores (definidas em `server.js`):

| Cor | Hex Primary | Hex Secondary |
|-----|-------------|---------------|
| ROXO | #a855f7 | #9333ea |
| AZUL | #3b82f6 | #1e40af |
| VERDE | #10b981 | #059669 |
| VERMELHO | #ef4444 | #dc2626 |
| LARANJA | #f97316 | #ea580c |
| AMARELO | #fbbf24 | #f59e0b |
| DOURADO | #fbbf24 | #b45309 |
| ROSA | #ec4899 | #db2777 |
| PRATA | #94a3b8 | #64748b |

## 🔧 Customização Avançada

### Ajustar Posicionamento de Elementos

Edite o endpoint `/api/gerar-banner-esporte` em [server.js](server.js) linha ~3090:

```javascript
// Exemplo: Mudar tamanho dos escudos
const escudoSize = 220; // era 180

// Exemplo: Mudar posição vertical dos escudos
const escudoY = Math.round(height * 0.40); // era 0.35

// Exemplo: Mudar tamanho da fonte
font-size: 52px // era 48px
```

### Adicionar Novos Elementos SVG

```javascript
// Adicionar logo da liga no topo
const textSvg = `
  <svg>
    <!-- ...elementos existentes... -->
    
    <!-- NOVO: Logo da liga -->
    <image href="${leagueLogoUrl}" x="${centerX - 50}" y="50" width="100" height="100"/>
  </svg>
`;
```

## 📊 Fluxo de Geração

```
1. Usuário escolhe esporte → 2. Escolhe modelo → 3. Escolhe cor → 4. Clica em Gerar
                                                                              ↓
5. Frontend busca dados do TheSportsDB ← 6. Envia para /api/gerar-banner-esporte
                                                                              ↓
7. Backend carrega modelo PNG base ← 8. Adiciona escudos e textos com Sharp
                                                                              ↓
9. Retorna PNG final ← 10. Abre em nova aba para download
```

## 🐛 Troubleshooting

### Modelo não aparece
- ✅ Verificar se o arquivo PNG existe no caminho correto
- ✅ Verificar permissões de leitura do arquivo
- ✅ Conferir nome do arquivo (case-sensitive no Linux)

### Imagem cortada/distorcida
- ✅ Usar dimensões corretas (1920x1080 ou 1080x1920)
- ✅ Verificar se o PNG tem área de trabalho suficiente

### Escudos não aparecem
- ✅ Verificar console do navegador para erros de CORS
- ✅ TheSportsDB pode não ter escudo daquele time
- ✅ Verificar se a URL do escudo está válida

## 📚 Arquivos Relacionados

- `public/futebol.html` - Interface do usuário
- `server.js` (linha ~3090) - Endpoint de geração
- `api/football-service.js` - Integração TheSportsDB
- `public/images/modelos/` - Pasta de modelos PNG

## 💡 Dicas

1. **Performance**: Use PNGs otimizados (< 500KB) para modelos
2. **Design**: Deixe áreas centrais vazias para não conflitar com overlays
3. **Cores**: Crie versões coloridas do modelo ou deixe neutro e use overlays coloridos
4. **Teste**: Sempre testar com diferentes combinações de times/ligas

---

**Criado por**: Orion Creator Team
**Versão**: 2.0
**Data**: 02/02/2026
