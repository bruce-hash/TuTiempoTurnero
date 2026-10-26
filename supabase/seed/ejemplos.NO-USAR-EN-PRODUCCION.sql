-- =====================================================================
-- TuTiempo · DATOS DE EJEMPLO (opcional)
-- Carga los 13 prestadores de ejemplo de los 6 rubros, con servicios,
-- indicaciones, horarios, reseñas y tarjetas de sellos (una por servicio), para ver la app llena desde el primer día.
-- No tienen dueño (nadie puede entrar a su panel) y se reservan como cualquier otro.
-- Todos ficticios (H14): ningún nombre, dirección, teléfono ni Instagram es de un negocio real. Los teléfonos empiezan
-- con 0 después de la característica (no existen).
-- Solo para una base local de pruebas: NUNCA en producción ni en el entorno de prueba (docs/02).
-- Para correrlo hay que avisar antes, en la misma sesión:   set tt.ejemplos = 'si';
-- Sin eso, el script no carga nada y da error.
-- Para borrarlos:  delete from public.providers where slug like 'ej-%';
-- Correr DESPUÉS de TODO_EN_UNO.sql.
-- =====================================================================
do $$
declare cid smallint := (select id from public.cities where slug = 'olavarria'); pid bigint; sid bigint; d int;
begin
  if coalesce(current_setting('tt.ejemplos', true), '') <> 'si' then
    raise exception 'ejemplos_no_autorizados: datos de ejemplo solo para una base local de pruebas. Si es eso, corré antes: set tt.ejemplos = ''si'';';
  end if;
  insert into public.providers (slug, name, address, city_id, instagram, hue, status, dni_verified)
    values ('ej-filo-barber-club', 'Filo Barber Club', 'Alsina 2100', cid, 'filo.barber.demo', 221, 'active', true)
    on conflict (slug) do nothing returning id into pid;
  if pid is not null then
    insert into public.provider_private (provider_id, phone) values (pid, '2284 000123');
    insert into public.provider_settings (provider_id, online, notice_min, buffer_min, happy_on, happy_pct, happy_days, happy_from, happy_to)
      values (pid, true, 60, 0, true, 20, '{1,2,3,4}', '09:00', '12:00');
    for d in 1 .. 5 loop insert into public.provider_hours values (pid, d, 1, '09:00', '12:00'), (pid, d, 2, '15:00', '21:00'); end loop;
    insert into public.provider_hours values (pid, 6, 1, '09:00', '13:00');
    insert into public.provider_categories (provider_id, category_id) values (pid, 'b') on conflict do nothing;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'b', 'Corte de cabello y barba', 30, 12500, 0, 0, null) returning id into sid;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'b', 'Corte de cabello', 25, 10000, 1, 0, null) returning id into sid;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'b', 'Arreglo de barba', 15, 6000, 2, 0, null) returning id into sid;
    update public.provider_settings set stamps_on = true where provider_id = pid;
    update public.services set stamp_goal = 15 where provider_id = pid;  -- una tarjeta por servicio
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Martín G.', 5, 'Puntual y prolijo. Me consiguió turno el sábado y me salvó el casamiento.');
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Lucía R.', 5, 'Le cortó a mi papá con mucha paciencia. Excelente trato.');
  end if;
  insert into public.providers (slug, name, address, city_id, instagram, hue, status, dni_verified)
    values ('ej-tomas-herrera-barbero', 'Tomás Herrera barbero', 'Lavalle 3100', cid, null, 262, 'active', true)
    on conflict (slug) do nothing returning id into pid;
  if pid is not null then
    insert into public.provider_private (provider_id, phone) values (pid, null);
    insert into public.provider_settings (provider_id, online, notice_min, buffer_min, happy_on, happy_pct, happy_days, happy_from, happy_to)
      values (pid, true, 60, 0, false, 20, '{1,2,3,4}', '09:00', '12:00');
    for d in 1 .. 5 loop insert into public.provider_hours values (pid, d, 1, '09:00', '12:00'), (pid, d, 2, '15:00', '21:00'); end loop;
    insert into public.provider_hours values (pid, 6, 1, '09:00', '13:00');
    insert into public.provider_categories (provider_id, category_id) values (pid, 'b') on conflict do nothing;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'b', 'Corte de cabello', 25, 12000, 0, 0, null) returning id into sid;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'b', 'Corte y barba', 35, 15000, 1, 0, null) returning id into sid;
    update public.provider_settings set stamps_on = true where provider_id = pid;
    update public.services set stamp_goal = 15 where provider_id = pid;  -- una tarjeta por servicio
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Martín G.', 5, 'Impecable el fade y súper puntual.');
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Leandro S.', 4, 'Muy buen corte, el lugar es cómodo.');
  end if;
  insert into public.providers (slug, name, address, city_id, instagram, hue, status, dni_verified)
    values ('ej-barberia-el-molino', 'Barbería El Molino', 'Moreno 2400', cid, null, 12, 'active', true)
    on conflict (slug) do nothing returning id into pid;
  if pid is not null then
    insert into public.provider_private (provider_id, phone) values (pid, null);
    insert into public.provider_settings (provider_id, online, notice_min, buffer_min, happy_on, happy_pct, happy_days, happy_from, happy_to)
      values (pid, true, 60, 0, false, 20, '{1,2,3,4}', '09:00', '12:00');
    for d in 1 .. 5 loop insert into public.provider_hours values (pid, d, 1, '09:00', '12:00'), (pid, d, 2, '15:00', '21:00'); end loop;
    insert into public.provider_hours values (pid, 6, 1, '09:00', '13:00');
    insert into public.provider_categories (provider_id, category_id) values (pid, 'b') on conflict do nothing;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'b', 'Corte premium', 40, 22000, 0, 0, null) returning id into sid;
    update public.provider_settings set stamps_on = true where provider_id = pid;
    update public.services set stamp_goal = 15 where provider_id = pid;  -- una tarjeta por servicio
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Martín G.', 5, 'Impecable el fade y súper puntual.');
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Leandro S.', 4, 'Muy buen corte, el lugar es cómodo.');
  end if;
  insert into public.providers (slug, name, address, city_id, instagram, hue, status, dni_verified)
    values ('ej-nacho-barber', 'Nacho barber', 'Sarmiento 3200', cid, null, 168, 'active', true)
    on conflict (slug) do nothing returning id into pid;
  if pid is not null then
    insert into public.provider_private (provider_id, phone) values (pid, null);
    insert into public.provider_settings (provider_id, online, notice_min, buffer_min, happy_on, happy_pct, happy_days, happy_from, happy_to)
      values (pid, true, 60, 0, false, 20, '{1,2,3,4}', '09:00', '12:00');
    for d in 1 .. 5 loop insert into public.provider_hours values (pid, d, 1, '09:00', '12:00'), (pid, d, 2, '15:00', '21:00'); end loop;
    insert into public.provider_hours values (pid, 6, 1, '09:00', '13:00');
    insert into public.provider_categories (provider_id, category_id) values (pid, 'b') on conflict do nothing;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'b', 'Corte de cabello', 25, 12500, 0, 0, null) returning id into sid;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'b', 'Corte + perfilado de barba', 35, 15500, 1, 0, null) returning id into sid;
    update public.provider_settings set stamps_on = true where provider_id = pid;
    update public.services set stamp_goal = 15 where provider_id = pid;  -- una tarjeta por servicio
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Martín G.', 5, 'Impecable el fade y súper puntual.');
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Leandro S.', 4, 'Muy buen corte, el lugar es cómodo.');
  end if;
  insert into public.providers (slug, name, address, city_id, instagram, hue, status, dni_verified)
    values ('ej-marta-ruiz-peluqueria', 'Marta Ruiz peluquería', 'Av. Pringles 3800', cid, null, 330, 'active', true)
    on conflict (slug) do nothing returning id into pid;
  if pid is not null then
    insert into public.provider_private (provider_id, phone) values (pid, null);
    insert into public.provider_settings (provider_id, online, notice_min, buffer_min, happy_on, happy_pct, happy_days, happy_from, happy_to)
      values (pid, true, 60, 10, false, 20, '{1,2,3,4}', '09:00', '12:00');
    for d in 1 .. 5 loop insert into public.provider_hours values (pid, d, 1, '09:00', '12:00'), (pid, d, 2, '15:00', '21:00'); end loop;
    insert into public.provider_hours values (pid, 6, 1, '09:00', '13:00');
    insert into public.provider_categories (provider_id, category_id) values (pid, 'p') on conflict do nothing;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'p', 'Color y corte', 120, 62500, 0, 0, 'Si es color, vení con el pelo sin lavar de 24 h.') returning id into sid;
    update public.provider_settings set stamps_on = true where provider_id = pid;
    update public.services set stamp_goal = 15 where provider_id = pid;  -- una tarjeta por servicio
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Florencia A.', 5, 'Me hizo el balayage que quería, divino.');
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Silvia P.', 5, 'Atención de diez, el color quedó parejo.');
  end if;
  insert into public.providers (slug, name, address, city_id, instagram, hue, status, dni_verified)
    values ('ej-valeria-sosa-estilista', 'Valeria Sosa estilista', 'Rufino Fal 2600', cid, null, 38, 'active', true)
    on conflict (slug) do nothing returning id into pid;
  if pid is not null then
    insert into public.provider_private (provider_id, phone) values (pid, null);
    insert into public.provider_settings (provider_id, online, notice_min, buffer_min, happy_on, happy_pct, happy_days, happy_from, happy_to)
      values (pid, true, 60, 10, false, 20, '{1,2,3,4}', '09:00', '12:00');
    for d in 1 .. 5 loop insert into public.provider_hours values (pid, d, 1, '09:00', '12:00'), (pid, d, 2, '15:00', '21:00'); end loop;
    insert into public.provider_hours values (pid, 6, 1, '09:00', '13:00');
    insert into public.provider_categories (provider_id, category_id) values (pid, 'p') on conflict do nothing;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'p', 'Color y corte', 120, 50000, 0, 0, 'Si es color, vení con el pelo sin lavar de 24 h.') returning id into sid;
    update public.provider_settings set stamps_on = true where provider_id = pid;
    update public.services set stamp_goal = 15 where provider_id = pid;  -- una tarjeta por servicio
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Florencia A.', 5, 'Me hizo el balayage que quería, divino.');
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Silvia P.', 5, 'Atención de diez, el color quedó parejo.');
  end if;
  insert into public.providers (slug, name, address, city_id, instagram, hue, status, dni_verified)
    values ('ej-sofia-benitez-studio', 'Sofía Benítez Studio', 'Belgrano 1200', cid, 'sofi.studio.demo', 280, 'active', true)
    on conflict (slug) do nothing returning id into pid;
  if pid is not null then
    insert into public.provider_private (provider_id, phone) values (pid, '2284 000456');
    insert into public.provider_settings (provider_id, online, notice_min, buffer_min, happy_on, happy_pct, happy_days, happy_from, happy_to)
      values (pid, true, 60, 10, true, 15, '{2,3}', '09:00', '12:00');
    for d in 1 .. 5 loop insert into public.provider_hours values (pid, d, 1, '09:00', '12:00'), (pid, d, 2, '15:00', '21:00'); end loop;
    insert into public.provider_hours values (pid, 6, 1, '09:00', '13:00');
    insert into public.provider_categories (provider_id, category_id) values (pid, 'l') on conflict do nothing;
    insert into public.provider_categories (provider_id, category_id) values (pid, 'u') on conflict do nothing;
    insert into public.provider_categories (provider_id, category_id) values (pid, 'd') on conflict do nothing;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'l', 'Extensiones pelo a pelo', 120, 30000, 0, 0, 'Vení sin maquillaje en los ojos y sin lentes de contacto.') returning id into sid;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'l', 'Lifting de pestañas', 60, 15000, 1, 0, 'Vení sin maquillaje en los ojos. No mojes las pestañas por 24 h después.') returning id into sid;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'u', 'Esmaltado semipermanente', 60, 12000, 2, 0, 'Si tenés esmaltado o esculpidas de otro lugar, sumá el retiro como adicional.') returning id into sid;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'u', 'Uñas esculpidas', 90, 18000, 3, 0, 'Si tenés esmaltado o esculpidas de otro lugar, sumá el retiro como adicional.') returning id into sid;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'd', 'Depilación de cejas', 20, 4500, 4, 0, null) returning id into sid;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'd', 'Depilación piernas completas', 40, 11000, 5, 0, 'Cera: vello de 5 mm y sin cremas ese día. Láser: rasurá 24 h antes y no tomes sol 15 días antes.') returning id into sid;
    update public.provider_settings set stamps_on = true where provider_id = pid;
    update public.services set stamp_goal = 20 where provider_id = pid;  -- una tarjeta por servicio
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Valentina R.', 5, 'Las extensiones me duraron un montón. Súper prolija.');
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Martina G.', 5, 'El lifting quedó natural, como pedí.');
  end if;
  insert into public.providers (slug, name, address, city_id, instagram, hue, status, dni_verified)
    values ('ej-espacio-calma', 'Espacio Calma', 'San Martín 2950', cid, null, 150, 'active', true)
    on conflict (slug) do nothing returning id into pid;
  if pid is not null then
    insert into public.provider_private (provider_id, phone) values (pid, null);
    insert into public.provider_settings (provider_id, online, notice_min, buffer_min, happy_on, happy_pct, happy_days, happy_from, happy_to)
      values (pid, true, 60, 15, false, 20, '{1,2,3,4}', '09:00', '12:00');
    for d in 1 .. 5 loop insert into public.provider_hours values (pid, d, 1, '09:00', '12:00'), (pid, d, 2, '15:00', '21:00'); end loop;
    insert into public.provider_hours values (pid, 6, 1, '09:00', '13:00');
    insert into public.provider_categories (provider_id, category_id) values (pid, 'm') on conflict do nothing;
    insert into public.provider_categories (provider_id, category_id) values (pid, 'd') on conflict do nothing;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'm', 'Masaje descontracturante', 60, 20000, 0, 0, 'Llegá 10 minutos antes. Evitá comidas pesadas 2 h antes.') returning id into sid;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'm', 'Masaje relajante', 50, 17000, 1, 0, 'Llegá 10 minutos antes. Evitá comidas pesadas 2 h antes.') returning id into sid;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'm', 'Piedras calientes', 75, 24000, 2, 0, 'Llegá 10 minutos antes. Evitá comidas pesadas 2 h antes.') returning id into sid;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'd', 'Depilación definitiva · sesión', 30, 15000, 3, 0, 'Rasurá 24 h antes. No tomes sol 15 días antes ni después.') returning id into sid;
    update public.provider_settings set stamps_on = true where provider_id = pid;
    update public.services set stamp_goal = 15 where provider_id = pid;  -- una tarjeta por servicio
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Laura B.', 5, 'Salí nueva. La presión justa y el lugar muy tranquilo.');
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Graciela F.', 4, 'Muy buen masaje descontracturante.');
  end if;
  insert into public.providers (slug, name, address, city_id, instagram, hue, status, dni_verified)
    values ('ej-lucia-ferreyra-masoterapia', 'Lucía Ferreyra masoterapia', 'Necochea 3500', cid, null, 120, 'active', true)
    on conflict (slug) do nothing returning id into pid;
  if pid is not null then
    insert into public.provider_private (provider_id, phone) values (pid, null);
    insert into public.provider_settings (provider_id, online, notice_min, buffer_min, happy_on, happy_pct, happy_days, happy_from, happy_to)
      values (pid, true, 60, 15, false, 20, '{1,2,3,4}', '09:00', '12:00');
    for d in 1 .. 5 loop insert into public.provider_hours values (pid, d, 1, '09:00', '12:00'), (pid, d, 2, '15:00', '21:00'); end loop;
    insert into public.provider_hours values (pid, 6, 1, '09:00', '13:00');
    insert into public.provider_categories (provider_id, category_id) values (pid, 'm') on conflict do nothing;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'm', 'Masaje terapéutico', 60, 18000, 0, 0, 'Llegá 10 minutos antes. Evitá comidas pesadas 2 h antes.') returning id into sid;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'm', 'Drenaje linfático', 60, 19000, 1, 0, 'Tomá agua antes y después de la sesión.') returning id into sid;
    update public.provider_settings set stamps_on = true where provider_id = pid;
    update public.services set stamp_goal = 15 where provider_id = pid;  -- una tarjeta por servicio
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Laura B.', 5, 'Salí nueva. La presión justa y el lugar muy tranquilo.');
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Graciela F.', 4, 'Muy buen masaje descontracturante.');
  end if;
  insert into public.providers (slug, name, address, city_id, instagram, hue, status, dni_verified)
    values ('ej-mirada-lash-studio', 'Mirada Lash Studio', 'Vicente López 2100', cid, null, 270, 'active', true)
    on conflict (slug) do nothing returning id into pid;
  if pid is not null then
    insert into public.provider_private (provider_id, phone) values (pid, null);
    insert into public.provider_settings (provider_id, online, notice_min, buffer_min, happy_on, happy_pct, happy_days, happy_from, happy_to)
      values (pid, true, 60, 10, false, 20, '{1,2,3,4}', '09:00', '12:00');
    for d in 1 .. 5 loop insert into public.provider_hours values (pid, d, 1, '09:00', '12:00'), (pid, d, 2, '15:00', '21:00'); end loop;
    insert into public.provider_hours values (pid, 6, 1, '09:00', '13:00');
    insert into public.provider_categories (provider_id, category_id) values (pid, 'l') on conflict do nothing;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'l', 'Volumen ruso', 150, 38000, 0, 0, 'Vení sin maquillaje en los ojos y sin lentes de contacto.') returning id into sid;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'l', 'Mantenimiento de extensiones', 60, 16000, 1, 0, 'Vení sin maquillaje en los ojos y sin lentes de contacto.') returning id into sid;
    update public.provider_settings set stamps_on = true where provider_id = pid;
    update public.services set stamp_goal = 15 where provider_id = pid;  -- una tarjeta por servicio
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Valentina R.', 5, 'Las extensiones me duraron un montón. Súper prolija.');
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Martina G.', 5, 'El lifting quedó natural, como pedí.');
  end if;
  insert into public.providers (slug, name, address, city_id, instagram, hue, status, dni_verified)
    values ('ej-nails-by-agus', 'Nails by Agus', 'Hornos 3300', cid, null, 15, 'active', true)
    on conflict (slug) do nothing returning id into pid;
  if pid is not null then
    insert into public.provider_private (provider_id, phone) values (pid, null);
    insert into public.provider_settings (provider_id, online, notice_min, buffer_min, happy_on, happy_pct, happy_days, happy_from, happy_to)
      values (pid, true, 60, 10, false, 20, '{1,2,3,4}', '09:00', '12:00');
    for d in 1 .. 5 loop insert into public.provider_hours values (pid, d, 1, '09:00', '12:00'), (pid, d, 2, '15:00', '21:00'); end loop;
    insert into public.provider_hours values (pid, 6, 1, '09:00', '13:00');
    insert into public.provider_categories (provider_id, category_id) values (pid, 'u') on conflict do nothing;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'u', 'Kapping gel', 60, 13000, 0, 0, 'Si tenés esmaltado o esculpidas de otro lugar, sumá el retiro como adicional.') returning id into sid;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'u', 'Manicura rusa', 75, 16000, 1, 0, 'Si tenés esmaltado o esculpidas de otro lugar, sumá el retiro como adicional.') returning id into sid;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'u', 'Pedicura spa', 60, 14000, 2, 0, 'Vení con calzado abierto si te hacés semipermanente.') returning id into sid;
    update public.provider_settings set stamps_on = true where provider_id = pid;
    update public.services set stamp_goal = 15 where provider_id = pid;  -- una tarjeta por servicio
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Camila S.', 5, 'El semipermanente me duró tres semanas perfecto.');
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Rocío P.', 4, 'Muy lindo diseño, volvería.');
  end if;
  insert into public.providers (slug, name, address, city_id, instagram, hue, status, dni_verified)
    values ('ej-piel-suave-depilacion', 'Piel Suave Depilación', 'Dorrego 2800', cid, null, 40, 'active', true)
    on conflict (slug) do nothing returning id into pid;
  if pid is not null then
    insert into public.provider_private (provider_id, phone) values (pid, null);
    insert into public.provider_settings (provider_id, online, notice_min, buffer_min, happy_on, happy_pct, happy_days, happy_from, happy_to)
      values (pid, true, 60, 5, false, 20, '{1,2,3,4}', '09:00', '12:00');
    for d in 1 .. 5 loop insert into public.provider_hours values (pid, d, 1, '09:00', '12:00'), (pid, d, 2, '15:00', '21:00'); end loop;
    insert into public.provider_hours values (pid, 6, 1, '09:00', '13:00');
    insert into public.provider_categories (provider_id, category_id) values (pid, 'd') on conflict do nothing;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'd', 'Cera · piernas completas', 40, 10000, 0, 0, 'Cera: vello de 5 mm y sin cremas ese día. Láser: rasurá 24 h antes y no tomes sol 15 días antes.') returning id into sid;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'd', 'Láser diodo · axilas', 20, 9000, 1, 0, 'Rasurá 24 h antes. No tomes sol 15 días antes ni después.') returning id into sid;
    update public.provider_settings set stamps_on = true where provider_id = pid;
    update public.services set stamp_goal = 15 where provider_id = pid;  -- una tarjeta por servicio
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Julieta M.', 5, 'Casi no dolió y es muy higiénico todo.');
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Daniela M.', 4, 'Me explicó bien cómo cuidarme después del láser.');
  end if;
  insert into public.providers (slug, name, address, city_id, instagram, hue, status, dni_verified)
    values ('ej-estudio-norte', 'Estudio Norte', 'Colón 4100', cid, null, 200, 'active', true)
    on conflict (slug) do nothing returning id into pid;
  if pid is not null then
    insert into public.provider_private (provider_id, phone) values (pid, null);
    insert into public.provider_settings (provider_id, online, notice_min, buffer_min, happy_on, happy_pct, happy_days, happy_from, happy_to)
      values (pid, true, 60, 0, false, 20, '{1,2,3,4}', '09:00', '12:00');
    for d in 1 .. 5 loop insert into public.provider_hours values (pid, d, 1, '09:00', '12:00'), (pid, d, 2, '15:00', '21:00'); end loop;
    insert into public.provider_hours values (pid, 6, 1, '09:00', '13:00');
    insert into public.provider_categories (provider_id, category_id) values (pid, 'b') on conflict do nothing;
    insert into public.provider_categories (provider_id, category_id) values (pid, 'p') on conflict do nothing;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'b', 'Corte masculino', 30, 11000, 0, 0, null) returning id into sid;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'b', 'Barba con toalla caliente', 20, 7000, 1, 0, null) returning id into sid;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'p', 'Corte y brushing', 60, 22000, 2, 0, null) returning id into sid;
    insert into public.services (provider_id, category_id, name, duration_min, price, sort, repeat_days, prep_note)
      values (pid, 'p', 'Color global', 120, 45000, 3, 0, 'Si es color, vení con el pelo sin lavar de 24 h.') returning id into sid;
    update public.provider_settings set stamps_on = true where provider_id = pid;
    update public.services set stamp_goal = 15 where provider_id = pid;  -- una tarjeta por servicio
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Martín G.', 5, 'Impecable el fade y súper puntual.');
    insert into public.reviews (provider_id, author, stars, body) values (pid, 'Leandro S.', 4, 'Muy buen corte, el lugar es cómodo.');
  end if;
end $$;
