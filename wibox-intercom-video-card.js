/**
 * WiBox Intercom Video Card - v1.0.0
 *
 * Two-way audio + video Lovelace card for a WiBox intercom served by go2rtc.
 *
 * Signalling goes through the Home Assistant WebSocket proxy registered by the
 * AlexxIT/WebRTC integration (`/api/webrtc/ws`, protected by `auth/sign_path`).
 * go2rtc's own API (1984) is never exposed: HA proxies the socket for us, so
 * this works remotely over the same HTTPS reverse proxy as the rest of HA.
 *
 * The microphone is acquired in the *click handler* of the "Pick up" button,
 * with no `await` before it, so mobile browsers treat it as a user gesture and
 * allow the mic. go2rtc cannot renegotiate over its WebSocket, so the mic track
 * must be part of the initial offer - push-to-talk then only gates the track
 * with `track.enabled`.
 *
 * Offer shape (must match what go2rtc maps onto the ONVIF backchannel):
 *   m=audio sendonly   <- browser mic  -> WiBox trackID=2 (PCMA)
 *   m=video recvonly   <- WiBox camera
 *   m=audio recvonly   <- WiBox mic
 *
 * Schema:
 *   type: custom:wibox-intercom-video-card
 *   stream: wibox                       # go2rtc stream name (from go2rtc.yaml)
 *   url: rtsp://user:pass@host/live     # or any source go2rtc can open
 *   entity: camera.xxx                  # or a camera entity
 *   server: http://localhost:1984/      # optional go2rtc URL override
 *   open_door_entity: button.xxx        # optional, simple "open door" mode
 *   open_door_action:                   # optional, advanced mode
 *     service: button.press
 *     entity_id: button.xxx
 *     data: {...}
 *   mute_while_talking: true            # half-duplex, kills speaker echo
 *   ice_servers: ['stun:stun.cloudflare.com:3478']
 *   video_max_height: 300px
 *   language: es|en|ca
 *
 * Repo: https://github.com/cmos486/wibox-intercom-video-card
 * License: Apache-2.0
 */

const CARD_VERSION = '1.0.0';
const CARD_TAG = 'wibox-intercom-video-card';
const EDITOR_TAG = 'wibox-intercom-video-card-editor';
const LOG_PREFIX = '[wibox-intercom-video-card]';

const WS_PATH = '/api/webrtc/ws';
const CONNECT_TIMEOUT_MS = 20000;
const DEFAULT_ICE_SERVERS = ['stun:stun.cloudflare.com:3478'];

// ---------- i18n ----------

