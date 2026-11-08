# Spécification : temps musical et transport partagé

## Scénario de référence

Un utilisateur ouvre faustmodular et faustdaw dans le même navigateur. Dans faustmodular, une scène joue à 120 BPM,
en 4/4 ; une Sync Clock bat les doubles croches. Dans faustdaw, la règle affiche des mesures et des temps au lieu de
secondes ; les lignes de mesure tombent exactement là où, dans faustmodular, la Sync Clock donne ses portes de début
de mesure. L'utilisateur appuie sur Lecture dans faustdaw : faustmodular démarre aussi, au même échantillon. Il dépose
un enregistrement sur une piste : le clip s'aimante au début de la mesure la plus proche. Il passe le tempo à 100 BPM :
la grille se resserre, les clips ne bougent pas.

Pendant tout ce temps, le défilement de la partition de montage reste aussi fluide qu'avant : la grille musicale est
dessinée dans les tampons de rendu existants, jamais à chaque frame.

## Portée de ce raffinement

Ce raffinement ajoute à faustdaw une **projection musicale** de la timeline absolue, et sa synchronisation avec la
ligne de temps partagée par les applications Faust du navigateur (faust-sync, `FAUST-SYNC-SPEC.md` du dépôt
faustmodular).

- La timeline canonique reste exprimée en `TimeCoord` entiers (`TIMELINESPEC.md`). Le temps musical est une
  projection, pas un remplacement (`ADVANCEDIDEAS.md`, « Musical Timeline Over Absolute Time »).
- Un tempo et une mesure uniques pour toute la session (version 1). Changer le tempo ne déplace aucun clip.
- Les clips restent ancrés en temps absolu ; aucun étirement temporel.
- Le transport de faustdaw peut suivre et piloter la ligne de temps partagée.

Hors portée : carte de tempo (changements de tempo ou de mesure en cours de morceau), clips ancrés en temps musical,
quantification automatique, MIDI, enregistrement (une spécification à part, plus tard).

## Constats préalables

L'étude du code (novembre 2026) relève quatre points qui conditionnent ce raffinement.

1. **Unités mêlées à la lecture.** `buildPlan` (`demo/playback-scheduler.ts`) calcule
   `offsetInBufferFrames = getClipSourceStartSample(clip) + max(effectiveStart − clip.start, 0)` : un écart en
   `TimeCoord` ajouté à un indice en échantillons. C'est exact à 48 et 96 kHz (`internalTimeFactor = 1`), faux sinon.
   À corriger avant toute exigence d'exactitude à l'échantillon.
2. **Réseau de zoom figé à 48 kHz.** `EXACT_TIMELINE_SCALE_LEVELS` (`demo/time-scale.ts`) donne ses pas en échantillons
   à 48 kHz ; `EXACTZOOMSPEC.md` en prévoit un pour 44,1 kHz. Ce raffinement suppose `sampleRate = 48000` ou le réseau
   correspondant.
3. **Pas de compensation de latence.** Le curseur suit `AudioContext.currentTime` ; ni `outputLatency` ni
   `getOutputTimestamp()` ne sont lus. faust-sync s'appuie sur `getOutputTimestamp()` pour aligner les applications.
4. **Les bancs d'essai ne tournent plus.** `benchmarks/*.spec.ts` et `scripts/bench.mjs` visent des sélecteurs et des
   modules disparus (`#clips-layer .clip-block`, `src/daw.ts`). Ils doivent être réparés **avant** ce raffinement, pour
   mesurer qu'il ne dégrade pas le défilement (critère R0).

## Vocabulaire du domaine

- **Tempo** : nombre de temps (noires) par minute, au centième.
- **Mesure (meter)** : nombre de temps par mesure.
- **Tic** : la position musicale entière ; `PPQ = 960` tics par temps (faust-sync).
- **Origine** : la `TimeCoord` où se trouve le tic 0, début de la mesure 1.
- **Temps musical** : le triplet tempo, mesure, origine d'une session.
- **Grille musicale** : les lignes de mesure, de temps et de subdivision, et leurs étiquettes, projetées sur la
  timeline.
- **Ligne de temps partagée** : la ligne de temps de faust-sync, commune aux applications Faust du navigateur
  (tempo, mesure, lecture, position en tics, ancrée sur l'horloge audio d'une application).

## Types

