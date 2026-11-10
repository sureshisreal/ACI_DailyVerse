export type BibleThemeKey =
  | 'PROTECTION'
  | 'PROVISION'
  | 'RECOVERY'
  | 'PEACE'
  | 'HOPE'
  | 'GUIDANCE'
  | 'LOVE'
  | 'FAITH'
  | 'STRENGTH'
  | 'HEALING'
  | 'THANKSGIVING'
  | 'FORGIVENESS'
  | 'WISDOM'
  | 'COMFORT'
  | 'SALVATION'
  | 'CREATION'
  | 'JUDGMENT'
  | 'PRAISE'
  | 'WAITING'
  | 'GENERIC';

export interface ThemeVisualSpec {
  themeKey: BibleThemeKey;
  label: string;
  emotion: string;
  viewerSituation: string;
  emotionalHook: string;
  visualConcepts: string[];
  cinematicPromptBase: string;
  compositionPattern: string;
  fontStyle: 'classic-serif' | 'delicate-serif' | 'engraved-display' | 'decorative-warm';
  accentColor: string;
}

export interface DetectedTheme {
  themeKey: BibleThemeKey;
  confidence: number;
  matchedKeywords: string[];
  spec: ThemeVisualSpec;
}

const THEME_SPECS: Record<BibleThemeKey, ThemeVisualSpec> = {
  PROTECTION: {
    themeKey: 'PROTECTION',
    label: 'Divine Protection',
    emotion: 'assuring',
    viewerSituation: 'someone feeling vulnerable, afraid, or exposed to danger and needing shelter',
    emotionalHook: "If you feel unsafe or afraid today, remember this promise of protection.",
    visualConcepts: [
      'a biblical-era shepherd from the chest down only, head not in frame, gently shielding a trembling white lamb beneath the heavy wool of his thick outer cloak, weathered wooden staff gripped in his calloused hand, storm rain falling in silver streaks around them',
      'a modern Christian father shot from the shoulders down only, head not in frame, kneeling to shelter his young daughter beneath the strong curve of his arm on a storm-lashed wooden doorstep, porch light warm and golden behind them casting soft shadows',
      'a Christian family shot from the waist down only, heads not in frame, walking together hand in hand along a safe winding stone mountain path at dusk, unafraid, a single warm lantern swinging gently ahead of them',
      'a robed biblical traveler shot from shoulders down only, head not in frame, kneeling in quiet prayer beside a dusty road at nightfall, a lit brass lantern on a stone beside him, rolling hills safe and quiet in deep indigo shadow around',
      'a mother shot from chest down only, head not in frame, holding her sleeping child close wrapped in a soft wool blanket in a small whitewashed home at night, a single warm clay oil lamp lit on a nearby table, storm visible through the shuttered window outside but not touching them'
    ],
    cinematicPromptBase: 'intimate eye-level shot, 85mm f/1.4 prime lens, shallow depth of field with creamy organic background bokeh, warm golden rim light from behind that carves bright edges through wet fabric and rain, amber-brown and deep indigo color grade, atmospheric haze, volumetric light rays slicing through falling rain, Kodak Portra 400 film emulation, natural documentary realism',
    compositionPattern: 'subject occupies the lower or side portion of the frame; the upper half and opposite side are open sky or softly blurred backdrop kept simple for text overlay',
    fontStyle: 'classic-serif',
    accentColor: '#D4A24C'
  },
  PROVISION: {
    themeKey: 'PROVISION',
    label: 'God\'s Provision',
    emotion: 'tender, grateful',
    viewerSituation: 'someone facing lack, uncertainty about needs, or financial worry and longing for sustenance',
    emotionalHook: "If you're worried about provision today, hold on to this promise.",
    visualConcepts: [
      'a Christian family shot from the shoulders down only, heads not in frame, holding hands and bowing their heads in silent thanks around a simple weathered wooden dinner table before eating, warm kitchen light from a cast-iron lamp above, a crusty loaf of sourdough bread dusted with flour in the center',
      'church volunteers shot from the waist down only, heads not in frame, packing woven wicker food baskets together in a sunlit fellowship hall, smiling, rough calloused hands reaching past each other with cans and fresh produce, warm community atmosphere',
      'a biblical-era mother shot from the chest down only, head not in frame, handing warm fresh bread on a rough clay plate to her children at a rustic wooden table at meal time, golden hour sunlight spilling through a thatched window onto the scene',
      'a farmer shot from the shoulders down only, head not in frame, kneeling in a sun-drenched golden wheat field at harvest time, straw hat resting on the ground beside him, giving thanks with head bowed, calloused hands folded in prayer, sunrise light painting the tall stalks around him',
      'a shepherd shot from the waist down only, head not in frame, leading well-fed cream-colored sheep through lush green pasture beside glassy still water, weathered wooden staff resting on his shoulder, soft wool texture visible on the sheep closest to camera'
    ],
    cinematicPromptBase: 'intimate eye-level slightly-low close-up, 50mm f/2.0 or 85mm f/1.8 lens, shallow depth of field with soft natural background bokeh, warm backlit rim light that turns bread crust and flour dust translucent, warm amber-brown and cream color grade, soft texture of linen fabric and weathered wood grain visible, natural documentary realism, Kodak Portra 400 film stock, fine natural film grain',
    compositionPattern: 'subject fills the lower half of the frame; the upper half is open warm sky or soft blurred background kept simple and uncluttered for text overlay',
    fontStyle: 'decorative-warm',
    accentColor: '#C8883A'
  },
  RECOVERY: {
    themeKey: 'RECOVERY',
    label: 'Recovery & Victory',
    emotion: 'triumphant, determined',
    viewerSituation: 'someone who has suffered loss, setback, or defeat and is ready to reclaim what was taken',
    emotionalHook: "If you need to recover what was lost, this promise is for you today.",
    visualConcepts: [
      'a biblical warrior shot from behind on horseback, low heroic camera angle looking up, warrior in weathered bronze armor and crimson cloak billowing in wind, round bronze shield slung over his back, spear held high pointing forward, horse kicking up a cloud of desert dust under its hooves, mountain range silhouetted in the distance',
      'a determined figure shot from the waist down only, head not in frame, climbing out of a deep dark stone pit onto sunlit rocky ground, both hands reaching up to grasp a strong helping hand extended from above, weathered ropes and chains discarded at the pit edge',
      'a modern man shot from the shoulders down only, head not in frame, rising from kneeling prayer at his bedside at dawn, resolve in the set of his shoulders, morning light streaming tall and golden through the bedroom window across the linen sheets',
      'a shepherd shot from the back on foot, waist down only, head not in frame, carrying a rescued lost white lamb home across his broad shoulders at golden hour, winding arid hillside path beneath his boots, the lamb\'s wool catching the sun, soft relief in the shepherd\'s relaxed posture',
      'a Christian woman shot from behind at the doorway of a weathered stone home she is reclaiming, worn leather-bound Bible held pressed to her chest with both hands, sunrise breaking brilliantly behind her painting the sky in tangerine and rose, door standing wide open'
    ],
    cinematicPromptBase: 'wide dramatic action framing, 70-200mm f/2.8 telephoto lens at low heroic angle, volumetric golden god-rays slicing through thick dust-lit atmosphere, motion cues of fine sand spray, billowing cloak fabric, kicked-up dust and loose earth suspended in air, high-contrast warm-orange and deep brown color grade, cinematic anamorphic lens feel with subtle horizontal lens flare streaks, wind-blown fabric and mane, Kodak Vision3 500T film emulation, rich film grain',
    compositionPattern: 'subject fills the right half or lower portion of the frame; the left half or upper portion is open sky kept simple for text overlay',
    fontStyle: 'engraved-display',
    accentColor: '#B8691F'
  },
  PEACE: {
    themeKey: 'PEACE',
    label: 'Peace & Rest',
    emotion: 'serene, calm',
    viewerSituation: 'someone with a restless mind, anxious heart, or chaotic schedule longing for quiet',
    emotionalHook: "If your heart feels restless, let this promise of peace quiet you today.",
    visualConcepts: [
      'a vast rolling golden wheat field at late afternoon, heavy heads of amber wheat swaying slow and gentle in a soft warm breeze, a weathered split-rail wooden fence of rough-hewn cedar running diagonally along the lower edge of the frame casting long thin shadows on the stubble below, the field stretching wide and uninterrupted to the far flat horizon',
      'a Christian family shot from shoulders down only, heads not in frame, sitting quietly together on a wide weathered wooden porch at dusk, a leather-bound Bible open on one lap, still and unhurried, screen door standing ajar behind them spilling warm yellow lamplight',
      'a person shot from the waist down only, head not in frame, sitting alone in a dark polished wood quiet church pew at morning, first light slanting through stained glass painting soft ruby and sapphire patches on the wood, hands resting calmly palms-down on the pew edge, eyes closed in stillness',
      'a woman shot from shoulders down only, head not in frame, praying quietly beside glassy still lake water at dawn, the sky and distant hills reflected perfectly without a ripple, hands folded gently, fine linen sleeve fabric catching the first pale pink light',
      'a small rough-hewn stone chapel with warm honey-colored light glowing in its tall narrow windows, nestled in a fold of a lush green valley, a narrow worn stone path lined with wildflowers leading to its arched wooden door, mountains rising soft and hazy behind it'
    ],
    cinematicPromptBase: 'wide open establishing shot, 24-70mm f/8 lens for deep scenic depth, soft natural daylight with a gentle sky gradient, clean uncluttered symmetrical composition, deep focus front to back, airy pastel-to-gold color grade, peaceful absolute stillness, National Geographic landscape photography quality, Kodak Ektar 100 film stock emulation, fine grain, rich saturated earth tones, immense scale and quiet',
    compositionPattern: 'subject occupies the lower third of the frame; the upper two-thirds are open sky and distant horizon kept simple and uncluttered for text overlay',
    fontStyle: 'delicate-serif',
    accentColor: '#8FA68E'
  },
  HOPE: {
    themeKey: 'HOPE',
    label: 'Living Hope',
    emotion: 'uplifting, expectant',
    viewerSituation: 'someone in a dark season, feeling discouraged, waiting for a breakthrough',
    emotionalHook: "If you're in a hard season, hold on - hope is closer than you think.",
    visualConcepts: [
      'a Christian woman shot from behind stepping out her weathered white front door into brilliant sunrise light, worn leather-bound Bible held loosely in one hand, posture lifted with expectation, the dawn sky blazing pink and tangerine, a small porch step beneath her feet',
      'a young man shot from the shoulders down only, head not in frame, kneeling in prayer on a windswept grassy hilltop as dawn breaks over a dark shadowed valley below, the first thin gold line of sun touching the top of his shoulders, hands folded',
      'a family shot from the waist down only, heads not in frame, opening their living room curtains together to let in the first light of a new morning, quiet hopeful stillness in their posture, three pairs of hands gripping the curtain rod together',
      'a biblical traveler shot from behind walking a mist-covered forest path at dawn as sunlight breaks through the tall pine trees ahead, casting long bright golden shafts through the mist, heavy wool cloak, worn leather satchel slung over one shoulder, a rough wooden walking stick',
      'a grandmother and grandchild shot from behind on a weathered wooden porch swing, watching a sunrise together over a pasture, both pairs of hands folded loosely in their laps, hopeful stillness, the swing\'s chains hanging still'
    ],
    cinematicPromptBase: 'wide establishing shot at the edge of dawn, 35mm or 50mm lens, warm-to-cool color temperature shift from horizon shadow to sky, volumetric golden light rays piercing thin mist or low cloud, atmospheric haze, hopeful brightening color grade of indigo through rose to gold, the palpable sense of tangible darkness giving way to light, cinematic realism, Kodak Portra 800 film stock for rich shadow detail',
    compositionPattern: 'subject occupies the lower portion and horizon; the upper two-thirds are filled with sky, sunrise light, and ascending atmosphere kept clear for text overlay',
    fontStyle: 'classic-serif',
    accentColor: '#D99A5E'
  },
  GUIDANCE: {
    themeKey: 'GUIDANCE',
    label: 'Divine Guidance',
    emotion: 'reassuring',
    viewerSituation: 'someone facing a decision, standing at a crossroads, or feeling lost and needing direction',
    emotionalHook: "If you don't know which way to go, remember this promise of guidance.",
    visualConcepts: [
      'a Christian man shot from shoulders down only, head not in frame, reading an open well-worn leather-bound Bible by warm brass lamplight at his scuffed wooden kitchen table late at night, seeking direction, one finger tracing a line of Scripture, a half-empty mug of tea beside him',
      'a biblical traveler shot from behind holding a flickering oil lamp with a brass handle that lights a narrow uneven stone path forward into deep darkness, his hand steady on the lamp, heavy woolen robe dragging on the path, light only reaching a few steps ahead',
      'a young woman shot from the waist down only, head not in frame, kneeling in prayer at a crossroads of two dirt paths in soft rolling morning fog, deciding which way to walk, hands folded over a small pocket Bible resting on her knees',
      'a shepherd\'s staff shot from low angle extending to gently guide a trembling black lamb onto the narrow right path at a fork in a rocky sunbaked trail, the shepherd visible only from knees down in rough wool cloak walking just behind',
      'a small group of biblical travelers shot from behind following a tall luminous pillar of thin wispy cloud across a sunbaked desert plain at the boundary of day and night, walking in single file, staffs and sandals visible, their shadows long ahead'
    ],
    cinematicPromptBase: 'medium shot at eye level, 50mm f/2.0 or 35mm f/1.8 lens, shallow to moderate depth of field, warm practical directional light from lamp, candle, or fire contrasted with cool atmospheric indigo surroundings, warm amber and deep blue color grade with precise color separation, mystery and certainty in tension, cinematic realism, Kodak Portra 400 film stock, fine natural film grain',
    compositionPattern: 'subject (path, lamp, traveler) occupies the lower or left portion of the frame; the upper or right portion opens up into sky and distance, kept simple for text overlay',
    fontStyle: 'classic-serif',
    accentColor: '#B08040'
  },
  LOVE: {
    themeKey: 'LOVE',
    label: 'Everlasting Love',
    emotion: 'tender, intimate',
    viewerSituation: 'someone feeling unseen, unloved, or lonely, needing to be reminded of being cherished',
    emotionalHook: "If you ever feel unloved, let this promise wash over you today.",
    visualConcepts: [
      'a mother shot from the chest down only, head not in frame, holding her sleeping infant child close wrapped in soft cream knit blanket, warm amber lamp light, quiet room at night, the mother\'s hand resting gently on the baby\'s back, intimate soft embrace',
      'a person shot from behind kneeling alone in a vast sunlit wildflower field, head bowed and both arms resting open palms-up at their sides, overwhelmed by quiet tangible assurance of being loved, tall grass and wildflowers brushing their sides',
      'a shepherd shot from the waist down only, head not in frame, tenderly carrying a small fluffy white lamb pressed close to his chest in both arms, walking through lush green pasture dotted with wildflowers at golden hour, the lamb\'s legs hanging gently down',
      'a father shot from behind wrapping both strong arms around his teenage son on wide weathered wooden porch steps at sunset, quiet reconciliation, both standing still in the embrace, their shadows falling long on the porch floor',
      'a church community shot from the waist down only, heads not in frame, embracing and welcoming a newcomer with open arms at the arched wooden church door, warm golden afternoon light spilling from the sanctuary behind them, genuine smiles visible on the lower faces'
    ],
    cinematicPromptBase: 'intimate close-up shot, 85mm f/1.4 or 105mm f/2.0 short telephoto lens, extremely shallow depth of field with soft creamy organic background bokeh, warm soft side light that wraps around fabric and skin, rose-gold and soft cream color grade, gentle tenderness and warmth, professional editorial portrait photography, soft natural film grain, Kodak Portra 400, tangible fabric texture on robes and blankets',
    compositionPattern: 'subject (hands, figure, embrace) occupies the lower or side portion; the rest of the frame is soft out-of-focus warm atmosphere kept clear for text overlay',
    fontStyle: 'delicate-serif',
    accentColor: '#C98E6A'
  },
  FAITH: {
    themeKey: 'FAITH',
    label: 'Steadfast Faith',
    emotion: 'grounded, unwavering',
    viewerSituation: 'someone whose faith is being tested, feeling shaken, needing to stand firm',
    emotionalHook: "If your faith feels weak today, let this promise strengthen you.",
    visualConcepts: [
      'a Christian man shot from shoulders down only, head not in frame, kneeling in prayer with one calloused hand resting firmly on an open well-worn leather Bible during a dark storm visible through the kitchen window behind him, unshaken composure, warm lamp light on the table',
      'a small rural white clapboard church standing firm against a roiling dark storm, its tall narrow windows glowing warm honey-amber from within, wooden steeple silhouetted against the bruised purple and charcoal storm clouds, a single light in the belfry',
      'an elderly woman shot from the chest down only, head not in frame, praying with both gnarled weathered hands resting on a well-worn cracked leather family Bible at her dark oak kitchen table, quiet unwavering trust, a small clay vase of dried lavender beside her',
      'a massive ancient gnarled olive tree standing alone in the desert, its thick twisted trunk split into two heavy arms, silvery leaves catching warm side light, dry cracked desert earth around its base, distant eroded limestone hills behind under a vast sky',
      'a tiny single black mustard seed resting on an open cream-colored Bible page marked with a pressed four-leaf clover, beside it a flourishing leafy young sapling in soft focus in the sunlit window background, shallow depth of field'
    ],
    cinematicPromptBase: 'wide epic landscape to medium framing, 24-70mm lens low to ground angle, dynamic dramatic contrast between storm or wild chaos and stability, depth of field emphasizing solid rooted foreground, blue-gray charcoal storm tones and warm gold sanctuary light color grade, cinematic landscape photography, Kodak Ektar 100 for saturated earth tones, tangible texture on rock bark and aged wood',
    compositionPattern: 'subject (tree, church, rock, hands-on-book) occupies the lower half and center of the frame; the upper half is open sky and atmosphere kept simple for text overlay',
    fontStyle: 'engraved-display',
    accentColor: '#8A7A5C'
  },
  STRENGTH: {
    themeKey: 'STRENGTH',
    label: 'Renewed Strength',
    emotion: 'empowering, resolute',
    viewerSituation: 'someone exhausted, weary, burnt out, needing to rise and keep going',
    emotionalHook: "If you feel worn out today, here is the promise of new strength.",
    visualConcepts: [
      'a tired Christian woman shot from shoulders down only, head not in frame, first kneeling in prayer at her dark oak bedside at dawn with elbows pressed into a linen quilt, then rising to stand with renewed resolve, long tall golden morning sunlight streaming in through the sheer white window curtains across the room',
      'a man shot from behind reaching the crest of a sunbaked rocky hill at sunrise after a long hard climb, a hand-carved wooden cross verse-marker at the summit beside a cairn of stones, both arms lifted high in worship toward the blazing horizon, wind catching his shirt',
      'worn calloused hands clasped firmly together in determined prayer pressed flat on the open worn pages of a leather-bound Bible on a weathered oak table, bright sunrise light streaming tall and clean through a kitchen window beside them, resolve in the tight grip',
      'a father shot from the shoulders down only, head not in frame, carrying his exhausted sleeping young child draped across his broad shoulders up a steep rocky mountain trail at dawn, both reaching the summit viewpoint together, the father\'s hand steadying the child\'s leg',
      'a small church congregation shot from behind standing together at sunrise outdoor service on a hilltop, hands all raised together in a line, facing a vast vista of valleys and a new day rising, determination and collective strength in their shared posture'
    ],
    cinematicPromptBase: 'low heroic camera angle, wide epic landscape to medium framing, 24-70mm or 70-200mm lens, strong directional low sunlight casting long defined shadows, warm honey gold and deep bronze sunset color grade with rich shadow detail, the palpable sense of rising and ascending motion, cinematic landscape and documentary photography, Kodak Ektar 100, fine grain, wind-blown fabric, tangible leather and wood texture',
    compositionPattern: 'subject (figure, hilltop, hands, congregation) occupies the lower or right portion of the frame; the upper or left portion is open sky kept simple and uncluttered for text overlay',
    fontStyle: 'engraved-display',
    accentColor: '#A67428'
  },
  HEALING: {
    themeKey: 'HEALING',
    label: 'Healing & Restoration',
    emotion: 'gentle, hopeful',
    viewerSituation: 'someone in physical, emotional, or relational pain, longing for wholeness',
    emotionalHook: "If you're carrying pain today, let this promise of healing reach you.",
    visualConcepts: [
      'a small group of Christians shot from the waist down only, heads not in frame, laying hands gently together on a friend\'s bowed shoulder in quiet collective prayer, heads all bowed inward, warm honey-soft afternoon light spilling through a window across their overlapping hands and shoulders',
      'a pastor shot from chest down only, head not in frame, praying quietly beside a hospital patient\'s bed, the pastor\'s weathered hand resting gently on the patient\'s pale hand atop the starched white linens, warm fading evening light through the room window',
      'a biblical-era healer\'s gentle hand shot in close-up resting lightly on a bowed hunched shoulder, a small plain clay alabaster jar of olive oil sitting uncorked on a nearby weathered stone ledge, intimate sacred moment, warm soft side light',
      'a woman shot from the waist down only, head not in frame, sitting alone in a polished dark oak church pew, hands folded in quiet prayer on her lap, a single tall shaft of morning sunlight falling vertically through a high window directly upon her, quiet healing stillness',
      'a withered ancient olive tree putting out fresh bright green tender shoots in spring, new growth contrasting with the old gnarled cracked bark, growing beside a small weathered limestone chapel wall, dewdrops on the new leaves catching pale morning sunlight'
    ],
    cinematicPromptBase: 'intimate macro to medium shot, 100mm f/2.8 macro or 85mm f/1.8 prime lens, very soft shallow depth of field with organic creamy bokeh, warm diffused soft side lighting or tall vertical window light, cream white and soft muted teal healing color grade, tenderness and sacred fragility, documentary-style portrait and still life photography, Kodak Portra 400 film stock, subtle soft grain',
    compositionPattern: 'subject (hands, jar, tree, pew) occupies the lower or lower-left portion; the rest of the frame is soft out-of-focus atmosphere kept clear for text overlay',
    fontStyle: 'delicate-serif',
    accentColor: '#9FB49A'
  },
  THANKSGIVING: {
    themeKey: 'THANKSGIVING',
    label: 'Gratitude & Praise',
    emotion: 'joyful, celebratory',
    viewerSituation: 'someone counting blessings, remembering God\'s goodness, wanting to give thanks',
    emotionalHook: "Take a moment to remember - here's a promise to give thanks for today.",
    visualConcepts: [
      'a Christian family shot from shoulders down only, heads not in frame, all holding hands and bowing heads in quiet thanks around a long weathered farmhouse harvest table heaped high with autumn food, golden hour warm sunlight streaming in from a side window, a large loaf of crusty sourdough at the center',
      'a woman shot from chest down only, head not in frame, kneeling beside her white linen bed in grateful morning prayer, both hands folded loosely, bright clean morning light streaming tall through sheer bedroom curtains, a small open leather Bible on the nightstand beside her',
      'a family shot from the waist down only, heads not in frame, gathered around a rough wooden table outdoors under a tall mature olive tree, sharing and breaking bread together, giving thanks, warm sunset light dappling the table through the silvery leaves',
      'a small church congregation shot from behind standing with hands raised in thanksgiving during a Sunday morning service, joyful lifted posture, warm honey-colored sunlight streaming tall through tall arched sanctuary windows over their shoulders',
      'an elderly man shot from chest down only, head not in frame, writing with a fountain pen in a dark leather gratitude journal beside an open Bible on his weathered cedar front porch table, peaceful warm morning sunlight on the pages, a steaming mug of coffee beside them'
    ],
    cinematicPromptBase: 'eye-level medium to wide shot, 35mm or 50mm lens, warm golden hour backlighting that turns food edges and leaf rims translucent, long soft extended shadows, rich harvest color palette of deep burnt orange, amber gold, burgundy purple and forest green, abundant generous overflowing feeling, editorial food and lifestyle documentary photography, Kodak Ektar 100 film stock for saturated color, fine natural film grain',
    compositionPattern: 'subject (table, hands, family, congregation) occupies the lower half of the frame; the upper half is open golden sunset sky kept simple for text overlay',
    fontStyle: 'decorative-warm',
    accentColor: '#D89420'
  },
  FORGIVENESS: {
    themeKey: 'FORGIVENESS',
    label: 'Forgiveness & Cleansing',
    emotion: 'liberating, tender',
    viewerSituation: 'someone weighed down by guilt, shame, regret, needing to be set free',
    emotionalHook: "If guilt has been weighing on you, hear this promise of forgiveness today.",
    visualConcepts: [
      'two Christian friends shot from the shoulders down only, heads not in frame, embracing in quiet reconciliation outside a small whitewashed stone church, tears and relief visible in their posture, warm soft late afternoon sun falling across their backs',
      'a person shot from the waist down only, head not in frame, kneeling alone at a polished dark wood church altar rail in quiet prayer, head bowed low, hands clasped together on the rail, soft tall light falling from a high stained-glass window above',
      'a father shot from behind on his wide weathered wooden porch embracing his returning grown son at the open doorway of their home, both standing perfectly still in the emotional moment, warm amber porch light spilling around them, prodigal son moment',
      'a young person shot from chest down only, head not in frame, warmly smiling while serving a hot meal from a tin plate to an elderly neighbor across a rough-hewn community wooden table, tenderhearted active kindness in action, soft overcast day',
      'gentle weathered hands shot in extreme close-up softly wiping tears from a tear-streaked cheek, warm soft side light illuminating each individual tear, intimate sacred moment of mercy, skin texture and linen sleeve cuff visible'
    ],
    cinematicPromptBase: 'intimate medium shot, 50mm f/1.8 or 85mm f/1.4 lens, strong dramatic contrast of shadow-to-light representing dark to freed, clean white and warm cream tones against soft background shadow, soft directional window or porch light, the palpable sense of liberation and weight being visibly lifted, cinematic editorial portrait photography, Kodak Portra 400 film, fine grain, natural tear and skin texture',
    compositionPattern: 'subject (robes, hands, gate, altar, embrace) occupies the lower or right portion; the left or upper portion opens into bright sky or distance kept clear for text overlay',
    fontStyle: 'classic-serif',
    accentColor: '#A08868'
  },
  WISDOM: {
    themeKey: 'WISDOM',
    label: 'Wisdom & Understanding',
    emotion: 'thoughtful, discerning',
    viewerSituation: 'someone needing clarity, discernment, or answers to questions they cannot solve alone',
    emotionalHook: "If you need wisdom for today's decisions, this promise is for you.",
    visualConcepts: [
      'a young Christian woman shot from chest down only, head not in frame, reading an open leather-bound Bible at her worn walnut writing desk by warm lamplight late at night, a fountain pen in hand taking notes in a lined journal, seeking understanding, a steaming mug of tea beside her',
      'an elder with a kind weathered face partially visible seated beneath the wide canopy of a mature fig tree, teaching a small circle of attentive young disciples who face him, a long parchment scroll unrolled open on a rough cloth between them, dappled soft afternoon sunlight filtering through the fig leaves',
      'a grandfather shot from chest down only, head not in frame, reading Scripture aloud from a large well-worn family Bible to his grandchildren gathered cross-legged on the living room rug, warm amber evening lamp light on the pages',
      'a pastor shot from shoulders down only, head not in frame, counseling a young man quietly in a dark paneled church study, open leather Bible between them on a heavy oak table, both leaning forward in thoughtful posture, expressions sincere',
      'a merchant\'s hand shot in close-up carefully selecting a single lustrous white pearl of great price from among many ordinary rough stones spread out on a weathered canvas cloth at a dusty open-air market, dappled sunlight catching the pearl\'s sheen'
    ],
    cinematicPromptBase: 'eye-level medium shot, 35mm or 50mm lens, warm soft practical lighting from oil lamp, brass desk lamp, or dappled window, deep rich cozy tones of aged walnut wood, cracked leather, and weathered stone, warm gold and deep walnut-brown color grade, cozy studious atmosphere, editorial still life and documentary portraiture, Kodak Portra 800 film for warm shadows, soft natural grain',
    compositionPattern: 'subject (lamp, scroll, elder, tree, pearl) occupies the lower or side portion; the rest of the frame is warm out-of-focus atmosphere kept simple for text overlay',
    fontStyle: 'classic-serif',
    accentColor: '#9C7C3E'
  },
  COMFORT: {
    themeKey: 'COMFORT',
    label: 'Comfort in Mourning',
    emotion: 'gentle, consoling',
    viewerSituation: 'someone grieving, heartbroken, lonely, in need of being comforted',
    emotionalHook: "If your heart is heavy today, let this promise of comfort reach you.",
    visualConcepts: [
      'a Christian friend shot from shoulders down only, head not in frame, wrapping a strong gentle arm around weeping hunched shoulders in a quiet shadowed corner of a small church foyer, soft warm amber lamp light falling nearby, presence alone',
      'a widow shot from chest down only, head not in frame, sitting quietly alone on a polished dark oak church pew, an elderly friend\'s weathered gnarled hand resting gently on top of hers on the pew edge, soft morning light through stained glass',
      'two worn weathered hands clasped tightly together on the open cream-colored pages of a large leather Bible on a weathered oak table, neither hand nor person speaking, quiet tangible presence alone, warm golden hour window light illuminating the hands',
      'a shepherd shot from waist down only, head not in frame, gently comforting a ewe that has just lost her lamb, kneeling beside her in soft green pasture at dusk, one hand resting lightly on her wool, quiet care',
      'a person shot from chest down only, head not in frame, praying quietly beside a hospital bed holding a loved one\'s pale frail hand in theirs across the crisp white linens, soft warm evening lamplight glowing in the otherwise dim room'
    ],
    cinematicPromptBase: 'intimate eye-level shot, 85mm f/1.4 prime lens, extremely shallow creamy organic depth of field, soft diffused warm side lighting with gentle shadow falloff, muted gentle tone palette of cream, pale dusty blue, warm dove gray, the sacred quiet atmosphere of mourning and consolation, editorial portrait and still life photography, Kodak Portra 400 film, very subtle soft grain',
    compositionPattern: 'subject (hands, pew, two figures, shepherd) occupies the lower portion; the upper portion is open sky or soft out-of-focus wall/window kept simple for text overlay',
    fontStyle: 'delicate-serif',
    accentColor: '#8F9EA0'
  },
  SALVATION: {
    themeKey: 'SALVATION',
    label: 'Salvation & Redemption',
    emotion: 'triumphant, awe-filled',
    viewerSituation: 'someone longing for rescue, needing to be saved, seeking freedom from bondage',
    emotionalHook: "If you need to be rescued today, hear this promise of salvation.",
    visualConcepts: [
      'the empty weathered limestone tomb at dawn sunrise, the large round stone rolled away to one side revealing the open arched entrance, white linen burial cloths folded neatly inside upon the stone shelf, a garden of green olive trees and pink rose bushes beyond in the first soft light, resurrection dawn',
      'a fisherman shot from the waist down only, head not in frame, reaching down strong calloused hands to pull a drowning gasping man up into the wooden hull of his storm-tossed fishing boat on roiling dark water, the storm clouds visibly breaking open to golden sunlight above',
      'close-up of heavy forged iron slave chains falling away mid-air, broken and discarded clattering on a dark rough-hewn wood plank floor, brilliant tall golden light streaming in through a tall open wooden doorway just beyond the chains',
      'the Passover lamb on a rough stone altar at twilight, small fire rising and catching the edge of the wood, the weathered wooden doorposts to either side visibly marked with deep red blood, an ancient Hebrew doorway at dusk',
      'a figure shot from behind walking forward from deep shadow across a stone threshold into brilliant tall golden morning light, long flowing robes billowing gently behind, the posture of one completely set free'
    ],
    cinematicPromptBase: 'wide to medium epic dramatic shot, 24-70mm f/2.8 lens, dramatic chiaroscuro lighting - razor-sharp contrast between inky shadow and brilliant warm light, warm burnished gold and deep blue-black indigo color grade, the palpable sense of deliverance and liberation, cinematic biblical historical film still photography, shot on ARRI Alexa or RED, Kodak Vision3 500T film emulation for cinematic contrast, rich film grain, textured stone and linen',
    compositionPattern: 'subject (tomb, hands, figure, chains, lamb) occupies the lower or center portion; the upper or side portion opens into bright sky or tall light kept clear for text overlay',
    fontStyle: 'engraved-display',
    accentColor: '#B8882A'
  },
  CREATION: {
    themeKey: 'CREATION',
    label: 'Creator\'s Majesty',
    emotion: 'awe-filled, wonder',
    viewerSituation: 'someone forgetting how great God is, needing to be reminded of His power and goodness',
    emotionalHook: "Lift your eyes today and remember the One who created everything.",
    visualConcepts: [
      'a vast sweeping alpine valley at golden hour sunset, tall snow-capped granite and limestone peaks lining a meadow carpeted in dense wildflowers in deep purple, butter yellow, and pure white, a narrow bright silver creek winding through the valley floor catching the low sun, a single giant ancient fir tree standing sentinel at the valley entrance, no people',
      'a vast crystal-clear starry night sky over a still arid desert, the bright Milky Way band clearly visible arching overhead thick with stars, a lone believer standing small on the ridge looking up in wonder beside a small glowing orange campfire ring of stones, sense of immense scale',
      'the open ocean at sunrise, long gentle rolling swells catching the first thin line of golden sunlight on their crests, the horizon stretching perfectly straight and endless, a few seagulls soaring high and distant in the upper sky, immense peaceful scale',
      'ancient old-growth redwood forest, massive tree trunks towering upward out of frame, shafts of brilliant warm sunlight slanting through the tall canopy, ferns and mossy logs on the dark forest floor, palpable sense of being in an ancient cathedral of trees',
      'the grand canyon at late golden hour, layered bands of red, terracotta, and burnt-orange rock receding into the distance, a narrow silver river winding far below at the base of the gorge, dramatic depth and scale, sky a soft deepening blue above the rim'
    ],
    cinematicPromptBase: 'wide epic landscape establishing shot, 16-35mm f/8 or 24-70mm f/11 lens for deep front-to-back scenic depth, golden hour or twilight blue hour, rich deep saturated natural colors, the tangible sense of immense scale and majesty, professional National Geographic landscape photography, Kodak Ektar 100 or Fuji Velvia 50 film stock emulation for vivid saturated color, fine crisp grain, atmospheric haze between distant ridges, perfect horizon level',
    compositionPattern: 'subject (mountains, canyon, forest, ocean, desert) occupies the lower half of the frame; the upper half is vast open sky or starry night kept simple and uncluttered for text overlay',
    fontStyle: 'engraved-display',
    accentColor: '#8E7A48'
  },
  JUDGMENT: {
    themeKey: 'JUDGMENT',
    label: 'Justice & Judgment',
    emotion: 'solemn, weighty',
    viewerSituation: 'someone needing to trust that justice will be done, or standing in awe of God\'s holiness',
    emotionalHook: "When justice seems delayed, remember this promise.",
    visualConcepts: [
      'an ancient throne room interior at dusk, a massive empty high-backed stone throne carved with ancient script, a shining bronze sword upright planted before it, a balanced set of brass scales of justice resting beside it on a carved stone pedestal, no figure on the throne, tall golden light streaming down from a high opening above',
      'white and black sheep being separated into two groups on a rocky sunbaked hillside at twilight, a shepherd visible only from the waist down in heavy wool cloak, dividing them gently but firmly with his long wooden staff, long purple shadows falling across the slope',
      'an old balanced set of carved stone scales with polished brass pans, sitting centered on a rough stone pedestal in a torch-lit stone wall alcove, warm flickering torchlight dancing against the stone, evening ceremony weighty solemnity',
      'a judge\'s weathered hand shot in close-up about to strike a polished dark wooden gavel down on its sounding block, the otherwise empty oak courtroom in soft creamy bokeh behind, serious weighty atmosphere',
      'an ancient stone city gate at sunset, elders in long plain robes shot from the waist down only, heads not in frame, seated in judgment beneath the pointed stone arch, scrolls spread open before them on a long stone bench, the people gathered respectfully in front'
    ],
    cinematicPromptBase: 'low to medium angle, 35mm or 50mm lens, dramatic chiaroscuro torch or single-light lighting, deep sculpted shadows, muted solemn stone gray and warm torch-gold color grade with no bright distractions, the palpable weighty solemn atmosphere, cinematic historical film still photography, Kodak Vision3 500T film emulation for dramatic contrast, rich visible film grain, carved stone texture, aged wood, brass patina',
    compositionPattern: 'subject (throne, scales, shepherd, gate, gavel) occupies the lower or center portion; the upper portion is open sky or high vaulted room kept simple for text overlay',
    fontStyle: 'engraved-display',
    accentColor: '#7A6040'
  },
  PRAISE: {
    themeKey: 'PRAISE',
    label: 'Worship & Praise',
    emotion: 'joyful, exuberant',
    viewerSituation: 'someone with a heart ready to worship, wanting to declare God\'s goodness aloud',
    emotionalHook: "Lift up a song today - here is a truth worth praising God for.",
    visualConcepts: [
      'a small church choir singing together on a raised platform shot from behind the congregation, many hands lifted, warm honey-gold light slanting down through tall arched stained-glass windows painted ruby, sapphire, and emerald, falling across the singers and their music stands',
      'a family shot from shoulders down only, heads not in frame, worshipping together in their living room at night, one hand strumming an acoustic guitar, other hands lifted, warm lamplight around them, song sheets open on the coffee table',
      'a congregation shot from behind standing with many hands raised in joyful worship during a Sunday morning service, bright warm sunlight streaming tall through sanctuary windows across their backs, joyful collective energy',
      'a biblical musician shot from waist down only, head not in frame, playing a large carved wooden harp and singing psalms on wide weathered stone temple steps at sunrise, the first golden sunlight breaking over the city buildings behind him, his robe flowing',
      'a lone woman shot from behind standing on a grassy hilltop at sunrise with both arms lifted high in worship toward the blazing rising sun, her long garment billowing in the wind, a small stone church with a wooden steeple visible tiny in the green valley far below'
    ],
    cinematicPromptBase: 'medium to wide shot, 35mm or 24-70mm lens, warm golden festival and sanctuary light, rich deep colors of crimson, cobalt blue and burnished gold, sense of flowing motion of fabric and lifted hands, joyful exuberant energy, cinematic historical and editorial documentary photography, Kodak Ektar 100 film for saturated color, natural film grain, flowing linen and wool texture',
    compositionPattern: 'subject (instruments, singers, lifted hands, hilltop worshipper) occupies the lower or left portion of the frame; the upper or right portion is open sky and tall light kept simple for text overlay',
    fontStyle: 'decorative-warm',
    accentColor: '#C49030'
  },
  WAITING: {
    themeKey: 'WAITING',
    label: 'Patient Waiting',
    emotion: 'quiet, expectant',
    viewerSituation: 'someone in a season of waiting, patience wearing thin, promises delayed',
    emotionalHook: "If you're weary of waiting, let this promise encourage you today.",
    visualConcepts: [
      'a lone watchman shot from the shoulders down only, head not in frame, standing still on a high stone tower parapet at dawn, a brass lantern hanging from one hand, looking out steadily toward the far horizon where the very first thin line of sun has just appeared, mist in the valleys far below',
      'a farmer shot from the waist down only, head not in frame, leaning both forearms on the wooden handles of his old rusted plow at the edge of a freshly sown bare earth field, looking out over the rows of dark soil with patient expectation, sunrise low behind him',
      'a woman shot from chest down only, head not in frame, sitting quietly alone in her wooden rocking chair by the front living room window at deep twilight, a small leather-bound Bible open on her lap, a small steady flame in a brass lamp burning on the sill beside her, watching and waiting outside',
      'a mother shot from chest down only, head not in frame, sitting beside a dark wicker cradle, watching a sleeping child through the long night, soft pale moonlight falling through the bedroom window across the linen, quiet enduring patience',
      'a small group of biblical travelers shot from the waist down only, heads not in frame, camped beside a dusty road at dawn, their small fire still glowing orange, packs and bedrolls rolled up ready beside them, all facing down the road watching intently for the guide to come'
    ],
    cinematicPromptBase: 'eye-level medium shot, 50mm or 85mm lens, soft warm lantern or dawn light contrasted with cool surrounding indigo darkness or thin ground fog, muted warm brown and soft dusty blue color grade, the palpable feeling of stillness and quiet expectancy, cinematic portrait and landscape photography, Kodak Portra 800 film for low light shadow detail, soft natural grain',
    compositionPattern: 'subject (watchman, farmer, door, window, travelers) occupies the lower or side portion of the frame; the rest of the frame is open sky, horizon, or distant road kept simple for text overlay',
    fontStyle: 'delicate-serif',
    accentColor: '#968056'
  },
  GENERIC: {
    themeKey: 'GENERIC',
    label: 'General Devotional',
    emotion: 'peaceful',
    viewerSituation: 'someone looking for a moment of quiet reassurance today',
    emotionalHook: "If you need a moment of peace today, listen to this.",
    visualConcepts: [
      'a person shot from the waist down only, head not in frame, sitting quietly with an open well-worn leather Bible on their lap in a sunlit bay window seat lined with linen cushions, peaceful warm morning stillness, soft green hills visible through the glass behind',
      'a small Christian family shot from the waist down only, heads not in frame, walking together in single file along a quiet tree-lined countryside dirt path at golden hour, unhurried and at peace, the parents holding a small child\'s hand between them',
      'a person shot from behind kneeling in quiet prayer alone in a softly lit small stone chapel interior, warm tall morning light through a simple arched leaded-glass window illuminating thin dust motes, stone pews empty around them',
      'a well-worn dark leather-bound family Bible resting open cream-colored pages on a weathered oak kitchen table beside a small brass candlestick with a thin taper burning steadily, warm quiet evening lamplight',
      'a believer shot from behind sitting on a grassy hillside at sunrise, hands resting loosely open palms-down on their knees in quiet reflection, a small stone church with a white wooden steeple visible in the green valley far below them'
    ],
    cinematicPromptBase: 'wide open establishing shot, 35mm or 50mm lens, soft natural daylight with a gentle sky gradient, clean uncluttered symmetrical composition, deep focus, airy pastel-to-gold color grade, peaceful absolute stillness, professional editorial landscape and lifestyle photography, Kodak Portra 400 film stock, soft natural grain, palpable quiet atmosphere',
    compositionPattern: 'subject occupies the lower third of the frame; the upper two-thirds are open sky and distant horizon kept simple and uncluttered for text overlay',
    fontStyle: 'classic-serif',
    accentColor: '#FFD700'
  }
};

