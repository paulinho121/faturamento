-- ============================================================
-- O banco manda periodicamente uma lista de títulos em aberto (.txt) com o
-- "Nosso Número" dele ao lado do "Seu Número" (que bate com numero_titulo).
-- Guardar essa correspondência aqui permite que o retorno CNAB 400 (.RET,
-- que só traz o Nosso Número) case sozinho com o título certo depois.
-- ============================================================

alter table boletos add column if not exists nosso_numero text;

create index if not exists boletos_nosso_numero_idx on boletos (nosso_numero) where nosso_numero is not null;
