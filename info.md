# 📹 WiBox Intercom Video Card

Custom Lovelace card with **two-way audio + video** for a Fermax WiBox intercom served by go2rtc — and it works in the 📱 **Home Assistant mobile app**, where other cards fail to get the microphone.

## ✨ Features

- 📹 Live video + audio over WebRTC, straight from your named `go2rtc.yaml` stream
- 🎤 Two-way audio with push-to-talk, into the WiBox ONVIF backchannel
- 📱 Microphone acquired inside the button's user gesture, so mobile browsers allow it
- 🔒 Signalling proxied through Home Assistant — the go2rtc API (1984) is never exposed
- 🌍 Works remotely over your existing HTTPS reverse proxy, no extra ports
- 🔓 Open door button (`button.press`, `lock.unlock` or any custom service)
- 🔊 Full duplex: you keep hearing the door while you talk, with optional half-duplex if you get feedback
- 🛠 Visual editor
- 🗣 Multi-language UI (Spanish, English, Catalan) with auto-detection

## 📋 Requirements

- 🔌 The [cmos486/wibox-media](https://github.com/cmos486/wibox-media) firmware on the WiBox — the fork of [segator/wibox-media](https://github.com/segator/wibox-media) whose ONVIF backchannel accepts WebRTC audio. **Talkback does not work without it.**
- 🧱 The [AlexxIT/WebRTC](https://github.com/AlexxIT/WebRTC) integration installed (it provides the `/api/webrtc/ws` proxy this card signals through)
- 🎬 A go2rtc stream pointing at your WiBox RTSP URL, with the ONVIF backchannel intact
- 🔒 **HTTPS access to Home Assistant** — browsers refuse microphone access over plain `http://`

See the README for the full setup, port forwarding notes and troubleshooting.
