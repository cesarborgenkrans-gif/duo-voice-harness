/* Runtime motion authority: reviewed phrases and byte-identical active atlases. */
window.MomotamuSpeakingMotion={
  "version": 1,
  "date": "2026-10-02",
  "status": "User approved preview and authorized main-app integration on 2026-10-02",
  "sheet": "characters/momotamu/active/viewer-attending-speaking-variations-momotamu-4x2-1448x1086.png",
  "cell": [
    362,
    543
  ],
  "grid": [
    4,
    2
  ],
  "anchor": [
    181,
    440
  ],
  "poses": [
    "rest",
    "speak-soft-v1",
    "speak-emphasis-v1",
    "speak-settle-v1",
    "speak-warm-v1",
    "speak-thoughtful-v1",
    "speak-blink-v1",
    "speak-settle-v1"
  ],
  "phrases": {
    "quiet-a": {
      "id": "quiet-a",
      "label": "Quiet phrase A",
      "tone": "quiet",
      "frames": [
        3,
        1,
        3,
        1,
        3
      ],
      "ms": [
        160,
        180,
        140,
        220,
        360
      ],
      "kind": "speech"
    },
    "quiet-b": {
      "id": "quiet-b",
      "label": "Quiet phrase B",
      "tone": "quiet",
      "frames": [
        3,
        1,
        5,
        1,
        3
      ],
      "ms": [
        120,
        180,
        240,
        170,
        380
      ],
      "kind": "speech"
    },
    "explain-a": {
      "id": "explain-a",
      "label": "Explanation A",
      "tone": "explain",
      "frames": [
        3,
        1,
        2,
        1,
        3,
        1,
        3
      ],
      "ms": [
        120,
        140,
        240,
        140,
        160,
        180,
        380
      ],
      "kind": "speech"
    },
    "explain-b": {
      "id": "explain-b",
      "label": "Explanation B",
      "tone": "explain",
      "frames": [
        3,
        1,
        2,
        1,
        2,
        1,
        3
      ],
      "ms": [
        160,
        190,
        200,
        160,
        240,
        170,
        420
      ],
      "kind": "speech"
    },
    "warm-a": {
      "id": "warm-a",
      "label": "Warm reply A",
      "tone": "warm",
      "frames": [
        3,
        1,
        4,
        1,
        3
      ],
      "ms": [
        120,
        180,
        300,
        180,
        420
      ],
      "kind": "speech"
    },
    "warm-b": {
      "id": "warm-b",
      "label": "Warm reply B",
      "tone": "warm",
      "frames": [
        3,
        1,
        4,
        1,
        2,
        1,
        3
      ],
      "ms": [
        160,
        170,
        260,
        150,
        180,
        160,
        400
      ],
      "kind": "speech"
    },
    "thoughtful-a": {
      "id": "thoughtful-a",
      "label": "Thoughtful phrase A",
      "tone": "thoughtful",
      "frames": [
        3,
        1,
        5,
        1,
        3
      ],
      "ms": [
        160,
        180,
        340,
        150,
        500
      ],
      "kind": "speech"
    },
    "thoughtful-b": {
      "id": "thoughtful-b",
      "label": "Thoughtful phrase B",
      "tone": "thoughtful",
      "frames": [
        3,
        5,
        1,
        5,
        3
      ],
      "ms": [
        180,
        280,
        200,
        240,
        550
      ],
      "kind": "speech"
    },
    "blink": {
      "id": "blink",
      "label": "Brief blink",
      "tone": "quiet",
      "frames": [
        3,
        1,
        6,
        1,
        3
      ],
      "ms": [
        120,
        120,
        110,
        120,
        240
      ],
      "kind": "blink"
    },
    "entry": {
      "id": "entry",
      "label": "Begin speaking",
      "tone": "quiet",
      "frames": [
        0,
        3
      ],
      "ms": [
        160,
        180
      ],
      "kind": "entry"
    },
    "return": {
      "id": "return",
      "label": "Finish and return",
      "tone": "quiet",
      "frames": [
        3,
        0
      ],
      "ms": [
        180,
        400
      ],
      "kind": "return"
    }
  },
  "compatibleDirectedEdges": [
    [
      0,
      3
    ],
    [
      3,
      0
    ],
    [
      3,
      1
    ],
    [
      1,
      3
    ],
    [
      1,
      2
    ],
    [
      2,
      1
    ],
    [
      1,
      4
    ],
    [
      4,
      1
    ],
    [
      1,
      5
    ],
    [
      5,
      1
    ],
    [
      3,
      5
    ],
    [
      5,
      3
    ],
    [
      1,
      6
    ],
    [
      6,
      1
    ]
  ],
  "hubFrame": 3,
  "homeFrame": 0,
  "blinkGapMs": [
    6000,
    10000
  ],
  "autoToneWeights": {
    "quiet": 4,
    "explain": 3,
    "warm": 1,
    "thoughtful": 2
  },
  "method": "Visually selected phrases, per-beat holds and compatible returns. Shared painter eases registered head placement and inclination over 180 ms, with independent upper-body motion and fixed lower legs. One crisp drawing at a time; no sheet-order loop or whole-character fade.",
  "references": [
    "external-source:chibis/SPRITE-RIG-METHOD.md",
    "external-source:chibis/4x4/4x4-marina/marina-tebjudning.html"
  ],
  "minimum_clearance": 91,
  "row_gap": 203,
  "poseApproval": {
    "original-and-first-three-speaking-drawings": "user-approved 2026-10-02: Awesome!!",
    "new-warm-thoughtful-blink": "user-approved 2026-10-02: It's pretty great. Exact approved copies recorded in characters/momotamu/_work/viewer-attending-provenance.json"
  },
  "playbackReview": "Grounded continuous playback updated 2026-10-02; human visual review pending in development/reviews/smooth-motion-2026-10-02/.",
  "transitionReview": "Visually selected phrase edges and Marina timing accepted by user 2026-10-02: It's pretty great. All live Momotamu routes now reference the approved active atlas collection."
};
