-- Migration 003: grant_credits RPC for monthly / purchase top-ups
-- Mirrors spend_credits but ADDS instead of subtracts, and never lowers an
-- unlimited (-1) wallet. Atomic row-lock prevents race conditions.

create or replace function public.grant_credits(
  p_user_id uuid,
  p_amount integer,
  p_type text,
  p_description text
) returns integer as $$
declare
  v_balance integer;
begin
  -- Ensure a wallet row exists
  insert into public.credits (user_id, balance)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  -- Lock the row and read current balance
  select balance into v_balance
  from public.credits
  where user_id = p_user_id
  for update;

  if v_balance is null then
    raise exception 'No credits record for user';
  end if;

  -- Unlimited wallet stays -1; just log the grant
  if v_balance = -1 then
    insert into public.credit_transactions (user_id, amount, type, description)
    values (p_user_id, 0, p_type, p_description);
    return -1;
  end if;

  -- Add
  update public.credits
  set balance = balance + p_amount, updated_at = now()
  where user_id = p_user_id;

  -- Log transaction
  insert into public.credit_transactions (user_id, amount, type, description)
  values (p_user_id, p_amount, p_type, p_description);

  return v_balance + p_amount;
end;
$$ language plpgsql security definer;
