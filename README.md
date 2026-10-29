# Neon Vault City

Explore your Obsidian vault as a holographic 3D cyberpunk city. Every note is a building, taller buildings have more links, and folders (or tags) become districts. Capri, your holographic guide, chats, finds notes, answers questions from them and flies you around.

## Install
1. Copy this `neon-vault-city` folder into your vault's `.obsidian/plugins/` folder.
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