const TRANSLATIONS = {
  es: {
    idle: 'Inactivo',
    connecting: 'Conectando...',
    requesting_mic: 'Pidiendo microfono...',
    signing: 'Autenticando con HA...',
    ws_connecting: 'Abriendo canal go2rtc...',
    sending_offer: 'Enviando offer...',
    answer_received: 'Answer recibido',
    negotiating: 'Negociando ICE...',
    connected: 'RTC conectado',
    pc_state: 'Estado PC:',
    ptt_button: 'PULSAR PARA HABLAR',
    ptt_talking: 'HABLANDO...',
    pick_up: 'Descolgar',
    open_door: 'Abrir puerta',
    hang_up: 'Colgar',
    door_opened: 'Puerta abierta',
    hung_up: 'Colgado',
    disconnected: 'Desconectado',
    listen_only: 'Solo escucha (sin microfono)',
    error_opening: 'Error abriendo:',
    door_not_configured: 'Abrir puerta no configurado',
    error_service: 'service mal formado',
    error_prefix: 'Error:',
    error_ha: 'Error de HA:',
    hint_stream_not_found:
      "el go2rtc que responde no tiene ese stream. Comprueba el nombre en go2rtc.yaml, o pon la URL RTSP directamente en 'url:'.",
    error_answer: 'Error en answer:',
    error_ws: 'Canal cerrado por HA/go2rtc',
    error_timeout: 'Timeout: no se establecio la conexion RTC',
    error_insecure:
      'Microfono bloqueado: HA no se ha abierto por HTTPS. Revisa que la app entre por tu URL https, no por http://IP:8123.',
    error_no_mic: 'Sin acceso al microfono:',
    // Editor labels
    editor_stream_label: 'Stream de go2rtc (recomendado)',
    editor_stream_help: 'Nombre del stream en go2rtc.yaml (p.ej. "wibox") o una fuente que go2rtc pueda abrir (p.ej. rtsp://...). Es la via que conserva el backchannel ONVIF.',
    editor_entity_label: 'Entidad camara (alternativa a stream)',
    editor_entity_help: 'Se usa solo si dejas el stream vacio. go2rtc recibira la URL RTSP de la entidad.',
    editor_door_label: 'Entidad para abrir puerta (opcional)',
    editor_door_help: 'Aparece el boton "Abrir puerta". Para un button.xxx llama a button.press.',
    editor_mute_label: 'Silenciar entrada mientras hablas (medio duplex)',
    editor_mute_help: 'Recomendado: evita que el altavoz del movil se realimente en el microfono.',
    editor_advanced_toggle: 'Avanzado: accion personalizada para abrir puerta',
    editor_advanced_help: 'Configura cualquier llamada de servicio para el boton "Abrir puerta". Dejarlo vacio deshabilita el boton.',
    editor_service_label: 'Servicio (ej. button.press, script.turn_on)',
    editor_action_entity_label: 'Entidad (opcional)',
    editor_action_entity_help: 'Si el servicio necesita un entity_id, ponlo aqui.',
    editor_language_label: 'Idioma (opcional, sobrescribe el de HA)',
    editor_language_help: 'Idioma de los textos del card. Si se deja vacio, se usa el idioma de Home Assistant.',
  },
  en: {
    idle: 'Idle',
    connecting: 'Connecting...',
    requesting_mic: 'Requesting microphone...',
    signing: 'Authenticating with HA...',
    ws_connecting: 'Opening go2rtc channel...',
    sending_offer: 'Sending offer...',
    answer_received: 'Answer received',
    negotiating: 'Negotiating ICE...',
    connected: 'RTC connected',
    pc_state: 'PC state:',
    ptt_button: 'PUSH TO TALK',
    ptt_talking: 'TALKING...',
    pick_up: 'Pick up',
    open_door: 'Open door',
    hang_up: 'Hang up',
    door_opened: 'Door opened',
    hung_up: 'Hung up',
    disconnected: 'Disconnected',
    listen_only: 'Listen only (no microphone)',
    error_opening: 'Error opening:',
    door_not_configured: 'Open door not configured',
    error_service: 'malformed service',
    error_prefix: 'Error:',
    error_ha: 'HA error:',
    hint_stream_not_found:
      "the go2rtc that answered has no such stream. Check the name in go2rtc.yaml, or put the RTSP URL directly in 'url:'.",
    error_answer: 'Error in answer:',
    error_ws: 'Channel closed by HA/go2rtc',
    error_timeout: 'Timeout: RTC connection was not established',
    error_insecure:
      'Microphone blocked: HA was not loaded over HTTPS. Make sure the app connects through your https URL, not http://IP:8123.',
    error_no_mic: 'No microphone access:',
    editor_stream_label: 'go2rtc stream (recommended)',
    editor_stream_help: 'Stream name from go2rtc.yaml (e.g. "wibox") or any source go2rtc can open (e.g. rtsp://...). This is the path that preserves the ONVIF backchannel.',
    editor_entity_label: 'Camera entity (alternative to stream)',
    editor_entity_help: 'Only used if the stream field is empty. go2rtc will receive the entity RTSP URL.',
    editor_door_label: 'Open door entity (optional)',
    editor_door_help: 'Shows the "Open door" button. For a button.xxx it calls button.press.',
    editor_mute_label: 'Mute incoming audio while talking (half-duplex)',
    editor_mute_help: 'Recommended: stops the phone speaker from feeding back into the microphone.',
    editor_advanced_toggle: 'Advanced: custom open-door action',
    editor_advanced_help: 'Configure any service call for the "Open door" button. Leaving it empty disables the button.',
    editor_service_label: 'Service (e.g. button.press, script.turn_on)',
    editor_action_entity_label: 'Entity (optional)',
    editor_action_entity_help: 'If your service needs an entity_id, set it here.',
    editor_language_label: 'Language (optional, overrides HA language)',
    editor_language_help: 'Language for card texts. Leave empty to use Home Assistant language.',
  },
  ca: {
    idle: 'Inactiu',
    connecting: 'Connectant...',
    requesting_mic: 'Demanant microfon...',
    signing: 'Autenticant amb HA...',
    ws_connecting: 'Obrint canal go2rtc...',
    sending_offer: 'Enviant oferta...',
    answer_received: 'Resposta rebuda',
    negotiating: 'Negociant ICE...',
    connected: 'RTC connectat',
    pc_state: 'Estat PC:',
    ptt_button: 'PREMER PER PARLAR',
    ptt_talking: 'PARLANT...',
    pick_up: 'Despenjar',
    open_door: 'Obrir porta',
    hang_up: 'Penjar',
    door_opened: 'Porta oberta',
    hung_up: 'Penjat',
    disconnected: 'Desconnectat',
    listen_only: 'Nomes escolta (sense microfon)',
    error_opening: 'Error obrint:',
    door_not_configured: 'Obrir porta no configurat',
    error_service: 'servei mal format',
    error_prefix: 'Error:',
    error_ha: "Error d'HA:",
    hint_stream_not_found:
      "el go2rtc que respon no te aquest stream. Comprova el nom a go2rtc.yaml, o posa la URL RTSP directament a 'url:'.",
    error_answer: 'Error a la resposta:',
    error_ws: 'Canal tancat per HA/go2rtc',
    error_timeout: 'Temps esgotat: no s\'ha establert la connexio RTC',
    error_insecure:
      "Microfon bloquejat: HA no s'ha obert per HTTPS. Comprova que l'app entri per la teva URL https, no per http://IP:8123.",
    error_no_mic: 'Sense acces al microfon:',
    editor_stream_label: 'Stream de go2rtc (recomanat)',
    editor_stream_help: 'Nom del stream a go2rtc.yaml (p.ex. "wibox") o una font que go2rtc pugui obrir (p.ex. rtsp://...). Es la via que conserva el backchannel ONVIF.',
    editor_entity_label: 'Entitat camera (alternativa a stream)',
    editor_entity_help: "Nomes s'usa si deixes el stream buit. go2rtc rebra la URL RTSP de l'entitat.",
    editor_door_label: 'Entitat per obrir la porta (opcional)',
    editor_door_help: 'Apareix el boto "Obrir porta". Per a un button.xxx crida button.press.',
    editor_mute_label: 'Silenciar entrada mentre parles (mig duplex)',
    editor_mute_help: 'Recomanat: evita que l\'altaveu del mobil es realimenti al microfon.',
    editor_advanced_toggle: 'Avancat: accio personalitzada per obrir la porta',
    editor_advanced_help: 'Configura qualsevol crida de servei per al boto "Obrir porta". Deixar-ho buit desactiva el boto.',
    editor_service_label: 'Servei (p.ex. button.press, script.turn_on)',
    editor_action_entity_label: 'Entitat (opcional)',
    editor_action_entity_help: "Si el servei necessita un entity_id, posa-l'hi aqui.",
    editor_language_label: 'Idioma (opcional, sobreescriu el d\'HA)',
    editor_language_help: "Idioma dels textos del card. Si es deixa buit, s'usa l'idioma de Home Assistant.",
  },
};