```math
PPQ = 960
TempoC ::= entier, 2000 ≤ TempoC ≤ 99900          — le tempo en centièmes de BPM (20,00 à 999,00)
Meter ::= entier, 1 ≤ Meter ≤ 32
Tick ::= entier
R ::= Timebase.internalTimeRate                   — coordonnées par seconde (48000 à 48 kHz)

MusicalTime ::= MusicalTime(
  tempo: TempoC,
  meter: Meter,
  origin: TimeCoord
)

Timeline ::= Timeline(tracks, cursor, transport, musical: MusicalTime)      — raffinement de TIMELINESPEC
```

Le temps musical par défaut est `MusicalTime(12000, 4, 0)`.

## Projection

Un tic dure `6000 · R / (tempo · PPQ)` coordonnées. Les deux projections, en arithmétique entière exacte (grands
entiers) :

```math
C⟦m, t⟧ = m.origin + ⌈ (t · 6000 · R) / (m.tempo · PPQ) ⌉        — la première coordonnée où la position atteint t
T⟦m, c⟧ = ⌊ ((c − m.origin) · m.tempo · PPQ) / (6000 · R) ⌋      — le tic à la coordonnée c

Bar⟦m, k⟧  = C⟦m, k · m.meter · PPQ⟧          — le début de la mesure k + 1 (k ≥ 0, ou négatif avant l'origine)
Beat⟦m, j⟧ = C⟦m, j · PPQ⟧
```

**Propriété P-M1 (connexion).** Si un tic est plus long qu'une coordonnée, ce qui est toujours vrai
(`tempo · PPQ / 6000 ≤ 999 · 16 = 15984 < R`) :

```math
∀ m, ∀ t :  T⟦m, C⟦m, t⟧⟧ = t
∀ m, ∀ c :  C⟦m, T⟦m, c⟧⟧ ≤ c < C⟦m, T⟦m, c⟧ + 1⟧
```

**Propriété P-M2 (accord avec faust-sync).** À `R = sampleRate` (48 kHz) et pour une origine qui coïncide avec
l'ancre de la ligne de temps partagée, `C⟦m, t⟧` est exactement l'échantillon `frameOfTick(t)` de faustmodular
(`src/audio/Recording.ts`) : la règle de la Timeline faust-sync y voit le tic `t` pour la première fois. Les lignes de
mesure de faustdaw tombent donc sur les portes de début de mesure des Sync Clocks de faustmodular, à l'échantillon.

## Invariants

```math
I-M1 :  2000 ≤ timeline.musical.tempo ≤ 99900
I-M2 :  1 ≤ timeline.musical.meter ≤ 32
I-M3 :  timeline.musical.origin ∈ ℤ
I-M4 :  ∀ clip c :  c.start ne dépend pas de timeline.musical          — les clips sont en temps absolu
```

`assertValidProject` vérifie I-M1 à I-M3.

## Opérations

Les trois opérations modifient le temps musical et rien d'autre.

```math
SetTempo⟦p, tc⟧ :   pré  2000 ≤ tc ≤ 99900
                    post p'.timeline.musical = p.timeline.musical{tempo ← tc}
                         ∧ ∀ piste, ∀ clip : inchangés          [I-M4]

SetMeter⟦p, n⟧ :    pré  1 ≤ n ≤ 32
                    post p'.timeline.musical = p.timeline.musical{meter ← n}

SetOrigin⟦p, c⟧ :   pré  c ∈ ℤ
                    post p'.timeline.musical = p.timeline.musical{origin ← c}
```

- **Persistance.** `SessionDocument` reçoit un champ optionnel `musical: { tempo, meter, origin }`, comme
  `transformChain` en son temps : absent, c'est la valeur par défaut. Le document reste en version 1 ; sa révision et
  l'annulation couvrent le temps musical sans autre travail.
- **Annulation.** Chacune des trois opérations est un pas d'annulation de la session (`SESSIONSPEC.md`).

## La grille musicale

### Ce qui est affiché

Le niveau de détail est une fonction de la largeur à l'écran : on affiche le niveau le plus fin dont l'espacement est
au moins `g_min = 6` pixels, les autres disparaissant.

```math
Niveaux = [ mesure · 2^k (k ≥ 1), mesure, temps, croche, double croche ]
Visible⟦zoom, m⟧ = { n ∈ Niveaux | largeur(n, zoom, m) ≥ g_min }
```

