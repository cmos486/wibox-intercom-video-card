/**
 * Dependency-free checks for wibox-intercom-video-card.js.
 *
 *   node tests/run.js
 *
 * The gesture check is the important one: the whole card exists because
 * `getUserMedia` has to be reachable synchronously from the click handler.
 * Put an `await` in front of it and the microphone silently dies on mobile.
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const CARD = path.join(__dirname, '..', 'wibox-intercom-video-card.js');
const source = fs.readFileSync(CARD, 'utf8');

let pass = 0;
let fail = 0;

function eq(name, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w);
  }
}

function ok(name, condition, detail) {
  if (condition) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name + (detail ? '\n       ' + detail : ''));
  }
}

// ---------- 1. The card evaluates and registers itself ----------

const defined = {};
const sandbox = {
  console: { log() {}, warn() {}, error() {} },
  HTMLElement: class { attachShadow() { return {}; } },
  customElements: { define: (n, c) => { defined[n] = c; }, get: () => undefined },
  WebSocket: { OPEN: 1 },
  window: {},
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const run = (expr) => vm.runInContext(expr, sandbox);

console.log('registration:');
eq('custom elements defined', Object.keys(defined).sort(),
  ['wibox-intercom-video-card', 'wibox-intercom-video-card-editor']);
eq('listed in customCards', sandbox.window.customCards.map((c) => c.type),
  ['wibox-intercom-video-card']);

// ---------- 2. The user-gesture property ----------

console.log('\nuser gesture (mobile microphone):');
{
  const start = source.indexOf('async _connect()');
  const call = source.indexOf('navigator.mediaDevices.getUserMedia', start);
  ok('_connect() calls getUserMedia', start !== -1 && call !== -1);

  // The `await` directly in front of the call belongs to the call itself: the
  // expression is evaluated before the coroutine suspends, so it is harmless.
  let head = source.slice(start, call).replace(/await\s*$/, '');
  head = head.replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  const suspends = head.match(/\bawait\b|\.then\s*\(/g) || [];
  ok('no await before getUserMedia', suspends.length === 0,
    'found ' + JSON.stringify(suspends) + ' - mobile browsers will deny the mic');

  const handler = source.match(/startBtn\.addEventListener\('click',\s*(.*?)\);/);
  ok('click handler does not await', handler && !handler[1].includes('await'),
    handler ? handler[1] : 'handler not found');
}

// ---------- 3. The SDP shape go2rtc maps onto the backchannel ----------

console.log('\nSDP shape:');
ok('mic transceiver is sendonly',
  /addTransceiver\(\s*this\._localStream\.getAudioTracks\(\)\[0\],\s*\{\s*\n?\s*direction: 'sendonly'/.test(source));
ok('video transceiver is recvonly',
  source.includes("addTransceiver('video', { direction: 'recvonly' })"));
ok('audio transceiver is recvonly',
  source.includes("addTransceiver('audio', { direction: 'recvonly' })"));

// ---------- 4. Signalling goes through HA, never straight to go2rtc ----------

console.log('\nsignalling:');
ok('signs the path with HA', source.includes("type: 'auth/sign_path'"));
ok('uses the AlexxIT proxy path', source.includes("const WS_PATH = '/api/webrtc/ws'"));
ok('go2rtc API port is never referenced', !/:1984/.test(source.replace(/^ \*.*$/gm, '')),
  'the card must not talk to the go2rtc API directly');
ok('sends a go2rtc offer', source.includes("type: 'webrtc/offer'"));
ok('handles a go2rtc answer', source.includes("msg.type === 'webrtc/answer'"));

// ---------- 5. Full duplex is the default ----------

console.log('\nduplex default:');
ok('card defaults mute_while_talking to false',
  source.includes('this._config = { mute_while_talking: false, ...config };'),
  'incoming audio must keep playing while the talk button is held');
ok('editor switch agrees with that default',
  source.includes('toggle.checked = value === true;'),
  'a `value !== false` test would show the switch on while the card behaves as off');

// ---------- 6. Config helpers ----------

console.log('\nresolveOpenDoorAction:');
const door = (c) => run('resolveOpenDoorAction(' + JSON.stringify(c) + ')');
eq('button entity', door({ open_door_entity: 'button.wifi_intercom_entrada_open_door' }),
  { service: 'button.press', entity_id: 'button.wifi_intercom_entrada_open_door' });
eq('lock entity', door({ open_door_entity: 'lock.front' }),
  { service: 'lock.unlock', entity_id: 'lock.front' });
eq('script entity', door({ open_door_entity: 'script.gate' }),
  { service: 'script.turn_on', entity_id: 'script.gate' });
eq('legacy lock_entity', door({ lock_entity: 'lock.front' }),
  { service: 'lock.unlock', entity_id: 'lock.front' });
eq('explicit action wins',
  door({ open_door_entity: 'button.a', open_door_action: { service: 'script.turn_on', entity_id: 'script.b' } }),
  { service: 'script.turn_on', entity_id: 'script.b' });
eq('nothing configured', door({}), null);
eq('unsupported domain', door({ open_door_entity: 'sensor.x' }), null);

console.log('\nnormalizeIceServers:');
const ice = (c) => run('normalizeIceServers(' + JSON.stringify(c) + ')');
eq('default is cloudflare stun', ice({}), [{ urls: 'stun:stun.cloudflare.com:3478' }]);
eq('list of strings', ice({ ice_servers: ['stun:a:1', 'stun:b:2'] }), [{ urls: 'stun:a:1' }, { urls: 'stun:b:2' }]);
eq('list of objects', ice({ ice_servers: [{ urls: 'turn:x', username: 'u' }] }), [{ urls: 'turn:x', username: 'u' }]);
eq('bare string', ice({ ice_servers: 'stun:a:1' }), [{ urls: 'stun:a:1' }]);
eq('empty list disables', ice({ ice_servers: [] }), []);
eq('null disables', ice({ ice_servers: null }), []);

console.log('\ndetectLanguage:');
const lang = (h, c) => run('detectLanguage(' + JSON.stringify(h) + ',' + JSON.stringify(c) + ')');
eq('config overrides hass', lang({ locale: { language: 'en' } }, 'ca'), 'ca');
eq('follows hass locale', lang({ locale: { language: 'es' } }, undefined), 'es');
eq('strips regional tag', lang({ language: 'es-ES' }, undefined), 'es');
eq('unknown falls back to en', lang({ locale: { language: 'de' } }, undefined), 'en');
eq('no hass falls back to en', lang(null, undefined), 'en');
eq('unknown config lang ignored', lang({ locale: { language: 'ca' } }, 'de'), 'ca');

console.log('\ntranslations:');
const keys = (l) => run('Object.keys(TRANSLATIONS.' + l + ').sort()');
eq('es has every en key', keys('es'), keys('en'));
eq('ca has every en key', keys('ca'), keys('en'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