const LANGUAGE_NAMES = {
  '': 'Auto (Home Assistant)',
  es: 'Espanol',
  en: 'English',
  ca: 'Catala',
};

function detectLanguage(hass, configLang) {
  if (configLang && TRANSLATIONS[configLang]) return configLang;
  const haLang = (hass && (hass.locale?.language || hass.language)) || '';
  const short = haLang.split('-')[0].toLowerCase();
  if (TRANSLATIONS[short]) return short;
  return 'en';
}

function t(lang, key) {
  return TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS.en[key] ?? key;
}

// ---------- Helpers ----------

// Domain -> service used by the "open door" shortcut.
const DOOR_SERVICES = {
  button: 'button.press',
  input_button: 'input_button.press',
  lock: 'lock.unlock',
  switch: 'switch.turn_on',
  script: 'script.turn_on',
  scene: 'scene.turn_on',
  automation: 'automation.trigger',
};

function resolveOpenDoorAction(config) {
  if (config.open_door_action && config.open_door_action.service) {
    return config.open_door_action;
  }
  const entity = config.open_door_entity || config.lock_entity;
  if (entity) {
    const service = DOOR_SERVICES[entity.split('.')[0]];
    if (service) return { service, entity_id: entity };
  }
  return null;
}

function normalizeIceServers(config) {
  const raw = config.ice_servers === undefined ? DEFAULT_ICE_SERVERS : config.ice_servers;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((item) => (typeof item === 'string' ? { urls: item } : item))
    .filter((item) => item && item.urls);
}

async function loadHaComponents() {
  if (customElements.get('ha-entity-picker') && customElements.get('ha-textfield')) {
    return;
  }
  if (!customElements.get('hui-entities-card')) {
    const helpers = await window.loadCardHelpers();
    const entitiesCard = await helpers.createCardElement({
      type: 'entities',
      entities: [],
    });
    entitiesCard.constructor.getConfigElement?.();
  } else {
    const entitiesCard = customElements.get('hui-entities-card');
    entitiesCard?.getConfigElement?.();
  }
}

// ---------- Main Card ----------

class WiboxIntercomVideoCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._pc = null;
    this._ws = null;
    this._localStream = null;
    this._connected = false;
    this._connecting = false;
    this._micReady = false;
    this._talking = false;
    this._localCandidates = [];
    this._remoteCandidates = [];
    this._offerSent = false;
    this._tearingDown = false;
    this._micError = null;
    this._statusIsError = false;
    this._connectTimer = null;
    this._keepAliveTimer = null;
    this._sessionSeq = 0;
    this._lang = 'en';
  }

  static async getConfigElement() {
    await loadHaComponents();
    return document.createElement(EDITOR_TAG);
  }

  static getStubConfig() {
    return { stream: 'wibox' };
  }

  setConfig(config) {
    if (!config.stream && !config.url && !config.entity) {
      throw new Error('You need to define a go2rtc "stream" name, a "url" source, or a camera "entity"');
    }
    if ((config.stream || config.url) && config.entity) {
      // Both are valid on their own, but they are the same wire parameter and
      // the named source wins - which looks like `entity` being ignored.
      console.warn(
        LOG_PREFIX,
        `both "${config.stream ? 'stream' : 'url'}" and "entity" are set; ` +
        `using "${config.stream || config.url}" and ignoring ${config.entity}`
      );
    }
    this._config = { mute_while_talking: true, ...config };
    this._refreshLang();
    this._render();
  }

  set hass(hass) {
    const langBefore = this._lang;
    this._hass = hass;
    this._refreshLang();
    if (langBefore !== this._lang && this.shadowRoot.querySelector('.container')) {
      this._render();
    }
  }

  _refreshLang() {
    if (!this._config) return;
    this._lang = detectLanguage(this._hass, this._config.language);
  }

  getCardSize() {
    return 4;
  }

  _render() {
    const T = (key) => t(this._lang, key);

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 0; overflow: hidden; }
        .container { display: flex; flex-direction: column; background: #000; }
        .video-wrap { position: relative; width: 100%; aspect-ratio: 4 / 3; max-height: var(--wibox-video-max-height, none); background: #000; }
        video { width: 100%; height: 100%; object-fit: var(--wibox-video-object-fit, contain); max-height: var(--wibox-video-max-height, none); background: #000; }
        .overlay {
          position: absolute; top: 8px; left: 8px; right: 8px;
          padding: 4px 8px; background: rgba(0, 0, 0, 0.6);
          color: #fff; font-size: 12px; border-radius: 4px; font-family: monospace;
        }
        .overlay.error { background: rgba(198, 40, 40, 0.85); }
        .controls { display: flex; flex-direction: column; padding: 16px; gap: 12px; background: #1a1a1a; }
        .row { display: flex; gap: 12px; }
        .ptt {
          flex: 1; padding: 24px; font-size: 18px; font-weight: bold;
          border: none; border-radius: 12px; background: #444; color: #fff;
          cursor: pointer; user-select: none; touch-action: none; transition: background 0.1s;
        }
        .ptt:disabled { opacity: 0.4; cursor: not-allowed; }
        .ptt.active { background: #d32f2f; box-shadow: 0 0 20px rgba(211, 47, 47, 0.8); }
        .ptt.ready { background: #2e7d32; }
        .action-btn {
          flex: 1; padding: 16px; font-size: 15px; font-weight: 600;
          border: none; border-radius: 10px; color: #fff; cursor: pointer;
          user-select: none; transition: opacity 0.15s, transform 0.05s;
        }
        .action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .action-btn:active:not(:disabled) { transform: scale(0.97); }
        .start-btn { background: #1976d2; }
        .door-btn { background: #f57c00; }
        .hangup-btn { background: #c62828; }
      </style>
      <ha-card>
        <div class="container">
          <div class="video-wrap">
            <video id="video" autoplay playsinline></video>
            <div class="overlay" id="status">${T('idle')}</div>
          </div>
          <div class="controls">
            <button class="ptt" id="ptt" disabled>${T('ptt_button')}</button>
            <div class="row">
              <button class="action-btn start-btn" id="start">📞 ${T('pick_up')}</button>
              <button class="action-btn door-btn" id="door" disabled>🔓 ${T('open_door')}</button>
              <button class="action-btn hangup-btn" id="hangup" disabled>📵 ${T('hang_up')}</button>
            </div>
          </div>
        </div>
      </ha-card>
    `;

    const maxHeight = this._config && this._config.video_max_height;
    if (maxHeight) {
      this.style.setProperty('--wibox-video-max-height', maxHeight);
      this.style.setProperty('--wibox-video-object-fit', 'contain');
    } else {
      this.style.removeProperty('--wibox-video-max-height');
      this.style.removeProperty('--wibox-video-object-fit');
    }

    const startBtn = this.shadowRoot.getElementById('start');
    const pttBtn = this.shadowRoot.getElementById('ptt');
    const doorBtn = this.shadowRoot.getElementById('door');
    const hangupBtn = this.shadowRoot.getElementById('hangup');

    // IMPORTANT: `_connect` must reach getUserMedia with no `await` before it,
    // so the browser still sees this click as the activating user gesture.
    startBtn.addEventListener('click', () => this._connect());
    hangupBtn.addEventListener('click', () => this._teardown());
    doorBtn.addEventListener('click', () => this._openDoor());

    const pttDown = (e) => {
      e.preventDefault();
      if (pttBtn.disabled) return;
      if (e.pointerId !== undefined && pttBtn.setPointerCapture) {
        try { pttBtn.setPointerCapture(e.pointerId); } catch (_) {}
      }
      this._setTalking(true);
    };
    const pttUp = (e) => {
      e.preventDefault();
      this._setTalking(false);
    };
    pttBtn.addEventListener('pointerdown', pttDown);
    pttBtn.addEventListener('pointerup', pttUp);
    pttBtn.addEventListener('pointercancel', pttUp);
    pttBtn.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) pttDown(e);
    });
    pttBtn.addEventListener('keyup', (e) => {
      if (e.key === ' ' || e.key === 'Enter') pttUp(e);
    });

    if (!resolveOpenDoorAction(this._config)) {
      doorBtn.style.display = 'none';
    }
  }

  _status(text, isError = false) {
    this._statusIsError = !!isError;
    const el = this.shadowRoot.getElementById('status');
    if (el) {
      el.textContent = text;
      el.classList.toggle('error', !!isError);
    }
    if (isError) console.error(LOG_PREFIX, text);
    else console.log(LOG_PREFIX, text);
  }

  async _openDoor() {
    const T = (key) => t(this._lang, key);
    const action = resolveOpenDoorAction(this._config);
    if (!action || !action.service) { this._status(T('door_not_configured'), true); return; }
    const [domain, service] = action.service.split('.');
    if (!domain || !service) { this._status(T('error_service'), true); return; }
    try {
      const data = {};
      if (action.entity_id) data.entity_id = action.entity_id;
      Object.assign(data, action.data || {});
      await this._hass.callService(domain, service, data);
      this._status(T('door_opened'));
      const doorBtn = this.shadowRoot.getElementById('door');
      const originalBg = doorBtn.style.background;
      doorBtn.style.background = '#2e7d32';
      setTimeout(() => { doorBtn.style.background = originalBg; }, 800);
    } catch (err) {
      this._status(`${T('error_opening')} ${err.message}`, true);
      console.error(LOG_PREFIX, 'openDoor failed:', err);
    }
  }

  // ---------- Connection ----------

  async _connect() {
    const T = (key) => t(this._lang, key);
    if (this._connecting || this._connected) return;
    this._connecting = true;
    // Bumped by _teardown, so a hang-up mid-connect can be told apart from a
    // real failure and does not report itself as an error.
    const session = ++this._sessionSeq;
    this._localCandidates = [];
    this._remoteCandidates = [];
    this._offerSent = false;
    this._micReady = false;
    this._micError = null;
    this._statusIsError = false;

    const startBtn = this.shadowRoot.getElementById('start');
    const hangupBtn = this.shadowRoot.getElementById('hangup');
    const doorBtn = this.shadowRoot.getElementById('door');
    startBtn.disabled = true;
    hangupBtn.disabled = false;
    if (resolveOpenDoorAction(this._config)) doorBtn.disabled = false;

    try {
      // --- Step 1: microphone, FIRST, still inside the click gesture. ---
      // Everything above this line is synchronous on purpose. Do not insert an
      // `await` before this call or mobile browsers will deny the mic.
      this._status(T('requesting_mic'));
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        this._micError = T('error_insecure');
        console.error(LOG_PREFIX, this._micError);
      } else {
        try {
          this._localStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: false,
          });
          this._localStream.getAudioTracks().forEach((track) => (track.enabled = false));
          this._micReady = true;
        } catch (err) {
          // Fall through to listen-only rather than losing video entirely.
          this._micError = `${T('error_no_mic')} ${err.message}`;
          console.warn(LOG_PREFIX, 'getUserMedia failed, falling back to listen-only:', err);
        }
      }

      // --- Step 2: peer connection with the SDP shape go2rtc expects. ---
      this._pc = new RTCPeerConnection({
        iceServers: normalizeIceServers(this._config),
        bundlePolicy: 'max-bundle',
      });

      if (this._micReady) {
        // sendonly mic -> go2rtc -> WiBox ONVIF backchannel (trackID=2, PCMA)
        this._pc.addTransceiver(this._localStream.getAudioTracks()[0], {
          direction: 'sendonly',
          streams: [this._localStream],
        });
      }
      this._pc.addTransceiver('video', { direction: 'recvonly' });
      this._pc.addTransceiver('audio', { direction: 'recvonly' });

      const remoteStream = new MediaStream();
      this._pc.ontrack = (ev) => {
        console.log(LOG_PREFIX, 'Track received:', ev.track.kind);
        remoteStream.addTrack(ev.track);
        const video = this.shadowRoot.getElementById('video');
        if (video.srcObject !== remoteStream) video.srcObject = remoteStream;
        video.play().catch((err) => console.warn(LOG_PREFIX, 'video.play():', err));
      };

      this._pc.onconnectionstatechange = () => {
        if (!this._pc) return;
        const state = this._pc.connectionState;
        if (state === 'connected') {
          this._onConnected();
        } else if (state === 'failed' || state === 'closed') {
          this._status(`${T('pc_state')} ${state}`, true);
          this._teardown();
        } else {
          // 'disconnected' can be a transient 5G/WiFi handover; WebRTC promotes
          // it to 'failed' on its own if it does not recover. Do not hang up.
          this._status(`${T('pc_state')} ${state}`, state === 'disconnected');
        }
      };

      this._pc.onicecandidate = (ev) => {
        // go2rtc wants the raw candidate string, and '' as end-of-candidates.
        const value = ev.candidate ? ev.candidate.candidate : '';
        this._sendSignal({ type: 'webrtc/candidate', value });
      };

      const offer = await this._pc.createOffer();
      await this._pc.setLocalDescription(offer);

      // --- Step 3: signed WebSocket to HA, proxied to go2rtc. ---
      this._status(T('signing'));
      const wsURL = await this._buildWsUrl();

      this._status(T('ws_connecting'));
      await this._openWebSocket(wsURL);

      this._status(T('sending_offer'));
      this._sendSignal({ type: 'webrtc/offer', value: this._pc.localDescription.sdp });
      // ICE gathering starts at setLocalDescription, i.e. before the socket was
      // open, so replay whatever was queued - but only after the offer, since
      // go2rtc drops candidates that arrive before it.
      this._flushLocalCandidates();
      this._status(T('negotiating'));

      // Closing this socket tears the WebRTC session down on the go2rtc side,
      // so it has to stay open for the whole call. go2rtc ignores message types
      // it has no handler for, so this is purely to keep an idle reverse proxy
      // from timing the socket out mid-conversation.
      this._keepAliveTimer = setInterval(() => {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
          this._ws.send(JSON.stringify({ type: 'keepalive' }));
        }
      }, 30000);

      this._connectTimer = setTimeout(() => {
        if (!this._connected) {
          this._status(T('error_timeout'), true);
          this._teardown();
        }
      }, CONNECT_TIMEOUT_MS);
    } catch (err) {
      console.error(LOG_PREFIX, 'connect failed:', err);
      if (session === this._sessionSeq) {
        this._status(`${T('error_prefix')} ${err.message}`, true);
        this._teardown();
      }
    } finally {
      this._connecting = false;
    }
  }

  /**
   * Build `wss://<ha>/api/webrtc/ws?authSig=...&url=wibox`.
   * The signature comes from HA's `auth/sign_path`; the AlexxIT/WebRTC
   * integration validates it and proxies the socket to go2rtc's /api/ws.
   */
  async _buildWsUrl() {
    const data = await this._hass.callWS({ type: 'auth/sign_path', path: WS_PATH });
    const httpURL = this._hass.hassUrl
      ? this._hass.hassUrl(data.path)
      : new URL(data.path, location.origin).href;
    let wsURL = 'ws' + httpURL.substring(4); // http->ws, https->wss

    // go2rtc resolves `src` either as a stream name from go2rtc.yaml or as a
    // source it can open on the fly, so both options take the same parameter.
    const src = this._config.stream || this._config.url;
    if (src) {
      wsURL += '&url=' + encodeURIComponent(src);
    } else {
      wsURL += '&entity=' + encodeURIComponent(this._config.entity);
    }
    if (this._config.server) {
      wsURL += '&server=' + encodeURIComponent(this._config.server);
    }
    return wsURL;
  }

  _openWebSocket(wsURL) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsURL);
      this._ws = ws;
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error(t(this._lang, 'error_ws'))));
      ws.addEventListener('close', () => {
        if (this._connected) return;
        // Reject even if this is no longer the current socket: a teardown
        // during connect must not leave _connect awaiting forever.
        reject(new Error(t(this._lang, 'error_ws')));
      });
      ws.addEventListener('message', (ev) => this._onSignalMessage(ev));
    });
  }

  _sendSignal(msg) {
    if (this._offerSent && this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(msg));
      return;
    }
    if (msg.type === 'webrtc/candidate') {
      // Gathered before the offer went out; flushed by _flushLocalCandidates.
      this._localCandidates.push(msg);
    } else if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._offerSent = true;
      this._ws.send(JSON.stringify(msg));
    }
  }

  _flushLocalCandidates() {
    while (this._localCandidates.length) {
      const msg = this._localCandidates.shift();
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify(msg));
      }
    }
  }

  async _onSignalMessage(ev) {
    const T = (key) => t(this._lang, key);
    if (typeof ev.data !== 'string') return;

    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    console.log(LOG_PREFIX, 'signal:', msg);
    if (!this._pc) return; // late message after teardown

    if (msg.type === 'webrtc/answer') {
      this._status(T('answer_received'));
      try {
        await this._pc.setRemoteDescription({ type: 'answer', sdp: msg.value });
        // Flush candidates that arrived before the remote description.
        while (this._remoteCandidates.length) {
          await this._addRemoteCandidate(this._remoteCandidates.shift());
        }
      } catch (err) {
        this._status(`${T('error_answer')} ${err.message}`, true);
        console.error(LOG_PREFIX, 'setRemoteDescription failed:', err);
      }
    } else if (msg.type === 'webrtc/candidate') {
      if (!msg.value) return;
      if (!this._pc || !this._pc.remoteDescription) {
        this._remoteCandidates.push(msg.value);
      } else {
        await this._addRemoteCandidate(msg.value);
      }
    } else if (msg.type === 'error') {
      const detail = String(msg.value || msg.message || '');
      const hint = detail.includes('stream not found') ? ` — ${T('hint_stream_not_found')}` : '';
      this._status(`${T('error_ha')} ${detail}${hint}`, true);
    }
  }

  async _addRemoteCandidate(value) {
    try {
      await this._pc.addIceCandidate({ candidate: value, sdpMid: '0' });
    } catch (err) {
      console.warn(LOG_PREFIX, 'addIceCandidate failed:', err);
    }
  }

  _onConnected() {
    const T = (key) => t(this._lang, key);
    if (this._connected) return;
    this._connected = true;
    clearTimeout(this._connectTimer);
    this._connectTimer = null;

    const pttBtn = this.shadowRoot.getElementById('ptt');
    if (this._micReady) {
      pttBtn.disabled = false;
      pttBtn.classList.add('ready');
      this._status(T('connected'));
    } else {
      pttBtn.disabled = true;
      this._status(this._micError || `${T('connected')} - ${T('listen_only')}`, true);
    }

    const video = this.shadowRoot.getElementById('video');
    if (video) video.play().catch(() => {});
  }

  // ---------- Push to talk ----------

  _setTalking(talking) {
    const T = (key) => t(this._lang, key);
    if (!this._localStream || !this._connected || !this._micReady) return;
    if (this._talking === talking) return;
    this._talking = talking;

    this._localStream.getAudioTracks().forEach((track) => (track.enabled = talking));

    const pttBtn = this.shadowRoot.getElementById('ptt');
    if (pttBtn) {
      pttBtn.classList.toggle('active', talking);
      pttBtn.textContent = talking ? T('ptt_talking') : T('ptt_button');
    }

    // Half-duplex: mute the WiBox audio while talking so the phone speaker
    // does not feed back into the phone mic.
    if (this._config.mute_while_talking) {
      const video = this.shadowRoot.getElementById('video');
      if (video) video.muted = talking;
    }

    console.log(LOG_PREFIX, 'Mic:', talking ? 'ON' : 'OFF');
  }

  // ---------- Teardown ----------

  _teardown() {
    const T = (key) => t(this._lang, key);
    // pc.close() fires onconnectionstatechange synchronously, which calls back
    // in here; without this guard the teardown re-enters itself.
    if (this._tearingDown) return;
    this._tearingDown = true;
    this._sessionSeq++;
    const wasConnected = this._connected;
    this._connected = false;
    this._talking = false;
    this._micReady = false;

    clearTimeout(this._connectTimer);
    this._connectTimer = null;
    clearInterval(this._keepAliveTimer);
    this._keepAliveTimer = null;

    const video = this.shadowRoot.getElementById('video');
    if (video) {
      if (video.srcObject) {
        video.srcObject.getTracks().forEach((track) => track.stop());
        video.srcObject = null;
      }
      video.muted = false;
    }
    if (this._ws) {
      const ws = this._ws;
      this._ws = null;
      try { ws.close(); } catch (_) {}
    }
    if (this._pc) { try { this._pc.close(); } catch (_) {} this._pc = null; }
    if (this._localStream) {
      this._localStream.getTracks().forEach((track) => track.stop());
      this._localStream = null;
    }
    this._localCandidates = [];
    this._remoteCandidates = [];
    this._offerSent = false;

    const pttBtn = this.shadowRoot.getElementById('ptt');
    if (pttBtn) {
      pttBtn.disabled = true;
      pttBtn.classList.remove('ready', 'active');
      pttBtn.textContent = T('ptt_button');
    }
    const startBtn = this.shadowRoot.getElementById('start');
    if (startBtn) startBtn.disabled = false;
    const hangupBtn = this.shadowRoot.getElementById('hangup');
    if (hangupBtn) hangupBtn.disabled = true;
    const doorBtn = this.shadowRoot.getElementById('door');
    if (doorBtn) doorBtn.disabled = true;

    // Keep whatever error put us here on screen; it is the only diagnostic
    // the user gets on a phone with no console.
    if (!this._statusIsError) {
      this._status(wasConnected ? T('hung_up') : T('disconnected'));
    }
    this._tearingDown = false;
  }

  disconnectedCallback() {
    this._teardown();
  }
}

