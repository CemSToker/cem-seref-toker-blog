# Cem Seref Toker

Personal blog about robotics, molecular biology, early stage startups, and lab automation.

## Local preview

```sh
python3 -m http.server 8787 --directory dist
```

Visit http://localhost:8787. No build step or dependencies are needed.

## Deploy to Vercel

Import this repository into your personal Vercel Hobby account. The included `vercel.json` selects the Other framework preset, skips the build, and serves `dist/`.

## Editing

The homepage is `dist/index.html`, the biography is `dist/about.html`, and essays live in `dist/essays/`. Shared styling lives in `dist/assets/style.css`.

## Branding

The logo and liquid animation originate from neuromorphic-research/Neuromorphic (`public/brand/neuromorphic-mark.png` and `src/lib/landing.js`). The blog removes the contact form and pause control. Reduced-motion preferences and unavailable WebGL show the static logo.
