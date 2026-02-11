<div align="center">
  <a href="https://osschat.dev">
    <img src="https://raw.githubusercontent.com/opencoredev/openchat/main/apps/web/public/og-image.png" width="680" alt="OpenChat" />
  </a>
  <br /><br />
  <a href="https://github.com/opencoredev/openchat/stargazers">
    <img src="https://img.shields.io/github/stars/opencoredev/openchat?style=flat&color=38C9A8" alt="stars" />
  </a>
  &nbsp;
  <a href="https://github.com/opencoredev/openchat/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/opencoredev/openchat?style=flat" alt="license" />
  </a>
  &nbsp;
  <a href="https://discord.gg/gSYSrgcS">
    <img src="https://img.shields.io/badge/discord-join-5865F2?style=flat&logo=discord&logoColor=white" alt="discord" />
  </a>
</div>

<br />

Open-source AI chat platform. Connects to **100+ models** through [OpenRouter](https://openrouter.ai), syncs conversations in real-time across devices with [Convex](https://convex.dev), and runs on TanStack Start + React 19 + Tailwind v4.

Use it free at **[osschat.dev](https://osschat.dev)**, bring your own API key, or self-host the whole thing.

## What You Get

- **100+ AI models** — GPT-4o, Claude, Llama, Gemini, and everything else on OpenRouter
- **Real-time sync** — conversations persist and update across devices instantly
- **Web search** — built-in search with source citations
- **Self-hostable** — Docker Compose or one-click Vercel deploy
- **BYOK** — bring your own OpenRouter key for unlimited usage
- **Browser extension** — quick access from any tab

## Quick Start

```bash
git clone https://github.com/opencoredev/openchat.git
cd openchat && bun install
cp env.web.example apps/web/.env.local
cp env.server.example apps/server/.env.local
# fill in your env vars → docs/ENVIRONMENT.md
bun dev
```

Frontend on `localhost:3000`, Convex starts automatically.

## Deploy

| Method | |
|--------|---|
| **Vercel + Convex Cloud** | [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/opencoredev/openchat) |
| **Docker** | `docker compose up -d` |

Full setup in [deployment docs](docs/deployment/).

<br />

<div align="center">
  <a href="https://star-history.com/#opencoredev/openchat&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=opencoredev/openchat&type=Date&theme=dark" />
      <img src="https://api.star-history.com/svg?repos=opencoredev/openchat&type=Date" width="560" alt="Star History" />
    </picture>
  </a>
</div>

<br />

## Sponsors

<p align="center">
  <a href="https://convex.dev">
    <picture>
      <source media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/d80d057b-e651-49c3-a0eb-ee324274d549">
      <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/04dee790-d23a-4aed-93bb-5943e7f9cd5c">
      <img height="34" alt="Convex" src="https://github.com/user-attachments/assets/d80d057b-e651-49c3-a0eb-ee324274d549">
    </picture>
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://greptile.com">
    <img height="34" alt="Greptile" src="https://github.com/user-attachments/assets/0dc5a5c7-2196-4270-b609-ea5a40f7e13e">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://gitbook.com">
    <img height="34" alt="GitBook" src="https://github.com/user-attachments/assets/ef2d2c18-0b94-424c-af39-cd40e0238665">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://sentry.io">
    <img height="34" alt="Sentry" src="https://github.com/user-attachments/assets/26266fa9-67a0-4256-9530-614f7ca4d2f5">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://graphite.dev">
    <img height="34" alt="Graphite" src="https://avatars.githubusercontent.com/u/105563461?s=120">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://upstash.com">
    <picture>
      <source media="(prefers-color-scheme: light)" srcset="https://upstash.com/logo/upstash-white-bg.svg">
      <source media="(prefers-color-scheme: dark)" srcset="https://upstash.com/logo/upstash-dark-bg.svg">
      <img height="28" alt="Upstash" src="https://upstash.com/logo/upstash-dark-bg.svg">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://github.com/sponsors/opencoredev">Become a sponsor</a>
</p>

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and guidelines.

<a href="https://github.com/opencoredev/openchat/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=opencoredev/openchat" />
</a>

## License

[AGPL-3.0](LICENSE)