const EN_KEYWORDS: Record<BibleThemeKey, string[]> = {
  PROTECTION: ['protect', 'shield', 'shelter', 'defend', 'refuge', 'fortress', 'stronghold', 'deliver', 'save from', 'safe', 'guard', 'under his wings', 'buckler', 'armor', 'hide', 'cover', 'terror', 'afraid', 'fear no', 'no harm'],
  PROVISION: ['provide', 'provision', 'bread', 'food', 'hunger', 'thirst', 'satisfy', 'saturate', 'plenty', 'abundance', 'harvest', 'shepherd green pasture', 'still waters', 'rich food', 'feast', 'wine', 'oil', 'firstfruits', 'storehouse', 'give', 'supply', 'lack no', 'famine', 'poor', 'needy'],
  RECOVERY: ['recover', 'restore', 'repossess', 'overtake', 'pursue', 'deliverance', 'rescue', 'redeem', 'ransom', 'victory', 'triumph', 'conquer', 'overcome', 'smite', 'slay', 'battle', 'war', 'sword', 'prevail', 'bring back', 'turn captivity', 'healed', 'save', 'lost sheep', 'found'],
  PEACE: ['peace', 'rest', 'quiet', 'still', 'calm', 'shalom', 'tranquil', 'at ease', 'dwell safe', 'no terror', 'lie down', 'sleep', 'sabbath', 'gentle', 'lowly heart', 'weary rest', 'peaceable', 'border peace'],
  HOPE: ['hope', 'expect', 'wait', 'future', 'promise', 'dawn', 'rise', 'renew', 'breakthrough', 'deliverer', 'salvation draws near', 'blessed hope', 'anchor', 'spring up', 'sprout', 'bud', 'lifted head'],
  GUIDANCE: ['guide', 'lead', 'direct', 'teach', 'way', 'path', 'lamp', 'light', 'order steps', 'counsel', 'instruct', 'shepherd lead', 'pillar of cloud', 'pillar of fire', 'follow', 'show me', 'discern', 'understanding'],
  LOVE: ['love', 'loved', 'cherish', 'compassion', 'tender mercies', 'affection', 'beloved', 'dearly loved', 'faithful love', 'everlasting love', 'unfailing love', 'embrace', 'kiss', 'covenant love', 'kindness', 'goodness'],
  FAITH: ['faith', 'believe', 'trust', 'rely', 'stand', 'steadfast', 'immovable', 'abide', 'remain', 'rooted', 'grounded', 'built on the rock', 'oath', 'promise', 'mustard seed', 'little faith', 'without faith', 'faithful', 'endure', 'patient'],
  STRENGTH: ['strength', 'strong', 'might', 'power', 'rise up', 'wings like eagles', 'run not weary', 'walk not faint', 'renewed strength', 'empower', 'enable', 'uphold', 'sustain', 'overcome', 'valiant', 'warrior', 'mighty', 'bow', 'battle axe'],
  HEALING: ['heal', 'healing', 'health', 'restore', 'recovery', 'physician', 'stripes', 'wounds', 'disease', 'sickness', 'infirmity', 'lame walk', 'blind see', 'deaf hear', 'dead live', 'cleanse', 'leprosy', 'bind up', 'broken hearted', 'bandage'],
  THANKSGIVING: ['thank', 'thanks', 'give thanks', 'grateful', 'gratitude', 'praise', 'bless the lord', 'extol', 'magnify', 'thanksgiving', 'firstfruits', 'offer', 'sacrifice of praise', 'enter his gates', 'thankful heart', 'rejoice always', 'overflowing'],
  FORGIVENESS: ['forgive', 'forgiveness', 'pardon', 'cleanse', 'wash', 'purify', 'blot out', 'remember sin no more', 'east from west', 'scarlet white', 'snow', 'merciful', 'atonement', 'blood', 'propitiation', 'sins removed', 'cast into depths', 'iniquity', 'trespass', 'transgression'],
  WISDOM: ['wisdom', 'wise', 'understanding', 'discernment', 'counsel', 'instruction', 'teach', 'learning', 'knowledge', 'prudence', 'fear of the lord', 'proverb', 'parable', 'lamp to feet', 'light to path', 'treasure hidden', 'pearl', 'seek wisdom'],
  COMFORT: ['comfort', 'comforter', 'consolation', 'mourn', 'mourning', 'weep', 'broken heart', 'crushed spirit', 'grieve', 'sorrow', 'lonely', 'alone', 'wipe tears', 'dry eyes', 'bandage', 'near to', 'embrace', 'carry', 'shepherd carries'],
  SALVATION: ['save', 'salvation', 'deliver', 'redeem', 'redemption', 'ransom', 'born again', 'eternal life', 'everlasting life', 'kingdom', 'tomb', 'resurrection', 'raised', 'life', 'gospel', 'believe and be', 'saved', 'deliverer', 'messiah', 'christ', 'lamb', 'passover', 'baptism', 'regeneration'],
  CREATION: ['create', 'creator', 'made', 'formed', 'genesis', 'heaven and earth', 'light', 'sun', 'moon', 'stars', 'sea', 'land', 'plants', 'trees', 'living creatures', 'made man', 'image of god', 'firmament', 'expanse', 'deep', 'breath of life'],
  JUDGMENT: ['judge', 'judgment', 'justice', 'righteous judgment', 'day of the lord', 'day of wrath', 'separate', 'sheep goats', 'wheat tares', 'condemn', 'innocent', 'guilty', 'throne', 'book of life', 'account', 'reward', 'punish', 'avenge', 'vengeance', 'eye for', 'recompense'],
  PRAISE: ['praise', 'worship', 'sing', 'song', 'psalm', 'hymn', 'melody', 'harp', 'lyre', 'trumpet', 'cymbals', 'musical instruments', 'dance', 'bow down', 'worship him', 'glory', 'magnify', 'exalt', 'extol', 'bless the lord', 'temple', 'Zion', 'Jerusalem'],
  WAITING: ['wait', 'waiting', 'patient', 'patience', 'expect', 'look for', 'tarry', 'delay', 'promised', 'soon', 'draw near', 'the lord will come', 'not slow', 'keep watch', 'watchman', 'sleeper', 'wake up', 'far off', 'approaching', 'near'],
  GENERIC: []
};

