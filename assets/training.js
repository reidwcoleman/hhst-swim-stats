/* =============================================================
   HHST Swim Stats — Training knowledge base + personalized engine
   -------------------------------------------------------------
   ONE source of truth for "how to get faster," shared by:
     • get-faster.html  — the full public guide (renders STROKES + EXTRAS)
     • dashboard.html   — the personalized plan (tipsForSwimmer)

   Pure content + a small engine. No Firebase, no network. It uses a
   couple of HHST helpers (fmtTime / extractStroke / extractDistance)
   when they're present, but degrades gracefully if data.js isn't loaded
   (so the public guide page can stay lightweight).

   Everything here is COACHING GUIDANCE, written to be encouraging and
   age-appropriate. The benchmark "goal times" are friendly targets to
   chase — not official cuts. They exist so the personalized plan can say
   "you're here, a strong time is about there, and this is how to close it."
   ============================================================= */
(function (global) {
  'use strict';

  // ---- tiny helpers (work with or without data.js) ----
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

  /* =========================================================
     STROKES — the heart of the guide. One entry per stroke.
     Each: name, key, color, emoji, tagline, how (what the stroke
     is), cues (quick "think about this" checkpoints), mistakes
     (what slows kids down + the fix), drills (in-water practice),
     dryland (at-home, no pool), and a short focus note.
     ========================================================= */
  var STROKES = {
    Freestyle: {
      key: 'Freestyle', name: 'Freestyle', color: '#60a5fa', emoji: '🌊',
      tagline: 'The fastest stroke — built on a long, balanced body and a high-elbow pull.',
      how: 'Freestyle (front crawl) is all about traveling long and staying flat. You reach far in front, catch the water with a bent elbow, and press it back past your hip while a small, fast kick keeps your legs up. Speed comes from a long body line and a clean catch — not from thrashing your arms.',
      cues: [
        'Reach long — stretch your fingertips past your head before every pull.',
        'High-elbow catch: point your fingertips at the bottom of the pool, then press the water back toward your feet.',
        'Kick small and fast from your hips with loose ankles and pointed toes.',
        'Roll body-to-side and breathe in that roll — keep one goggle in the water.',
        'Keep your head still, eyes down — don’t lift it to breathe.',
        'Exhale steadily underwater so the breath is just a quick sip of air.'
      ],
      mistakes: [
        { name: 'Lifting the head to breathe', fix: 'Turn your head with your body roll and leave one ear in the water. Lifting drops your hips and slams on the brakes.' },
        { name: 'Hand crossing over the center line', fix: 'Enter your hand in line with your shoulder, not across your nose. Catch-Up drill fixes this fast.' },
        { name: 'Straight, dragging arm pull', fix: 'Bend your elbow and press with the whole forearm — a high-elbow catch grabs far more water.' },
        { name: 'Big, bouncy "bicycle" kick', fix: 'Make the kick small and quick from the hips; your knees should barely bend.' }
      ],
      drills: [
        { name: 'Catch-Up', focus: 'Long reach + no crossover', how: 'Keep one arm stretched out front; only pull with it once the other hand "catches up" to it. 4×25.' },
        { name: 'Fingertip Drag', focus: 'High-elbow recovery', how: 'Drag your fingertips along the surface as your arm swings forward, keeping the elbow high. 4×25.' },
        { name: '6-Kick Switch', focus: 'Balance + body rotation', how: 'On your side in streamline, kick 6 times, then take one stroke to switch sides. 6×25.' },
        { name: '3/3/3 Breathing', focus: 'Even breathing both sides', how: 'Breathe every 3rd stroke so you alternate left and right. Builds a balanced stroke. 4×50.' }
      ],
      dryland: [
        { name: 'Streamline holds', how: 'Stand tall, hands stacked, arms squeezing your ears — hold a tight, long line.', reps: '3 × 30 sec' },
        { name: 'Plank', how: 'Forearm plank, flat back, tight belly. Builds the core that keeps you streamlined.', reps: '3 × 20–40 sec' },
        { name: 'Superman holds', how: 'Lie face-down, lift arms and legs off the floor, hold. Strengthens your back line.', reps: '3 × 20 sec' },
        { name: 'Ankle flexibility', how: 'Sit on your heels with toes pointed back to loosen ankles for a better kick.', reps: '2 × 30 sec' }
      ],
      focus: 'Freestyle rewards distance-per-stroke. Count your strokes per length and try to travel farther each stroke without slowing your tempo.'
    },

    Backstroke: {
      key: 'Backstroke', name: 'Backstroke', color: '#34d399', emoji: '⬆️',
      tagline: 'Race lying flat with hips high, rolling shoulder-to-shoulder behind a steady kick.',
      how: 'Backstroke is freestyle flipped over. You stay long and flat on your back with your hips at the surface, enter each arm pinky-first straight overhead, catch deep, and press the water down to your feet. A constant flutter kick holds your body up and drives your rotation.',
      cues: [
        'Lie flat with hips up and head perfectly still — eyes straight up.',
        'Pinky enters first, arm brushing past your ear like a clock hand.',
        'Catch deep, then press the water down toward your feet with a bent elbow.',
        'Roll shoulder-to-shoulder — let your hips drive the rotation.',
        'Kick small and fast; let your toes just tickle the surface.',
        'Count your strokes into the wall so you finish strong, not crashing.'
      ],
      mistakes: [
        { name: 'Sitting up / moving the head', fix: 'Keep the back of your head in the water and hips high. A bobbing head sinks your legs.' },
        { name: 'Throwing the arm flat and wide', fix: 'Enter pinky-first straight overhead, then catch deep. Flat, wide arms just slip.' },
        { name: 'Bending at the waist', fix: 'Stay long and flat and kick your legs up to the surface — don’t sit in a "chair."' },
        { name: 'Stopping the kick', fix: 'Backstroke needs a continuous kick to stay flat — keep it going the whole length.' }
      ],
      drills: [
        { name: 'Streamline Kick on Back', focus: 'Body line + kick', how: 'Arms in a tight streamline, kick on your back with hips high. 6×25.' },
        { name: 'Single-Arm Back', focus: 'Clean entry + deep catch', how: 'One arm only, the other at your side; nail the pinky-first entry and deep press. 4×25 each arm.' },
        { name: 'Pencil Rotation', focus: 'Hip-driven roll', how: 'Hands at your sides, rotate hip-to-hip while kicking, staying long as a pencil. 6×25.' },
        { name: '3 Strokes / 6 Kicks', focus: 'Rhythm + balance', how: '3 strokes, then pause on your side for 6 kicks. Stops you from rushing. 4×50.' }
      ],
      dryland: [
        { name: 'Streamline holds', how: 'Tall streamline, arms squeezing the ears — the same shape you push off every wall in.', reps: '3 × 30 sec' },
        { name: 'Shoulder band external rotation', how: 'Elbow at your side, rotate a light band/towel outward. Keeps backstroke shoulders healthy.', reps: '2 × 12 each' },
        { name: 'Glute bridge', how: 'On your back, drive hips up and squeeze. Trains the "hips up" feeling.', reps: '3 × 12' },
        { name: 'Superman holds', how: 'Lift arms + legs face-down and hold for a strong back line.', reps: '3 × 20 sec' }
      ],
      focus: 'Backstroke is won by a still head and a relentless kick. If your legs ever stop, your hips drop — keep them moving.'
    },

    Breaststroke: {
      key: 'Breaststroke', name: 'Breaststroke', color: '#fbbf24', emoji: '🐸',
      tagline: 'Timing over power: pull, breathe, kick, then glide long in a tight streamline.',
      how: 'Breaststroke is the timing stroke. The rhythm is pull → breathe → kick → glide. Quick hands sweep out and back in under your chin, you sneak a breath, then a powerful whip-kick shoots you into a long streamline glide. The glide is free speed — patient swimmers beat strong-but-rushed ones.',
      cues: [
        'Rhythm is pull → breathe → kick → glide. Finish every stroke long.',
        'Hands scull out, then sweep in fast under your chin — small, quick hands.',
        'Heels to your seat, turn your toes out, and whip your feet back together.',
        'Shoot your hands forward and squeeze into a tight streamline.',
        'Hold the glide a beat — feel yourself shoot forward before the next pull.',
        'One pull = one kick = one breath. Never two pulls per kick.'
      ],
      mistakes: [
        { name: 'No glide (rushing)', fix: 'Hold the streamline after each kick for a full beat. That glide is the fastest moment of the stroke.' },
        { name: 'Wide knees / "frog" kick', fix: 'Keep your knees inside your hips. Power comes from turning the feet out and whipping them in, not spreading the knees.' },
        { name: 'Pulling too wide and long', fix: 'Keep the pull in front of your shoulders — quick hands in to under the chin, then shoot forward.' },
        { name: 'Lunging up instead of forward', fix: 'Drive your body forward over the water, leading with the chin — not up out of the water.' }
      ],
      drills: [
        { name: '2 Kicks / 1 Pull', focus: 'Strong kick + glide', how: 'Two breaststroke kicks for every one pull, holding the streamline each time. 6×25.' },
        { name: 'Pull-Out Practice', focus: 'Underwater pulldown off the wall', how: 'From the wall: one big pull to your thighs, glide, recover hands under your body, kick. Do it legally off every start and turn.' },
        { name: 'Vertical / Tall Kick', focus: 'Kick power + foot turn', how: 'In deep water, arms crossed, kick breaststroke to stay tall. 4×20 sec. (Always with a lifeguard.)' },
        { name: '3-Second Glide', focus: 'Patience + streamline', how: 'Count "one-one-thousand…" through each glide before the next pull. 4×50.' }
      ],
      dryland: [
        { name: 'Wall sit', how: 'Back on a wall, thighs parallel to the floor, hold. Builds the leg drive for the kick.', reps: '3 × 30–45 sec' },
        { name: 'Glute bridge', how: 'Hips up and squeeze — power for the whip-kick.', reps: '3 × 12' },
        { name: 'Ankle + hip mobility', how: 'Sit in a deep squat and gently rock to open the hips and ankles for a wider foot turn.', reps: '2 × 30 sec' },
        { name: 'Streamline holds', how: 'Tall, tight streamline — the shape you glide in after every kick.', reps: '3 × 30 sec' }
      ],
      focus: 'Breaststroke is timing, not muscle. Slow down and find the glide — most kids get faster the moment they stop rushing.'
    },

    Butterfly: {
      key: 'Butterfly', name: 'Butterfly', color: '#f472b6', emoji: '🦋',
      tagline: 'A rhythm stroke: press the chest, two kicks per pull, and a low, quick breath.',
      how: 'Butterfly looks hard but it’s really about rhythm and timing, not raw strength. You press your chest down so your hips ride up, take two dolphin kicks per arm cycle (a small one as the hands enter, a big one as they finish), and sneak a low breath as your hands push past your ribs. Smooth beats forceful every time.',
      cues: [
        'Two kicks per arm cycle: a little kick as the hands enter, a big kick as they finish.',
        'Press your chest down ("press the buoy") so your hips and legs pop up.',
        'Hands enter shoulder-width, catch, sweep to your hips, then throw forward low over the water.',
        'Breathe low and early — chin close to the water — then drive your head back down.',
        'Think rhythm, not muscle. Butterfly is all timing.',
        'Relaxed, wide arm recovery with thumbs down — let momentum carry them.'
      ],
      mistakes: [
        { name: 'Lifting the head/chest too high to breathe', fix: 'Breathe low and early (as the hands push back), then get the head back down before the arms swing over.' },
        { name: 'Only one kick per stroke', fix: 'Add the second kick on the entry. Two kicks per cycle keeps you flat and moving.' },
        { name: 'Muscling stiff, high arms', fix: 'Relax the recovery — sweep the arms low and wide and let the rhythm do the work.' },
        { name: 'Diving too deep', fix: 'Press the chest just enough to stay flat; stay near the surface so you keep moving forward, not down.' }
      ],
      drills: [
        { name: 'Single-Arm Fly', focus: 'Timing + catch', how: 'One arm strokes while the other rests out front; breathe to the side. 4×25 each arm.' },
        { name: '3 Right / 3 Left / 3 Full', focus: 'Rhythm builder', how: '3 single-arm right, 3 left, then 3 full strokes. 6×25.' },
        { name: 'Underwater Dolphin Kick', focus: 'Kick from the core', how: 'Streamline dolphin kick off each wall, kicking from the chest and hips (not just the knees). 8×15m.' },
        { name: '2 Kick / 1 Pull Fly', focus: 'Two-kick timing', how: 'Exaggerate the two kicks per pull until the timing is automatic. 6×25.' }
      ],
      dryland: [
        { name: 'Body dolphins (on the floor)', how: 'Lie face-down and ripple from chest → hips → legs to feel where the kick starts.', reps: '3 × 10' },
        { name: 'Plank + hollow holds', how: 'Plank, then a hollow-body hold on your back. Fly is powered by the core.', reps: '3 × 20–30 sec' },
        { name: 'Superman holds', how: 'Lift arms + legs and hold for the back strength fly demands.', reps: '3 × 20 sec' },
        { name: 'Shoulder mobility (band pull-aparts)', how: 'Light band, arms straight, pull apart across your chest. Keeps the over-water recovery loose.', reps: '2 × 12' }
      ],
      focus: 'Start with great underwater dolphin kicks and short, smooth fly. Build the distance only once the rhythm holds — never grind out ugly strokes.'
    },

    IM: {
      key: 'IM', name: 'Individual Medley (IM)', color: '#a78bfa', emoji: '🔀',
      tagline: 'All four strokes, one race. Pace it, nail the turns, and train your weakest stroke.',
      how: 'The IM swims all four strokes in order — Butterfly, Backstroke, Breaststroke, Freestyle. It rewards all-around swimmers and smart pacing: don’t blow up on the fly, keep the strokes legal through every transition, and finish hard on freestyle. The race is usually won (or lost) on your weakest stroke.',
      cues: [
        'Order: Fly → Back → Breast → Free. Memorize it cold.',
        'Build the fly under control — never sprint the first length.',
        'Master the cross-over turns, especially the tricky back-to-breast.',
        'Your weakest stroke is where the race is won — give it the most practice.',
        'Stay smooth through fly and back so you still have legs for freestyle.'
      ],
      mistakes: [
        { name: 'Going out too fast on fly', fix: 'Swim the fly controlled and tall. Blowing up early costs you the entire rest of the race.' },
        { name: 'Illegal or slow IM turns', fix: 'Drill each transition until it’s automatic — fly-to-back, back-to-breast (touch then turn), breast-to-free.' },
        { name: 'Ignoring the weak stroke', fix: 'Add a focused set of your hardest stroke every practice; that’s where you’ll find the most time.' }
      ],
      drills: [
        { name: 'IM Order 25s', focus: 'Transitions', how: '25 of each stroke in order with a legal turn between each. 4 rounds.' },
        { name: 'Reverse IM', focus: 'Finishing strong', how: 'Free, Breast, Back, Fly. Trains the back half of the race when you’re tired. 4×100.' },
        { name: 'Turn Focus', focus: 'Legal cross-overs', how: 'Stand at the wall and rep the fly-to-back and back-to-breast turns 10× each until they’re automatic.' },
        { name: 'Weak-Stroke Set', focus: 'Fix the limiter', how: 'Pick your hardest stroke and swim an extra 4×50 of it every practice.' }
      ],
      dryland: [
        { name: 'Full-body circuit', how: 'Squats, push-ups, plank, glute bridge — the IM needs all-around strength.', reps: '2–3 rounds' },
        { name: 'Core (plank + hollow holds)', how: 'A strong core ties all four strokes together.', reps: '3 × 30 sec' },
        { name: 'Squat jumps', how: 'Explosive jumps for stronger walls and starts between strokes.', reps: '3 × 8' },
        { name: 'Shoulder band work', how: 'Pull-aparts + external rotations to keep all four strokes healthy.', reps: '2 × 12' }
      ],
      focus: 'Build a real base in every stroke. The best IM-ers have no "hole" — turn your weakest length into a strength and your times tumble.'
    }
  };
  // Render / tab order
  var STROKE_ORDER = ['Freestyle', 'Backstroke', 'Breaststroke', 'Butterfly', 'IM'];

  /* =========================================================
     EXTRAS — the free speed that isn't a stroke. Same shape as
     a stroke entry (cues + items) so the guide can render them
     with the same components.
     ========================================================= */
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

  /* =========================================================
     BENCHMARKS — friendly "goal times" (in seconds) by stroke →
     distance → age bracket. These are encouraging targets to
     chase, NOT official qualifying cuts. Short-course yards.
     Missing combos simply fall back to a generic technique tip.
     Brackets match HHST: 6 & Under, 7-8, 9-10, 11-12, 13-14, 15-18.
     ========================================================= */
  var BENCHMARKS = {
    Freestyle: {
      '25':  { '6 & Under': 24, '7-8': 20, '9-10': 17, '11-12': 15, '13-14': 14, '15-18': 13 },
      '50':  { '6 & Under': 55, '7-8': 45, '9-10': 36, '11-12': 31, '13-14': 28, '15-18': 26 },
      '100': { '9-10': 84, '11-12': 70, '13-14': 62, '15-18': 58 },
      '200': { '11-12': 155, '13-14': 140, '15-18': 130 }
    },
    Backstroke: {
      '25':  { '6 & Under': 28, '7-8': 23, '9-10': 19, '11-12': 17, '13-14': 16, '15-18': 15 },
      '50':  { '6 & Under': 64, '7-8': 52, '9-10': 42, '11-12': 36, '13-14': 33, '15-18': 30 },
      '100': { '11-12': 80, '13-14': 71, '15-18': 65 }
    },
    Breaststroke: {
      '25':  { '6 & Under': 30, '7-8': 25, '9-10': 21, '11-12': 19, '13-14': 18, '15-18': 17 },
      '50':  { '6 & Under': 70, '7-8': 58, '9-10': 47, '11-12': 41, '13-14': 37, '15-18': 34 },
      '100': { '11-12': 89, '13-14': 79, '15-18': 73 }
    },
    Butterfly: {
      '25':  { '6 & Under': 30, '7-8': 23, '9-10': 19, '11-12': 17, '13-14': 16, '15-18': 15 },
      '50':  { '6 & Under': 75, '7-8': 56, '9-10': 44, '11-12': 36, '13-14': 32, '15-18': 29 },
      '100': { '13-14': 76, '15-18': 68 }
    },
    IM: {
      '100': { '9-10': 95, '11-12': 80, '13-14': 72, '15-18': 66 },
      '200': { '11-12': 175, '13-14': 158, '15-18': 146 }
    }
  };

  function benchmarkFor(stroke, distance, bracket) {
    var s = BENCHMARKS[stroke];
    if (!s) return null;
    var d = s[String(distance).replace(/[^0-9]/g, '')];
    if (!d) return null;
    var v = d[bracket];
    return (typeof v === 'number' && isFinite(v)) ? v : null;
  }

  // Next clean whole-second barrier just under a time (mirrors the dashboard's
  // Event Deep Dive "Next Goal"). A near-term, tangible stepping stone.
  function nextBarrier(best) {
    if (!isFinite(best)) return null;
    var b = Math.floor(best);
    if (best - b < 0.10) b -= 1; // already basically on it → aim one lower
    return b > 0 ? b : null;
  }

  /* =========================================================
     tipsForSwimmer(stats, info) — the personalized engine.
       stats : the object from HHST.statsForSwimmer (needs .bestTimes
               and .ageGroup). bestTimes entries carry stroke, distance,
               seconds, time, improvement, count.
       info  : optional { bracket } override (else stats.ageGroup wins).
     Returns:
       { bracket, focus:[tip...], strengths:[tip...], topFocus, hasData }
     A "tip" pairs the swimmer's event time with a goal and the matching
     stroke's drills/dryland/cues so the dashboard can render a real plan.
     ========================================================= */
  function statusFor(seconds, bench) {
    if (!bench) return 'general';
    if (seconds <= bench * 1.02) return 'strong';   // within ~2% of the goal
    if (seconds <= bench * 1.12) return 'onTrack';   // within ~12%
    return 'developing';
  }

  function buildTip(b, bracket) {
    var stroke = b.stroke || strokeOf(b.event);
    if (!stroke || !STROKES[stroke]) return null;
    if (!isFinite(b.seconds)) return null;
    var distance = (b.distance || distOf(b.event) || '').toString().replace(/[^0-9]/g, '');
    var bench = benchmarkFor(stroke, distance, bracket);
    var nb = nextBarrier(b.seconds);
    var status = statusFor(b.seconds, bench);
    var gapToBench = bench ? (b.seconds - bench) : null;

    // Headline goal: chase the age-group benchmark unless you're already
    // strong, in which case chase the next clean barrier under your PR.
    var goalSec = null, goalKind = '';
    if (bench && status !== 'strong') { goalSec = bench; goalKind = 'age-group goal'; }
    else if (nb) { goalSec = nb; goalKind = 'next barrier'; }

    var g = STROKES[stroke];
    return {
      event: b.event, stroke: stroke, distance: distance,
      color: g.color, emoji: g.emoji,
      time: b.time, seconds: b.seconds,
      bench: bench, benchTime: bench ? fmt(bench) : '',
      gapToBench: gapToBench,
      nextBarrier: nb, nextBarrierTime: nb ? fmt(nb) : '',
      goalSec: goalSec, goalTime: goalSec ? fmt(goalSec) : '', goalKind: goalKind,
      status: status,
      drills: g.drills.slice(0, 3),
      dryland: g.dryland.slice(0, 2),
      cues: g.cues.slice(0, 4),
      mistakes: g.mistakes.slice(0, 2),
      strokeFocus: g.focus,
      improvement: b.improvement || 0,
      improvementPct: b.improvementPct || 0,
      count: b.count || 0
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
    // Rank focus: developing first (biggest opportunity), then on-track, then
    // events with no benchmark; within a tier, the largest gap leads.
    var rankStatus = function (s) { return s === 'developing' ? 0 : s === 'onTrack' ? 1 : 2; };
    out.focus.sort(function (a, b) {
      if (rankStatus(a.status) !== rankStatus(b.status)) return rankStatus(a.status) - rankStatus(b.status);
      var ga = a.gapToBench != null ? a.gapToBench : 0, gb = b.gapToBench != null ? b.gapToBench : 0;
      return gb - ga;
    });
    // Strengths: closest to (or furthest under) the goal first.
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
    tipsForSwimmer: tipsForSwimmer,
    fmt: fmt
  };
})(window);