- Les mesures portent leur numéro (1, 2, 3…) ; les temps leur rang dans la mesure quand l'espace le permet (`5.3`).
- Le mode d'affichage (*Temps* ou *Mesures*) est une préférence de la vue, persistée avec l'état de la vue
  (`demo/session-view-state.ts`), pas dans le document. En mode *Mesures*, la grille musicale remplace les lignes
  secondaires et tertiaires de la grille de temps ; les lignes primaires de temps restent, atténuées.

### Rendu : ce qui ne doit pas changer

Le défilement de la partition repose sur trois tampons glissants (`NEWFASTRENDERINGSPEC.md`, réalisé dans
`demo/grid-view/grid-view-buffers.ts`) et sur une frame de pan réduite à des transformations CSS. La grille musicale
s'y insère sans en changer les règles. Ces invariants de rendu sont normatifs.

- **R0 (mesure).** Les bancs d'essai de pan (`benchmarks/pan.perf.spec.ts`, `benchmarks/pan.compare.spec.ts`) sont
  réparés, puis exécutés avant et après. `pan.frameGap.ms` (médiane et maximum) et le nombre de reconstructions
  `render.timeline.geometryRebuild.*` ne doivent pas augmenter de plus de 5 %, sur un projet vide et un projet de
  2000 clips, en mode *Mesures*.
- **R1.** Une frame de pan stable reste une pure opération de transformation (`TimelineScene.setPanPreviewOffset`).
  La grille musicale n'y ajoute aucun dessin, aucune lecture de mise en page, aucun parcours des clips.
- **R2.** La grille musicale est dessinée **dans les tampons**, par division, comme les clips. Concrètement :
  - `registerContentPainter` devient une liste ordonnée de peintres ;
  - le peintre de grille musicale y est inscrit **avant** celui des clips et des formes d'onde, pour que les clips
    restent au-dessus ;
  - ce peintre ne dessine que dans `[début de division, fin de division)`, avec découpe.
- **R3.** La tuile périodique de la grille de temps n'est **pas** remplacée par des mesures. Une mesure n'est en
  général ni un nombre entier d'échantillons ni un nombre entier de pixels, et une origine non nulle casse la
  périodicité. Les unités de remplissage restent celles de `getRenderDivisionSpec`.
- **R4.** La clé de contenu des tampons inclut une **version du temps musical** (et le mode d'affichage). Un
  changement de tempo, de mesure ou d'origine est une seule invalidation (`invalidateWaveformSlidingBuffers`), jamais
  une par frame.
- **R5.** Les numéros de mesure sont des étiquettes DOM recyclées par clé (l'index de mesure), réconciliées seulement
  lors d'une reconstruction de géométrie, comme les étiquettes primaires (`buildBufferedRulerModels`,
  `renderRulerLabels`).
- **R6.** Les chemins directs, qui ne passent pas par les peintres, dessinent la même grille :
  `GridView.renderDirectFrame` et `WaveformView.renderDirectFrame` (zoom direct), et `TimelineWaveformPreview`.
- **R7.** Les lignes d'une division se calculent en `O(lignes de la division)` : le premier tic de la division est
  `T⟦m, début⟧`, puis on avance de tic en tic du niveau visible, avec `C⟦m, ·⟧`. Aucun parcours depuis l'origine.
- **R8.** Le réseau de lignes visibles pour un niveau de zoom est mis en cache, avec pour clé (niveau de zoom, `R`,
  version du temps musical, mode).

### Aimantation

- En mode *Mesures*, `applyClipMagnetism` aimante sur le niveau musical visible le plus fin, puis sur le temps, puis
  sur la mesure, avec les mêmes seuils en pixels que la grille de temps (3 et 4 px).
- La géométrie d'aimantation est mise en cache avec pour clé (niveau de zoom, `R`, version du temps musical).
- Les guides d'alignement entre clips (`resolveClipAlignmentTarget`) restent prioritaires sur la grille.
- Maj+clic sur la règle place le curseur sur le temps le plus proche.

## Le transport partagé

### Rôle

faustdaw devient un **participant** de faust-sync, comme faustmodular et faustcode. Il annonce son horloge audio,
mesure ses écarts avec les autres, et :

- **suit** la ligne de temps partagée : tempo, mesure, lecture, position ;
- **la pilote** : Lecture, Arrêt, changement de tempo et déplacement du curseur deviennent des opérations faust-sync,
  appliquées par toutes les applications.

La correspondance entre les deux temps est l'**origine** : le tic `t` de la ligne de temps partagée est la
coordonnée `C⟦m, t⟧` de faustdaw.

### Le protocole

- **Le code.** faustdaw utilise le code de faust-sync de faustmodular (`src/sync/` : `SharedTimeline`, `ClockLine`,
  `ClockOffset`, `TimelineCore`), compilé en module ES et gardé en copie, comme la bibliothèque des magasins dans
  faustcode.
- **Le canal.** Ses messages passent par le canal `BroadcastChannel("faust-sync")`, distinct de `"webdaw-workspace"`.
- **L'activation.** La participation est activée par une préférence de la vue (*Synchroniser avec les applications
  Faust*), active par défaut quand une autre application est présente.