const TA_KEYWORDS: Record<BibleThemeKey, string[]> = {
  PROTECTION: ['காப்பாற்று', 'தலைக்காய', 'அபாயம்', 'பாதுகாப்பு', 'கோட்டை', 'சரணாகம்', 'துணை', 'விடுதலை', 'அச்சம்', 'கவலை', 'தொடர்பு'],
  PROVISION: ['அளிக்கிறார்', 'சமைத்துத்தருகிறார்', 'அபூர்வம்', 'சர்வசகல', 'ஆரோக்கியம்', 'பசி', 'தாகம்', 'திருப்தி', 'அமுதம்', 'பஞ்சம்', 'கனிவு'],
  RECOVERY: ['மீட்டெடுக்க', 'மீட்டெடுக்கிறார்', 'திரும்பப் பெற', 'வெற்றி', 'கைப்பற்ற', 'பின்தொடர', 'கலைக்க', 'வெல்ல', 'வீழ்த்த', 'சங்ககம்', 'விடுதலை'],
  PEACE: ['சமாதானம்', 'இருக்கை', 'மகிழ்ச்சி', 'மௌனம்', 'அமைதி', 'நிம்மதி', 'இயற்கை', 'மிகவும் நோயில்லாமல்'],
  HOPE: ['நம்பிக்கை', 'முன்னேற்றம்', 'எதிர்பார்ப்பு', 'வாக்குறுதி', 'புதுயிர்', 'புதுஜீவனம்', 'அதிகாரம்', 'எழுந்திரு'],
  GUIDANCE: ['வழிநடத்துகிறார்', 'கற்பிப்பார்', 'வழி', 'பாதை', 'விளக்கு', 'ஒளி', 'கல்வி', 'போதகம்', 'புலனாய்வு'],
  LOVE: ['அன்பு', 'அன்பு நிறைந்த', 'கருணை', 'கிருபை', 'அசுத்த', 'இரக்கம்', 'காதல்', 'நிலையான அன்பு', 'மாறாத அன்பு'],
  FAITH: ['விசுவாசம்', 'நம்பிக்கை', 'நிலைத்து நிற்க', 'நிலைக்க', 'இருக்கை', 'வேர் விதைக்க', 'அமைதியாய்', 'மாறாது', 'உறுதியான'],
  STRENGTH: ['வலம்', 'வலிமை', 'தாக்குதல்', 'சக்தி', 'எழுந்திரு', 'கழுகு', 'விரைத்து', 'சோராது', 'தளராது', 'உறுதியேற்றுகிறார்'],
  HEALING: ['ஆரோக்கியம்', 'குணப்படுத்துகிறார்', 'மீட்சி', 'குணம்', 'புண்', 'பிணி', 'வியாதி', 'புற்றுநோய்', 'குரங்கு', 'கண்கள் பார்க்க', 'செவிகள் கேட்க'],
  THANKSGIVING: ['நன்றி', 'ஸ்தோத்திரம்', 'மேகிப்பு', 'போற்றி', 'பாடல்', 'கீர்த்தனை', 'புகழ்ந்து பாட', 'நன்றி சொல்லு'],
  FORGIVENESS: ['மன்னிப்பு', 'மன்னிக்க', 'அழிக்க', 'கழுவ', 'தூய்மைப்படுத்த', 'இரத்தம்', 'பாவம்', 'குற்றம்', 'குற்றங்கள்', 'குணப்படுத்து'],
  WISDOM: ['ஞானம்', 'விவேகம்', 'போதனை', 'கற்பிக்கிறார்', 'அறிவு', 'கல்வி', 'திறமை', 'ஞானசம்பந்தன்'],
  COMFORT: ['ஆறுதல்', 'ஆறுதலளிக்கிறார்', 'காவல்', 'குலைந்து', 'கண்ணீர்', 'வருத்தம்', 'துன்பம்', 'மன அழுத்தம்'],
  SALVATION: ['இரட்சிப்பு', 'விடுதலை', 'மீட்சி', 'விமோசனை', 'புதுச்சுடர்', 'என்றுமுள்ள வாழ்க்கை', 'இரத்தம்', 'நிமிஷம்', 'ஞானம்', 'மாசில்லாத் தூவி'],
  CREATION: ['சிருஷ்டிப்பு', 'உறுவக்கியவர்', 'படைத்தவர்', 'உலகம்', 'வானம்', 'பூமி', 'சூரியன்', 'நிலா', 'விண்மீன்கள்', 'கடல்'],
  JUDGMENT: ['நியாயம்', 'நியாயாதிபதி', 'தீர்ப்பு', 'நியாய விசாரணை', 'அற்புதம்', 'கோபத்தின் நாள்', 'பன்னிரண்டு', 'பருத்தி', 'கோட்பாடு'],
  PRAISE: ['ஸ்தோத்திரம்', 'போற்றி', 'புகழ்', 'மேகிப்பு', 'பாடல்', 'பாடுக', 'சத்தானம்', 'கீதம்', 'வணக்கம்', 'தாழ்ந்து வணங்கு'],
  WAITING: ['காத்திரு', 'காத்திருக்கிறேன்', 'பொறுமை', 'பொறுமையாய்', 'எதிர்பார்த்து', 'தாமசம்', 'விரைவில்', 'புறப்படுகிறார்'],
  GENERIC: []
};

