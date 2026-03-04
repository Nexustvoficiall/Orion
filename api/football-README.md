FootballDataService — integração com TheSportsDB

Config
- `THE_SPORTSDB_V1_KEY` (opcional): chave v1. Default: `123` (public free key).
- `THE_SPORTSDB_V2_KEY` (opcional): chave v2. Quando presente, usa v2 e envia `X-API-KEY`.

Endpoints
- GET `/api/football/leagues` — lista slugs e ids (lê `config/leagues.json`).
- GET `/api/football/next?league=<slug>` — próximos jogos normalizados.
- GET `/api/football/next-multi?leagues=slug1,slug2` — junta resultados ordenados por data/hora.

Cache
- TTL padrão: 10 minutos (configurado em `api/football-service.js`).
- Cache persistido em `storage/cache/tsdb/` como JSON com timestamp.
- Se cache válido, não faz requisição externa.

Uso rápido (local):
- Instale dependências: `npm install` (proj usa `node-fetch`).
- Rodar verificação script:

```bash
node --experimental-specifier-resolution=node scripts/verifyFootball.mjs
```

Observações
- Não armazene chaves no código — use variáveis de ambiente.
- O serviço faz fallback automático para v1 se v2 retornar 401/403.
- Logs de erro incluem contexto (liga, URL) mas não incluem chaves.
