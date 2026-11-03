You are building a new browser game from scratch in this folder: a calm hot air balloon ride over a beautiful countryside at golden hour. Stylized like a Ghibli / Makoto Shinkai painting (toon-shaded, warm light, fluffy clouds), not photoreal. No combat, no score, no objectives. Just float, rise, drift and look down.

Do not ask me questions. Make the decisions yourself and keep going until the definition of done at the bottom is met.

## 1. Reuse my best environment code (most important rule)

I already have two finished games with the best environments I've made:
- Summer Cycle (Ghibli countryside): F:\summer-cycle
- Bay Ride (Ghibli seaside town + water): F:\bay-ride

Before writing anything new:
1. Read both projects and list which modules are worth reusing: sky, clouds, sun/time of day, toon/cel shader, outlines, terrain, vegetation, houses, water, post-processing, audio synthesis.
2. COPY those modules into this new project and adapt them. Never edit files inside the old projects.
3. Do NOT copy the characters, the bike, the boat, or any gameplay. Do NOT reuse their on-screen text/HUD. This must not turn into the cycle game or Bay Ride again.

## 2. What the game is

- The player rides a hot air balloon. Camera options: third-person behind/above the balloon (default), and a "look down from the basket" view (press V to toggle).
- No visible human in the basket. Empty basket with the burner is fine. Do not model people.
- Controls (keep them simple):
  - Space (hold): fire the burner -> balloon slowly rises, burner flame + roar sound
  - S (hold): open the vent -> balloon slowly sinks
  - Mouse drag: look around
  - No steering wheel. Like real balloons, you steer by changing altitude: wind at different heights blows in different directions (e.g. low wind drifts east, mid wind north-east, high wind north). Show wind direction with drifting particles/cloud motion, not with text.
  - T: cycle time of day (sunrise, golden hour, sunset, blue hour). Golden hour is the default.
  - H: show/hide a tiny controls hint. Hidden by default. No other text on screen. Nothing in the top-right corner.
- Other balloons: 4-6 other colorful balloons drifting at different heights in the distance. They sell the scene.

## 3. THE main thing: the view looking down

This build lives or dies on what you see when you look down from 100 m to 600 m up. It has to look like a hand-painted miniature world:
- A small village with tiny houses (different roof colors, chimneys, little gardens), a church/tower or windmill, winding roads, a river with a stone bridge.
- Patchwork fields in different greens and golds, hedgerows, tree clusters, a few orchards, a lake that reflects the sky.
- Tiny details that reward looking down: sheep or cows as small dots in fields, a road with a moving cart or car, smoke from chimneys, birds below you.
- Clouds at different layers, including a few you can rise up through and pop out above.
- Atmospheric perspective: distant land fades into warm haze, so the world feels huge.
- Use LOD/instancing so the ground stays detailed and the frame rate stays smooth from every altitude.

## 4. Research first, before building features

Before building the major systems, research and write a short notes file (docs/research.md):
- How real hot air balloons fly (burner timing, vent, wind layers, typical climb/sink rates) so the motion feels real but calm.
- How developers usually build large stylized terrains, villages and cloud layers in Three.js with good performance.
- What well-cited research says makes an experience feel calm and wonder-filled (pace, sound, color), and turn it into concrete ideas for this game.

## 5. Skills and tools

- Install these skill repos into this project's .claude/skills folder (git clone them, keep only the skill folders), then run /reload-skills:
  - https://github.com/cloudai-x/threejs-skills
  - https://github.com/dgreenheck/webgpu-claude-skill
  - https://github.com/majidmanzarpour/threejs-game-skills
- Also check skills.sh for any skill that helps with Three.js terrain, clouds or shaders.
- Blender MCP is connected. Use Blender (by script) to model the balloon: envelope with proper gore panels and stripes, wicker basket, ropes, burner frame. Also use it for any hero props that look bad as code (windmill, church, bridge). Export as .glb into public/models and ship them with the game.
- Sounds: synthesize them in code (burner roar, wind, distant birds, faint village bells). No downloaded audio.
- Tech: Three.js + Vite + TypeScript. Use pnpm for everything.

## 6. How to work: builder + critic, one at a time

Work in a gauntlet loop:
1. Build one system at a time, in order: project setup + reused environment, terrain + village, balloon model + flight physics, clouds + wind, other balloons, look-down camera, audio, time of day, polish.
2. After each system, render frames with a headless browser (Playwright) from fixed camera spots: on the ground, 50 m, 200 m, 500 m up, and looking straight down.
3. A separate critic subagent compares those frames against real reference photos of hot air balloon flights at golden hour (e.g. aerial photos of balloon festivals over countryside) and against frames from Summer Cycle for the art style. The critic must name concrete problems (e.g. "houses are flat boxes", "fields have no color variation", "clouds look like spheres") — never just "looks good".
4. Fix and re-render until the critic passes that system. Then move to the next.

Run subagents one at a time, never in parallel. My PC is an RTX 4060 with 32 GB RAM: don't max out the CPU/GPU, and open test windows on my second screen.

## 7. Recording mode

Add a cinematic mode (press C) that flies a smooth scripted camera path: starts close on the balloon with the burner firing, pulls back to reveal the village below, then glides over the fields at golden hour. Also write a script that records this path to a 1080p60 MP4 (about 40-60 seconds) into a /recordings folder, so I can post it.

## 8. Ship it

- Create a public GitHub repo under StarKnightt (name it something short like "sky-drift" or "balloon-ride"), push the code, and deploy to GitHub Pages.
- Make the game work on mobile too (touch buttons for burner and vent).
- Make an OG image (1200x630) from the best golden hour frame and set it as the page's og:image and the repo's social preview.
- Write a short README with the play link and controls.

## Definition of done

- pnpm build runs with no errors and the game runs smoothly in Chrome.
- The critic has passed every system against the reference photos.
- Frames from 50 m, 200 m and 500 m up and looking straight down clearly show tiny detailed houses, patchwork fields, roads, a river and layered clouds.
- The cinematic recording MP4 is in /recordings.
- It's live on GitHub Pages with the OG image.
