# 📹 WiBox Intercom Video Card

[![hacs][hacs-badge]][hacs-url]
[![release][release-badge]][release-url]
[![license][license-badge]][license-url]

Custom Lovelace card with **two-way audio + video** for a Fermax WiBox intercom served through [go2rtc](https://github.com/AlexxIT/go2rtc) — and, unlike the existing cards, 📱 **the microphone works in the Home Assistant mobile app**.

```yaml
type: custom:wibox-intercom-video-card
stream: wibox
open_door_entity: button.wifi_intercom_entrada_open_door
```

> [!IMPORTANT]
> This card is the frontend half of a pair. The talkback path also needs the WiBox firmware from [**cmos486/wibox-media**](https://github.com/cmos486/wibox-media) — a fork of [segator/wibox-media](https://github.com/segator/wibox-media) that fixes the ONVIF backchannel so it **accepts WebRTC audio**: it parses the RTP header extension browsers add, and reframes the incoming stream into the 160-sample blocks the audio output expects. Without that firmware the card connects, the video plays, and your voice quietly goes nowhere.

---

## ✨ Features

- 📹 Live video + audio over WebRTC, straight from your named `go2rtc.yaml` stream
- 🎤 Two-way audio with push-to-talk, into the WiBox ONVIF backchannel
- 📱 Microphone acquired inside the button's user gesture, so mobile browsers allow it
- 🔒 Signalling proxied through Home Assistant — the go2rtc API (1984) is never exposed
- 🌍 Works remotely over your existing HTTPS reverse proxy, no extra ports
- 🔓 Open door button (`button.press`, `lock.unlock` or any custom service)
- 🔇 Half-duplex mode: mutes incoming audio while you talk, killing speaker echo
- 🛠 Visual editor
- 🗣 Multi-language UI (Spanish, English, Catalan) with auto-detection

## 🤔 Why this card exists

`custom:webrtc-camera` does two-way audio on a desktop but not on a phone. The reason is in [`video-rtc.js`](https://github.com/AlexxIT/WebRTC/blob/master/custom_components/webrtc/www/video-rtc.js):

```js
async createOffer(pc) {
    if (this.media.includes('microphone')) {
        const media = await navigator.mediaDevices.getUserMedia({audio: true});
```

`createOffer()` runs from the WebSocket `message` handler — several `await`s and a network round-trip after whatever the user tapped. Mobile browsers only grant the microphone to code running inside a **user gesture**, so by then the request is denied. (There is no push-to-talk button either; that is an open feature request.)

This card fixes exactly that: 👉 **`getUserMedia` is the first thing the "Pick up" click handler does**, with no `await` before it.

The Advanced Camera Card is not an option here either — it wants to reach the go2rtc API directly, and go2rtc listens on `127.0.0.1:1984`.

## 🔧 How it works

```
  📱 phone (HA app, HTTPS)
      │  1. auth/sign_path  ─────────────►  HA WebSocket API
      │  2. wss://ha/api/webrtc/ws?authSig=…&url=wibox
      │         └─► AlexxIT/WebRTC proxies it ─► go2rtc /api/ws?src=wibox
      │  3. webrtc/offer  ⇄  webrtc/answer  ⇄  webrtc/candidate
      │
      └─ 4. media, direct ─────────────►  go2rtc :8555 (public candidate via STUN)
                                              │
                                     RTSP ────┴──── rtsp://wibox:8554/live
                                     backchannel trackID=2 (sendonly PCMA) ─► 🔊 WiBox speaker
```

**🔐 Signalling goes through Home Assistant**, using the WebSocket proxy that the [AlexxIT/WebRTC](https://github.com/AlexxIT/WebRTC) integration registers at `/api/webrtc/ws`. That endpoint is authorised with HA's `auth/sign_path` and forwards the socket verbatim to go2rtc. Consequences:

- The go2rtc API on port 1984 stays on localhost. Nothing new is exposed.
- Everything rides your existing HTTPS reverse proxy on 443, so it works remotely.
- `stream: wibox` is passed to go2rtc as `src=wibox`, so **your own named stream from `go2rtc.yaml` is used as-is** — which is what keeps the RTSP producer and its ONVIF backchannel alive.

**📡 Media does not go through HA.** The browser connects straight to go2rtc's WebRTC port (8555), using the public candidate go2rtc discovers via STUN. That port must be forwarded.

### ❌ Why not HA's native `camera/webrtc/offer`?

Home Assistant 2024.11+ has built-in WebRTC signalling over the HA WebSocket, which would be the tidier channel. It does not work for talkback here. In [`homeassistant/components/go2rtc/__init__.py`](https://github.com/home-assistant/core/blob/dev/homeassistant/components/go2rtc/__init__.py), the provider ignores your `wibox` stream and registers its own from `camera.stream_source()`; for a `generic` camera it prefixes it with `ffmpeg:`, and an ffmpeg producer has no ONVIF backchannel. The audio would reach go2rtc and stop there.

### ⏱ Why push-to-talk does not call `getUserMedia`

go2rtc cannot renegotiate a session over its WebSocket, so the microphone track has to be present in the **initial offer**. Acquiring it on the first PTT press would mean tearing down and rebuilding the whole session. So "Pick up" is the gesture that unlocks the mic, and push-to-talk only gates the track with `track.enabled` — the same design as [ring-intercom-video-card](https://github.com/cmos486/ring-intercom-video-card).

### 🧩 The SDP shape

```js
pc.addTransceiver(micTrack, {direction: 'sendonly'});   // → WiBox backchannel trackID=2
pc.addTransceiver('video',  {direction: 'recvonly'});   // ← WiBox camera
pc.addTransceiver('audio',  {direction: 'recvonly'});   // ← WiBox microphone
```

Three m-lines, matching what `custom:webrtc-camera` produces with `media: video,audio,microphone` — the shape already proven against go2rtc and this firmware. go2rtc transcodes the browser's Opus to the PCMA 8 kHz the backchannel expects.

## 📋 Requirements

| | |
|---|---|
| 🔌 **[cmos486/wibox-media](https://github.com/cmos486/wibox-media)** | The WiBox firmware fork with the backchannel fix. Required for talkback — stock firmware will not accept the WebRTC audio. |
| 🧱 **[AlexxIT/WebRTC](https://github.com/AlexxIT/WebRTC)** | Installed and configured. This card signals through its `/api/webrtc/ws` proxy. |
| 🎬 **go2rtc** | With a named stream for the WiBox, and `8555` UDP+TCP reachable from outside. |
| 🔒 **HTTPS** | Mandatory. `getUserMedia` requires a secure context — see [Troubleshooting](#-the-microphone-is-blocked-on-the-phone). |
| 🏠 **Home Assistant** | 2024.4.0 or newer. |

### ⚙️ go2rtc configuration

```yaml
# /config/go2rtc.yaml
streams:
  wibox: rtsp://video:<password>@<wibox-ip>:8554/live

webrtc:
  listen: ":8555"
  candidates:
    - stun:8555          # discovers the public IP for remote clients

api:
  listen: 127.0.0.1:1984 # stays on localhost; HA proxies the signalling
```

Forward **8555 UDP and TCP** on your router to the Home Assistant host. This is the only port that needs forwarding; do not expose 1984.

## 📥 Installation

### HACS (custom repository)

1. HACS → Frontend → ⋮ → Custom repositories
2. Add `https://github.com/cmos486/wibox-intercom-video-card`, category **Lovelace**
3. Install, then reload the browser.

### Manual

1. Copy `wibox-intercom-video-card.js` into `/config/www/`
2. Settings → Dashboards → ⋮ → Resources → Add resource
   - URL: `/local/wibox-intercom-video-card.js`
   - Type: JavaScript Module

## 🎛 Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `stream` | string | — | go2rtc stream name from `go2rtc.yaml`. **Recommended** — this is the path that keeps the ONVIF backchannel. |
| `url` | string | — | Any source go2rtc can open, e.g. `rtsp://user:pass@host:8554/live`. go2rtc creates the stream on the fly, backchannel included. Use this if `stream` reports `stream not found`. |
| `entity` | string | — | Camera entity. go2rtc receives the entity's RTSP URL. |
| `server` | string | — | Override the go2rtc URL used by the proxy. Rarely needed. |
| `open_door_entity` | string | — | Shows the "Open door" button. The service is derived from the domain: `button`/`input_button` → `press`, `lock` → `unlock`, `switch`/`script`/`scene` → `turn_on`. |
| `open_door_action` | object | — | Full control instead of `open_door_entity`: `service`, `entity_id`, `data`. |
| `mute_while_talking` | bool | `true` | Half-duplex. Mutes the WiBox audio while you hold the talk button, so the phone speaker cannot feed back into the phone mic. |
| `ice_servers` | list | `['stun:stun.cloudflare.com:3478']` | STUN servers for the browser side. No TURN needed. Set to `[]` to disable. |
| `video_max_height` | string | — | Caps the video height, e.g. `300px`. Useful on small screens. |
| `language` | string | auto | `es`, `en` or `ca`. Defaults to the Home Assistant language. |

One of `stream`, `url` or `entity` is required. `stream` and `url` are the same go2rtc parameter — go2rtc resolves it as a stream name if it matches one, and otherwise tries to open it as a source.

### 📝 Examples

Minimal:

```yaml
type: custom:wibox-intercom-video-card
stream: wibox
```

Full:

```yaml
type: custom:wibox-intercom-video-card
stream: wibox
open_door_entity: button.wifi_intercom_entrada_open_door
mute_while_talking: true
video_max_height: 300px
language: es
```

Custom open-door action:

```yaml
type: custom:wibox-intercom-video-card
stream: wibox
open_door_action:
  service: script.turn_on
  entity_id: script.open_the_gate
  data:
    variables:
      duration: 5
```

## 🕹 Usage

1. **📞 Pick up** — asks for the microphone (first time only), then connects. Video and WiBox audio start.
2. **🎤 PUSH TO TALK** — hold to transmit, release to stop. Enabled once the connection is up.
3. **🔓 Open door** — fires the configured service.
4. **📵 Hang up** — closes the session and releases the microphone.

The status line over the video shows each step, and stays red with the error if something fails — the only diagnostic you get on a phone with no console.

## ✅ Verifying that audio reaches the WiBox

On the WiBox:

```bash
grep "backchannel audio pkt" /var/log/wibox-media-daemon.log
```

You should see packets with a non-zero `audio_len` while the talk button is held, and **no** `send AO frame failed` errors.

Test in this order: 💻 desktop on WiFi → 📱 tablet on WiFi → 📶 phone on mobile data.

## 🩺 Troubleshooting

### 🎤 The microphone is blocked on the phone

`getUserMedia` only works in a **secure context**. `https://` is one; `http://192.168.x.x:8123` is not (only `localhost` is exempt). So if the companion app reaches Home Assistant through an `internal_url` of `http://<ip>:8123` on WiFi, the microphone is denied no matter how the card is written.

The card detects this and shows it in red instead of failing silently, then continues in listen-only mode so you still get video.

**Fix:** in the companion app settings, make the internal URL your HTTPS proxy URL (or clear it so the external one is always used). To confirm the diagnosis quickly, turn WiFi off and try on mobile data — that already goes through 443. If it works on mobile data and not on WiFi, this is it.

Also check that the companion app itself holds the microphone permission — if [Assist](https://www.home-assistant.io/voice_control/) can use the mic, it does.

### 🔍 "webrtc/offer: stream not found"

Signalling is working — this is go2rtc replying that the name you asked for is not one of its streams. Either the name does not match `go2rtc.yaml`, or the go2rtc instance answering is not the one holding that config. That second case is easy to hit: the go2rtc add-on and a go2rtc that the AlexxIT integration downloaded and started itself are two different processes with two different configs, and `api: listen: 127.0.0.1:1984` only accepts connections from inside its own container.

You do not have to work out which. Drop the stream name and point the card at the camera entity instead:

```yaml
type: custom:wibox-intercom-video-card
entity: camera.wifi_intercom_camara_entrada
```

The integration resolves the RTSP URL from the entity and hands that to go2rtc as the source, so no named stream is involved. The ONVIF backchannel comes with it, because go2rtc negotiates it from the RTSP producer — talkback works exactly the same. `url: rtsp://user:pass@host:8554/live` does the same thing if you would rather name the source yourself.

> [!WARNING]
> `stream`, `url` and `entity` are the same go2rtc parameter, and a named source wins over `entity`. Setting both leaves `entity` silently ignored, which looks like the entity being broken. The card logs a warning to the browser console when it spots this.

### 🔇 Video works but nothing reaches the WiBox

- Make sure the WiBox runs the [cmos486/wibox-media](https://github.com/cmos486/wibox-media) firmware. Stock firmware drops the WebRTC audio.
- Confirm the stream name in the card matches `go2rtc.yaml`, and that go2rtc's own web UI shows the backchannel track on that stream.
- If you set `entity` instead of `stream`, switch to `stream`. The entity path hands go2rtc a bare RTSP URL and the backchannel may not survive.
- Check the WiBox log as above.

### ⏳ It stays on "Negotiating ICE…" and then times out

The media path is failing, not the signalling. Check that **8555 UDP+TCP** is forwarded to the HA host and that go2rtc's `candidates: [stun:8555]` is resolving your public IP (go2rtc logs it at startup).

### 🔌 "Channel closed by HA/go2rtc"

The signalling proxy rejected the socket. Check that the AlexxIT/WebRTC integration is installed and loaded, and look at the Home Assistant log for `custom_components.webrtc`.

### 📞 The call drops after about a minute

Closing the signalling WebSocket tears the session down on the go2rtc side, so the card holds it open for the whole call and pings it every 30 s. If calls still die on a fixed interval, raise the idle read timeout on your reverse proxy (`proxy_read_timeout` on nginx).

### 🔊 Echo

Leave `mute_while_talking: true`. The browser's echo cancellation only handles the local loop; half-duplex handles the rest.

## 🧪 Development

```bash
node tests/run.js
```

No dependencies. Beyond the config helpers, the suite statically asserts the three properties the card would otherwise fail silently on: that `getUserMedia` is reachable with no `await` in front of it, that the offer keeps its sendonly/recvonly/recvonly shape, and that nothing ever addresses the go2rtc API directly.

## 🙏 Credits

- [cmos486/wibox-media](https://github.com/cmos486/wibox-media) — the WiBox firmware fork this card talks to, forked from [segator/wibox-media](https://github.com/segator/wibox-media).
- [AlexxIT/WebRTC](https://github.com/AlexxIT/WebRTC) and [go2rtc](https://github.com/AlexxIT/go2rtc) — the signalling proxy and streaming engine this card is built on.
- [ring-intercom-video-card](https://github.com/cmos486/ring-intercom-video-card) — the card this one is modelled on.

## 📄 License

Apache-2.0

[hacs-badge]: https://img.shields.io/badge/HACS-Custom-41BDF5.svg
[hacs-url]: https://github.com/hacs/integration
[release-badge]: https://img.shields.io/github/v/release/cmos486/wibox-intercom-video-card
[release-url]: https://github.com/cmos486/wibox-intercom-video-card/releases
[license-badge]: https://img.shields.io/badge/license-Apache--2.0-blue.svg
[license-url]: ./LICENSE
