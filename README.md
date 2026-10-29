# Neon Vault City

Explore your Obsidian vault as a holographic 3D cyberpunk city. Every note is a building, taller buildings have more links, and folders (or tags) become districts. Capri, your holographic guide, chats, finds notes, answers questions from them and flies you around.

## Install
1. Create a `neon-vault-city` folder in your vault's `.obsidian/plugins/` folder and put `main.js`, `manifest.json` and `styles.css` in it (from this repository or its latest release).
2. In Obsidian: Settings → Community plugins → turn off Restricted mode if needed → click the refresh icon → turn on **Neon Vault City**.
3. Click the building icon in the left ribbon, or run **Neon Vault City: Open city** from the command palette (Ctrl+P).

## Getting around
| Input | Does |
|---|---|
| Drag | Slide the city like a map |
| Right-drag / Q, E | Turn the city |
| Scroll | Zoom |
| WASD | Move |
| Click / double-click | Select a building / open its note |
| F | Fly mode (Space up, C down) |
| G | Scan: orphan notes red, recently edited green |
| V | Skyline tour |
| X | Random note |
| P | Save a snapshot to `City Snapshots/` |
| O | Quick settings |
| H | Hide the HUD |
| Esc | Back |

Spinning diamonds are **data shards** over older notes. Click one to collect it and rediscover the note.

## Capri
- Works offline with no setup: say "heyy", "help", "find <words>", "what is <topic>", "take me to <note>", "open <note>", "scan", "tour" or "surprise me".
- Optional extras in Settings → Neon Vault City:
  - **Claude API key** for full AI conversation (billed to your key).
  - **Voice**: Windows voices (default), a Fish Audio voice (your own API key and voice ID), or Kokoro, a free voice that runs on your PC through a small local server.
- To change her look, put a square PNG with a transparent background named `avatar.png` (standing) and, optionally, `avatar-perch.png` (crouching) in this folder.

## Settings
Theme, rain, flying cars, billboards, glitch effects, district grouping (top folders, every folder or first tag), the filler skyline, labels, sounds and Capri's voice and personality are all in the in-city **⚙ SETTINGS** panel or under Settings → Neon Vault City.

API keys you enter are saved in `.obsidian/plugins/neon-vault-city/data.json`. Don't share that file.

## Privacy and network use
Out of the box, Neon Vault City works fully offline: it reads your notes locally and sends nothing anywhere. There is no telemetry. Network use only happens when you turn on these optional features yourself:

| Feature | What it does | Account or key |
|---|---|---|
| Claude API (Capri's full AI chat) | Sends your chat messages, and the text of notes Capri reads to answer you, to Anthropic's API at `api.anthropic.com` | Your own Claude API key; usage is billed to it |
| Fish Audio voice | Sends the text of Capri's replies to `api.fish.audio` to turn it into speech | Your own Fish Audio API key |
| Kokoro voice | Sends Capri's replies to a voice server running on your own computer (`127.0.0.1`). With auto-start on, the plugin launches that server using the Python and script paths you enter in settings, which are outside your vault | None; Kokoro is installed separately |

Files the plugin writes inside your vault:
- `City Snapshots/` when you take a photo (P)
- new notes, or text added to the end of existing notes, only when you ask Capri to add something while the Claude API is on

The plugin is desktop only, because starting the Kokoro voice server needs desktop features.

## Licence
MIT. See [LICENSE](LICENSE).
