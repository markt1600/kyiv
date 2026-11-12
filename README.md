# KYIV — Defence of the Capital

A browser real-time strategy game set in the war for Kyiv, 2022 onward. It is a fork of
[IRONVEIL](https://github.com/markt1600/RTS) and keeps its core: a flow economy, assistable construction,
salvageable wrecks, skirmish AI, and a world that keeps every scar. Play as **Ukraine (Zelensky)** defending the
city, or as **Russia (Putin)** attacking from Hostomel.

Everything in the game is generated in code — terrain, buildings, 3D models, textures, particles, icons, sound and music.
The only image files are a few in-game screenshots (`public/intro/`) used as the title-screen montage while the live
background battle loads.

## The map

North is up. It is not a street plan, but the iconic pieces are where you expect them, with open ground left to build on.

- **Dnipro** down the eastern third, with the left-bank estates (Troieshchyna, Darnytsia) beyond it
- **Irpin river** cutting off the north-west, where the invasion force stages around **Hostomel** and the Antonov hangar
- Six **bridges** (Stoyanka, Irpin, Demydiv; Pivnichnyi, Metro, Paton). Bring one down and vehicles cannot cross there
  — select it and right-click with armed units. Infantry can still wade a river, slowly. With **Military Bridging**
  researched, engineers can lay a pontoon bridge over the gap
- Districts of panel blocks, towers, houses and warehouses; **St Sophia**, the **Lavra**, the **Motherland Monument**,
  the **Independence Monument** on the Maidan, the **TV tower**
- Roads between them: they stay passable when everything else is mud or snow

## What persists

- **Buildings take graded damage**: shell holes, blown-out windows and soot; then a section comes down; then rubble.
  Lightly damaged buildings can still be used, heavily damaged ones cannot
- **Craters**, scorched ground, burned forest, vehicle tracks ploughed through snow and fields
- **Wrecks** rust where they died. **The dead stay where they fell** and decay with the calendar: fresh, bloated,
  collapsed, bones
- Vehicles and structures blacken as they are shot up, smoke, then burn

## Seasons

The calendar runs through a full year about every 32 minutes, so a long war passes through every season.

| Season | Effect |
| --- | --- |
| Winter (snow) | Troops out of reach of a base freeze: they lose health, move and fire slowly. Vehicles crawl in deep snow, far worse beyond supply. Rivers ice over, fires spread poorly |
| Thaw / autumn rains (mud) | Everything off-road is slow; wheeled vehicles worst |
| Summer | Good going, long reach, and fire spreads fast |

Any completed structure (and the command post) supplies troops within its radius — press **V** to see it. Forward bases
matter: build a bunker line, or **requisition** a city building as a base camp, drone workshop or observation post.
Requisitioned buildings are cheap and instant-ish but fragile, slow and limited, and die with the building.

## Civilians

Civilians live in the districts and run when shelling starts. Explosions kill them; nobody can order an attack on them.
Ukraine receives aid for as long as its people survive. Whichever side kills civilians loses supply income
(sanctions, lost support). The game does not reward killing them for either side.

## Forces

Both sides field the same core roles under their own names and markings, plus exclusive advanced weapons.

| Built at | Units (Ukraine / Russia) |
| --- | --- |
| Barracks | Sapper, Territorial Defence / Motor Rifleman, Javelin / Kornet team, Stinger / Igla team, mortar team |
| Motor Pool | Engineering vehicle, Kozak-2 / Tigr-M, BMP-2 / BMP-3, T-64BV / T-72B3, 2S1 / 2S19, Gepard / Pantsir |
| Airfield | Leleka-100 / Orlan-10, Bayraktar TB2 / Orion, Mi-24 / Ka-52, MiG-29 / Su-35S, Su-25 / Su-34 |
| Drone Workshop | FPV kamikaze drone, Liutyi / Geran-2 long-range strike drone, Kizilelma / S-70 Okhotnik supersonic UCAV |
| Armour Depot | Leopard 2A6 / T-90M, M2A2 Bradley / BMPT Terminator, HIMARS / Uragan |
| Defences | MG bunker, M777 / Msta-B battery, ZU-23-2, radar, Patriot / S-400, EW station, Neptune / Iskander-K launcher |

| Ukraine only | CAESAR truck howitzer, F-16 multirole fighter (Western Arms Packages); Sting interceptor drone (needs Electronic Warfare) |
| Russia only | TOS-1A thermobaric launcher, Kinzhal hypersonic missiles for the launcher (Thermobaric & Hypersonic Arms); Lancet loitering munition (needs Strike Drones) |

One-way munitions (FPV drones, strike drones, cruise missiles) are real units in the air: air defence can shoot them down
and EW stations jam drones out of the sky.

## Technology ladder

Researched at the Design Bureau (select it and pick a programme).

```
FPV Drone Warfare ─┬─ Electronic Warfare
                   └─ Long-Range Strike Drones ─┐
Integrated Air Defence ─────────────────────────┴─ Supersonic Combat Drones ─┐
Modern Armour ─── Precision Strike (cruise missiles) ────────────────────────┴─ Space Programme
Rail Logistics (4× supply hubs, thermal power plant)
Military Bridging (pontoon bridges over destroyed crossings)
Modern Armour ─── Western Arms Packages (Ukraine) / Thermobaric & Hypersonic Arms (Russia)
```

The Space Programme unlocks the **Launch Complex**: a recon satellite reveals the whole map on radar and spots every
enemy structure; a guidance satellite cuts artillery dispersion by 60%.

## Controls

- **Left-click / drag** select · **double-click** all of type · **Ctrl+1-9** / **1-9** groups
- **Right-click** move / attack / assist / repair / salvage / set rally
- **Shift** queue orders or place many buildings (drag for a row)
- **A** attack-move · **P** patrol · **G** guard · **R** repair · **E** salvage · **S** stop · **Del** scuttle
- **V** supply ranges · **T** thermal drone view · **H** find command post · **Tab** idle builder
- **F** first-person view of the selected unit (drag to look, wheel to zoom, **Tab** next unit, **F** / **Esc** to return)
- Arrows / screen edge / middle-drag pan · wheel zoom · **Z / X** rotate · **Space** pause · **+ / −** speed

### Touch (phones and tablets)

The page detects a touch device and switches to mobile mode on its own: touch controls, a toolbar in place of the
hotkeys, a reflowed HUD, lighter graphics, and the montage instead of the live battle on the title screen. Add
`?mobile` to the address to try it on a desktop.

- **Tap** your unit to select · **double-tap** to select all of that type on screen
- With units selected, **tap** ground to move, an enemy to attack, a wreck to salvage
- **Drag** to pan · **pinch** to zoom · **twist** to rotate
- **Long-press then drag**, or the **Box** button, to box-select · **Army** selects every combat unit
- Tap a build icon, drag to position it, release to build · **long-press** a queue icon to remove one

## Run

```bash
npm install
npm run dev      # local dev server
npm run build    # production build in dist/
npm run sim      # headless AI-vs-AI soak test, e.g. `npm run sim -- 2,2 30 7 0` (levels, minutes, seed, start date)
```

## Layout

- `src/sim.ts` – fixed-step simulation: economy, orders, combat, research, seasons and supply, civilians, damage
- `src/map.ts` – the Kyiv map: rivers, bridges, roads, districts, landmarks; A* pathfinding
- `src/defs.ts` – every unit, structure and technology, with procedural model recipes
- `src/ai.ts` – skirmish AI (economy, research, production, squads, raids, air and drone wings)
- `src/render.ts` – three.js renderer, effects, day/night and seasonal lighting, thermal view
- `src/world.ts` – city buildings and their damage states, bridges, civilians, the dead
- `src/scenery.ts` – water, foliage, procedural textures
- `src/ui.ts` – HUD, input, minimap · `src/audio.ts` – synthesized effects and score

## Balance

The core rosters are mirrored. The asymmetry is in the opening and the top end: Russia starts with an armoured column
already over the border, Ukraine with territorial-defence infantry, anti-tank teams and an aid income that lasts as long
as its civilians do. Ukraine's exclusives are precise and mobile; Russia's are heavy and hard to stop. Ten Hard-vs-Hard
AI matches on different seeds split 5–5 (`npm run sim -- 2,2 45 <seed>`).

## Rendering

Physically based sky whose light is re-filtered into the scene's environment map as the day moves; soft 4K sun shadows;
ground-truth ambient occlusion and mirrored river reflections on High; PBR facades with recessed, reflective glass;
roads drawn from a distance field with worn markings; wet mud and snow sheen; alpha-cut foliage; bloom, film grade and
grain; a white-hot thermal view. It is rasterised, not ray traced — the reflections and occlusion are the screen-space
and planar equivalents.

## Not done yet

- The AI rebuilds and destroys bridges by simple rules; it does not plan whole campaigns around the crossings
- Pontoon bridges go only where a bridge stood
