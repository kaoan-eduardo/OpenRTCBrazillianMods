# 🎢 OpenRCT2 QoL Suite

### Uma coleção de plugins para melhorar a experiência de gerenciamento no OpenRCT2

Uma suíte de plugins independentes, desenvolvidos para facilitar a administração de parques no **OpenRCT2**, oferecendo ferramentas de diagnóstico, gerenciamento de funcionários, análise financeira, infraestrutura e monitoramento de visitantes.

O objetivo é reduzir tarefas repetitivas, fornecer informações úteis e melhorar a tomada de decisões, sem eliminar os desafios naturais do jogo.

> **Filosofia do projeto:** automatizar tarefas repetitivas, não a estratégia do jogador.

---

## 📋 Sobre o projeto

O OpenRCT2 oferece diversas ferramentas de gerenciamento, mas algumas informações importantes podem estar espalhadas por diferentes janelas, exigindo análises manuais e repetitivas.

Esta suíte busca centralizar e facilitar essas atividades com plugins especializados.

Cada plugin tem uma responsabilidade específica e pode ser utilizado independentemente dos demais.

### Princípios

- Preservar a dificuldade original dos cenários.
- Evitar funcionalidades que concedam vantagens injustas.
- Fornecer diagnósticos e recomendações compreensíveis.
- Exigir confirmação para mudanças importantes.
- Aproveitar as APIs oficiais do OpenRCT2.
- Manter os plugins independentes e modulares.
- Oferecer interfaces em português brasileiro.
- Priorizar compatibilidade e facilidade de manutenção.

---

# 🧩 Plugins disponíveis

## 1. 🎯 Objective Assistant PT-BR

**Arquivo:** `objective-assistant.js`

### Descrição

Assistente para acompanhamento dos objetivos dos cenários do OpenRCT2.

Permite identificar facilmente o que precisa ser realizado para concluir um cenário e acompanhar o progresso.

### Funcionalidades

- Identificação do objetivo atual.
- Apresentação das condições necessárias para vencer.
- Acompanhamento do progresso.
- Informações sobre visitantes, avaliação e atrações.
- Verificação de objetivos relacionados a montanhas-russas.
- Explicações em português brasileiro.
- Interface compacta.

### Exemplo

    OBJETIVO DO CENÁRIO

    Alcançar 1.500 visitantes.

    Visitantes atuais: 1.120
    Faltam: 380

    Avaliação do parque: 780

    Status: Em andamento

### Filosofia

O plugin ajuda o jogador a compreender os objetivos, mas não modifica as condições de vitória.

---

## 2. 💰 Finance Advisor PT-BR

**Arquivo:** `finance_advisor_custom.js`

### Descrição

Ferramenta de análise financeira voltada principalmente aos preços das atrações.

Seu objetivo é identificar oportunidades de melhoria na receita sem exigir que o jogador ajuste individualmente cada atração.

### Funcionalidades

- Leitura dos preços atuais das atrações.
- Sugestões de preços.
- Comparação entre preço atual e sugerido.
- Estratégias de precificação.
- Visualização organizada das recomendações.
- Aplicação individual de sugestões.
- Aplicação conjunta mediante ação do jogador.

### Estratégias

**Equilibrada**

Busca um equilíbrio entre receita e percepção de valor dos visitantes.

**Bom custo-benefício**

Utiliza preços mais conservadores para favorecer a satisfação dos visitantes.

### Exemplo

| Atração          | Preço atual | Sugerido |
| ---------------- | ----------: | -------: |
| Montanha-russa 1 |       $2,00 |    $3,20 |
| Carrossel        |       $1,00 |    $1,40 |
| Barco Viking     |       $1,50 |    $2,10 |

_Valores meramente ilustrativos._

### Filosofia

Nenhuma alteração financeira é aplicada sem uma ação do jogador.

As sugestões são heurísticas e não garantem o preço economicamente ideal.

---

## 3. 👷 Staff Zone Manager

**Arquivo:** `staff-zone-manager.js`

### Descrição

Gerenciador avançado de funcionários, com análise de caminhos, distribuição de rondas e dimensionamento de equipes.

O plugin trabalha com quatro categorias de funcionários:

