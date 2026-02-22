# Património Familiar (PWA offline-first)

## Deploy (GitHub Pages)
1. Cria um repositório no GitHub (ex: `patrimonio-familiar`).
2. Faz upload de **todos** estes ficheiros (mantendo as pastas).
3. Em *Settings → Pages*:
   - Source: `Deploy from a branch`
   - Branch: `main` / `/ (root)`
4. Abre o URL do GitHub Pages.

## Importação (Excel/CSV)
- Usa a aba **Importar**.
- Para teres um ficheiro “perfeito”, descarrega o **Template CSV** e preenche.

## Privacidade
- Sem login e sem backend. Dados ficam no browser (localStorage).
- Para sincronizar: exporta JSON num dispositivo e importa no outro.

## Notas técnicas
- Chart.js e SheetJS via CDN.
- Service worker faz cache do “app shell” (offline).
