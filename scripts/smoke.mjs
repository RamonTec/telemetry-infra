// End-to-end smoke test of the running stack (./stack.sh smoke).
// Runs inside the platform network from the traccar-adapter image (it ships the NATS client),
// mounted at /app so its node_modules resolve.
import { jetstreamManager } from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';

const KEYCLOAK = 'http://keycloak:8080/realms/telemetry';
const ADAPTER = 'http://traccar-adapter:3000';
const OSMAND = 'http://traccar:5055';
const NATS = 'nats://nats:4222';
const EVENTS_STREAM = 'TELEMETRY_EVENTS';
const IMEI = '359000000000017';
const { SMOKE_CLIENT_ID: clientId, SMOKE_CLIENT_SECRET: clientSecret } = process.env;

let failed = false;
async function step(name, fn) {
  try {
    const detail = await fn();
    console.log(`OK    ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    failed = true;
    console.log(`FAIL  ${name} — ${error instanceof Error ? error.message : error}`);
    throw error;
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function retry(fn, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(`${what}: ${last instanceof Error ? last.message : last}`);
}

async function main() {
  let token;
  let groupId;
  let deviceId;

  await step('traccar-adapter ready', () =>
    retry(
      async () => {
        const res = await fetch(`${ADAPTER}/health/ready`);
        const body = await res.json();
        assert(res.ok, `status ${res.status} ${JSON.stringify(body.checks)}`);
        return JSON.stringify(body.checks);
      },
      120_000,
      'not ready',
    ),
  );

  await step('Keycloak issues a client-credentials token', () =>
    retry(
      async () => {
        assert(clientId && clientSecret, 'SMOKE_CLIENT_ID / SMOKE_CLIENT_SECRET not set');
        const res = await fetch(`${KEYCLOAK}/protocol/openid-connect/token`, {
          method: 'POST',
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
          }),
        });
        assert(res.ok, `status ${res.status}`);
        token = (await res.json()).access_token;
        const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
        const roles = claims.resource_access?.['traccar-adapter']?.roles ?? [];
        const aud = [claims.aud].flat();
        assert(claims.iss === KEYCLOAK, `iss ${claims.iss}`);
        assert(aud.includes('traccar-adapter'), `aud ${aud}`);
        assert(roles.includes('groups:write') && roles.includes('devices:write'), `roles ${roles}`);
        return `azp=${claims.azp} roles=${roles.join(',')}`;
      },
      120_000,
      'no token',
    ),
  );

  const api = async (path, body, auth = true) => {
    const res = await fetch(`${ADAPTER}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(auth && { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  await step('traccar-adapter rejects a request without token', async () => {
    const res = await api('/groups', { name: 'smoke-group' }, false);
    assert(res.status === 401, `status ${res.status}`);
  });

  await step('POST /groups with the Keycloak token', async () => {
    const res = await api('/groups', { name: 'smoke-group' });
    assert(res.status === 200 || res.status === 201, `status ${res.status} ${JSON.stringify(res.body)}`);
    groupId = res.body.groupId;
    return `groupId=${groupId}`;
  });

  await step('POST /devices with the Keycloak token', async () => {
    const res = await api('/devices', { uniqueId: IMEI, name: 'smoke-device', groupId });
    assert(res.status === 200 || res.status === 201, `status ${res.status} ${JSON.stringify(res.body)}`);
    deviceId = res.body.deviceId;
    return `deviceId=${deviceId}`;
  });

  const nc = await connect({ servers: NATS, timeout: 5000 });
  try {
    const jsm = await jetstreamManager(nc);
    const before = (await jsm.streams.info(EVENTS_STREAM)).state.last_seq;
    const timestamp = Math.floor(Date.now() / 1000);

    await step('Traccar accepts an OsmAnd position', async () => {
      const query = new URLSearchParams({ id: IMEI, lat: '19.4326', lon: '-99.1332', timestamp: String(timestamp) });
      const res = await fetch(`${OSMAND}/?${query}`);
      assert(res.ok, `status ${res.status}`);
    });

    await step(`position reaches ${EVENTS_STREAM}`, () =>
      retry(
        async () => {
          const info = await jsm.streams.info(EVENTS_STREAM);
          for (let seq = info.state.last_seq; seq > before; seq -= 1) {
            const msg = await jsm.streams.getMessage(EVENTS_STREAM, { seq });
            const event = msg?.json();
            if (
              event?.type === 'position.reported' &&
              event.data?.deviceId === deviceId &&
              Date.parse(event.occurredAt) === timestamp * 1000
            ) {
              return `${msg.subject} id=${event.id}`;
            }
          }
          throw new Error('not yet');
        },
        30_000,
        'event not found',
      ),
    );
  } finally {
    await nc.close();
  }
}

main()
  .catch(() => undefined)
  .finally(() => {
    console.log(failed ? '\nSMOKE FAILED' : '\nSMOKE PASSED');
    process.exit(failed ? 1 : 0);
  });