const TE_KEYWORDS: Record<BibleThemeKey, string[]> = {
  PROTECTION: ['రక్షించు', 'రక్షణ', 'ఆశ్రయం', 'కోట', 'గోడ', 'పారాపట్టను', 'బద్ధపరచు', 'భయం', 'అపాయం', 'విమోచనం'],
  PROVISION: ['అందజేయు', 'సామర్థ్యం', 'పుష్టి', 'ప్రవహించు', 'ఆహారం', 'ఆకలి', 'దాహం', 'తృప్తి', 'పంట', 'సంపద'],
  RECOVERY: ['తిరిగి పొందు', 'తీసికెళ్ళు', 'వెనుకాడు', 'గెలుచు', 'విజయం', 'సాధించు', 'దండి పెట్టు', 'విమోచనం', 'విడిపించు'],
  PEACE: ['శాంతి', 'శాంతము', 'ప్రశాంతత', 'నిద్ర', 'విశ్రాంతి', 'అమరత్వము', 'నెమ్మది', 'చల్లని'],
  HOPE: ['ఆశ', 'ఊహ', 'వాగ్దానం', 'వైభవం', 'పునరుద్ధరణ', 'ప్రత్యక్షం', 'భవిష్యత్తు', 'వెలువడు'],
  GUIDANCE: ['మార్గదర్శనం', 'బోధించు', 'మార్గం', 'దారి', 'దీపము', 'వెలుగు', 'గురువు', 'బోధన', 'ఉపదేశం'],
  LOVE: ['ప్రేమ', 'దయ', 'కరుణ', 'కృప', 'ప్రేమతో', 'అనురాగం', 'విశ్వాసపాత్ర', 'నిలచే ప్రేమ'],
  FAITH: ['విశ్వాసం', 'నమ్మకం', 'నిర్మలము', 'నిలిచే', 'ఉంచు', 'స్థిరపరచు', 'భాగ్యం', 'మెలికపరచు'],
  STRENGTH: ['బలము', 'శక్తి', 'ప్రభావం', 'సామర్థ్యం', 'పైకి తేలు', 'గృధ్ర', 'అయస్కాంతం', 'క్షీణించకుండా', 'పందుకొను'],
  HEALING: ['ఆరోగ్యం', 'బాగుపరచు', 'క్షమింపు', 'వైద్యుడు', 'పుణ్యం', 'గాయము', 'వ్యాధి', 'అనారోగ్యం', 'చికిత్స'],
  THANKSGIVING: ['కృతజ్ఞత', 'స్తోత్రం', 'మెచ్చుకొను', 'స్తుతించు', 'గానం', 'గీతము', 'వాచనం', 'కృతజ్ఞులౌతూ'],
  FORGIVENESS: ['క్షమా', 'క్షమించు', 'తొడగించు', 'కడుగు', 'శుభ్రపరచు', 'పాపం', 'అపరాధం', 'రక్తం', 'విమోచనం'],
  WISDOM: ['జ్ఞానం', 'వివేకం', 'బోధన', 'శిక్షణ', 'ఉపదేశం', 'నిపుణత', 'ప్రజ్ఞ', 'దృష్టాంతం'],
  COMFORT: ['ఆదరణ', 'ఆదరించు', 'ఆశ్వాసం', 'దుఃఖం', 'కళ్లు తుడిచు', 'కణ్నీరు', 'ఏకాంతం', 'సొంతం'],
  SALVATION: ['రక్షణ', 'విమోచనం', 'తిరుగుబాటు', 'శాశ్వత జీవం', 'నివారణ', 'రక్తం', 'బాప్తిస్మం', 'నూతన జీవనం'],
  CREATION: ['సృష్టి', 'సృష్టికర్త', 'రచించాడు', 'ఆకాశము', 'భూమి', 'సూర్యుడు', 'చంద్రుడు', 'నక్షత్రాలు', 'సముద్రం'],
  JUDGMENT: ['తీర్పు', 'న్యాయం', 'న్యాయాధిపతి', 'ప్రతీకారం', 'రోష దినం', 'పొలుసు', 'గుత్తె', 'బహిష్కరించు'],
  PRAISE: ['స్తోత్రం', 'వందనం', 'పాట', 'గీతం', 'కీర్తన', 'బొమ్మాలు', 'నమస్కరించు', 'ప్రణామం', 'మహిమ'],
  WAITING: ['వేచి', 'వేచిఉండు', 'పోరాటపడు', 'ప్రతీక్ష', 'శీఘ్రం', 'సమీపం', 'వచ్చేది', 'పురుగుతుంది'],
  GENERIC: []
};

