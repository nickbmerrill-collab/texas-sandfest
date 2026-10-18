# Frontend Media Assets

Public images from the official Texas SandFest site are downloaded into `public/assets/sandfest-media/` for prototype use.

## Commands

```bash
npm run scrape:public
npm run media:download
npm run media:optimize
```

## Outputs

- Full source manifest: `public/assets/sandfest-media/media-manifest.json`
- Trimmed browser manifest: `public/assets/sandfest-media/media-runtime-manifest.json`
- Responsive derivative manifest: `public/assets/sandfest-media/media-derivatives.json`
- Processed manifest: `data/processed/media-assets.json`
- Asset folders: `logos`, `sponsor-logos`, `photos`, `maps`, `social`, `misc`

## Production Note

These are public working assets scraped for frontend prototyping. Confirm image/logo usage rights and sponsor approval before production launch or App Store submission.