### Les correspondances

| faustdaw | ligne de temps partagée |
| :-- | :-- |
| Lecture depuis le curseur `c` | `locate` au tic `T⟦m, c⟧`, puis `play` |
| Arrêt | `stop` |
| Retour à zéro (Origine) | `play` depuis le début (un `start` pour les Sync Clocks) ou `locate` 0 |
| Changement de tempo ou de mesure | `tempo`, `meter` |
| Une opération reçue d'une autre application | mise à jour de `timeline.musical` et du transport, puis du plan de lecture |

### Ordonnancement

- **La source unique.** L'ancre de `PlaybackSession` (`transportStartCoord`, `audioStartTime`) est dérivée de la
  règle de la ligne de temps partagée traduite dans le contexte audio de faustdaw (`SharedTimeline.rule`) : la
  coordonnée `C⟦m, rule.tick⟧` correspond au temps audio `rule.frame / sampleRate`. Cette ancre est la seule
  correspondance entre transport et audio (`PLAYERSPEC.md`).
- **L'exactitude.** Chaque événement de clip démarre à `start(when)`, avec `when` calculé depuis cette ancre en
  entiers puis converti une seule fois en secondes. L'exigence est le **même échantillon** que faustmodular pour une
  même position (critère C-M3). Elle suppose corrigé le constat 1.
- **Le curseur affiché** suit la position qui sort du haut-parleur : celle que `SharedTimeline.positionNow()` calcule,
  latence de sortie comprise (constat 3).
- **Les reprises.** Un déplacement du curseur pendant la lecture garde, en version 1, l'arrêt et la reprise actuels
  (`restartIfNeeded`). Le fondu de reprise déclaré (`SEEK_CROSSFADE_SECONDS`) est un point ouvert.

## Propriétés

```math
P-M3 :  SetTempo, SetMeter et SetOrigin ne changent ni O⟦·⟧ à l'arrêt, ni la position d'aucun clip
P-M4 :  pour une session synchronisée, ∀ k :  la ligne de la mesure k est à l'échantillon où faustmodular voit la
        mesure k commencer (P-M2)
P-M5 :  le rendu d'une frame de pan ne dépend pas de timeline.musical (R1)
```

## Phases

1. **Le temps musical** :
   - `MusicalTime` dans le domaine et le document ;
   - la grille musicale, ses étiquettes et l'aimantation ;
   - le mode d'affichage.

   Préalables : les constats 1 et 4 corrigés.
2. **Le transport partagé** : faustdaw participant de faust-sync, en lecture puis en pilotage. Préalable : le
   constat 3.
3. **Plus tard** :
   - la carte de tempo (marqueurs de tempo et de mesure) ;
   - les clips ancrés en temps musical ;
   - les opérations de mise en grille (`ADVANCEDIDEAS.md`, « Temporal Layout Operations »).

## Critères d'acceptation

- **C-M1.** Pour 50 tempos tirés entre 20 et 999 BPM et des mesures de 1 à 32, `T⟦m, C⟦m, t⟧⟧ = t` pour tous les tics
  d'une heure de musique (test unitaire).
- **C-M2.** À 48 kHz, `C⟦m, t⟧` égale `frameOfTick` de faustmodular pour la même règle, sur les mêmes tirages.
- **C-M3.** Deux onglets, faustmodular avec une Sync Clock et faustdaw avec un clic sur chaque mesure, sur une même
  carte son : les fronts coïncident à ±1 échantillon. Mesure par une sonde AudioWorklet, comme le test de
  synchronisation de faustmodular.
- **C-M4.** Changer le tempo ne déplace aucun clip, et coûte une seule invalidation des tampons.
- **C-M5 (R0).** Pan sur 2000 clips en mode *Mesures* : `pan.frameGap.ms` et les reconstructions à ±5 % du mode
  *Temps*.