export function detectTheme(english: string, tamil: string = '', telugu: string = ''): DetectedTheme {
  const allText = `${english} ${tamil} ${telugu}`.toLowerCase();
  const scores: Record<string, { key: BibleThemeKey; score: number; matched: string[] }> = {};

  (Object.keys(THEME_SPECS) as BibleThemeKey[]).forEach((key) => {
    scores[key] = { key, score: 0, matched: [] };
  });

  (Object.keys(EN_KEYWORDS) as BibleThemeKey[]).forEach((key) => {
    EN_KEYWORDS[key].forEach((kw) => {
      if (allText.includes(kw.toLowerCase())) {
        scores[key].score += kw.length > 6 ? 3 : 2;
        if (!scores[key].matched.includes(kw)) scores[key].matched.push(kw);
      }
    });
  });

  if (tamil) {
    (Object.keys(TA_KEYWORDS) as BibleThemeKey[]).forEach((key) => {
      TA_KEYWORDS[key].forEach((kw) => {
        if (tamil.includes(kw)) {
          scores[key].score += 4;
          if (!scores[key].matched.includes(kw)) scores[key].matched.push(kw);
        }
      });
    });
  }

  if (telugu) {
    (Object.keys(TE_KEYWORDS) as BibleThemeKey[]).forEach((key) => {
      TE_KEYWORDS[key].forEach((kw) => {
        if (telugu.includes(kw)) {
          scores[key].score += 4;
          if (!scores[key].matched.includes(kw)) scores[key].matched.push(kw);
        }
      });
    });
  }

  const sorted = Object.values(scores).sort((a, b) => b.score - a.score);
  const best = sorted[0];

  if (best.score > 0) {
    const secondScore = sorted[1]?.score ?? 0;
    const confidence = secondScore === 0 ? 1.0 : Math.max(0.55, Math.min(0.98, best.score / (best.score + secondScore)));
    return {
      themeKey: best.key,
      confidence,
      matchedKeywords: best.matched,
      spec: THEME_SPECS[best.key]
    };
  }

  return {
    themeKey: 'GENERIC',
    confidence: 0.3,
    matchedKeywords: [],
    spec: THEME_SPECS.GENERIC
  };
}

