# MemeDNA · Frontend

Premium DNA-themed dashboard for the MemeDNA API.

## Stack

- **Next.js 15** (App Router) + **React 19**
- **TypeScript** (strict)
- **Tailwind CSS 4** (with CSS-first `@theme` tokens)
- **Framer Motion** · **lucide-react**

No chart library: the evolution curve is rendered as a hand-rolled SVG so the
bundle stays under 200 KB gzipped.

## Quickstart

```bash
cd frontend
npm install
cp .env.local.example .env.local   # points at http://127.0.0.1:8000 by default
npm run dev                        # http://localhost:3000
```

Make sure the MemeDNA FastAPI backend is running (default
`http://127.0.0.1:8000`).

## Project layout

```
src/
├── app/                 # App Router pages
│   ├── page.tsx         # landing (hero + trending + families grid)
│   ├── families/        # paginated + filterable list
│   ├── family/[id]/     # detail: 4 centers, evolution curve, mutations, timeline
│   ├── mutation/[addr]/ # single-token view
│   └── trending/        # evolution leaderboard
├── components/          # composable UI pieces (hero, cards, helix, …)
│   └── ui/              # primitives: card, badge, button
└── lib/                 # api client, types, formatters, cn()
```

## Palette

```
ink-950 → helix-a (#5EF7D1 cytosine-teal)
         helix-b (#8B5CF6 adenine-violet)
         helix-c (#F0ABFC guanine-pink)
         helix-d (#FBBF24 thymine-amber)

strain-origin   = helix-a
strain-dominant = helix-d
strain-fastest  = helix-c
```
