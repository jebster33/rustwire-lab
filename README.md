# Rustwire Lab

Browser simulator for Rust (Facepunch) electricity, water, farming and industrial setups.

- Real item icons, recipes and recycle yields (data from RustLabs via [abbmarand/rustitems](https://github.com/abbmarand/rustitems); icons hotlinked from the RustClash wiki).
- Tick-based sim: power passthrough and consumption, batteries (80% charge efficiency, drain by real downstream load), logic gates, memory cells, counters, timers, RF, HBHF / laser / pressure pad sensors with draggable players, turrets, water pumps/purifiers/hoses/sprinklers, planters with genes and crossbreeding, furnaces, refinery, recycler, conveyors with filters, industrial crafters, God Box / Void Box.
- Saves: on-device (autosave + named saves + file export), online via Netlify Functions + Blobs (private link or public gallery), optional Steam sign-in.

## Develop

```bash
npm install
npm run dev
```

Online saves and Steam login need the Netlify runtime (`netlify dev`) and a `SESSION_SECRET` env var.

## Rebuild item data

```bash
git clone --depth 1 https://github.com/abbmarand/rustitems /tmp/rustitems
node scripts/build-data.mjs /tmp/rustitems/data/itemsbyshortname.json
```