export function pickVisualConcept(spec: ThemeVisualSpec, seedSalt: string = ''): string {
  const pool = spec.visualConcepts;
  const idx = hashSeed(seedSalt, pool.length);
  return pool[idx];
}

function hashSeed(seedSalt: string, poolLength: number): number {
  let hash = 0;
  for (let i = 0; i < seedSalt.length; i++) {
    hash = (hash * 31 + seedSalt.charCodeAt(i)) | 0;
  }
  return hash === 0 ? Math.floor(Math.random() * poolLength) : Math.abs(hash) % poolLength;
}

// Per-theme color-grade options (Issue: every Shorts/poster background was converging on the same
// warm golden-hour look - reported directly from the YouTube Studio Shorts grid, many different
// verses all reading as the same photo). Index 0 preserves each theme's original warm grade (used
// verbatim by the no-Claude static fallback below, so that path's look doesn't change); the
// remaining entries are genuinely cool/neutral alternatives in the same theme's register. A soft
// "please vary the grade" instruction alone was tested directly against Claude and did NOT work -
// it kept defaulting to the single most-reinforced "warm amber-brown" phrase regardless. So this
// picks a SPECIFIC grade deterministically per verse (same hashing approach as pickVisualConcept,
// salted differently so the two picks don't move in lockstep) and hands it to Claude as a concrete
// per-verse assignment via analyzeVerseWithClaude's userPrompt, the same pattern already used for
// the theme/visualConcept hints below - a concrete instruction, not an abstract preference.
const COLOR_GRADE_POOLS: Record<BibleThemeKey, string[]> = {
  PROTECTION: [
    'warm golden rim light, amber-brown and deep indigo color grade',
    'cool storm-blue and slate-gray color grade with a single small warm lantern accent',
    'muted moonlit silver and charcoal color grade, quiet night watch',
  ],
  PROVISION: [
    'warm backlit amber-brown and cream color grade',
    'soft neutral wheat-gold fading to pale overcast gray color grade',
    'cool early-morning blue-gray kitchen-light color grade',
  ],
  RECOVERY: [
    'high-contrast warm-orange and deep brown color grade',
    'steel-blue dawn color grade breaking open with a single warm rim-light accent',
    'stormy charcoal-gray color grade parting to brilliant gold',
  ],
  PEACE: [
    'airy pastel-to-gold color grade',
    'cool dawn cerulean-to-white color grade',
    'soft sage-green and overcast pearl-gray color grade',
  ],
  HOPE: [
    'hopeful brightening color grade of indigo through rose to gold',
    'cool pre-dawn slate-blue color grade with one thin gold line on the horizon',
    'soft misty gray-lavender color grade brightening toward pale gold',
  ],
  GUIDANCE: [
    'warm amber and deep blue color grade with precise color separation',
    'cool indigo-night color grade with a single small warm lamp accent',
    'overcast pearl-gray fog color grade with a warm lantern accent',
  ],
  LOVE: [
    'rose-gold and soft cream color grade',
    'cool moonlit blue-silver color grade',
    'muted dusty-rose and charcoal color grade',
  ],
  FAITH: [
    'blue-gray charcoal storm tones and warm gold sanctuary light color grade',
    'deep indigo storm-light color grade, no warm accent',
    'muted sage-green and weathered stone-gray color grade',
  ],
  STRENGTH: [
    'warm honey gold and deep bronze sunset color grade',
    'steel-blue dawn color grade with a single warm rim-light accent',
    'stormy slate-gray color grade breaking open to one narrow shaft of light',
  ],
  HEALING: [
    'cream white and soft muted teal healing color grade',
    'cool moonlit blue-silver color grade, quiet night vigil',
    'soft neutral dove-gray and cream color grade',
  ],
  THANKSGIVING: [
    'rich harvest color palette of deep burnt orange, amber gold, burgundy purple and forest green',
    'soft neutral wheat and warm-gray autumn-light color grade',
    'cool early frost-blue morning-light color grade',
  ],
  FORGIVENESS: [
    'clean white and warm cream color grade against soft background shadow',
    'cool moonlit blue-silver color grade',
    'muted dusty-rose and soft charcoal color grade',
  ],
  WISDOM: [
    'warm gold and deep walnut-brown color grade',
    'cool indigo-night study color grade with a single small warm lamp accent',
    'overcast pearl-gray daylight color grade through a window',
  ],
  COMFORT: [
    'muted gentle tone palette of cream, pale dusty blue, and warm dove gray',
    'cool moonlit blue-silver color grade, quiet night vigil',
    'muted dusty-rose and charcoal color grade',
  ],
  SALVATION: [
    'warm burnished gold and deep blue-black indigo color grade',
    'cool pre-dawn indigo color grade breaking to a single bright gold line',
    'stormy charcoal color grade parting to brilliant light',
  ],
  CREATION: [
    'golden hour rich deep saturated color grade',
    'twilight blue hour color grade, crisp and cool',
    'deep indigo starlit-night color grade',
  ],
  JUDGMENT: [
    'muted solemn stone gray and warm torch-gold color grade with no bright distractions',
    'cold blue-gray storm-light color grade, no warm accent',
    'deep indigo dusk color grade with a single narrow shaft of light',
  ],
  PRAISE: [
    'warm golden festival light, rich deep colors of crimson, cobalt blue and burnished gold',
    'cool dawn cerulean color grade with bright festival color accents',
    'soft neutral daylight color grade with rich color accents, no golden cast',
  ],
  WAITING: [
    'muted warm brown and soft dusty blue color grade',
    'deep indigo twilight color grade, cooler and quieter',
    'overcast pearl-gray color grade with a single small warm lantern accent',
  ],
  GENERIC: [
    'airy pastel-to-gold color grade',
    'cool overcast pearl-gray and soft blue color grade',
    'muted sage and warm dove-gray color grade',
  ],
};

