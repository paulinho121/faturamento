# Setup do Supabase

Passos que só você pode fazer (exigem sua conta):

1. Crie um projeto em [supabase.com](https://supabase.com) (plano gratuito serve para começar).
2. No painel do projeto, abra **SQL Editor** → cole o conteúdo de `supabase/migrations/0001_init.sql` → Run.
3. Ainda no SQL Editor, rode `supabase/seed.sql` para popular vendedores, filiais e listas de apoio.
4. Vá em **Authentication → Users** → crie 2 usuários (ex: `faturista@empresa.com` e `diretor@empresa.com`) com senha.
5. Volte ao SQL Editor e vincule o papel de cada um (troque os e-mails/UUIDs pelos que você criou):
   ```sql
   insert into profiles (id, full_name, role)
   select id, 'Nome do Faturista', 'faturista' from auth.users where email = 'faturista@empresa.com';

   insert into profiles (id, full_name, role)
   select id, 'Nome do Diretor', 'diretor' from auth.users where email = 'diretor@empresa.com';
   ```
6. Em **Project Settings → API**, copie a **Project URL** e a **anon public key**.
7. No projeto local, copie `.env.example` para `.env` e cole os dois valores:
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```
8. Em **Database → Replication**, habilite Realtime para a tabela `invoices` (necessário para o feed ao vivo do dashboard).
9. Rode `npm install` e depois `npm run dev`.

Sem os passos acima, o app abre normalmente mas mostra um aviso de "Supabase não configurado" e não consegue logar.
