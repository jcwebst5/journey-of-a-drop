# Journey of a Drop

A cartoon arcade game made for a class partnered with [charity: water](https://www.charitywater.org). You guide a raindrop 10,000 feet down from the clouds. Bounce on clean clouds, dodge pollution, keep your drop pure, and land it in the clean well.

## How to play

Open `index.html` in any modern browser. It runs on desktop, tablets and phones.

| Action | Desktop | Phone / tablet |
|---|---|---|
| Steer | ← → or A / D | Hold the left or right side of the screen |
| Pause | P or Esc | Pause button (top right) |

- **Purity** is your health. Touching dust, soot, smog or chemical clouds lowers it, and collecting droplets raises it. At 0% the drop is too polluted and the run ends.
- **Clean clouds** bounce you and build a combo multiplier (up to x5). Pink clouds launch you high, and cream clouds break after one bounce.
- **Stomp** smog monsters and plastic bottles from above to clean or recycle them. Birds are bouncy too.
- **Power-ups:** the filter shield blocks all pollution for 7 seconds, and the droplet magnet pulls droplets toward you.
- **The landing:** the clean well, a muddy pond and a toxic drain are shuffled every run. Only the well counts as a win.

### Zones

1. **Cloud Kingdom:** mostly clean clouds, with birds.
2. **Windy Heights:** gusts push the drop sideways.
3. **Smog City:** the dirty air slowly drains purity.
4. **Farmlands:** plastic bottles float up.
5. **Final Approach:** find the clean well.

Each run has three missions, such as "Stomp 3 smog monsters". Missions and your best score are saved in the browser. After every run, the results screen shows a sourced fact about clean water.

## Project files

| File | What it is |
|---|---|
| `index.html` | Page structure: HUD, menus and results screen |
| `style.css` | Cartoon UI styling and the layouts for phone and desktop |
| `script.js` | The game: physics, world generation, drawing, sound and saving |
| `assets/charity-water-logo.png` | charity: water logo |
| `build.py` | Bundles everything into one HTML file in `dist/` |
| `dist/journey-of-a-drop.html` | A single self-contained copy of the game, easy to share |

There are no dependencies or build tools to install. Graphics are drawn on an HTML canvas and sound effects are generated with the Web Audio API, so the game has no image or audio files besides the logo. Fonts (Fredoka and Nunito) load from Google Fonts.

To rebuild the single-file copy after editing:

```
python build.py
```

## Technical notes

- Physics runs in fixed 1/120 s sub-steps, so the game plays the same at 60 Hz, 120 Hz or 144 Hz.
- The world is about 820 units tall on every screen and as wide as the window, so phones get a tall, narrow play field and desktops a full-screen one. Wider screens spawn more clouds and give the drop more sideways speed.
- Clouds, monsters and pickups are drawn once to offscreen canvases and reused every frame.
- The game pauses automatically when the tab loses focus, and it honors the system's reduced-motion setting.
