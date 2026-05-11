# 📚 Ciclo de Estudos

App de acompanhamento de estudos para concursos com **Pomodoro**, **simulados**, **metas**, **ciclo personalizado** e **revisão espaçada**.

## ✨ Funcionalidades

- **Pomodoro** com timer preciso (não trava ao trocar de aba), bip sonoro ao finalizar, blocos de foco + pausas curtas/longas configuráveis
- **Simulados gerais** com gráfico de evolução ao longo do tempo
- **Simulados por matéria** com registro de meta e gráfico comparativo meta × desempenho
- **Ciclo de estudos** personalizável via drag & drop, com recomendação automática de ordem por prioridade
- **Revisões espaçadas** com 3 níveis (1ª revisão, 2ª revisão, revisão profunda) baseados no último estudo
- **Configurações completas**: matérias (adicionar/editar/remover/reordenar), porcentagens, horas diárias, dias de estudo
- **Persistência total**: todos os dados ficam salvos no `localStorage` entre sessões
- **PWA**: pode ser instalado como app no celular/desktop

## 🚀 Como usar

### 1. Rodando localmente

Basta abrir o `index.html` em qualquer navegador moderno. Não precisa de servidor.

> Para testar o Service Worker (cache offline), use um servidor local:
> ```bash
> # Python
> python3 -m http.server 8080
> # ou Node.js
> npx serve .
> ```
> Depois acesse `http://localhost:8080`

### 2. Deploy no GitHub Pages (recomendado)

**Passo a passo:**

1. Crie um repositório no GitHub (ex: `ciclo-estudos`)
2. Faça upload de todos os arquivos desta pasta para a branch `main`
3. Vá em **Settings → Pages → Source → Branch: main / root**
4. Salve — em alguns minutos o site estará em:
   `https://SEU_USUARIO.github.io/ciclo-estudos/`

**Via linha de comando:**
```bash
cd ciclo-estudos
git init
git add .
git commit -m "feat: ciclo de estudos app v1"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/ciclo-estudos.git
git push -u origin main
```

### 3. Instalar como app (PWA)

- **Android**: abra no Chrome → menu ⋮ → "Adicionar à tela inicial"
- **iOS**: abra no Safari → compartilhar → "Adicionar à Tela de Início"
- **Desktop (Chrome/Edge)**: clique no ícone de instalar na barra de endereços

## 📁 Estrutura de arquivos

```
ciclo-estudos/
├── index.html      # Estrutura HTML do app
├── style.css       # Design completo (tema escuro)
├── app.js          # Toda a lógica (timer, dados, gráficos)
├── manifest.json   # Configuração PWA
├── sw.js           # Service Worker (cache offline)
├── gen_icons.py    # Script para regenerar ícones (opcional)
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── README.md
```

## 🔧 Personalizações

Os dados das matérias podem ser editados diretamente na aba **Config** do app. Para alterar as matérias padrão no código, edite o array `DEFAULT_STATE.subjects` em `app.js`.

## 💾 Dados

Todos os dados são salvos automaticamente no `localStorage` do navegador. Para apagar tudo, use o botão **"Apagar todos os dados"** na aba Config.

> **Atenção**: limpar o cache do navegador ou usar modo incógnito apaga os dados.

## 🛠️ Tecnologias

- HTML5 + CSS3 + JavaScript puro (sem framework)
- [Chart.js 4.4](https://www.chartjs.org/) para gráficos
- [Tabler Icons](https://tabler-icons.io/) para ícones
- [DM Sans + Space Mono](https://fonts.google.com/) para tipografia
- Web Audio API para bip sonoro
- Service Worker para funcionamento offline
