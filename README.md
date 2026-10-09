# Views que não parecem humanas

Classificador **explicável** para uma série de views por hora. Ele devolve `legit`, `suspicious` ou `inconclusive`, um motivo em português e todos os sinais que usou, com o valor e o limiar de cada um. Não há modelo opaco: cada sinal é uma conta simples, e a decisão é uma regra de quatro linhas.

## Como rodar

Node 22 ou mais novo.

```bash
npm install
npm test            # inclui o teste que compara o README com o medido
npm run evaluate    # gera o dataset, mede as taxas e reescreve o bloco de métricas abaixo
npm run dataset     # idem, e grava data/dataset.json
npm run dev         # API em http://127.0.0.1:3009
```

```bash
curl -s -X POST localhost:3009/classify -H 'content-type: application/json' \
  -d '{"post_id":"p1","start_hour_local":18,"hourly_views":[2100,1900,1400,600,300,250,240,26300,23200,310,280,700,900,1100,1300,1500,1600,1700,1650,1500,1200,900,600,400]}'
```

```json
{
  "post_id": "p1",
  "label": "suspicious",
  "reason": "entre as horas 7 e 8 as views saltaram 58.4× acima do normal e, logo depois, caíram para 2% do pico: público humano não some de uma hora para outra depois de um pico.",
  "signals": [
    { "id": "bought_spike", "fired": true, "strength": "strong", "value": 0.016, "threshold": "bloco ≤ 4h e cauda < 15% do pico", "hours": [7, 8], "explanation": "…" },
    { "id": "ambiguous_spike", "fired": false, … },
    { "id": "abrupt_cliff", "fired": false, "explanation": "a única queda brusca é o fim do pico já apontado acima", … },
    { "id": "mechanical_flat", "fired": false, … },
    { "id": "no_day_night_cycle", "fired": false, … }
  ],
  "stats": { "hours": 24, "total_views": 71930, "peak_hour": 7, "peak_views": 26300 }
}
```

A entrada `hourly_views` são as views **ganhas** em cada hora desde a publicação (não o acumulado). `start_hour_local` é a hora local (America/Sao_Paulo) da primeira posição. `GET /criteria` devolve os limiares em uso.

## O critério

Os limiares ficam todos em `THRESHOLDS`, em [`src/classifier.ts`](src/classifier.ts).

| Sinal | Força | O que mede | Por que separa humano de comprado |
|---|---|---|---|
| `bought_spike` | forte | Uma hora com ≥ 8× a mediana das 6h anteriores (e ≥ 1000 views acima). O bloco do pico dura ≤ 4h e **a média das 3h seguintes fica abaixo de 15% do pico**. | Pico comprado é entregue e acaba. Pico humano (repost, viral) também pode subir de uma vez, mas **a audiência fica**: decai em horas, não some na hora seguinte. **A cauda é o que separa os dois.** |
| `ambiguous_spike` | fraco | O mesmo pico, com cauda entre 15% e 30%. | Caiu rápido, mas não o bastante para afirmar. |
| `mechanical_flat` | forte | 12h seguidas com média ≥ 200/h e coeficiente de variação < 3,5%. | Audiência real oscila com a hora do dia e com o acaso. Bot entrega um ritmo constante. |
| `abrupt_cliff` | forte | 3h sustentadas ≥ 300/h que caem, de uma hora para outra, para ≤ 12% disso e ficam lá por 3h. | É o desenho de uma entrega comprada que terminou. Humano diminui aos poucos, mesmo de madrugada. |
| `no_day_night_cycle` | fraco | Em 48h+, cada hora é dividida pela mediana das 24h ao redor dela. Dispara se a mediana das madrugadas (2h–6h) for ≥ 85% da dos dias (12h–22h). | Público brasileiro dorme. Mas público em vários fusos também não tem ciclo, então **sozinho este sinal não acusa**. |

**Decisão:**

1. Série com menos de 24h, ou com menos de 3000 views no total: não acusa. Fica `inconclusive` se algum sinal disparou, `legit` se nenhum.
2. Qualquer sinal forte: `suspicious`. O motivo junta a explicação de cada sinal forte.
3. Só sinais fracos: `inconclusive`. **O classificador prefere não acusar.**
4. Nenhum sinal: `legit`.

### Caso em que o classificador prefere não acusar