// ---------- Visual Editor ----------

class WiboxIntercomVideoCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._showAdvanced = false;
    this._isConnected = false;
    this._lang = 'en';
  }

  connectedCallback() {
    this._isConnected = true;
    this._renderIfReady();
  }

  setConfig(config) {
    this._config = config || {};
    if (this._config.open_door_action) this._showAdvanced = true;
    this._refreshLang();
    this._renderIfReady();
  }

  set hass(hass) {
    const firstHass = !this._hass;
    this._hass = hass;
    this._refreshLang();
    if (firstHass) {
      this._renderIfReady();
    } else {
      this.querySelectorAll('ha-entity-picker, ha-textfield').forEach((el) => {
        el.hass = hass;
      });
    }
  }

  _refreshLang() {
    this._lang = detectLanguage(this._hass, this._config.language);
  }

  async _renderIfReady() {
    if (!this._isConnected || !this._hass) return;
    await loadHaComponents();
    this._render();
  }

  _emitChange() {
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    }));
  }

  _setConfigValue(key, value) {
    if (value === '' || value == null) {
      const { [key]: _, ...rest } = this._config;
      this._config = rest;
    } else {
      this._config = { ...this._config, [key]: value };
    }
    this._refreshLang();
    this._emitChange();
  }

  _setActionValue(field, value) {
    const current = { ...(this._config.open_door_action || {}) };
    if (value === '' || value == null) delete current[field];
    else current[field] = value;
    if (Object.keys(current).length === 0) {
      const { open_door_action: _, ...rest } = this._config;
      this._config = rest;
    } else {
      this._config = { ...this._config, open_door_action: current };
    }
    this._emitChange();
  }

  _toggleAdvanced() {
    this._showAdvanced = !this._showAdvanced;
    if (this._showAdvanced && this._config.open_door_entity && !this._config.open_door_action) {
      const action = resolveOpenDoorAction(this._config);
      const { open_door_entity: _, ...rest } = this._config;
      this._config = { ...rest, open_door_action: action };
      this._emitChange();
    }
    this._render();
  }

  _makeHelpText(text) {
    const div = document.createElement('div');
    div.style.cssText = 'font-size:12px; color:var(--secondary-text-color); margin-top:4px;';
    div.textContent = text;
    return div;
  }

  _makeEntityPicker({ value, label, domains, onChange }) {
    const picker = document.createElement('ha-entity-picker');
    picker.hass = this._hass;
    picker.label = label;
    picker.value = value || '';
    if (domains) picker.includeDomains = domains;
    picker.allowCustomEntity = true;
    picker.addEventListener('value-changed', (e) => { onChange(e.detail.value); });
    return picker;
  }

  _makeTextField({ value, label, onInput }) {
    const field = document.createElement('ha-textfield');
    field.label = label;
    field.value = value || '';
    field.style.width = '100%';
    field.addEventListener('input', (e) => { onInput(e.target.value); });
    return field;
  }

  _makeSwitchRow({ value, label, onChange }) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:12px;';
    const text = document.createElement('span');
    text.style.cssText = 'font-size:14px; color:var(--primary-text-color);';
    text.textContent = label;
    const toggle = document.createElement('ha-switch');
    toggle.checked = value !== false;
    toggle.addEventListener('change', (e) => onChange(e.target.checked));
    row.appendChild(text);
    row.appendChild(toggle);
    return row;
  }

  _makeLanguageSelect({ value, label, onChange }) {
    const wrapper = document.createElement('div');
    const select = document.createElement('ha-select');
    select.label = label;
    select.value = value || '';
    select.style.width = '100%';
    select.addEventListener('selected', (e) => { onChange(e.target.value); });
    select.addEventListener('closed', (e) => e.stopPropagation());

    Object.entries(LANGUAGE_NAMES).forEach(([code, name]) => {
      const item = document.createElement('mwc-list-item');
      item.value = code;
      item.textContent = name;
      select.appendChild(item);
    });

    wrapper.appendChild(select);
    return wrapper;
  }

  _render() {
    const T = (key) => t(this._lang, key);
    while (this.firstChild) this.removeChild(this.firstChild);

    const c = this._config;
    const adv = this._showAdvanced;
    const action = c.open_door_action || {};

    const container = document.createElement('div');
    container.style.cssText = 'display:flex; flex-direction:column; gap:16px; padding:8px 0;';

    // go2rtc stream name
    const streamField = document.createElement('div');
    streamField.appendChild(this._makeTextField({
      value: c.stream,
      label: T('editor_stream_label'),
      onInput: (v) => this._setConfigValue('stream', v),
    }));
    streamField.appendChild(this._makeHelpText(T('editor_stream_help')));
    container.appendChild(streamField);

    // Camera entity fallback
    const entityField = document.createElement('div');
    entityField.appendChild(this._makeEntityPicker({
      value: c.entity,
      label: T('editor_entity_label'),
      domains: ['camera'],
      onChange: (v) => this._setConfigValue('entity', v),
    }));
    entityField.appendChild(this._makeHelpText(T('editor_entity_help')));
    container.appendChild(entityField);

    if (!adv) {
      const doorField = document.createElement('div');
      doorField.appendChild(this._makeEntityPicker({
        value: c.open_door_entity,
        label: T('editor_door_label'),
        domains: ['button', 'input_button', 'lock', 'switch', 'script', 'scene'],
        onChange: (v) => this._setConfigValue('open_door_entity', v),
      }));
      doorField.appendChild(this._makeHelpText(T('editor_door_help')));
      container.appendChild(doorField);
    }

    // Half-duplex switch
    const muteField = document.createElement('div');
    muteField.appendChild(this._makeSwitchRow({
      value: c.mute_while_talking,
      label: T('editor_mute_label'),
      onChange: (v) => this._setConfigValue('mute_while_talking', v),
    }));
    muteField.appendChild(this._makeHelpText(T('editor_mute_help')));
    container.appendChild(muteField);

    // Language selector
    const langField = document.createElement('div');
    langField.appendChild(this._makeLanguageSelect({
      value: c.language || '',
      label: T('editor_language_label'),
      onChange: (v) => this._setConfigValue('language', v),
    }));
    langField.appendChild(this._makeHelpText(T('editor_language_help')));
    container.appendChild(langField);

    // Advanced toggle
    const toggle = document.createElement('div');
    toggle.style.cssText = 'display:flex; align-items:center; gap:8px; cursor:pointer; user-select:none; padding:8px 0; color:var(--primary-text-color); font-size:14px;';
    const chevron = document.createElement('span');
    chevron.style.cssText = `display:inline-block; transition:transform 0.2s; transform:${adv ? 'rotate(90deg)' : 'rotate(0deg)'};`;
    chevron.textContent = '▶';
    const tlabel = document.createElement('span');
    tlabel.textContent = T('editor_advanced_toggle');
    toggle.appendChild(chevron);
    toggle.appendChild(tlabel);
    toggle.addEventListener('click', () => this._toggleAdvanced());
    container.appendChild(toggle);

    if (adv) {
      const advBox = document.createElement('div');
      advBox.style.cssText = 'padding:12px; border:1px solid var(--divider-color, #ccc); border-radius:8px; display:flex; flex-direction:column; gap:12px;';
      const hint = document.createElement('div');
      hint.style.cssText = 'font-size:12px; color:var(--secondary-text-color); font-style:italic;';
      hint.textContent = T('editor_advanced_help');
      advBox.appendChild(hint);
      advBox.appendChild(this._makeTextField({
        value: action.service,
        label: T('editor_service_label'),
        onInput: (v) => this._setActionValue('service', v),
      }));
      const entityWrap = document.createElement('div');
      entityWrap.appendChild(this._makeEntityPicker({
        value: action.entity_id,
        label: T('editor_action_entity_label'),
        domains: null,
        onChange: (v) => this._setActionValue('entity_id', v),
      }));
      entityWrap.appendChild(this._makeHelpText(T('editor_action_entity_help')));
      advBox.appendChild(entityWrap);
      container.appendChild(advBox);
    }

    this.appendChild(container);
  }
}

// ---------- Registration ----------

customElements.define(CARD_TAG, WiboxIntercomVideoCard);
customElements.define(EDITOR_TAG, WiboxIntercomVideoCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TAG,
  name: 'WiBox Intercom Video Card',
  description: 'Two-way audio + video card for a WiBox intercom via go2rtc',
  preview: false,
  documentationURL: 'https://github.com/cmos486/wibox-intercom-video-card',
});

console.log(
  `%c WIBOX-INTERCOM-VIDEO-CARD %c v${CARD_VERSION} `,
  'color: white; background: #1976d2; font-weight: 700;',
  'color: #1976d2; background: white; font-weight: 700;'
);
