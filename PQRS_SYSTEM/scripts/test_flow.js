(async function(){
  const port = process.env.TEST_PORT || process.env.PORT || 3000;
  const base = `http://localhost:${port}`;
  const fetch = globalThis.fetch || (await import('node-fetch')).default;

  async function login(username, password){
    const res = await fetch(base + '/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password }),
      redirect: 'manual'
    });
    const setCookie = res.headers.get('set-cookie');
    return setCookie;
  }

  async function createPqrs(cookie, payload){
    const res = await fetch(base + '/resident/pqrs/nueva', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'cookie': cookie },
      body: new URLSearchParams(payload),
      redirect: 'manual'
    });
    return res.status;
  }

  async function adminList(cookie){
    const res = await fetch(base + '/admin/pqrs', { headers: { cookie } });
    const text = await res.text();
    return text;
  }

  try {
    console.log('Logging in resident 1001...');
    const cookieRes = await login('1001', '123456');
    if (!cookieRes) { console.error('No cookie received for resident'); return; }
    console.log('Resident cookie:', cookieRes.split(';')[0]);

    console.log('Creating PQRS as resident for unidad 1...');
    const status = await createPqrs(cookieRes.split(';')[0], { id_unidad: '1', tipo: 'Queja', asunto: 'Prueba ruido', descripcion: 'Hay ruido en la noche' });
    console.log('Create status:', status);

    console.log('Logging in admin...');
    const cookieAdmin = await login('admin', 'Admin123*');
    console.log('Admin cookie:', cookieAdmin ? cookieAdmin.split(';')[0] : null);

    console.log('Fetching admin list page...');
    const html = await adminList(cookieAdmin.split(';')[0]);
    console.log('Admin page length:', html.length);
    const found = html.includes('Prueba ruido');
    console.log('Found created PQRS in admin list?', found);
  } catch (err) {
    console.error(err);
  }
})();