Um post com público espalhado em vários fusos (criador com audiência em Portugal, nos EUA e no Brasil) não tem madrugada. `no_day_night_cycle` dispara, mas a variação hora a hora é humana, e não há pico isolado nem queda brusca. O classificador responde `inconclusive`, com a explicação "Sozinho, isso não basta para acusar: pode ser público em vários fusos ou um repost que perdeu força." No dataset, é o cenário `organic_global_audience`, que fica quase todo em `inconclusive` e nunca em `suspicious`. O mesmo vale para volume baixo: um pico de 1200 views num post de 20 views/h é estranho, mas com tão pouco dado não dá para acusar ninguém.

## Dataset sintético e taxa medida

[`src/dataset.ts`](src/dataset.ts) gera séries de 48h a 120h com uma semente fixa (PRNG `mulberry32`). Não depende de rede social real. Os cenários:

- **Legítimos**
  - `organic_normal`: estreia que decai, ciclo dia/noite e ruído de contagem.
  - `organic_viral_ramp`: pico que cresce em algumas horas e decai devagar.
  - `organic_viral_fast`: pico que sobe **numa hora só** (repost grande), com cauda humana.
  - `organic_global_audience`: quase sem ciclo dia/noite.
  - `organic_low_volume`: post com pouca audiência.
- **Suspeitos**
  - `bought_spike`: bloco de 1 a 3h injetado.
  - `bot_flat_injection`: ritmo constante de 24h a 60h.
  - `bought_then_cliff`: entrega comprada que oscila e para de uma vez.

Medido por `npm run evaluate` e conferido pelo teste [`test/readme-metrics.test.ts`](test/readme-metrics.test.ts), que falha se o bloco abaixo divergir do medido:

<!-- metrics:start -->
Semente `20260601`, 1200 séries (750 legítimas, 450 suspeitas).

- **Taxa de falso positivo: 0.00%** (legítimas classificadas como suspeitas)
- Legítimas em que o classificador preferiu não acusar (inconclusive): 31.20%
- Detecção: 99.33% das suspeitas classificadas como suspeitas
- Suspeitas que passaram como legítimas: 0.67%

| cenário | legit | inconclusive | suspicious |
|---|---|---|---|
| `organic_normal` | 147 | 3 | 0 |
| `organic_viral_ramp` | 112 | 38 | 0 |
| `organic_viral_fast` | 104 | 46 | 0 |
| `organic_global_audience` | 4 | 146 | 0 |
| `organic_low_volume` | 149 | 1 | 0 |
| `bought_spike` | 0 | 0 | 150 |
| `bot_flat_injection` | 0 | 0 | 150 |
| `bought_then_cliff` | 3 | 0 | 147 |
<!-- metrics:end -->

**Como ler esse número.** Os limiares de `mechanical_flat` e de `no_day_night_cycle` foram escolhidos olhando a distribuição dos sinais num dataset de **outra semente** (777), não da semente usada acima. Mesmo assim, este é um dataset sintético desenhado por quem escreveu o classificador. Os 0% de falso positivo dizem que **os casos que eu imaginei** não são acusados, não que criador real nunca será. Antes de usar para punir alguém, eu calibraria com séries reais rotuladas e acompanharia a taxa de `inconclusive`. O custo do cuidado também está medido: parte dos posts virais legítimos cai em `inconclusive`, porque o pico distorce o ciclo dia/noite.

## O que ele não detecta

- **Bot que imita humano:** injeção com ciclo dia/noite, ruído e cauda decrescente passa como `legit`. Só a série de views não basta. Seria preciso cruzar com engajamento (curtidas e comentários por view), retenção e origem do tráfego.
- **Compra pequena diluída:** injeção bem menor que a audiência orgânica (por exemplo, +10%) some no ruído.
- **Compra no minuto da estreia:** um pico comprado na primeira hora, com a estreia orgânica decaindo junto, se parece com um lançamento forte. O sinal de pico exige 3h de histórico antes.
- **Pico no fim da série:** sem as 3h seguintes não há cauda para medir, então o pico não é julgado.
- **Dados faltando:** hora sem dado deve ser enviada como ausente, não como 0. Hoje um buraco de coleta de 3h depois de um nível alto parece `abrupt_cliff`. Com mais tempo, a entrada aceitaria `null` e os sinais pulariam a lacuna.
- **Fusos:** o ciclo dia/noite assume público no Brasil (`start_hour_local` em America/Sao_Paulo).

## Uso de IA

<!-- revise e ajuste com as suas palavras antes de enviar -->
O código, o gerador de dataset, os testes e este README foram escritos com o Claude (Claude Code). Eu revisei os sinais e os limiares, os cenários do dataset e o caso em que o classificador não acusa, e rodei `npm test`, `npm run typecheck` e `npm run evaluate`.
