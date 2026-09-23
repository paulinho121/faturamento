-- ============================================================
-- Bianca (via pode_orientar_pedidos) precisa poder excluir de vez um pedido
-- que foi solicitado por engano (ex.: teste, duplicado). Nunca um já
-- faturado — esse já virou nota fiscal de verdade, não se apaga.
-- ============================================================

create policy "orientador_delete_pedidos" on pedidos for delete
  using (current_user_pode_orientar() and status <> 'faturado');
