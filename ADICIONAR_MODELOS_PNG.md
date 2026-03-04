# ⚠️ IMPORTANTE: Adicionar Arquivos PNG dos Modelos

## 📋 Próximos Passos

Para finalizar a implementação, você precisa adicionar os arquivos PNG dos modelos de banner.

### 1️⃣ Modelos de Futebol (PRIORITÁRIO)

Crie e adicione os seguintes arquivos:

```
public/images/modelos/futebol/modelo1.png  ← Design base do Modelo 1
public/images/modelos/futebol/modelo2.png  ← Design base do Modelo 2
public/images/modelos/futebol/modelo3.png  ← Design base do Modelo 3
```

**Especificações:**
- Dimensões: 1920x1080px (horizontal) ou 1080x1920px (vertical)
- Formato: PNG com transparência
- Design: Background colorido + áreas vazias para escudos dos times

### 2️⃣ Usar Modelos Existentes (Alternativa Rápida)

Se você já tem modelos na pasta antiga, mova-os:

```bash
# Opção A: Copiar modelo existente
cp "public/images/modelos futebol/modelo1/ROXO.png" public/images/modelos/futebol/modelo1.png

# Opção B: Criar links simbólicos (Windows requer admin)
mklink "public\images\modelos\futebol\modelo1.png" "public\images\modelos futebol\modelo1\ROXO.png"
```

### 3️⃣ Outros Esportes (Opcional)

Adicione modelos para os outros esportes quando necessário:

```
public/images/modelos/basquete/modelo1.png
public/images/modelos/tenis/modelo1.png
public/images/modelos/voley/modelo1.png
public/images/modelos/f1/modelo1.png
```

## 🎨 Design Guidelines

### Elementos Obrigatórios no PNG:
- ✅ Background com gradiente ou cores sólidas
- ✅ Espaço vazio à esquerda (~15% da largura) para escudo time casa
- ✅ Espaço vazio à direita (~85% da largura) para escudo time visitante
- ✅ Área central para "VS" (será adicionado por código)
- ✅ Topo para nome da liga (120px do topo)
- ✅ Rodapé para data/hora/local (70-120px do fundo)

### Elementos que o Sistema Adiciona Automaticamente:
- 🏆 Escudos dos times (180x180px)
- 📝 Nomes dos times
- 🎯 "VS" central
- 📅 Data e hora
- 📍 Local do jogo
- 🏅 Nome da liga/campeonato

## 🖼️ Templates Photoshop/Figma

Se precisar criar do zero, use estas camadas:

```
Camadas:
├── Background (Gradiente ou Sólido)
├── Decorações (Linhas, formas, etc)
├── [VAZIO] Escudo Esquerda (área 15% width)
├── [VAZIO] Centro (VS será adicionado)
├── [VAZIO] Escudo Direita (área 85% width)
├── [VAZIO] Topo (Liga)
└── [VAZIO] Rodapé (Data/Local)
```

## 🚀 Testar o Sistema

Após adicionar os PNGs:

1. Acesse `http://localhost:3000/futebol.html`
2. Escolha "Futebol"
3. Escolha um modelo (se o preview não aparecer, o PNG não foi encontrado)
4. Escolha uma cor
5. Clique em "Gerar Banner"

## 📂 Estrutura Final Esperada

```
public/images/
├── modelos/                      ← NOVA estrutura organizada
│   ├── futebol/
│   │   ├── modelo1.png          ✅ ADICIONAR
│   │   ├── modelo2.png          ✅ ADICIONAR
│   │   └── modelo3.png          ✅ ADICIONAR
│   ├── basquete/
│   │   └── modelo1.png          ⏳ Opcional
│   ├── tenis/
│   │   └── modelo1.png          ⏳ Opcional
│   ├── voley/
│   │   └── modelo1.png          ⏳ Opcional
│   └── f1/
│       └── modelo1.png          ⏳ Opcional
│
└── modelos futebol/              ← ANTIGA estrutura (fallback)
    └── modelo1/
        ├── ROXO.png             ✅ Existente
        └── AZUL.png             ✅ Existente
```

## ⚡ Atalho Rápido

Se quiser testar AGORA sem criar novos PNGs:

O sistema automaticamente usa a pasta antiga como fallback! 
Basta garantir que `modelos futebol/modelo1/ROXO.png` existe.

---

**Após adicionar os PNGs, o sistema estará 100% funcional!** 🎉
