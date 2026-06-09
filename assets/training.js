/* =============================================================
   HHST Swim Stats — Training knowledge base + personalized engine
   -------------------------------------------------------------
   ONE source of truth for "how to get faster," shared by:
     • get-faster.html  — the full public guide
     • dashboard.html   — the personalized plan (tipsForSwimmer)

   The rich per-stroke coaching content (whyFast / cues / getFaster /
   mistakes / drills / dryland / progression / measure) and the realistic
   age-group goal times are generated + cross-checked by a multi-agent
   coaching pass and embedded below. Design metadata (color/emoji/tagline)
   is authored here. The engine turns a swimmer's own times into an
   attainable, prioritized plan.
   ============================================================= */
(function (global) {
  'use strict';

  function fmt(sec) {
    if (global.HHST && typeof global.HHST.fmtTime === 'function') return global.HHST.fmtTime(sec);
    if (!isFinite(sec)) return '';
    var m = Math.floor(sec / 60), s = sec - m * 60;
    return m ? (m + ':' + s.toFixed(2).padStart(5, '0')) : s.toFixed(2);
  }
  function strokeOf(label) {
    if (global.HHST && typeof global.HHST.extractStroke === 'function') return global.HHST.extractStroke(label);
    var s = (label || '').toLowerCase();
    if (s.indexOf('free') >= 0) return 'Freestyle';
    if (s.indexOf('back') >= 0) return 'Backstroke';
    if (s.indexOf('breast') >= 0) return 'Breaststroke';
    if (s.indexOf('fly') >= 0 || s.indexOf('butter') >= 0) return 'Butterfly';
    if (s.indexOf('im') >= 0 || s.indexOf('medley') >= 0) return 'IM';
    return '';
  }
  function distOf(label) {
    if (global.HHST && typeof global.HHST.extractDistance === 'function') return global.HHST.extractDistance(label);
    var m = (label || '').toString().match(/\d{2,4}/);
    return m ? m[0] : '';
  }

  // ---- Design metadata (authored): color, emoji, display name, tagline ----
  var STROKE_META = {
    Freestyle:    { name: 'Freestyle',              color: '#60a5fa', emoji: '🌊', tagline: 'The fastest stroke — built on a long, balanced body and a high-elbow catch.' },
    Backstroke:   { name: 'Backstroke',             color: '#34d399', emoji: '⬆️', tagline: 'Race flat with hips high, rolling shoulder-to-shoulder behind a steady kick.' },
    Breaststroke: { name: 'Breaststroke',           color: '#fbbf24', emoji: '🐸', tagline: 'Timing over power: pull, breathe, kick, then glide long in a tight streamline.' },
    Butterfly:    { name: 'Butterfly',              color: '#f472b6', emoji: '🦋', tagline: 'A rhythm stroke: press the chest, two kicks per pull, and a low, quick breath.' },
    IM:           { name: 'Individual Medley (IM)', color: '#a78bfa', emoji: '🔀', tagline: 'All four strokes, one race. Pace it, nail the turns, train your weakest stroke.' }
  };

  // ---- Coaching content (generated + verified) ----
  var STROKE_CONTENT = {
  "Backstroke": {
    "key": "Backstroke",
    "whyFast": "Backstroke speed comes from a long, flat body with the hips riding high while you rotate hip-to-hip and press the water from above your head down to your feet with a bent-elbow catch — all over a kick that never stops. The swimmers who win are the ones who hold a dead-still head and turn the underwater off every wall into free distance.",
    "cues": [
      "Eyes straight up, head like a bowl of water you can't spill — never let it move.",
      "Hips and chest at the surface; lead each stroke with your hip, not your hand.",
      "Pinky enters first, arm brushing past your ear, thumb leaves first on the way out.",
      "Catch deep (don't slip along the top) and press the water all the way to your feet.",
      "Rotate shoulder-to-shoulder so one shoulder rolls up out of the water each stroke.",
      "Kick fast and steady from the hips, toes just tickling the surface — never stop the legs.",
      "Dolphin kick on your back in a tight streamline off every wall before your first pull.",
      "Count strokes into the wall so you finish on a full stroke, not a crash."
    ],
    "getFaster": [
      {
        "title": "Turn every wall into free speed with underwater dolphin kicks",
        "how": "Off every push-off, hold a tight streamline on your back and dolphin kick from your chest and hips (not just the knees) before you take your first stroke — aim for 3-5 kicks, growing toward the flags, and always surfacing before the 15-meter mark. Spend part of two pool sessions a week doing 8x15 yards of streamline-on-back dolphin kick, counting how far you travel on the same number of kicks. Done right it feels like your push-off carries you almost to the flags before you even pull, and over a few weeks this alone can drop a second or two with zero change to your stroke."
      },
      {
        "title": "Build a deep, pressing catch instead of a flat, slipping arm",
        "how": "Most kids throw the arm in flat and wide and it just skates along the surface. Once a week do a single-arm backstroke set (4x25 each arm, other arm at your side) and obsess over one thing: after the pinky enters, bend the elbow and press the water DOWN toward your feet so you feel resistance on your whole forearm, like pushing off a wall behind you. When the catch is right you'll feel your body surge forward on each arm and travel noticeably farther per stroke."
      },
      {
        "title": "Stretch your distance-per-stroke, then add tempo",
        "how": "Count how many strokes it takes you to cross the pool. For a couple of weeks, on easy 25s, try to shave one stroke off that count by rotating more and reaching longer on the entry — without slowing down or stalling. Once your low count feels smooth, keep that long stroke but pick the tempo back up. The goal is to travel far on each stroke AND turn the arms over quickly; the fastest backstrokers do both, and chasing length first stops you from just spinning your arms and going nowhere."
      },
      {
        "title": "Anchor a still head and high hips",
        "how": "A bobbing head is the number-one speed-killer in backstroke because the moment your head moves, your hips sink and your legs drag. Swim 4x50 with a small object (or just an imaginary cup) balanced on your forehead and refuse to let it spill, keeping your eyes locked straight up and your hips pressed to the surface. Practiced two or three times a week, a rock-steady head starts to feel automatic, your legs ride up on their own, and you stop plowing water."
      },
      {
        "title": "Keep the kick alive for the whole race with steady kick sets",
        "how": "Backstroke needs a kick that literally never stops, because the legs are what hold you flat. Once or twice a week do streamline kick-on-back sets — 6-8x25, or build to 4x50 — keeping the kick small, fast, and continuous from the hips with loose ankles, never pausing at the wall. Pair it with the dryland below for a stronger up-kick. After a few weeks you'll notice your legs don't sink on the back half of a race and your last length holds together instead of falling apart."
      },
      {
        "title": "Sharpen the finish so you don't lose the race at the wall",
        "how": "Lots of close races are lost in the final two strokes when a swimmer glides in, looks back, or jams into the wall. Every time you swim a 25 or 50, count your strokes from the flags so you learn exactly how many it takes to finish on a full, hard stroke — reaching back to touch with the hand, not coasting. Do this on your normal swims for a few weeks and finishing strong becomes a habit you don't even have to think about on race day."
      }
    ],
    "mistakes": [
      {
        "name": "Bobbing or lifting the head",
        "fix": "Lock your eyes straight up and keep the back of your head in the water all race. A still head keeps your hips up; a moving head sinks your legs and slams on the brakes."
      },
      {
        "name": "Throwing the arm in flat and wide",
        "fix": "Enter pinky-first straight overhead past your ear, then bend the elbow and catch deep. A flat, straight arm just slips across the top and grabs almost no water."
      },
      {
        "name": "Swimming flat with no rotation",
        "fix": "Roll hip-to-hip so one shoulder clears the surface each stroke and let the hip lead the pull. Staying flat shortens your stroke and wastes the power in your core."
      },
      {
        "name": "Bending at the waist / sitting in a chair",
        "fix": "Stay long and press your hips and chest to the surface, kicking your legs up to the top. If you bend at the waist your feet drop and you drag a 'chair' behind you."
      },
      {
        "name": "Letting the kick stop",
        "fix": "Keep a small, fast, continuous kick the entire length — including right off the wall. The instant the legs pause in backstroke, the hips drop and you stall."
      }
    ],
    "drills": [
      {
        "name": "Streamline Kick on Back",
        "focus": "Body line + continuous kick",
        "how": "Arms squeezed into a tight streamline behind your head, kick on your back with hips pressed high and toes tickling the surface. Keep it small and fast and never stop the legs. 6-8x25."
      },
      {
        "name": "Single-Arm Backstroke",
        "focus": "Clean entry + deep catch",
        "how": "One arm only, the other held at your side. Nail the pinky-first entry past the ear, then bend the elbow and press deep to your feet. Switch arms halfway. 4x25 each arm."
      },
      {
        "name": "Underwater Dolphin Kick on Back",
        "focus": "Free speed off the wall",
        "how": "Push off on your back in a tight streamline and dolphin kick from the chest and hips, surfacing before the flags. Count how far you get on the same number of kicks. 8x15 yards."
      },
      {
        "name": "Head-Still / Cup Balance",
        "focus": "Quiet head + high hips",
        "how": "Swim easy backstroke imagining a cup of water on your forehead you can't spill; eyes locked straight up. If the 'water' spills, slow down until it doesn't. 4x50."
      },
      {
        "name": "3 Strokes / 6 Kicks",
        "focus": "Rhythm + balance",
        "how": "Take 3 strokes, then pause rotated on your side and kick 6 times before the next 3 strokes. Stops you from rushing and teaches hip-driven rotation. 4x50."
      },
      {
        "name": "Pencil Rotation",
        "focus": "Hip-driven roll",
        "how": "Hands at your sides, body straight as a pencil, rotate hip-to-hip while kicking steadily — feel each hip drive the roll. 6x25."
      }
    ],
    "dryland": [
      {
        "name": "Glute bridge",
        "how": "Lie on your back, drive your hips up and squeeze your seat hard, then lower slowly. Trains the 'hips up' feeling and the glutes that power your up-kick.",
        "reps": "3 x 12"
      },
      {
        "name": "Superman holds",
        "how": "Lie face-down and lift your arms and legs off the floor, holding a strong line. Builds the back and hamstrings that keep you flat and drive the kick.",
        "reps": "3 x 20 sec"
      },
      {
        "name": "Hollow-body hold",
        "how": "On your back, arms reaching overhead, press your lower back into the floor and lift shoulders and legs slightly. This is your streamline shape and your core stability.",
        "reps": "3 x 20-30 sec"
      },
      {
        "name": "Shoulder band/towel external rotation",
        "how": "Tuck your elbow at your side and rotate a light band or towel outward, slow and controlled. Keeps backstroke shoulders healthy for all that overhead reaching.",
        "reps": "2 x 12 each arm"
      },
      {
        "name": "Streamline holds",
        "how": "Stand tall, hands stacked with the thumb wrapped, arms squeezing your ears into the exact shape you push off every wall in. Hold it tight and long.",
        "reps": "3 x 30 sec"
      }
    ],
    "progression": [
      "First, master a long, flat body line: a dead-still head with eyes up, hips and chest at the surface, and a small, continuous kick that never stops — held for a full 25.",
      "Next, add the arms cleanly: pinky-first entry past the ear, a deep bent-elbow catch that presses to your feet, and shoulder-to-shoulder rotation led by the hips.",
      "Then turn your walls into weapons: a tight streamline and 3-5 strong dolphin kicks on your back off every push-off, always surfacing before the flags.",
      "Finally, race it: hold your distance-per-stroke at a quick tempo, kick the whole way without fading, and finish on a full, hard stroke instead of gliding in."
    ],
    "measure": "Time yourself on a 25 or 50 backstroke every week or two and also count your strokes per length — getting faster while holding (or lowering) your stroke count, and reaching the flags on fewer kicks off the wall, are the clearest signs you're truly improving."
  },
  "Freestyle": {
    "key": "Freestyle",
    "whyFast": "Freestyle speed comes from a long, balanced body line and a high-elbow catch that anchors the water and presses it straight back past your hip — you go faster by traveling farther on each stroke, not by spinning your arms harder. The flutter kick and a tight underwater streamline off every wall are what hold that long line together.",
    "cues": [
      "Reach long and stretch your fingertips past your head before every pull.",
      "High-elbow catch: point your fingertips at the bottom of the pool, then press the water back toward your feet.",
      "Finish every stroke past your hip — brush your thumb on your thigh before the arm recovers.",
      "Kick small and fast from the hips with loose ankles and pointed toes.",
      "Roll body-to-side and breathe inside that roll, keeping one goggle in the water.",
      "Head still, eyes down — don't lift it to breathe.",
      "Exhale steadily underwater so the breath is just a quick sip of air.",
      "Push off every wall in a tight streamline and add 3-5 fast kicks before your first stroke."
    ],
    "getFaster": [
      {
        "title": "Build a better catch (the high elbow)",
        "how": "The catch is where most free speed hides. Twice a week swim 6-8 x 25 of sculling and Front Scull drill, feeling your forearm and palm face the wall behind you while your elbow stays high and forward near the surface. Done right it should feel like you're pulling your body past a fixed handhold, not slipping your hand through the water — once it 'grips,' carry that exact feel into easy full swimming."
      },
      {
        "title": "Grow your distance-per-stroke, then add tempo",
        "how": "Count your strokes for one length at an easy effort, then try to take 1-2 fewer strokes per length for a few weeks without slowing down — longer reach, fuller finish, tighter streamline off the wall. Once your stroke count drops and holds, layer speed back on by swimming the same low count at a faster turnover; the goal is long AND quick, never short and frantic."
      },
      {
        "title": "Train your underwater kick off every wall",
        "how": "Free races are often won at the walls. After each push-off hold a rock-tight streamline and take 3-5 strong flutter or dolphin kicks before you surface, and add 3-4 x 25 of fast streamline kick to your warm-up 2-3 times a week. Over a few weeks your breakouts get longer and faster, and you'll reach the flags already moving instead of starting from zero."
      },
      {
        "title": "Lock in a breathing pattern",
        "how": "Choppy breathing wrecks your body line. Practice breathing every 3rd stroke so you breathe to both sides evenly, and once that feels natural work sets like breathing every 5 on easy 50s to build comfort and control (only in shallow water with an adult watching — never push to dizziness). A calm, rhythmic breath keeps your hips up and your stroke long when you get tired."
      },
      {
        "title": "Learn to pace, not just sprint",
        "how": "Faster racing comes from even pacing, not blasting the first length. Once a week swim a set like 8 x 50 where you hold the same time on each one with good rest, then build the last few slightly faster. Learning what 'fast but controlled' feels like means you finish races strong instead of dying — most age-groupers go out too hard and lose it all on the back half."
      },
      {
        "title": "Sharpen your flip turns",
        "how": "A quick turn can save a full second or more per wall. Practice approaching the wall at race speed, flipping fast and tight, planting both feet, and shooting off in a streamline with kicks before your first pull. Do 6-8 turns at the end of practice each week until they're automatic — never glide into the wall and never breathe in or out of the turn."
      }
    ],
    "mistakes": [
      {
        "name": "Lifting the head to breathe",
        "fix": "Turn your head with your body roll and leave one goggle in the water. Lifting drops your hips and slams on the brakes — practice 3/3/3 breathing until it feels automatic."
      },
      {
        "name": "Straight, dragging arm pull",
        "fix": "Bend your elbow and press with the whole forearm — a high-elbow catch grabs far more water than a stiff straight arm. Front Scull and Catch-Up drills build the feel."
      },
      {
        "name": "Hand crossing over the center line",
        "fix": "Enter and reach in line with your shoulder, not across your nose. A crossover makes you wiggle and snake down the lane; Catch-Up drill fixes it fast."
      },
      {
        "name": "Big, bouncy 'bicycle' kick",
        "fix": "Make the kick small and quick from the hips with loose ankles; your knees should barely bend. A bent-knee bicycle kick acts like a parachute behind you."
      },
      {
        "name": "Quitting the stroke short at the hip",
        "fix": "Finish every pull all the way past your hip — brush your thigh before recovering. Stopping the pull early at your waist throws away the most powerful part of the stroke."
      }
    ],
    "drills": [
      {
        "name": "Catch-Up",
        "focus": "Long reach + no crossover",
        "how": "Keep one arm stretched out front; only pull with it once the other hand 'catches up' to it. Reach shoulder-width, not across your nose. 4-6 x 25."
      },
      {
        "name": "Front Scull",
        "focus": "Feeling the high-elbow catch",
        "how": "Arms extended in front just under the surface, make small figure-8 sculls so your palms and forearms press the water back. Feel the 'grip' before you ever pull. 6 x 25."
      },
      {
        "name": "Fingertip Drag",
        "focus": "High-elbow recovery + roll",
        "how": "Drag your fingertips along the surface as the arm swings forward, keeping the elbow higher than the hand. Forces a tall, relaxed recovery and good body roll. 4 x 25."
      },
      {
        "name": "6-Kick Switch",
        "focus": "Balance + body rotation",
        "how": "On your side in streamline with one arm extended, kick 6 times, then take one stroke to switch to the other side. Teaches you to swim on a long edge. 6 x 25."
      },
      {
        "name": "3/3/3 Breathing",
        "focus": "Even breathing to both sides",
        "how": "Breathe every 3rd stroke so you alternate left and right down the lane. Builds a balanced, symmetrical stroke and a steady exhale. 4 x 50."
      },
      {
        "name": "25 Stroke-Count Build",
        "focus": "Distance-per-stroke",
        "how": "Swim a 25 counting strokes, then try the next one in one fewer stroke at the same speed. Reach longer and finish fuller — don't just glide and stall. 6-8 x 25."
      }
    ],
    "dryland": [
      {
        "name": "Streamline holds",
        "how": "Stand tall, hands stacked, arms squeezing your ears into a long, tight line — the exact shape you push off every wall in. Hold it perfectly still.",
        "reps": "3 x 30 sec"
      },
      {
        "name": "Plank",
        "how": "Forearm plank with a flat back and tight belly. Builds the core that keeps your body long and stops your hips from sinking.",
        "reps": "3 x 20-40 sec"
      },
      {
        "name": "Superman holds",
        "how": "Lie face-down, lift your arms and legs off the floor, and hold. Strengthens the back-body line that holds your streamline together.",
        "reps": "3 x 20 sec"
      },
      {
        "name": "Ankle flexibility",
        "how": "Sit on your heels with the tops of your feet flat and toes pointed back, gently leaning to loosen the ankles for a floppier, faster kick.",
        "reps": "2 x 30 sec"
      },
      {
        "name": "Band or towel pull-backs",
        "how": "Hinge forward slightly and pull a light band or towel from out front all the way back past your hips, copying the freestyle finish. Keep the elbow high.",
        "reps": "2 x 12"
      }
    ],
    "progression": [
      "First, master the long balanced body line: a tight streamline off the wall, eyes down, and breathing with your body roll instead of lifting your head.",
      "Next, build a real high-elbow catch and finish every stroke past your hip so you travel farther on each pull — watch your stroke count per length drop.",
      "Then add strong underwater kicks off every wall and a steady every-3 breathing pattern so your speed holds up when you get tired.",
      "Finally, put it together at race pace: even pacing across a 50 or 100, fast tight flip turns, and the ability to build the last length without falling apart."
    ],
    "measure": "Once a week swim an easy 25 and count your strokes, and time a 50 free the same way each month — when your stroke count drops (or holds) while your time gets faster, your freestyle is genuinely improving."
  },
  "IM": {
    "key": "IM",
    "whyFast": "The IM is won in the transitions and on your weakest stroke, not by sprinting your best one — clean, legal, fast turns between strokes and smart pacing (controlled fly so your legs survive for freestyle) are what truly drop your time. The swimmer with no \"hole\" in their four strokes almost always beats the one with a single great stroke and a weak length.",
    "cues": [
      "Stroke order never changes: Fly, Back, Breast, Free. Say it before you step up.",
      "Swim the fly TALL and controlled — pretend the first length is the easy one.",
      "Every IM turn is a legal touch first, then the turn — know which touch each one needs.",
      "On the back-to-breast turn, touch on your back, then spin fast and go straight into your pullout.",
      "Use a streamline and a few dolphin kicks off the fly and back walls — that's free speed.",
      "Take your one legal breaststroke pullout off every breast wall — don't waste it.",
      "Breathe in a steady rhythm on every stroke; the IM is too long to hold your breath.",
      "Save something for freestyle — the last length is where you pass people, so finish hard."
    ],
    "getFaster": [
      {
        "title": "Turn your weakest stroke into a non-weakness",
        "how": "Find your slowest of the four strokes (your splits or a coach will tell you) and add one focused set of just that stroke every time you train — for example 4x50 with great technique, twice a week. You're not trying to make it your best stroke, just to erase the gap, because in the IM your weakest length leaks the most time. Over 4-6 weeks this is where you'll find the biggest drop with the least effort."
      },
      {
        "title": "Drill the four IM transitions until they're automatic",
        "how": "The fly-to-back, back-to-breast, and breast-to-free turns are pure free time most kids leave on the table. Pick one transition each session and rep it 8-10 times off the wall — touch legally, turn fast, and push off straight into a streamline. Done weekly, sloppy 'thinking' turns become instant reflexes, and you stop losing half a second every time the stroke changes."
      },
      {
        "title": "Learn to pace it (go out controlled, come home fast)",
        "how": "Swim 100 IMs where you deliberately hold the fly and back smooth and 'in control,' then build the breast and freestyle so the back half feels faster than the front. Try to make your freestyle length your fastest swim of the four. Do this once or twice a week and you'll train the engine and the discipline to stop blowing up on the fly — the number-one mistake in age-group IM."
      },
      {
        "title": "Build your underwaters and streamlines off every wall",
        "how": "Off the start and the fly and back walls, hold a tight streamline and add 3-5 dolphin kicks (stay legal, under the flags/15-meter mark) before your first stroke; off the breast wall, take your single allowed pullout. Practice this on every wall in every set, not just when you remember. These hidden seconds add up across four lengths and are the easiest speed in the race because they cost no extra fitness."
      },
      {
        "title": "Train the back half when you're already tired",
        "how": "Race fatigue hits hardest on the breast and free, so practice swimming those legs on tired legs. Do sets like Reverse IM (Free-Breast-Back-Fly) or finish a workout with 4x100 IM holding good technique when you'd rather quit. Once or twice a week this teaches your body to keep clean strokes and fast turns even when your arms are burning — which is exactly the back half of every IM."
      },
      {
        "title": "Build all-around fitness and core strength",
        "how": "The IM demands a complete swimmer, so mix longer steady swims for your aerobic engine with 2-3 short dryland sessions a week of core and whole-body strength. A strong, connected core is what holds your body line together across four different strokes when you're tired. Aim for fitness that lets you hold your best technique on the last length, not just the first."
      }
    ],
    "mistakes": [
      {
        "name": "Sprinting the fly and blowing up",
        "fix": "Swim the first length tall and controlled at about 80-85% — the fly is for setting up the race, not winning it. If your back and breast fall apart, you went out too hard."
      },
      {
        "name": "Slow, illegal, or 'thinking' transition turns",
        "fix": "Drill each IM turn separately until it's automatic. Remember the touches: fly and breast finish with a two-hand touch; the back-to-breast turn touches on your back first, then spins."
      },
      {
        "name": "Ignoring your weakest stroke in practice",
        "fix": "Add a short focused set of your hardest stroke every single practice. That weak length is where the race is lost, so it deserves the most attention, not the least."
      },
      {
        "name": "Forgetting or wasting the breaststroke pullout",
        "fix": "Off every breast wall, take your one legal pullout: a big pull to your thighs, glide, then recover and kick. It's free distance the rules give you — use it."
      },
      {
        "name": "Coasting the freestyle instead of finishing",
        "fix": "The last length is where you pass tired swimmers. Save enough to make your freestyle the fastest of the four strokes and sprint all the way into the wall."
      }
    ],
    "drills": [
      {
        "name": "IM Order 25s",
        "focus": "Legal transitions",
        "how": "Swim 25 of each stroke in IM order (Fly, Back, Breast, Free) with a correct, legal turn between each one. 4 rounds, focusing on a clean touch and a fast push-off into streamline every time."
      },
      {
        "name": "Transition Turn Reps (dry start at the wall)",
        "focus": "One turn at a time",
        "how": "Pick one transition per session — fly-to-back, back-to-breast, or breast-to-free — and rep it 10 times off the wall until the touch and spin are automatic. Then swim it into the next stroke for a few lengths."
      },
      {
        "name": "Reverse IM",
        "focus": "Finishing strong when tired",
        "how": "Swim the order backwards: Free, Breast, Back, Fly. 4x100. This trains the back half of the race and gets you used to swimming fly and back on tired arms."
      },
      {
        "name": "Weak-Stroke Set",
        "focus": "Erasing the gap",
        "how": "Pick your slowest of the four strokes and swim an extra 4x50 of it every practice with great technique and short rest. This is the single highest-value set in your week."
      },
      {
        "name": "Build-100 IM",
        "focus": "Pacing and negative split",
        "how": "Swim 100 IM trying to make each length feel a touch faster than the last, so freestyle is your fastest. 4-6x100 IM with rest. Hold the fly controlled so you can actually build."
      },
      {
        "name": "Underwater Streamline Off Each Wall",
        "focus": "Free speed on the walls",
        "how": "Off the fly and back walls, hold a tight streamline with 3-5 dolphin kicks before your first stroke; off the breast wall, take your full pullout. Do it on every wall, every set."
      }
    ],
    "dryland": [
      {
        "name": "Full-body strength circuit",
        "how": "Squats, push-ups, lunges, and glute bridges with clean, controlled form. The IM needs all-around strength, so train the whole body, not just the arms.",
        "reps": "2-3 rounds of 8-12 each"
      },
      {
        "name": "Core circuit (plank + hollow holds)",
        "how": "Forearm plank, side plank, and a hollow-body hold on your back with a flat lower back. A strong core is what ties all four strokes together when you get tired.",
        "reps": "3 x 20-40 sec each"
      },
      {
        "name": "Squat jumps",
        "how": "Sink to a quarter-squat and jump straight up, landing soft and quiet. Builds the explosive legs for faster starts and push-offs between strokes.",
        "reps": "3 x 8"
      },
      {
        "name": "Body dolphins on the floor",
        "how": "Lie face-down and ripple from your chest through your hips to your legs to feel where the dolphin kick starts — it powers your fly and your underwaters.",
        "reps": "3 x 10"
      },
      {
        "name": "Shoulder band work",
        "how": "Light band pull-aparts and external rotations to keep all four strokes' shoulders healthy and loose. Stop if anything pinches or hurts.",
        "reps": "2 x 12 each"
      }
    ],
    "progression": [
      "First, memorize the stroke order cold and swim a legal 100 IM (one length each) — correct strokes and a legal touch at every wall, even if it's slow.",
      "Next, make all four turns automatic and add a real streamline with a few dolphin kicks off the fly and back walls, plus your one pullout off the breast wall.",
      "Then learn to pace: hold the fly controlled and build into a strong freestyle so your back half is faster than your front half.",
      "Finally, attack your weakest stroke until you have no 'hole,' and step up to the 200 IM holding clean technique and fast turns even when tired."
    ],
    "measure": "Time a 100 IM and write down your split for each of the four strokes — your slowest split shows exactly which stroke to train next, and watching that gap shrink (and your last 25 free get faster) is how you know it's working."
  },
  "Butterfly": {
    "key": "Butterfly",
    "whyFast": "Speed in butterfly comes from rhythm and a forward-driving body wave, not from muscling your arms: when you press your chest so your hips ride up and time two dolphin kicks to every pull, momentum carries you across the top of the water. The swimmers who look smooth and stay flat almost always beat the ones who fight the water and throw their arms hard.",
    "cues": [
      "Two kicks per arm cycle: a little kick as your hands enter, a big kick as your hands finish past your hips.",
      "Press your chest down ('press the buoy') so your hips and legs pop up to the surface.",
      "Hands enter shoulder-width and just past your head, catch, then sweep all the way to your hips.",
      "Breathe low and early as your hands push back, chin skimming the water, then drive your head down first.",
      "Throw your arms forward low and wide over the water with thumbs down and elbows relaxed.",
      "Lead with your chest, not your head, so you travel forward instead of bobbing up and down.",
      "Stay flat and shallow, kicking from your belly and hips, not just your knees.",
      "Think rhythm, not muscle, and keep the same tempo every stroke, even tired."
    ],
    "getFaster": [
      {
        "title": "Build a real underwater dolphin kick",
        "how": "Push off the wall in a tight streamline a few inches under the surface and dolphin kick to the flags, kicking from your chest and hips so your whole body ripples, not just your feet. Do 8 rounds of about 10-15 yards two or three times a week, counting how many kicks it takes to reach the flags and trying to need one fewer over the weeks. A strong underwater is often worth more time than your swimming stroke, and it should feel like a snapping whip that flows from your core down to your toes."
      },
      {
        "title": "Lock in the two-kick timing until it's automatic",
        "how": "Most age-groupers only kick once per stroke and stall out, so spend a few weeks exaggerating both kicks on every length: a small kick as the hands enter and a big kick as they finish. Swim short 25s and say 'kick-KICK' in your head on each cycle until you don't have to think about it. When the timing clicks you'll feel the second kick launch your arms forward over the water almost for free."
      },
      {
        "title": "Fix the breath so it stops slowing you down",
        "how": "Breathing is where butterfly falls apart, so practice taking a low, early breath, chin close to the surface, then snapping your head and chest back down before your arms swing over. Start by breathing every 2nd stroke on short swims, and once that stays smooth, try a 'two strokes down, one breath' pattern so your face is in the water more of the race. It should feel like you sneak the air, not lift up to grab it."
      },
      {
        "title": "Add distance only after the rhythm holds",
        "how": "Don't grind out long, ugly fly: build it the way coaches do, by mastering a great 25 first, then stringing together more good strokes a little at a time. Each week add a few yards of clean fly before you let yourself rest, swimming, for example, 8x25 perfect, then progressing to 6x25 with the last few strokes still smooth, then occasional 50s. The goal is that your last stroke of a length looks as good as your first, never the opposite."
      },
      {
        "title": "Train the core that powers the wave",
        "how": "The dolphin motion comes from a strong, connected middle, so build it on land with planks, hollow-body holds, and slow body dolphins on the floor two or three times a week. Hold each for 20-40 seconds with a tight belly and don't let your back sag. After a few weeks of this you'll notice your hips ride higher and your kick feels like it starts from your stomach instead of dying at your knees."
      }
    ],
    "mistakes": [
      {
        "name": "Lifting the head and chest too high to breathe",
        "fix": "Breathe low and early as your hands push back, keeping your chin near the water, then drive your head down before your arms recover. Rearing up sinks your hips and stops you cold."
      },
      {
        "name": "Only one kick per stroke",
        "fix": "Add the second kick on the entry so it's two per arm cycle. The entry kick keeps you flat and slings your arms forward, while one kick leaves you sinking and stalling."
      },
      {
        "name": "Muscling stiff, high, straight arms over the water",
        "fix": "Relax the recovery and throw your arms low and wide with thumbs down, letting the rhythm carry them. Tense, high arms drain your energy and break your timing."
      },
      {
        "name": "Diving too deep on every stroke",
        "fix": "Press your chest just enough to stay flat and shallow, traveling forward instead of plunging down. Going deep wastes effort going the wrong direction."
      },
      {
        "name": "Speeding up the tempo when tired",
        "fix": "Hold one steady rhythm the whole way and let your kick keep you moving, rather than thrashing your arms faster. Rushing wrecks the timing exactly when you need it most."
      }
    ],
    "drills": [
      {
        "name": "Underwater Dolphin Kick",
        "focus": "Kick from the core, distance per push-off",
        "how": "Streamline off each wall and dolphin kick from your chest and hips, not just your knees, staying a few inches under the surface. 8x15yd, counting your kicks to the flags."
      },
      {
        "name": "Single-Arm Fly",
        "focus": "Timing and a clean catch",
        "how": "One arm strokes while the other stays stretched out front; breathe to the side so you can keep your rhythm. Keep both dolphin kicks going. 4x25 each arm."
      },
      {
        "name": "3 Right / 3 Left / 3 Full",
        "focus": "Rhythm builder",
        "how": "Three single-arm strokes right, three left, then three full strokes, keeping the same two-kick timing throughout. 6x25."
      },
      {
        "name": "2 Kick / 1 Pull Fly",
        "focus": "Locking in two-kick timing",
        "how": "Exaggerate both kicks, a small one on entry and a big one on the finish, until the timing is automatic. Say 'kick-KICK' each cycle. 6x25."
      },
      {
        "name": "3 Fly + 3 Free by 25",
        "focus": "Smooth fly while fresh",
        "how": "Swim three good fly strokes, then switch to freestyle to finish the length, so you only ever practice clean fly. Add a stroke as it gets easier. 6x25."
      },
      {
        "name": "Body-Dolphin Streamline",
        "focus": "The wave from chest to toes",
        "how": "In a tight streamline at the surface, dolphin with no arms, feeling the ripple start at your chest and roll to your feet. 6x25 easy, smooth and connected."
      }
    ],
    "dryland": [
      {
        "name": "Body dolphins on the floor",
        "how": "Lie face-down, arms in streamline, and ripple from chest to hips to legs so you feel where the kick starts. Move slowly and smoothly.",
        "reps": "3 x 10"
      },
      {
        "name": "Hollow-body holds",
        "how": "On your back, arms overhead, press your lower back into the floor and lift your shoulders and feet a few inches. This is the core shape fly is built on.",
        "reps": "3 x 20-30 sec"
      },
      {
        "name": "Plank",
        "how": "Forearm plank with a flat back and tight belly. Builds the connected middle that carries the wave forward.",
        "reps": "3 x 20-40 sec"
      },
      {
        "name": "Superman holds",
        "how": "Face-down, lift your arms and legs off the floor and hold for the back strength fly demands.",
        "reps": "3 x 20 sec"
      },
      {
        "name": "Band pull-aparts",
        "how": "Hold a light band with straight arms and pull it apart across your chest, squeezing your shoulder blades. Keeps the over-water recovery loose and healthy.",
        "reps": "2 x 12"
      }
    ],
    "progression": [
      "Master a great underwater dolphin kick off the wall in a tight streamline, kicking from your core. This is your foundation and your easiest free speed.",
      "Lock in the two-kick-per-pull timing on a smooth 25, so the entry kick and finish kick feel automatic and your hips stay up.",
      "Add a low, early breath that doesn't break your rhythm, working toward keeping your face down more of the length (like two strokes down, one breath).",
      "String together longer clean fly (a strong 50, then more) where your last stroke looks as good as your first, never grinding out ugly strokes to finish."
    ],
    "measure": "Time yourself on a 25 fly or count how many strokes it takes to swim one length, and over the weeks aim to either drop your time or cover the length in fewer, smoother strokes while still kicking twice per pull."
  },
  "Breaststroke": {
    "key": "Breaststroke",
    "whyFast": "Breaststroke speed comes from rhythm and a clean, narrow kick more than from muscling the pull — the fastest swimmers hold a long, flat glide line and snap a powerful \"whip\" kick that finishes with the feet, then sneak the arms forward without standing up in the water. Win the streamline-and-kick and you win the race.",
    "cues": [
      "Pull, breathe, kick, GLIDE — say it in that order every stroke",
      "Heels to your butt, then snap the feet around and SQUEEZE them together",
      "Hide behind your hands: stretch long and skinny after every kick",
      "Sneak the arms forward low and fast — don't reach to the sky",
      "Press your chest down a hair so your hips stay high",
      "Eyes down, chin tucked — look at the bottom, not the wall",
      "Make the kick whip-snap, not a slow frog push",
      "One pulldown off every wall, then break out before you slow down"
    ],
    "getFaster": [
      {
        "title": "Build a whip kick that actually finishes",
        "how": "The kick is where most breaststrokers leave time on the table. 2-3 times a week do a kick set on your back with a board on your belly (arms streamlined overhead) so you can feel the heels coming up and the feet snapping out-around-and-together — 8x25 or 6x50, resting enough to keep each one sharp. It should feel like you finish by clapping the soles of your feet, then your legs go totally straight and still; if your knees drop way below your hips or your feet point at the wall, slow down and fix the shape before adding speed."
      },
      {
        "title": "Steal distance with the glide (distance-per-stroke)",
        "how": "Faster doesn't mean more strokes — it means more travel per stroke. Once or twice a week, count your strokes for a 25 and try to take one or two fewer while keeping the same time, by holding the streamline a beat longer after each kick. Aim to feel a clear 'free ride' moment where you're long and skinny and not pulling; when you can drop a stroke or two without slowing down, your efficiency just went up and the speed follows."
      },
      {
        "title": "Master the underwater pulldown off every wall",
        "how": "The pulldown (one big pull to the thighs, a streamline glide, one dolphin kick is legal in summer league — check your rules, otherwise a breast kick) is free speed almost nobody uses. After each push-off, hold a tight streamline, take ONE long pull all the way to your hips, glide, then break out into your first stroke before you feel yourself slowing. Practice 8-10 push-offs a session focused only on this; the goal is to surface already moving fast, not to pop straight up."
      },
      {
        "title": "Connect the timing so there's no dead spot",
        "how": "Breaststroke is a rhythm stroke: the power should flow pull-then-kick with no pause where you stall. Swim easy 50s thinking 'kick me forward into my glide' — the kick should fire just as your hands shoot forward, launching you into the long part. A few times a week do 4-6x50 building from slow-and-perfect to race rhythm; it should start to feel bouncy and connected, like the kick keeps relaunching you instead of you grinding to a stop each stroke."
      },
      {
        "title": "Train race pace and the back-half",
        "how": "Breaststroke hurts late because the legs fatigue, so practice holding your stroke when tired. Once a week do short race-pace repeats with rest — like 8x25 fast on a comfortable interval, or 4x50 holding your 100 goal pace — and focus on keeping the kick FULL and the glide LONG even as you tire. The win is finishing the last few strokes with the same shape as the first; if your stroke gets short and choppy when tired, that's exactly the moment to lengthen, not speed up the arms."
      }
    ],
    "mistakes": [
      {
        "name": "Lifting the head and shoulders too high to breathe",
        "fix": "You're hitting the brakes every breath. Breathe by letting your hips drive your chin just above the surface, then drop right back down behind your hands — think 'breathe forward, not up,' and keep your eyes angled down at the water in front of you."
      },
      {
        "name": "A wide, slow 'frog' kick instead of a snappy whip",
        "fix": "Bring your HEELS to your seat (not your knees way forward), keep the knees about shoulder-width, then whip the feet out, around, and slam them together. Do slow kick-on-back drills feeling the soles 'clap,' then speed it up once the shape is right."
      },
      {
        "name": "No glide — rushing into the next stroke",
        "fix": "You're swimming in place. After every kick, freeze in streamline for a silent count of 'one' and feel yourself shoot forward. Count strokes per length and try to take fewer; the glide is where free speed lives."
      },
      {
        "name": "Pulling too wide and too far back past the chest",
        "fix": "Breaststroke arms are a small, fast scull, not a giant freestyle pull. Pull out to about shoulder-width, sweep your hands together under your chin, and shoot them forward fast and low — never pull past your ribs or you'll stall and sink."
      },
      {
        "name": "Pulling and kicking at the same time",
        "fix": "That cancels your power and stops you dead. Lock in the order: arms pull while legs stay straight, THEN legs kick as the arms shoot forward. Swim slow 50s saying 'pull-kick-glide' out loud in your head until the timing is automatic."
      }
    ],
    "drills": [
      {
        "name": "2 Kicks + 1 Pull",
        "focus": "Builds a powerful kick and forces a long glide between strokes",
        "how": "Take two full breaststroke kicks in streamline for every one arm pull. 6-8x25. Hold each glide until you feel yourself slow, then go again. Feel the kick launch you forward each time."
      },
      {
        "name": "Kick on Back (arms streamlined)",
        "focus": "Feeling the heels come up and the feet snap and squeeze",
        "how": "On your back, arms stretched overhead in streamline, do breaststroke kick only. 8x25 or 6x50. Watch your knees stay under the surface and feel the soles 'clap' together at the end of each kick."
      },
      {
        "name": "3 Strokes + Glide (stroke-count)",
        "focus": "Distance-per-stroke and a patient, long body line",
        "how": "Swim 3 strokes, then hold a full streamline glide across the rest of the 25. 6x25. Count total strokes and try to lower the number each round without slowing down."
      },
      {
        "name": "Pulldowns off the wall",
        "focus": "Fast, powerful starts and turns",
        "how": "From a push-off, one long pull to the thighs, streamline glide, then break out into your first full stroke. 8-10 reps. Goal: surface already moving fast, not popping straight up."
      },
      {
        "name": "2 Pulls / 2 Kicks separation",
        "focus": "Cleaning up timing and isolating each power source",
        "how": "Do 2 arm-only strokes (legs straight, small flutter ok) then 2 kick-only cycles in streamline, alternating down the lane. 4-6x50. Then put them together and feel the 'pull-then-kick' rhythm."
      },
      {
        "name": "Tempo 50s (build)",
        "focus": "Holding stroke length while raising race rhythm",
        "how": "4-6x50 starting slow and perfect, getting faster each 50 to near race pace. Keep the glide long and the kick full even as you speed up. Last one should feel bouncy and connected."
      }
    ],
    "dryland": [
      {
        "name": "Streamline wall holds",
        "how": "Stand tall, hands stacked, arms squeezing your ears, and hold a perfect streamline against a wall to train a tight, skinny body line. Press your belly button to your spine.",
        "reps": "3x30 seconds"
      },
      {
        "name": "Glute bridges",
        "how": "Lie on your back, knees bent, feet flat, and lift your hips up squeezing your butt, then lower slowly. Builds the hip power that drives the kick and keeps your hips high.",
        "reps": "2-3x12"
      },
      {
        "name": "Wall sits",
        "how": "Slide down a wall until your knees are bent about 90 degrees and hold, building the leg endurance breaststrokers need on the back half of a race.",
        "reps": "3x20-40 seconds"
      },
      {
        "name": "Squat-to-calf-raise",
        "how": "Do a slow bodyweight squat, then as you stand all the way up rise onto your toes — this trains the squeeze-and-snap of the legs and ankles used in the kick.",
        "reps": "2-3x10"
      },
      {
        "name": "Plank",
        "how": "Hold a straight-body plank on your forearms with hips level (not sagging) to build the core that keeps you long and flat instead of bending in the middle.",
        "reps": "3x20-40 seconds"
      }
    ],
    "progression": [
      "First, master the shape: a tight streamline glide and a whip kick that finishes with the feet snapping together (no wide frog kick).",
      "Next, lock the timing — pull, breathe, kick, glide in that order with no dead spot, and add one strong pulldown off every wall.",
      "Then build distance-per-stroke: take fewer strokes per length at the same speed by holding the glide longer.",
      "Finally, hold that long, full stroke at race pace when tired — same kick and glide on the last lap as the first."
    ],
    "measure": "Once a week, swim a 25 and count your strokes while a parent or friend times you — getting faster at the same stroke count (or the same time at fewer strokes) means your breaststroke is genuinely improving."
  }
};

  // Merge metadata + content into the STROKES the UI renders.
  var STROKES = {};
  ['Freestyle', 'Backstroke', 'Breaststroke', 'Butterfly', 'IM'].forEach(function (k) {
    var m = STROKE_META[k] || {}, c = STROKE_CONTENT[k] || {};
    STROKES[k] = {
      key: k, name: m.name || k, color: m.color || '#60a5fa', emoji: m.emoji || '🏊', tagline: m.tagline || '',
      whyFast: c.whyFast || '',
      cues: c.cues || [],
      getFaster: c.getFaster || [],
      mistakes: c.mistakes || [],
      drills: c.drills || [],
      dryland: c.dryland || [],
      progression: c.progression || [],
      measure: c.measure || ''
    };
  });
  var STROKE_ORDER = ['Freestyle', 'Backstroke', 'Breaststroke', 'Butterfly', 'IM'];


  var EXTRAS = [
    {
      key: 'Streamline', name: 'Streamline & Underwaters', color: '#38bdf8', emoji: '🚀',
      tagline: 'The single fastest thing you do all race — and most kids leave it on the table.',
      how: 'Off every start and wall you’re moving faster than you ever do swimming. A tight streamline plus a few underwater dolphin kicks turns that speed into free distance. Coaches love it because it’s pure technique: anyone can get great at it, no extra strength required.',
      cues: [
        'Hands stacked one on top of the other, thumb wrapped — squeeze your arms against your ears.',
        'Push off a few inches under the surface, not along the top, and hold the line.',
        'Add 3–5 dolphin kicks off each wall (stay legal — under the 15-meter mark).',
        'Stay tight until you feel yourself slowing, then break out into your first stroke.',
        'No breath on your first stroke off a wall — it wrecks the streamline.'
      ],
      items: [
        { name: 'Streamline kick every wall', focus: 'Make it a habit', how: 'Push off in a perfect streamline and kick to the flags before you take a stroke — every single wall.' },
        { name: 'Underwater dolphin', focus: 'Distance per push-off', how: 'Streamline off the wall and dolphin kick 8×15m, counting how far you get on the same number of kicks.' },
        { name: 'Hollow-body holds (dry)', focus: 'Hold the shape', how: 'On your back, arms overhead, press your lower back down and hold the streamline shape. 3 × 20–30 sec.' }
      ],
      focus: 'If you only fix one thing this month, fix your walls. Great streamlines win close races without changing your stroke at all.'
    },
    {
      key: 'Starts', name: 'Starts (the dive)', color: '#f59e0b', emoji: '🏁',
      tagline: 'A fast, far dive gives you a lead before you’ve taken a stroke.',
      how: 'A good racing start is explosive and clean. You load your weight, drive off the block out and slightly up, and slip through one small "hole" in the water so you barely slow down — then streamline into your underwater kicks.',
      cues: [
        'Feet about hip-width, toes curled over the edge, weight slightly forward.',
        'Pull down on the block to load, then explode out and a touch up.',
        'Reach for a spot a few feet out — enter hands-first through one hole.',
        'Squeeze into a tight streamline the instant you enter the water.',
        'Pick up your underwater kicks immediately and ride the speed.'
      ],
      items: [
        { name: 'Standing broad jump', focus: 'Explosive distance', how: 'From a standstill, jump as far forward as you can and stick the landing. 3 × 5. Mirrors the drive off the block.' },
        { name: 'Squat jumps', focus: 'Leg power', how: 'Sink to a quarter-squat and jump straight up, soft landings. 3 × 8.' },
        { name: 'Streamline holds', focus: 'Tight entry shape', how: 'Hold a perfect streamline so it’s automatic when you hit the water. 3 × 30 sec.' }
      ],
      focus: 'Always practice dives in deep water with a coach or lifeguard. Never dive into shallow water.'
    },
    {
      key: 'Turns', name: 'Turns', color: '#22d3ee', emoji: '🔄',
      tagline: 'Accelerate INTO the wall, turn fast, and explode OUT in streamline.',
      how: 'Slow turns quietly cost more time than your stroke does. Freestyle and backstroke use a flip turn; breaststroke and butterfly use a two-hand-touch open turn. In every case the rule is the same: don’t glide in, turn quick, and leave the wall faster than you arrived.',
      cues: [
        'Free flip turn: no breath into the wall, fast somersault, plant your feet, push off on your back, then rotate to your stomach in streamline.',
        'Open turn (breast/fly): two-hand touch, tuck your knees, throw your arms over, and push off into streamline.',
        'Drive your feet onto the wall and explode — the wall is a chance to speed up, not rest.',
        'Always come off the wall in a tight streamline with a few kicks before your first stroke.'
      ],
      items: [
        { name: 'Flip-turn reps', focus: 'Fast rotation', how: 'Swim in and flip at the wall 10× in a row, pushing off in streamline each time.' },
        { name: '5 turns in a row', focus: 'Consistency when tired', how: 'Do 5 quick turns back-to-back without stopping to build automatic, fast feet.' },
        { name: 'Wall push-off streamlines', focus: 'Explode out', how: 'Push off the wall as far as you can in streamline on one breath; mark how far you reach.' }
      ],
      focus: 'Count your strokes into each wall so you never glide or over-reach. Smooth, fast turns are some of the easiest free time in the pool.'
    },
    {
      key: 'Endurance', name: 'Endurance & Breathing', color: '#10b981', emoji: '🫁',
      tagline: 'Fitness is "easy speed" — the fitter you are, the faster you can hold your best technique.',
      how: 'Conditioning lets you swim fast technique for the whole race instead of just the first length. Build an aerobic base with steady swimming (or running and biking on land), learn to breathe in a relaxed rhythm, and practice negative splits — swimming the second half faster than the first.',
      cues: [
        'Exhale fully underwater so each breath is just a quick, relaxed sip.',
        'Find a breathing rhythm and stick to it — don’t hold your breath and panic.',
        'Build a base with longer, steady swims; "easy speed" comes from fitness.',
        'Practice negative splits: make the back half faster than the front half.'
      ],
      items: [
        { name: '8 × 50 steady', focus: 'Aerobic base', how: 'Swim 8×50 at a comfortable, repeatable pace with short rest. Hold the same time on each.' },
        { name: '4 × 100 build', focus: 'Pacing control', how: 'Each 100 gets faster from start to finish (build), teaching you to finish strong.' },
        { name: 'Land cardio', focus: 'Off-pool fitness', how: 'Running, biking, or jump rope 2–3× a week builds the engine that powers fast swimming.' }
      ],
      focus: 'You can train endurance even without a pool — anything that gets you breathing hard builds the engine for faster swims.'
    },
    {
      key: 'Dryland', name: 'Dryland Foundations', color: '#a78bfa', emoji: '💪',
      tagline: 'Bodyweight strength and mobility you can do at home — no pool required.',
      how: 'Dryland builds the core, hips, and shoulders that hold your body in a fast position. For young swimmers it’s all bodyweight: core, legs, and mobility. Do 2–3 short sessions a week, focus on good form, and remember it should never hurt.',
      cues: [
        'Core first: a strong middle keeps your body flat and connected in the water.',
        'Train legs and hips for stronger kicks, starts, and walls.',
        'Keep shoulders healthy with light band work and good mobility.',
        '2–3 short sessions a week beats one long one. Quality over quantity.'
      ],
      items: [
        { name: 'Core circuit', focus: 'A connected body line', how: 'Plank, side plank, hollow hold, and flutter kicks on your back. 2–3 rounds, 20–40 sec each.' },
        { name: 'Strength basics', focus: 'Whole-body power', how: 'Push-ups, squats, lunges, and glute bridges. 2–3 sets of 8–12 with clean form.' },
        { name: 'Power', focus: 'Starts + walls', how: 'Squat jumps and broad jumps, landing softly. 3 × 6–8.' },
        { name: 'Mobility', focus: 'Reach + ankle flex', how: 'Shoulder band pull-aparts, deep-squat holds, and pointed-toe ankle stretches.', }
      ],
      focus: 'Dryland should never cause pain — if something hurts, stop. Warm up first, move with control, and ask an adult to check your form.'
    }
  ];

  /* =========================================================
     WEEKLY PLAN — a simple, encouraging template for a swimmer
     who wants to practice on their own outside of team. Pure
     guidance; the page renders it as a 7-day list.
     ========================================================= */
  var WEEKLY_PLAN = {
    intro: 'Here’s a simple week you can do on your own to get faster — most of it needs no pool at all. Mix and match around your team schedule, and always swim with a lifeguard or adult present.',
    days: [
      { day: 'Monday', title: 'Core + Streamline', detail: 'Dryland core circuit (plank, hollow holds, superman) plus 3 long streamline holds. 15–20 min.' },
      { day: 'Tuesday', title: 'Technique focus', detail: 'Pick one stroke and do its drills (if you have pool time) or rehearse the cues dry in front of a mirror.' },
      { day: 'Wednesday', title: 'Land cardio', detail: 'Run, bike, or jump rope for 20–30 min to build your aerobic engine.' },
      { day: 'Thursday', title: 'Strength + Power', detail: 'Squats, push-ups, lunges, glute bridges, and squat jumps. 2–3 rounds.' },
      { day: 'Friday', title: 'Weak-stroke + turns', detail: 'Drill your hardest stroke and rep starts/turns. This is where the easy time hides.' },
      { day: 'Saturday', title: 'Fun swim / endurance', detail: 'Easy, steady swimming or active play in the water. Keep it fun and relaxed.' },
      { day: 'Sunday', title: 'Rest + stretch', detail: 'Light stretching and mobility. Rest days are when you actually get faster.' }
    ],
    note: 'Safety first: never swim alone, always have a lifeguard or adult present, and stop any exercise that causes pain.'
  };

  var BENCHMARKS = {
  "Freestyle": {
    "15": {
      "6 & Under": 16
    },
    "25": {
      "6 & Under": 24,
      "7-8": 21,
      "9-10": 18,
      "11-12": 16,
      "13-14": 15,
      "15-18": 14
    },
    "50": {
      "7-8": 50,
      "9-10": 42,
      "11-12": 34,
      "13-14": 31,
      "15-18": 28
    },
    "100": {
      "9-10": 92,
      "11-12": 75,
      "13-14": 68,
      "15-18": 62
    },
    "200": {
      "11-12": 162,
      "13-14": 146,
      "15-18": 132
    }
  },
  "Backstroke": {
    "15": {
      "6 & Under": 18
    },
    "25": {
      "6 & Under": 28,
      "7-8": 25,
      "9-10": 21,
      "11-12": 19,
      "13-14": 17,
      "15-18": 16
    },
    "50": {
      "7-8": 58,
      "9-10": 48,
      "11-12": 38,
      "13-14": 34,
      "15-18": 31
    },
    "100": {
      "9-10": 106,
      "11-12": 84,
      "13-14": 75,
      "15-18": 69
    }
  },
  "Breaststroke": {
    "15": {
      "6 & Under": 20
    },
    "25": {
      "6 & Under": 31,
      "7-8": 28,
      "9-10": 24,
      "11-12": 21,
      "13-14": 20,
      "15-18": 18
    },
    "50": {
      "7-8": 64,
      "9-10": 54,
      "11-12": 45,
      "13-14": 41,
      "15-18": 38
    },
    "100": {
      "9-10": 118,
      "11-12": 99,
      "13-14": 90,
      "15-18": 84
    }
  },
  "Butterfly": {
    "15": {
      "6 & Under": 18
    },
    "25": {
      "6 & Under": 29,
      "7-8": 26,
      "9-10": 22,
      "11-12": 20,
      "13-14": 18,
      "15-18": 17
    },
    "50": {
      "7-8": 62,
      "9-10": 51,
      "11-12": 40,
      "13-14": 36,
      "15-18": 33
    },
    "100": {
      "11-12": 88,
      "13-14": 79,
      "15-18": 73
    }
  },
  "IM": {
    "100": {
      "9-10": 102,
      "11-12": 85,
      "13-14": 77,
      "15-18": 71
    },
    "200": {
      "11-12": 183,
      "13-14": 165,
      "15-18": 152
    }
  },
  "notes": "Realistic, attainable summer-league goal times (short-course yards) — motivating targets, not elite cuts."
};

  // ---- Benchmark lookup ----
  function benchmarkFor(stroke, distance, bracket) {
    var s = BENCHMARKS[stroke];
    if (!s) return null;
    var d = s[String(distance).replace(/[^0-9]/g, '')];
    if (!d) return null;
    var v = d[bracket];
    return (typeof v === 'number' && isFinite(v)) ? v : null;
  }

  // Next clean whole-second barrier just under a time.
  function nextBarrier(best) {
    if (!isFinite(best)) return null;
    var b = Math.floor(best);
    if (best - b < 0.10) b -= 1;
    return b > 0 ? b : null;
  }
  // Round to a clean target (nearest 0.5s under a minute, nearest 1s above).
  function roundClean(sec) {
    if (!isFinite(sec)) return sec;
    return sec < 60 ? Math.round(sec * 2) / 2 : Math.round(sec);
  }
  // An ATTAINABLE near-term goal: roughly a 5% drop (min 1s), but never faster
  // than the long-term age-group benchmark — so the headline goal always feels
  // reachable even when the age-group time is still far away.
  function steppingStone(current, benchSec) {
    var drop = Math.max(1.0, current * 0.05);
    var target = current - drop;
    if (benchSec != null && target < benchSec) target = benchSec;
    target = roundClean(target);
    if (!(target > 0) || target >= current) target = nextBarrier(current);
    return target;
  }
  function statusFor(seconds, bench) {
    if (bench == null) return 'general';
    if (seconds <= bench * 1.02) return 'strong';
    if (seconds <= bench * 1.12) return 'onTrack';
    return 'developing';
  }

  // Build one personalized tip from a statsForSwimmer bestTimes entry.
  function buildTip(b, bracket) {
    var stroke = b.stroke || strokeOf(b.event);
    if (!stroke || !STROKES[stroke]) return null;
    if (!isFinite(b.seconds)) return null;
    var distance = (b.distance || distOf(b.event) || '').toString().replace(/[^0-9]/g, '');
    var bench = benchmarkFor(stroke, distance, bracket);
    var status = statusFor(b.seconds, bench);
    var g = STROKES[stroke];

    // Headline goal = attainable near-term target. Strong swimmers chase the
    // next clean barrier; everyone else chases a realistic stepping stone.
    var nearSec, nearKind;
    if (status === 'strong') { nearSec = nextBarrier(b.seconds); nearKind = 'next barrier'; }
    else { nearSec = steppingStone(b.seconds, bench); nearKind = 'next goal'; }
    if (!(nearSec > 0) || nearSec >= b.seconds) nearSec = nextBarrier(b.seconds);
    // Stretch goal = the age-group benchmark, shown only when it's meaningfully
    // beyond the near-term goal (so we don't show two near-identical numbers).
    var stretchSec = (bench != null && nearSec != null && bench < nearSec - 0.05) ? bench : null;

    return {
      event: b.event, stroke: stroke, distance: distance, color: g.color, emoji: g.emoji,
      time: b.time, seconds: b.seconds,
      bench: bench, benchTime: bench != null ? fmt(bench) : '',
      gapToBench: bench != null ? (b.seconds - bench) : null,
      goalSec: nearSec, goalTime: nearSec != null ? fmt(nearSec) : '', goalKind: nearKind,
      stretchSec: stretchSec, stretchTime: stretchSec != null ? fmt(stretchSec) : '',
      status: status,
      methods: (g.getFaster || []).slice(0, 3),
      drills: (g.drills || []).slice(0, 3),
      dryland: (g.dryland || []).slice(0, 2),
      cues: (g.cues || []).slice(0, 4),
      mistakes: (g.mistakes || []).slice(0, 2),
      progression: g.progression || [],
      measure: g.measure || '',
      topMethod: (g.getFaster && g.getFaster[0]) ? g.getFaster[0].title : '',
      improvement: b.improvement || 0, improvementPct: b.improvementPct || 0, count: b.count || 0
    };
  }

  function tipsForSwimmer(stats, info) {
    var bracket = (info && info.bracket) || (stats && stats.ageGroup) || 'Unknown';
    var out = { bracket: bracket, focus: [], strengths: [], topFocus: null, hasData: false };
    var bts = (stats && stats.bestTimes) || [];
    bts.forEach(function (b) {
      var tip = buildTip(b, bracket);
      if (!tip) return;
      out.hasData = true;
      if (tip.status === 'strong') out.strengths.push(tip);
      else out.focus.push(tip);
    });
    var rankStatus = function (s) { return s === 'developing' ? 0 : s === 'onTrack' ? 1 : 2; };
    out.focus.sort(function (a, b) {
      if (rankStatus(a.status) !== rankStatus(b.status)) return rankStatus(a.status) - rankStatus(b.status);
      var ga = a.gapToBench != null ? a.gapToBench : 0, gb = b.gapToBench != null ? b.gapToBench : 0;
      return gb - ga;
    });
    out.strengths.sort(function (a, b) {
      var ga = a.gapToBench != null ? a.gapToBench : 0, gb = b.gapToBench != null ? b.gapToBench : 0;
      return ga - gb;
    });
    out.topFocus = out.focus[0] || null;
    return out;
  }

  global.HHST_TRAIN = {
    STROKES: STROKES,
    STROKE_ORDER: STROKE_ORDER,
    EXTRAS: EXTRAS,
    WEEKLY_PLAN: WEEKLY_PLAN,
    BENCHMARKS: BENCHMARKS,
    benchmarkFor: benchmarkFor,
    nextBarrier: nextBarrier,
    steppingStone: steppingStone,
    tipsForSwimmer: tipsForSwimmer,
    fmt: fmt
  };
})(window);