- Mecânicos
- Zeladores
- Seguranças
- Animadores

### 🔧 Mecânicos

O gerenciador identifica as saídas das atrações utilizando as informações disponibilizadas pelo OpenRCT2.

A distribuição considera as saídas das estações e a localização dos mecânicos.

Funcionalidades:

- Identificação de saídas de atrações.
- Distribuição de atrações entre mecânicos.
- Criação de áreas de ronda.
- Suporte a atrações com caminhos elevados.
- Tratamento de cenários com mais mecânicos que saídas.
- Contratação manual.
- Limpeza manual de rondas.

O plugin utiliza as saídas conhecidas pelo jogo e deixa o próprio OpenRCT2 responsável pela navegação.

### 🧹 Zeladores

O módulo de zeladores analisa a malha de caminhos do parque.

Funcionalidades:

- Identificação de caminhos normais.
- Inclusão de filas.
- Análise de conectividade.
- Consideração de caminhos elevados e rampas.
- Separação de redes de caminhos.
- Divisão em setores.
- Priorização de regiões movimentadas.
- Contratação manual.
- Geração de rondas sob demanda.

### 👮 Seguranças

- Geração de rondas em áreas movimentadas.
- Distribuição conforme pontos de concentração de visitantes.
- Contratação manual.
- Limpeza e recriação de rondas.

### 🎭 Animadores

- Identificação de regiões com maior circulação.
- Criação de rondas menores.
- Contratação manual.
- Distribuição pelos pontos movimentados.

### 📊 Dimensionamento inteligente

Introduzido experimentalmente na versão 1.9.

A funcionalidade procura responder:

**Quantos mecânicos e zeladores meu parque realmente precisa?**

Em vez de utilizar somente proporções fixas, o sistema estima a carga de trabalho de cada categoria.

#### Mecânicos

São considerados:

- Quantidade de atrações.
- Intervalos de inspeção.
- Confiabilidade das atrações.
- Histórico de reparos.
- Histórico de inspeções.
- Deslocamento observado.
- Margem de capacidade para emergências.

Modelo conceitual:

    Trabalho = inspeções + reparos + deslocamentos

    Mecânicos necessários =
        teto(trabalho / capacidade útil por mecânico)

Capacidade útil inicial:

    75% do tempo disponível

#### Zeladores

São considerados:

- Quantidade de caminhos.
- Visitantes no parque.
- Lixo acumulado.
- Limpezas realizadas.
- Lixeiras esvaziadas.
- Distância percorrida.
- Distribuição dos setores.

Modelo conceitual:

    Trabalho = limpeza + lixeiras + deslocamentos

    Zeladores necessários =
        teto(trabalho / capacidade útil por zelador)

Capacidade útil inicial:

    80% do tempo disponível

Os tempos de trabalho são estimativas ajustáveis, não constantes oficiais do OpenRCT2.

### Histórico de produtividade

O plugin também observa determinados indicadores durante a partida.

Exemplos:

- Inspeções concluídas.
- Reparos realizados.
- Lixo recolhido.
- Lixeiras esvaziadas.
- Deslocamento observado.
- Tempo de observação acumulado.

A versão 1.9 possui caráter experimental e requer validação em diferentes parques.

### 🔨 Reparo de vandalismo

Funcionalidade opcional que permite que funcionários selecionados reparem determinados objetos vandalizados quando passam por eles.

O recurso é inspirado no projeto **Fix Vandalism With Staff**, de Wessel Ammerlaan.

### Filosofia

O plugin não deve contratar funcionários nem gerar rondas automaticamente.

O dimensionamento fornece recomendações, mas a decisão permanece com o jogador.

---

## 4. 🚶 Guest Flow Manager

**Arquivo:** `openrct2-guest-flow-manager.js`

### Descrição

Plugin voltado à análise de circulação de visitantes dentro do parque.

Ajuda a identificar problemas de movimentação e regiões com dificuldade de acesso.

### Funcionalidades

- Análise do fluxo de visitantes.
- Identificação de áreas problemáticas.
- Investigação de visitantes perdidos.
- Apoio à identificação de congestionamentos.
- Ferramentas para melhorar a circulação no parque.