// Deterministic per-verse pick (stable across repeat calls for the same verse, varied across
// different verses) - salted with '::grade' so this doesn't always move in lockstep with
// pickVisualConcept's own hash of the same seedSalt.
export function pickColorGrade(themeKey: BibleThemeKey, seedSalt: string = ''): string {
  const pool = COLOR_GRADE_POOLS[themeKey] ?? COLOR_GRADE_POOLS.GENERIC;
  const idx = hashSeed(`${seedSalt}::grade`, pool.length);
  return pool[idx];
}

// 'vertical' (default): subject confined to the bottom, text zone reserved on top - the layout
// every theme's visualConcepts/cinematicPromptBase was written for, and what Video/Meditation
// frames still use (locked to 9:16 for YouTube Shorts, can't use a side-column layout).
// 'editorial': subject confined to the RIGHT side, a text column reserved on the LEFT - the new
// left-text/right-subject poster style (see posterRenderer.ts's renderEditorialPoster).
// 'corner': subject confined to a small bottom-RIGHT corner, wide open top for text (see
// renderCornerPoster) - functionally close to 'vertical' but with a tighter, asymmetric subject
// zone instead of a centered bottom band.
// 'centered': subject confined to the middle column, text flanking it on BOTH sides at once - one
// language per side (see renderCenteredPoster), not a single block.
// Only the placement clause below differs between these; the theme's own visual concept and
// cinematic base text are shared and untouched by this flag. Which of editorial/corner/centered a
// given verse gets is chosen automatically from its detected theme - see
// pickPosterLayoutForTheme below - never client-specified.
export type PosterLayout = 'vertical' | 'editorial' | 'corner' | 'centered';

const VERTICAL_PLACEMENT_CLAUSE = 'ZERO OVERLAP DIRECTIVE - COMPOSITION GUARANTEE: the frame has two dedicated zones. The upper 55%+ is a CLEAN TEXT ZONE reserved for Scripture overlay - completely open and empty: plain sky, distant softly-blurred backdrop, or a smooth uniform gradient, with no clutter, texture, light rays, or busy detail. The entire subject (any person, animal, object, building, or tree) is confined strictly to a SUBJECT ZONE in the bottom 25% - 45% of the frame only, tightly grouped, never scattered. Zero overlap, ever: absolutely no tall silhouette, head, shoulder, hand, building, tree, or any object crosses above the vertical midpoint (50% line) of the image, not even partially. If a person is in the shot, do NOT frame their full head-to-foot body and merely position it low - percentage placement of a whole figure is not reliable. Instead crop the shot itself: shoulders-down or waist-down only, head and face excluded from frame entirely, so there is structurally nothing to place above the midpoint. Keep this a chest-down or waist-down crop, not an extreme macro close-up - depth of field should stay moderate enough that the setting around the subject is still softly recognizable, not a total abstract blur. Fill the lower zone deliberately and professionally: no tiny subject lost in space, no cramped edges, a deliberate intentional editorial composition.';

