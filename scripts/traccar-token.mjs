// Creates the first Traccar user (if none exists) and prints a new API token for it.
// Runs inside the platform network: node scripts/traccar-token.mjs
// Env: TRACCAR_URL, TRACCAR_ADMIN_EMAIL, TRACCAR_ADMIN_PASSWORD.
const base = process.env.TRACCAR_URL ?? 'http://traccar:8082';
const email = process.env.TRACCAR_ADMIN_EMAIL;
const password = process.env.TRACCAR_ADMIN_PASSWORD;
if (!email || !password) {
  console.error('TRACCAR_ADMIN_EMAIL and TRACCAR_ADMIN_PASSWORD are required');
  process.exit(1);
}

async function waitForTraccar() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/server`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Traccar not reachable at ${base}`);
}

await waitForTraccar();

const basic = 'Basic ' + Buffer.from(`${email}:${password}`).toString('base64');
const session = await fetch(`${base}/api/session`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ email, password }),
});
if (!session.ok) {
  // No such user: on an empty server the first registered user becomes admin.
  const created = await fetch(`${base}/api/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'admin', email, password }),
  });
  if (!created.ok) {
    throw new Error(
      `Cannot log in nor create the admin user (${created.status}): the Traccar volume ` +
        'already has users with other credentials. Use ./stack.sh reset or fix env/<env>.env.',
    );
  }
}

const token = await fetch(`${base}/api/session/token`, {
  method: 'POST',
  headers: { authorization: basic, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({}),
});
if (!token.ok) throw new Error(`Token request failed (${token.status})`);
process.stdout.write((await token.text()).trim());