### Exemplos de problemas

- Caminhos excessivamente longos.
- Visitantes presos em regiões isoladas.
- Dificuldade para encontrar a saída.
- Congestionamentos.
- Regiões com circulação mal distribuída.

### Filosofia

O módulo é responsável pela circulação dos visitantes e deve permanecer independente das rotinas de funcionários e das análises financeiras.

As ações disponíveis podem variar conforme a versão do script.

---

## 5. 📈 Diagnóstico do Parque

**Arquivo:** `openrct2-diagnostico-parque.js`

### Descrição

Ferramenta de diagnóstico geral do parque.

Seu objetivo é ajudar o jogador a compreender problemas que afetam a avaliação, a satisfação dos visitantes e o funcionamento das atrações.

### Funcionalidades

#### Avaliação do parque

Apresenta componentes que influenciam a avaliação:

- Felicidade dos visitantes.
- Visitantes perdidos tentando sair.
- Disponibilidade das atrações.
- Emoção e intensidade.
- Quantidade e qualidade das atrações.
- Lixo acumulado.
- Penalidades por acidentes.

#### Reclamações

Analisa pensamentos recentes dos visitantes.

Exemplos:

- Parque muito cheio.
- Fome.
- Sede.
- Falta de banheiros.
- Sujeira.
- Filas longas.
- Dificuldade de orientação.
- Preços considerados elevados.

#### Mapa de problemas

Agrupa visitantes por regiões e permite localizar áreas com:

- Reclamações de lotação.
- Visitantes perdidos.
- Visitantes perdidos tentando sair.

A ferramenta permite centralizar a câmera na região selecionada.

#### Atrações

Identifica atrações que podem precisar de atenção devido a:

- Quebras.
- Indisponibilidade.
- Downtime.
- Confiabilidade baixa.
- Popularidade e satisfação reduzidas.

#### Prêmios

Apresenta sinais e estimativas relacionados aos prêmios do parque.

As condições exibidas são heurísticas e não necessariamente reproduzem todas as regras internas de concessão de prêmios do jogo.

### Exemplo de utilização

Imagine um parque com avaliação de apenas 200 pontos.

O diagnóstico pode indicar uma combinação de:

- Visitantes insatisfeitos.
- Congestionamentos.
- Pessoas perdidas.
- Acúmulo de lixo.

Com a localização dos problemas, fica mais fácil encontrar a causa em vez de tentar melhorias aleatórias.

### Filosofia

Este é um plugin de **somente leitura**.

Não altera:

- Preços.
- Funcionários.
- Visitantes.
- Atrações.
- Condições do cenário.

---

## 6. 🪑 Infraestrutura de Caminhos

**Arquivo:** `infra.js`

### Descrição

Ferramenta de planejamento e instalação de infraestrutura em caminhos.

Seu objetivo é reduzir o trabalho repetitivo de distribuir objetos pelo parque.

### Funcionalidades

- Identificação de caminhos.
- Planejamento de instalação de bancos.
- Planejamento de instalação de lixeiras.
- Instalação de televisões em filas, quando disponíveis.
- Configuração de espaçamento.
- Alternância entre bancos e lixeiras.
- Estimativa de custos.
- Preservação de objetos existentes.
- Construção mediante confirmação.

### Fluxo de utilização

    1. Analisar caminhos

    2. Selecionar objetos

    3. Configurar espaçamento

    4. Visualizar planejamento

    5. Conferir custos

    6. Confirmar construção

### Filosofia

O plugin automatiza uma tarefa repetitiva de construção, mas mantém o custo dos objetos e exige uma decisão explícita do jogador.

---

# 🏗️ Organização do repositório

Estrutura sugerida:

    openrct2-qol-suite/
    │
    ├── README.md
    ├── LICENSE
    ├── CHANGELOG.md
    ├── .gitignore
    │
    ├── plugins/
    │   ├── objective-assistant.js
    │   ├── finance_advisor_custom.js
    │   ├── staff-zone-manager.js
    │   ├── openrct2-guest-flow-manager.js
    │   ├── openrct2-diagnostico-parque.js
    │   └── infra.js
    │
    ├── docs/
    │   ├── objective-assistant.md
    │   ├── finance-advisor.md
    │   ├── staff-zone-manager.md
    │   ├── guest-flow-manager.md
    │   ├── park-diagnostics.md
    │   └── path-infrastructure.md
    │
    └── screenshots/
        └── .gitkeep

