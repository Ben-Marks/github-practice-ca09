# Flame Out

A cartoon pull-the-pin puzzle game. Swipe the gold pins so the water reaches the fire.

| Levels | World | New idea |
|---|---|---|
| 1–10 | Water & Lava | Water puts fires out, lava makes them bigger, water turns lava into stone |
| 11–20 | Rocks | Rocks sink through liquids and can fill a drain so water flows over it |
| 21–30 | Locked Pins | Rock sitting where a pin's handle must go jams it until the rock is cleared |
| 31–40 | Two Fires | Every fire must go out, so the water has to be shared |
| 41–50 | Ice | Frozen water. Lava touching an ice block melts the whole block |

Each world keeps everything from the worlds before it. Every 3 completed levels there is an ad break.
Music and sound effects are generated in code (no audio files) and can be switched off separately.

## Play it

Open `dist/flame-out.html` in any browser (phone or computer). It is one file, nothing to install.

## How the levels were made

The 50 levels are fixed: every player gets the same levels, and each level uses its own fixed
random seed, so the water moves the same way for everyone.

They were picked by a generator plus a solver:

1. `tools/gen.js` builds random layouts from columns, chambers, pins, fires, drains, ramps, rock locks and ice.
2. `tools/solve.js` plays every possible order of pulling the pins (waiting for things to settle between pulls).
   It measures the fewest pulls that win and how often a player pulling random pins would win.
3. `tools/pick.js` keeps only levels that need several steps, rarely win by luck, and whose winning line
   also works with other random splash patterns.
4. `tools/build-levels.js` picks 10 per world from easier to harder and writes `game/levels.js`.
5. `tools/verify.js` re-checks all 50 levels.

```
node tools/pick.js <world 1-5> <seconds>   # find candidates (uses all CPU cores)
node tools/build-levels.js                 # choose the 50 levels
node tools/verify.js                       # check them
node tools/build.js                        # bundle into dist/
```

## Connecting real ads

The game already pauses for an ad break after every 3rd level. Right now it shows a 5-second placeholder.
To show real ads, set `window.FlameAdProvider` before the game script runs. It needs one function,
`showBreak(done)`, which plays an ad and then calls `done()` so the next level starts:

```html
<script>
  window.FlameAdProvider = {
    showBreak(done) {
      // call your ad network here, then:
      done();
    },
  };
</script>
```

Ads cannot run inside the claude.ai preview link. They need the game on your own website or in an app.

### Option A: a website (Google H5 Games Ads)

1. Put the game online on your own address, for example with Netlify or GitHub Pages.
2. Sign up for Google AdSense and apply for H5 Games Ads (the "Ad Placement API").
3. Add Google's script with your publisher ID, and hook it up:

```html
<script async data-ad-client="ca-pub-XXXXXXXXXXXXXXXX"
  src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>
<script>
  window.adsbygoogle = window.adsbygoogle || [];
  const adBreak = (o) => window.adsbygoogle.push(o);
  window.FlameAdProvider = {
    showBreak(done) {
      adBreak({ type: 'next', name: 'every-3-levels', adBreakDone: done });
    },
  };
</script>
```

### Option B: iPhone and Android apps (Google AdMob)

1. Wrap the game as an app with Capacitor (it turns a web game into an App Store / Play Store app).
   The iPhone build can be made with a cloud build service, so a Mac is not required.
2. Create a free AdMob account, register the app, and create an "Interstitial" ad unit.
3. Install the `@capacitor-community/admob` plugin and use it in `showBreak`:

```js
import { AdMob } from '@capacitor-community/admob';
window.FlameAdProvider = {
  async showBreak(done) {
    try {
      await AdMob.prepareInterstitial({ adId: 'YOUR_AD_UNIT_ID' });
      await AdMob.showInterstitial();
    } finally {
      done();
    }
  },
};
```

Store accounts cost $25 once (Google Play) and $99 a year (Apple). If the game is aimed at children,
the ad networks have extra rules (no personalised ads), so set that up when you create the account.

## Files

- `game/engine.js` – the particle simulation (water, lava, stone, rocks, ice, pins, locks, fires)
- `game/levels.js` – the 50 levels (generated)
- `game/game.js` – drawing, touch controls, music, sounds, menus and ad breaks
- `game/index.html` – page layout and styles
- `tools/` – level generator, solver, picker, verifier and the bundler
