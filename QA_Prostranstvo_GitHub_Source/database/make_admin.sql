-- Выполнить в Supabase SQL Editor только после входа в QA-сайт под своей почтой.
-- Замените текст ВАШ_EMAIL@example.com на точный email вашей учётной записи.
insert into qa_private.admins (user_id)
select id from auth.users
where lower(email) = lower('ВАШ_EMAIL@example.com')
  and email_confirmed_at is not null
on conflict (user_id) do nothing;

-- Проверка, что строка действительно создана:
select u.email, a.granted_at
from qa_private.admins a
join auth.users u on u.id=a.user_id;