Os nomes acima são uma proposta de padronização. Ao publicar, atualize a documentação conforme os nomes reais dos arquivos.

---

# 📦 Instalação

## Requisitos

- OpenRCT2 com suporte a plugins JavaScript.
- Versão compatível com a API exigida por cada plugin.
- Para o Staff Zone Manager 1.9, API de scripting 117 ou superior.

Outros plugins podem possuir requisitos diferentes.

## Passo a passo

1. Abra o OpenRCT2.
2. No menu principal, utilize **Open custom content folder** para localizar a pasta de conteúdo personalizado.
3. Abra a pasta `plugin`.
4. Copie os arquivos `.js` desejados.
5. Reinicie o OpenRCT2.
6. Procure os plugins no menu de plugins do jogo.

No Windows, a pasta costuma estar em:

    Documentos/OpenRCT2/plugin/

Em outros sistemas, utilize a opção do próprio jogo para localizar a pasta correta.

### Atenção

Evite manter duas versões do mesmo plugin instaladas simultaneamente.

Arquivos duplicados podem provocar:

- Entradas repetidas no menu.
- Execução duplicada de eventos.
- Conflitos entre versões.
- Comportamentos inesperados.

---

# 🔗 Como os plugins se complementam

Os plugins são independentes, mas podem ser utilizados em conjunto.

| Plugin                     | Responsabilidade                      |
| -------------------------- | ------------------------------------- |
| Objective Assistant        | Objetivos e progresso do cenário      |
| Finance Advisor            | Recomendações financeiras             |
| Staff Zone Manager         | Funcionários e rondas                 |
| Guest Flow Manager         | Circulação dos visitantes             |
| Diagnóstico do Parque      | Identificação de problemas            |
| Infraestrutura de Caminhos | Bancos, lixeiras e objetos de caminho |

### Exemplo de fluxo

**Situação:** a avaliação do parque começa a cair.

1. O **Diagnóstico do Parque** identifica aumento das reclamações de lotação.
2. O **Guest Flow Manager** ajuda a investigar a circulação.
3. A **Infraestrutura de Caminhos** auxilia no planejamento de objetos úteis.
4. O **Staff Zone Manager** verifica a cobertura dos zeladores e mecânicos.
5. O **Finance Advisor** ajuda a revisar preços caso existam reclamações financeiras.
6. O **Objective Assistant** acompanha o impacto dessas melhorias nos objetivos do cenário.

Cada ferramenta possui uma responsabilidade específica, evitando a concentração de todas as funcionalidades em um único plugin.

---

# 🛠️ Tecnologias

- JavaScript
- OpenRCT2 Scripting API
- PathNavigator
- APIs de entidades e atrações do OpenRCT2
- Interfaces nativas de plugins
- Git / GitHub

Documentação oficial:

https://github.com/OpenRCT2/OpenRCT2

---

# 📌 Estado dos plugins

| Plugin                     | Versão de referência | Estado       |
| -------------------------- | -------------------- | ------------ |
| Objective Assistant        | 2.1                  | Em testes    |
| Finance Advisor            | 2.x                  | Em testes    |
| Staff Zone Manager         | 1.9                  | Experimental |
| Guest Flow Manager         | Versão local         | Em testes    |
| Diagnóstico do Parque      | 2.1                  | Em testes    |
| Infraestrutura de Caminhos | 1.1                  | Em testes    |

As versões devem ser conferidas nos arquivos antes de publicar uma release oficial.

O desenvolvimento é incremental, com validação das funcionalidades durante partidas reais.

---

# ⚠️ Limitações conhecidas

- Alguns algoritmos utilizam estimativas e heurísticas.
- As recomendações não são garantias de desempenho.
- O dimensionamento de funcionários depende da qualidade das observações.
- Caminhos elevados e sobrepostos exigem atenção especial.
- Diferentes cenários podem apresentar comportamentos inesperados.
- A compatibilidade com multiplayer ainda precisa de validação.
- Plugins que modificam o parque devem ser utilizados preferencialmente após salvar a partida.
- Não há garantia de compatibilidade entre todas as versões do OpenRCT2.