// This exact directionality (subject RIGHT, not left or center) is the single most commonly
// violated instruction in this layout - verified directly against real generation logs: 4 of 5
// attempts for one verse placed the figure on the LEFT or in the CENTER despite this clause,
// something the vertical (subject-bottom) layout never has an equivalent failure mode for, since
// "bottom" has no mirror-image ambiguity the way "right" apparently does for this model. The
// repetition and the explicit "NOT left, NOT center" negation below are deliberate, not redundant -
// a single mention of "right" was not enough.
const EDITORIAL_PLACEMENT_CLAUSE = 'SIDE OVERLAP DIRECTIVE - COMPOSITION GUARANTEE: the frame has two dedicated zones, split vertically left-to-right rather than top-to-bottom. The LEFT 55% - 60% of the frame (its full height, top to bottom) is a CLEAN TEXT ZONE reserved for Scripture overlay - completely open and empty: plain sky, a distant softly-blurred backdrop, or a smooth uniform gradient, with no clutter, texture, light rays, or busy detail. The entire subject (any person, animal, object, building, or tree) is confined strictly to a SUBJECT ZONE on the RIGHT-HAND SIDE of the frame - the right 25% - 45% of its width, the side nearer the right edge of the photograph - NOT the left side and NOT the center. Zero overlap, ever: no part of the subject crosses left of that vertical line, not even partially - not a raised hand, not a branch, not a shadow. If a person is in the shot, keep them compact within the RIGHT-side column rather than sprawling toward center or appearing on the left; a full head-to-foot figure is fine here (unlike the top-clear layout, the head does not need to be cropped out) as long as the entire figure - head included - stays on the right side of the line. Do NOT place the subject on the left side of the frame and do NOT center it - this is a right-side-only composition, mirror-imaged from what might feel like the default. Fill the right-side zone deliberately and professionally: no tiny subject lost in space, no cramped edges, a deliberate intentional editorial composition, matching the framing of a premium devotional print - a wooden cross, a lit lantern, a tree, a doorway, or a compact figure positioned confidently in the right third of the frame, with the left two-thirds left entirely open.';

// Same left/right directionality risk as EDITORIAL_PLACEMENT_CLAUSE above, plus a second, deeper
// failure mode discovered directly against real generation logs: for landscape-heavy visual
// concepts (mountains, forests, open fields), asking to confine "the entire subject" to a small
// bottom-right corner failed 5/5 review attempts - a wide establishing landscape structurally
// resists being squeezed into 20% of the frame, and the model just filled the whole frame instead.
// The fix is distinguishing calm ATMOSPHERE (which may fill the whole frame, including the top,
// as long as it stays low-detail) from the CONCRETE SUBJECT (which alone must be corner-confined) -
// not asking the same "shrink everything into the corner" of a full landscape scene.
const CORNER_PLACEMENT_CLAUSE = 'CORNER COMPOSITION GUARANTEE: distinguish calm ATMOSPHERE from the CONCRETE SUBJECT - they follow different rules. Calm atmosphere (open sky, distant softly-blurred hills or horizon, a smooth gradient, gentle haze, a wide but SOFT/LOW-DETAIL landscape backdrop) MAY extend across the ENTIRE frame, including the top and middle - it does not need to vanish, it just needs to stay genuinely calm, low-detail, and uncluttered wherever it appears, since text will be placed directly over it. The CONCRETE SUBJECT - any well-defined, sharply-detailed foreground element the eye is drawn to: a person, an animal, a building, a tree with visible bark/leaf texture, a rock formation, any single "main thing" - must be confined SPECIFICALLY to a small area in the bottom-right corner only (roughly the bottom 20% of height, right half of width) and appear NOWHERE else in the frame - not the bottom-left, not spanning the full width, not repeated elsewhere. The TOP 50% must have no sharply-detailed concrete element at all, only calm atmosphere. If the verse\'s own visual concept is itself a landscape/scenery type with no natural single figure or object (mountains, fields, open sky), keep that ENTIRE landscape soft, hazy, and low-detail throughout - like a gentle atmospheric backdrop, not a sharp epic vista filling the frame with texture - and add exactly ONE small, clearly-detailed grounded element (a tree, a distant figure, a rock, a gate) confined to the bottom-right corner as the actual focal point, standing out against the soft backdrop around it.';

// The middle column is genuinely centered (not directional), but each flanking column IS a
// left-vs-right distinction, so the same negation technique still applies: don't let the subject
// drift into either flanking third.
const CENTERED_PLACEMENT_CLAUSE = 'CENTER-FLANKED COMPOSITION GUARANTEE: the frame has three vertical zones side by side. The CENTER 30% of the frame\'s width (its full height) holds the entire subject - a person elevated/upright, hands reaching, or a single symbolic object - confined strictly to that middle column, tightly grouped. The LEFT 30% - 35% of the frame\'s width and the RIGHT 30% - 35% are BOTH separate CLEAN TEXT ZONES, completely open and empty on EACH side - plain sky, a distant softly-blurred backdrop, or a smooth uniform gradient, with no clutter, texture, or busy detail in either flanking column. Zero overlap in both directions: no part of the subject crosses into the left third, and no part crosses into the right third - not a raised hand, not fabric, not a shadow, on either side. Do NOT let the subject drift toward one edge - it must read as genuinely centered, with both flanking columns equally open, since text will be placed independently in BOTH of them at once. If a person is in the shot, a full head-to-foot figure is fine, centered and upright, elevated enough in the frame to read as the clear emotional focal point.';

export function buildStandardizedPrompt(
  spec: ThemeVisualSpec,
  visualConcept: string,
  extraCompositionHint: string = '',
  colorGradeOverride: string = '',
  layout: PosterLayout = 'vertical'
): { prompt: string; negativePrompt: string; composition: string } {
  const composition = extraCompositionHint || spec.compositionPattern;
  const placementClause = layout === 'editorial' ? EDITORIAL_PLACEMENT_CLAUSE
    : layout === 'corner' ? CORNER_PLACEMENT_CLAUSE
    : layout === 'centered' ? CENTERED_PLACEMENT_CLAUSE
    : VERTICAL_PLACEMENT_CLAUSE;

  const prompt = [
    visualConcept,
    '—',
    spec.cinematicPromptBase,
    '—',
    ...(colorGradeOverride ? [`Use this specific color grade instead of any other grade mentioned above: ${colorGradeOverride}.`, '—'] : []),
    placementClause,
    '—',
    'shot on ARRI Alexa or RED Komodo, natural color science, rich dynamic range, properly exposed highlights and shadows, Kodak Portra 400 or Ektar 100 film stock emulation, fine natural film grain, tangible texture on fabrics wood stone leather linen wool and skin, natural atmospheric perspective, subject-background separation via light not just blur, volumetric light with visible air or dust motes, professional editorial or documentary photography quality, not a snapshot or phone camera'
  ].join(' ');

  const negativePromptBase = 'text, typography, letters, words, watermark, logo, signature, caption, blurry, low quality, distorted anatomy, extra limbs, duplicate subjects, illustration, cartoon, anime, 3d render, cgi, painting, clipart, amateur photo, snapshot, distorted face, ugly, deformed, extra fingers, oversharpened, oversaturated, plastic skin, waxy texture, uncanny valley, fake lighting, flat lighting, no depth, washed out, high iso noise, jpeg artifacts, banding, posterization, bad hands, fused fingers, missing fingers, mutated hands, malformed limbs, floating limbs, disconnected limbs, revealing clothing, low-cut neckline, cleavage, lingerie, swimwear, nudity, seductive pose, glamour photography, fashion editorial, sexualized, suggestive';
  // Explicit negative terms for the failure mode logs showed repeatedly: the subject landing on
  // the left or in the center instead of the right (see EDITORIAL_PLACEMENT_CLAUSE's comment).
  const negativePrompt = layout === 'editorial'
    ? `${negativePromptBase}, subject on left side, figure on left side, left-aligned subject, centered subject, symmetrical composition, subject in middle of frame`
    : layout === 'corner'
    ? `${negativePromptBase}, subject on bottom left, subject spanning full width, centered subject, symmetrical composition, subject in text zone, tall subject crossing into top half`
    : layout === 'centered'
    ? `${negativePromptBase}, subject touching left edge, subject touching right edge, off-center subject, subject in left third, subject in right third, asymmetrical composition`
    : negativePromptBase;

  return { prompt, negativePrompt, composition };
}

export function getThemeSpec(key: BibleThemeKey): ThemeVisualSpec {
  return THEME_SPECS[key] ?? THEME_SPECS.GENERIC;
}

export const ALL_THEME_KEYS: BibleThemeKey[] = (Object.keys(THEME_SPECS) as BibleThemeKey[]);

// Which Poster style (see PosterLayout above) a given theme gets - the same deterministic,
// no-manual-picker approach the app already uses for visual concepts, color grades, and fonts.
// A judgment call grounded in the pasted spec's own "Best for" guidance per option:
//   - 'editorial' (subject-right, symbolic object): "peace verses, crucifixion imagery, symbolic
//     elements" - peace, salvation, faith/steadfastness (often an object - tree, church), mercy,
//     and the general/unthemed default.
//   - 'corner' (small bottom-right subject, wide landscape/sky): "landscape backgrounds with
//     spiritual figures" - protection, recovery, hope, guidance, strength, creation, judgment -
//     all themes whose visual concepts lean on wide scenery (mountains, fields, storms, dawn).
//   - 'centered' (subject centered, dual-column text): "prayers, hands reaching, spiritual
//     moments" - provision, love, healing, thanksgiving, wisdom, comfort, praise, waiting - the
//     more intimate/gesture-led themes (hands, embraces, quiet seated moments).
export const POSTER_LAYOUT_BY_THEME: Record<BibleThemeKey, 'editorial' | 'corner' | 'centered'> = {
  PEACE: 'editorial',
  SALVATION: 'editorial',
  FAITH: 'editorial',
  FORGIVENESS: 'editorial',
  GENERIC: 'editorial',
  PROTECTION: 'corner',
  RECOVERY: 'corner',
  HOPE: 'corner',
  GUIDANCE: 'corner',
  STRENGTH: 'corner',
  CREATION: 'corner',
  JUDGMENT: 'corner',
  PROVISION: 'centered',
  LOVE: 'centered',
  HEALING: 'centered',
  THANKSGIVING: 'centered',
  WISDOM: 'centered',
  COMFORT: 'centered',
  PRAISE: 'centered',
  WAITING: 'centered',
};

export function pickPosterLayoutForTheme(themeKey: BibleThemeKey): 'editorial' | 'corner' | 'centered' {
  return POSTER_LAYOUT_BY_THEME[themeKey] ?? 'editorial';
}
