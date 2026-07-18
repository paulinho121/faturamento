# Deploy no Vercel

## O que já está pronto no código

- `vercel.json` — configura o build (`npm run build`, saída em `dist`) e faz *rewrite* de
  todas as rotas para `index.html`, necessário porque o app usa React Router (client-side
  routing): sem isso, dar F5 em `/dashboard` ou `/operacoes` direto no Vercel dá 404.
- `.gitignore` já exclui `node_modules`, `dist` e `.env` — suas chaves do Supabase não vão
  parar no GitHub.
- Bundle de produção dividido em chunks (`router`, `supabase`, `charts`) para carregar mais rápido.

## Passos que só você pode fazer

### 1. Subir o código pro GitHub
Depois de criar o repositório, na pasta do projeto:
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <url-do-seu-repo>
git push -u origin main
```
(Me avisa quando o repo existir que eu ajudo a rodar isso, se quiser.)

### 2. Importar o projeto no Vercel
[vercel.com](https://vercel.com) → **Add New** → **Project** → selecione o repositório no
GitHub → o Vercel detecta Vite automaticamente (build command e output directory já vêm do
`vercel.json`).

### 3. Configurar as variáveis de ambiente
**Antes de clicar em Deploy**, em **Environment Variables**, adicione (mesmos valores do seu
`.env` local, projeto **DUIMP**):
```
VITE_SUPABASE_URL=https://sjimfrvggujbarxedplu.supabase.co
VITE_SUPABASE_ANON_KEY=<sua anon key>
```
Sem isso o app builda mas não consegue logar em produção.

### 4. Deploy
Clique em **Deploy**. Ao terminar, o Vercel te dá uma URL tipo `https://seu-projeto.vercel.app`.

### 5. Atualizar o Supabase com a URL de produção (importante!)
No projeto **DUIMP** → **Authentication** → **URL Configuration**:
- **Site URL**: troque para `https://seu-projeto.vercel.app/definir-senha`
- **Redirect URLs**: adicione `https://seu-projeto.vercel.app/**` (pode manter também o
  `http://localhost:5173/**` para continuar testando local)

Sem isso, os links de convite/"esqueci minha senha" enviados por e-mail continuam apontando
para `localhost` mesmo em produção.

## Depois do primeiro deploy

Todo novo `git push` na branch `main` gera um deploy automático novo no Vercel — não precisa
repetir os passos 2–3, só o 5 se a URL de produção mudar (ex: ao configurar um domínio próprio).