---

# 🙏 Créditos e agradecimentos

Este projeto foi desenvolvido com base em estudos da API do OpenRCT2, experimentação prática e referências a plugins criados pela comunidade.

Agradecemos aos desenvolvedores do OpenRCT2 e aos autores que compartilham suas ferramentas e conhecimentos.

## Projetos de referência

### Wessel Ammerlaan

**Fix Vandalism With Staff**

Projeto que permite que funcionários selecionados reparem objetos vandalizados durante suas rondas.

https://github.com/WesselAmmerlaan/OpenRCT2-FixVandalismWithStaff

Licença identificada no repositório: MIT.

### StixsmasterHD4k

**Advanced Staff AI Manager**

Projeto voltado ao gerenciamento avançado de funcionários, distribuição de áreas e automação da equipe.

https://github.com/StixsmasterHD4k/advanced-staff-ai-manager

### JohannesHolzhaeuer

**OpenRCT2 Staff Manager**

Projeto de gerenciamento de funcionários que utiliza informações de caminhos, filas e saídas de atrações.

https://www.openrct2plugins.org/plugin/R_kgDOT67Vvw/openrct2-staff-manager

Licença indicada no diretório de plugins: MIT.

### Comunidade OpenRCT2

Pelo desenvolvimento do jogo, da API de scripting e das ferramentas que tornam possíveis plugins como estes.

https://github.com/OpenRCT2/OpenRCT2

## Desenvolvimento desta suíte

**Kaoan**

- Idealização e direção do projeto.
- Definição de requisitos.
- Testes durante partidas reais.
- Identificação e reprodução de bugs.
- Validação das soluções.
- Evolução das funcionalidades.

**OpenAI / ChatGPT**

- Assistência no desenvolvimento.
- Estruturação dos algoritmos.
- Apoio à depuração.
- Documentação técnica.
- Propostas de melhoria.

Os créditos aos projetos de referência não significam que seus autores participaram diretamente do desenvolvimento desta suíte.

Os direitos autorais e licenças dos respectivos projetos permanecem com seus titulares.

---

# 📜 Licenciamento

Antes da distribuição pública, é necessário conferir a procedência de todos os trechos reutilizados e preservar os avisos de copyright e os termos de licença exigidos pelos projetos originais.

A intenção é disponibilizar os componentes próprios da suíte sob uma licença permissiva, preferencialmente MIT, após essa revisão.

**Não considere a licença MIT automaticamente aplicável a todos os scripts ou a todo código incorporado de terceiros.**

---

# 🤝 Contribuições

Contribuições são bem-vindas.

Você pode colaborar com:

- Relatórios de bugs.
- Melhorias de desempenho.
- Novas funcionalidades.
- Testes de compatibilidade.
- Traduções.
- Sugestões de interface.
- Correções na documentação.

Ao relatar um problema, procure informar:

1. Versão do OpenRCT2.
2. Plugin e versão utilizada.
3. Comportamento esperado.
4. Comportamento observado.
5. Etapas para reproduzir o problema.

Capturas de tela e logs também são úteis.

---

# 🚀 Próximos passos

- Aprimorar o dimensionamento de funcionários.
- Calibrar estimativas com dados de partidas reais.
- Melhorar a identificação de congestionamentos.
- Detectar visitantes presos em regiões do mapa.
- Aprimorar a análise de cobertura das rondas.
- Criar testes automatizados para algoritmos principais.
- Melhorar a apresentação de informações.
- Expandir a documentação individual de cada plugin.

---

# ❤️ Agradecimentos

Este projeto nasceu da ideia de tornar o OpenRCT2 mais confortável de jogar, sem retirar aquilo que torna o jogo interessante: administrar um parque, descobrir problemas e tomar decisões.

Agradecimentos à comunidade OpenRCT2, aos desenvolvedores dos plugins de referência e a todos que contribuírem para a evolução desta suíte.

**Feito por fãs, para fãs de OpenRCT2.**
