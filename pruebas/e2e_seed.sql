-- Datos para la prueba end-to-end: 2 prestadores (uno multirrubro), activos y con Mercado Pago conectado.
insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values
 ('11111111-1111-1111-1111-111111111111','sofia@test.ar','prestador123','{"full_name":"Sofía"}'),
 ('22222222-2222-2222-2222-222222222222','max@test.ar','prestador123','{"full_name":"Max"}');
do $$
declare pid bigint;
begin
  perform set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',true);
  pid := public.register_provider('Sofía Benítez Studio','Belgrano 1200',array['l','u','d'],'2284 111222','30111222','sofi.studio');
  insert into public.services (provider_id, category_id, name, duration_min, price) values
   (pid,'l','Lifting de pestañas',60,15000),(pid,'u','Esmaltado semipermanente',60,12000),(pid,'d','Depilación de cejas',20,4500);
  perform set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',true);
  pid := public.register_provider('Barbería Max','Rivadavia 100',array['b'],'2284 333444','28111222');
  insert into public.services (provider_id, category_id, name, duration_min, price) values (pid,'b','Corte',30,10000);
  perform set_config('request.jwt.claims','',true);
end $$;
update public.providers set status='active', dni_verified=true;
update public.provider_settings set online=true, notice_min=0;
update public.provider_settings set buffer_min=10 where provider_id=(select id from public.providers where name like 'Sofía%');
update public.services set repeat_days=21, prep_note='Venir sin esmalte' where name='Esmaltado semipermanente';
insert into public.service_addons (service_id, name, price, duration_min) select id, 'Nail art', 2000, 15 from public.services where name='Esmaltado semipermanente';
-- cuenta de Mercado Pago activa (Bloque 1: mp_accounts; mp_connected lo actualiza la base)
select public.mp_connect(id, 'mp-test-' || id, 'v1:aXY=:VEVTVC10b2tlbg==', null, 15552000) from public.providers;   -- llave con el formato cifrado (el e2e no la usa)
