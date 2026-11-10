# Spécification de Faust Transform

## Problème

Le DAW permet d'appliquer des effets Faust en temps réel sur les pistes
(chaîne d'effets par piste). Mais il n'existe aucun mécanisme pour
**transformer destructivement** le contenu audio d'un clip à l'aide d'un
programme Faust — par exemple appliquer une réverbération, une
distorsion, un filtre ou n'importe quel traitement DSP dont le résultat
remplace l'audio original du clip.

Conséquences :

1. **Pas de traitement offline par clip.** Les effets de piste sont
   globaux et temporaires — ils ne modifient pas le contenu des clips.
   Un utilisateur qui veut « cuire » un effet dans un clip doit exporter,
   retraiter hors du DAW, puis réimporter.
2. **Pas de workflow d'ajustement.** Pour trouver les bons paramètres
   d'un traitement, il faut pouvoir écouter le résultat en temps réel
   avant de s'engager. Les effets de piste offrent cette écoute, mais
   ils ne permettent pas de figer le résultat dans le clip.
3. **Les effets à queue (reverb, delay) changent la durée.** Un simple
   bounce à durée fixe tronquerait la queue de réverbération. Il faut un
   mécanisme de détection de fin automatique.

Nous voulons introduire un workflow **Faust Transform** qui permette de
prévisualiser un traitement Faust sur un clip, d'ajuster ses paramètres
en temps réel, puis de bouncer le résultat dans le clip.

## But

Fournir un workflow complet de transformation de clip par une chaîne
de programmes Faust (Transform Chain), composé de trois phases :

1. **Import** : charger un ou plusieurs programmes Faust (fichiers
   `.dsp`) dans la Transform Chain et les compiler via faustwasm.
2. **Preview** : jouer le clip sélectionné en boucle à travers la
   Transform Chain, avec une UI de paramètres pour ajuster le traitement
   en temps réel. Les effets de piste sont bypassés pendant le preview.
3. **Bounce** : appliquer le traitement offline sur le PCM du clip,
   produire un nouveau clip avec le résultat, et remplacer l'original.
   Le bounce détecte automatiquement la fin de la queue audio.

## Vocabulaire

- **Faust Transform** : l'ensemble du workflow (import → preview →
  bounce) qui transforme un clip via un ou plusieurs programmes Faust.
- **Transform Chain** : une FX Chain (`FxEffect[]`) dédiée aux
  transformations destructives de clips. Même type et mêmes opérations
  CRUD que la FX Chain de piste (add, remove, reorder, bypass, adjust
  params), mais dans un contexte différent : preview/bounce destructif
  au lieu de temps réel permanent. Elle est persistée dans la session —
  quand l'utilisateur rouvre le dialogue Transform, il retrouve ses
  derniers programmes et réglages.
- **Preview Mode** : état du DAW pendant lequel le clip sélectionné est
  joué en boucle à travers la Transform Chain, avec les effets de
  piste bypassés. L'utilisateur ajuste les paramètres des programmes via
  l'UI Orbit. Le transport normal est suspendu.
- **Bounce** : rendu offline du clip à travers la Transform Chain,
  produisant un nouveau `AudioResource` avec le résultat. Le bounce
  prolonge le rendu au-delà de la fin du clip jusqu'à ce que le niveau
  de sortie tombe sous un seuil de silence.
- **Tail Detection** : mécanisme qui détecte la fin de la queue audio
  (réverbération, delay, etc.) en mesurant le niveau RMS de la sortie.
  Le bounce s'arrête quand le niveau reste sous le seuil pendant une
  durée minimale.

## Concept 1 — Contraintes et périmètre

### Un seul clip à la fois

Le Faust Transform opère sur **un seul clip**. Raisons :

1. **Simplicité du routage audio.** Un seul `BufferSource` → Faust →
   sortie. Pas de synchronisation multi-clip à gérer.
2. **Cohérence du bounce.** Chaque clip a sa propre durée, sa propre
   resource audio. Bouncer plusieurs clips nécessiterait de gérer N
   résultats indépendants — c'est N applications de la même opération,
   pas une opération différente.
3. **Preview en boucle.** Boucler sur un seul clip est naturel. Boucler
   sur une sélection multi-clip est le rôle de Play Selection, pas de
   Faust Transform.

Si la sélection contient plusieurs clips, le menu « Faust Transform »
est grisé. L'utilisateur doit réduire la sélection à un seul clip.

### Effets de piste bypassés

Pendant le Preview Mode, les effets de la piste du clip sont
**intégralement bypassés**. Le signal suit le chemin :

```
clip audio → Transform Chain → master output
```

Raison : l'utilisateur veut entendre **uniquement** l'effet de la
Transform Chain, sans coloration par la chaîne d'effets de piste. C'est
une écoute en solo du clip transformé.

Le volume de piste, le pan, le mute et le solo sont également ignorés
pendant le preview — le clip est joué à volume unitaire, centré.

### Transform Chain — mémoire des programmes et paramètres

Les programmes Faust utilisés pour les transformations sont conservés
dans une **Transform Chain** — une FX Chain (`FxEffect[]`) globale
(non liée à une piste), persistée dans la session. Le concept de FX
Chain est unique : même type, mêmes opérations CRUD, même UI Orbit.
Seul le contexte d'utilisation varie :

|   | FX Chain de piste | Transform Chain |
| --- | --- | --- |
| **Rattachement** | Par piste (`track.effects`) | Global (`project` ou `demoState`) |
| **Contexte audio** | Temps réel, non destructif, permanent | Preview → Bounce destructif, éphémère |
| **Persistance** | Dans la session, par piste | Dans la session, globalement |

Quand l'utilisateur ouvre le dialogue Transform :
- Il retrouve la Transform Chain telle qu'il l'a laissée (programmes +
  paramètres ajustés).
- Il peut ajouter un nouveau `.dsp` (drag-and-drop ou sélecteur de
  fichier), le réordonner, le supprimer, le bypasser — mêmes gestes
  que la FX Chain de piste.
- Le preview joue le clip à travers **toute la chaîne** (effets non
  bypassés, en série).

Les `FxResource` importées pour la Transform Chain sont stockées dans
le même catalogue global `project.fxResources` que celles des effets
de piste. Un même programme Faust peut donc être utilisé à la fois
comme effet de piste et comme programme de transformation.

## Concept 2 — Preview Mode

### Entrée en Preview Mode

L'utilisateur entre en Preview Mode via l'une de ces actions :

- **Bouton** dans le context menu du clip : « Faust Transform… »
  qui ouvre le panneau overlay avec la Transform Chain.
- **Drag-and-drop** d'un fichier `.dsp` sur un clip sélectionné :
  ouvre le panneau overlay et **ajoute** le programme à la fin de la
  Transform Chain existante (même comportement que le drop sur le
  panneau FX de piste). La chaîne existante n'est pas effacée.

Préconditions :

- Exactement un clip sélectionné.
- Le transport est à l'arrêt (ou est arrêté automatiquement).
- Le fichier `.dsp` compile sans erreur.

### Comportement du Preview Mode

1. **Compilation.** Le fichier `.dsp` est compilé via
   `ensureFaustCompiler()` / `FaustMonoDspGenerator.compile()` (même
   pipeline que les effets de piste). En cas d'erreur de compilation, un
   message est affiché et le Preview Mode n'est pas activé.

2. **Routage audio.** Le preview **réutilise le mécanisme de Play
   Selection** (`playbackClipFilter`, `playSelectionLoopRange`) pour la
   boucle de lecture et le mouvement du curseur. La différence est
   l'insertion de la Transform Chain dans le chemin audio :
   ```
   clip audio (scheduled normalement par buildTrackPlaybackPlan)
       → Transform Chain (FxEffect nodes en série, non bypassés)
       → master output
   ```
   Les effets de piste sont bypassés (la Transform Chain les
   remplace), mais le scheduling, le curseur, le loop-back et les
   markers (début/fin de boucle) fonctionnent exactement comme en Play
   Selection. Le curseur avance dans le clip et reboucle au début quand
   il atteint la fin.

3. **UI de paramètres.** Les paramètres de chaque effet de la Transform
   Chain sont exposés via l'UI Orbit existante (même composant que pour
   les effets de piste). L'UI est intégrée dans le panneau overlay.

4. **Feedback visuel.** Même mécanisme que Play Selection :
   - Les autres clips sont grisés via `isDimmed`
     (`playbackClipFilter`).
   - Les markers `arrow_menu_open` / `arrow_menu_close` délimitent la
     zone de boucle.
   - Le clip cible a en plus une bordure distinctive (violet au lieu de
     cyan) pour signaler le mode transform.

5. **Panneau overlay semi-transparent.** Le panneau se superpose à la
   fenêtre du DAW avec un fond semi-transparent, permettant de voir la
   timeline et les pistes en dessous. Ce choix offre suffisamment
   d'espace pour afficher et manipuler la Transform Chain complète.

   Le panneau affiche :
   - **Header** : kicker « FAUST TRANSFORM » + status (« Compiling… »,
     « Previewing (looping) », « Bouncing… »).
   - **Transform Chain** : liste ordonnée des effets avec les mêmes
     contrôles que la FX Chain de piste :
     - Drag-to-reorder.
     - Bouton bypass par effet.
     - Bouton supprimer par effet.
     - Zone de drop pour ajouter un nouveau `.dsp`.
   - **Paramètres** : widget Orbit de l'effet sélectionné dans la
     chaîne (un effet à la fois, comme pour la FX Chain de piste).
   - **Footer** : boutons « Apply » (Enter) et « Cancel » (Esc).

### Sortie du Preview Mode

- **Apply (bouton ou raccourci)** : lance le Bounce (§3), puis sort du
  Preview Mode.
- **Cancel (Esc ou bouton)** : détruit le graphe audio de preview et
  restaure l'état normal. Aucune modification du clip.

## Concept 3 — Bounce

### Déclenchement

Le Bounce est déclenché par l'utilisateur via un bouton « Apply » ou un
raccourci clavier pendant le Preview Mode.

### Rendu offline (synchrone, dans l'adapter)

Le bounce utilise les **processeurs Faust bas niveau** (API WASM
`compute()`) au lieu d'un `OfflineAudioContext`. Ce choix permet une
tail detection en streaming — pas besoin de pré-allouer une durée
fixe.

1. **Instancier chaque effet de la Transform Chain** (non bypassé)
   via l'API bas niveau Faust WASM (`createOfflineProcessor` ou
   instanciation directe du DSP). Les paramètres sont copiés depuis
   les instances de preview (les valeurs que l'utilisateur a ajustées).

2. **Lire le PCM du clip** via `deps.sampleStore.read`.

3. **Padding.** Le clip est paddé à un nombre entier de blocs de
   128 samples (les samples manquants sont remplis de zéros).

4. **Phase clip** : traiter tous les blocs paddés à travers la chaîne
   de processeurs :
   ```
   for each block of padded clip:
     input ← next block (clip PCM + zero padding)
     for each processor in chain:
       processor.compute(blockSize, input, output)
       input ← output
     accumulate output block
   ```

5. **Pas de classement stateless / stateful a priori.** Les samples
   qui suivent immédiatement le clip ne disent pas si l'effet a une
   queue : un écho de 250 ms y est silencieux et ne sonne que plus
   tard. (Une version antérieure décidait sur un bloc de garde ; elle
   tronquait ces échos à la durée du clip.)

6. **Phase tail** (toujours) : continuer à traiter des
   blocs de **silence** en entrée. Les blocs silencieux en sortie sont
   mis en attente et ne sont ajoutés au résultat que si un bloc
   non-silencieux suit (pour éviter d'inclure du silence de fin).
   S'arrêter quand le signal reste sous le seuil pendant la durée de
   silence requise.

7. **Assembler et tronquer.** Assembler les blocs accumulés en
   `Float32Array[]`. Si rien n'a dépassé le seuil après la fin du clip
   (ni dans la zone paddée de son dernier bloc, ni en phase tail), le
   résultat a **exactement** la longueur du clip. Sinon, scanner en
   arrière pour supprimer les derniers samples à zéro (trim au sample
   près, pas aux frontières de blocs), **sans jamais descendre sous la
   longueur du clip**. Passer le résultat à
   `applySelectionOperation(new FaustTransformSelection(), { processedSamples, … })`.

### Tail Detection

La tail detection se fait **en streaming** pendant le rendu, pas en
post-traitement sur un buffer pré-alloué. Avantages :

- **Pas de pré-allocation** : pas besoin de deviner la durée de la
  tail. On rend jusqu'au silence effectif.
- **Pas de troncature** : contrairement à un `OfflineAudioContext` de
  durée fixe, on ne risque pas de couper une queue longue.
- **Efficace** : on s'arrête dès que le silence est détecté, pas
  besoin de rendre puis scanner un buffer surdimensionné. Coût : au
  plus la durée du critère d'arrêt (2 s) de calcul hors ligne en plus.
- **Pas de rallongement des effets stateless** : un gain ou un EQ
  produit un résultat de **même durée** que le clip original : sa
  sortie après le clip reste sous le seuil (la décroissance d'un
  filtre n'est pas une queue), et le résultat est coupé à la longueur
  du clip.

Paramètres de la tail detection :

- **Seuil** : -60 dB RMS **sous la crête de la sortie du clip** (convention RT60), plancher -120 dBFS. Relatif, pour qu'un même effet sur un même matériau garde la même queue quel que soit le niveau. (Il était absolu, -60 dBFS : un clip faible perdait ses répétitions, un clip à -60 dBFS perdait son écho.)
  *Limite connue, reportée (2026-11-10)* : pour un effet sans signal direct dont le retard dépasse la durée du clip (délai pur suivi d'une rétroaction, réverbération à grand prédélai), la sortie pendant le clip est (quasi) nulle et le seuil tombe au plancher : la queue est gardée jusqu'à -120 dBFS, plus longue que nécessaire et de nouveau dépendante du niveau (mesuré : 5,2 s à -6 dBFS, 3,45 s à -48 dBFS, pour environ 2,95 s utiles). Rien n'est perdu. Raffinement envisagé : une crête glissante (seuil = 1e-3 × max(crête du clip, crête vue jusqu'ici dans la queue), qui ne fait que monter).
- **Fenêtre d'analyse** : blocs de 128 samples (taille native Faust).
- **Critère d'arrêt** : le signal est sous le seuil pendant au moins
  2 s consécutives. Cette durée borne l'écart toléré entre deux
  répétitions d'un écho : des répétitions plus espacées sont coupées.
  (Elle valait 100 ms, ce qui coupait toute répétition espacée de
  plus de 100 ms.)
- **Garde-fou** : durée maximale de tail (ex: 30 secondes) pour éviter
  un rendu infini si l'effet produit un signal permanent (oscillateur,
  feedback loop non amorti).
- **Mise en attente** : les blocs silencieux de la phase tail sont
  bufférisés et ne sont commités que si un bloc non-silencieux suit.
  Cela évite d'inclure de larges plages de silence en fin de queue.
- **Trim au sample** : après assemblage, les samples à zéro en fin
  de résultat sont supprimés par un scan arrière. Cela garantit que
  le résultat se termine exactement au dernier sample non-nul, sans
  arrondi aux frontières de blocs. Un filtre FIR d'ordre N produit
  ainsi un résultat de `clipLength + N` samples — pas plus.

Pour un effet stateless (pas de queue), le résultat a **exactement**
la même durée que le clip original, au sample près. Pour un effet
stateful, la durée du résultat est celle du dernier sample non-nul
— au sample près également.

### Création du clip résultat

Le bounce suit le même pattern que `reverseClip` :

1. Publier le buffer tronqué comme nouvelle `AudioResource` via
   `resourceSink.create()`.
2. Retirer le clip original du projet via `removeClip()`.
3. Créer un nouveau `Clip` pointant vers la nouvelle resource, à la
   même position timeline que l'original.
4. Placer le nouveau clip via `placeClipInstance()`.

Le nom du clip résultat est `"<original> (<chainLabel>)"`, où
`chainLabel` est construit à partir des noms des effets non bypassés
de la chaîne, joints par `+` (ex: `"voice (reverb+delay)"`).

L'opération est **atomique** du point de vue undo-redo : un seul
`applySessionDocumentTransition`.

### Durée du résultat

Le clip résultat peut être **plus long** que l'original (queue de
reverb/delay). Il occupe donc plus de place sur la timeline. C'est
le comportement attendu — la queue fait partie du résultat.

Si le clip résultat chevauche un clip voisin sur la même piste, aucun
traitement spécial : le DAW autorise déjà les chevauchements visuels
(le rendu empile les clips superposés).

## Concept 4 — Architecture et dépendances

### Primitive bas niveau

```ts
// src/domain/clip-operations.ts

/**
 * Remplace l'audio d'un clip par des samples pré-calculés. La durée du
 * résultat peut différer de l'original (ex: queue de réverbération).
 * Même pattern structurel que reverseClip : publish resource → remove
 * old clip → place new clip.
 */
export function replaceClipAudio(
  project: Project,
  clip: Clip,
  processedSamples: Float32Array[],
  deps: ClipSampleDeps,
  clipIdFactory: () => ClipId,
  resultName: string,
): ClipPairResult;
```

La primitive domaine reçoit des samples **déjà traités** — elle ne
connaît ni Faust ni Web Audio ni le mécanisme de rendu. Elle ne
s'occupe que de la mécanique projet (publish resource, remove/place
clip). Tout le travail de rendu (instanciation des processeurs Faust
WASM, traitement bloc par bloc, tail detection) est fait **avant**
par l'adapter UI, qui passe le résultat final à cette primitive.

Ce découpage préserve le contrat synchrone de `SelectionOperation.apply()`
— aucune opération existante n'est impactée.

### SelectionOperation

```ts
// src/domain/selection/operations/faust-transform-selection.ts

export interface FaustTransformParams {
  readonly deps: ClipSampleDeps;
  readonly createClipId: () => ClipId;
  /** Samples déjà traités par l'adapter (rendu offline + tail detection). */
  readonly processedSamples: Float32Array[];
  /** Label descriptif dérivé de la chaîne, ex: "reverb+delay". */
  readonly chainLabel: string;
}

export class FaustTransformSelection
  extends SelectionOperation<FaustTransformParams> {

  label(): string;       // "Transform clip (<chainLabel>)"
  canApply(): boolean;   // selection.size === 1
  apply(): SelectionOperationResult;  // synchrone, comme toutes les opérations
}
```

### Adapter UI (interactions.ts)

L'adapter UI orchestre le workflow complet. C'est le seul endroit qui
connaît Faust et Web Audio — le domaine ne manipule que des samples
et des structures projet.

1. **Ouverture du panneau** : affiche l'overlay avec la Transform
   Chain existante. L'utilisateur peut ajouter/supprimer/réordonner
   des effets et ajuster leurs paramètres.
2. **Import .dsp** : lecture du fichier, compilation via faustwasm,
   ajout comme `FxEffect` à la Transform Chain.
3. **Preview Mode** :
   - Construit le graphe audio de preview (BufferSource → Transform
     Chain → master).
   - Affiche l'UI de paramètres Orbit dans le panneau overlay.
   - Gère la boucle de lecture via Play Selection mechanism.
   - Stocke l'état de preview dans `demoState`.
4. **Bounce** (synchrone, dans l'adapter) :
   - Lit le PCM du clip via `deps.sampleStore.read`.
   - Instancie les processeurs Faust bas niveau (API WASM `compute()`),
     copie les paramètres depuis les instances de preview.
   - Traite bloc par bloc : phase clip puis phase tail (silence en
     entrée, arrêt quand RMS < seuil pendant 2 s ; voir « Tail Detection »).
   - Passe les samples résultants (`Float32Array[]`) à
     `applySelectionOperation(new FaustTransformSelection(), params)`.
5. **Cancel** :
   - Détruit le graphe audio, ferme le panneau overlay.
   - Restaure l'état normal (effets de piste, transport).
   - La Transform Chain est conservée pour la prochaine utilisation.

### DAG de dépendances

```
src/domain/
├── clip-operations.ts           # replaceClipAudio (nouveau)
└── selection/
    └── operations/
        └── faust-transform-selection.ts  (nouveau)

demo/
├── interactions.ts              # adapter : preview, bounce, cancel
└── fx-chain/
    ├── fx-chain-runtime.ts      # ensureFaustCompiler (existant)
    └── fx-chain-audio.ts        # wireTrackEffectChain (existant, bypassé)
```

- `replaceClipAudio` ne connaît ni Faust ni Web Audio — purement
  domaine, synchrone.
- `FaustTransformSelection` ne connaît ni Faust ni Web Audio — elle
  reçoit des samples pré-calculés. `apply()` est synchrone.
- L'adapter UI (`interactions.ts`) est le seul endroit qui connaît
  Faust et Web Audio. Le domaine ne reçoit que des samples et des
  structures projet.

## Concept 5 — État dans demoState

### Transform Chain (persistant)

```ts
// demo/state.ts  (ou dans Project si on veut le sérialiser dans le domaine)

/** Chaîne d'effets Faust dédiée aux transformations de clips.
 *  Même type que track.effects — réutilise FxEffect[].
 *  Persistée dans la session (session-archive / session-document). */
transformChain: readonly FxEffect[];
```

Ce champ existe en permanence (initialisé à `[]`). Il est modifié
quand l'utilisateur ajoute, supprime, réordonne ou ajuste un effet
dans le panneau Transform. Il est sérialisé/restauré avec la session,
de sorte que l'utilisateur retrouve sa Transform Chain en rouvrant le
projet.

### Preview Mode (éphémère)

```ts
/** État du Faust Transform preview, ou null quand inactif. */
faustTransformPreview: {
  /** Le clip en cours de transformation. */
  clipId: ClipId;
  /** Les nœuds AudioWorklet de la Transform Chain (pour capturer les params). */
  transformNodes: AudioWorkletNode[];
  /** Index de l'effet sélectionné dans le panneau (pour afficher ses params). */
  selectedEffectIndex: number;
} | null;
```

Ce champ est :

- `null` quand le Faust Transform est inactif.
- Non-null pendant le Preview Mode.
- Remis à `null` après bounce ou cancel.

## Concept 6 — Décisions et open questions

### Pourquoi pas un `OfflineAudioContext` pour le bounce ?

L'`OfflineAudioContext` exige une durée fixe à la création — il faut
deviner la longueur de la tail avant le rendu. Trop court : troncature.
Trop long : gaspillage mémoire/CPU. Pas de rendu incrémental possible.

Le bounce utilise à la place les **processeurs Faust WASM bas niveau**
(API `compute(blockSize, inputs, outputs)`) qui permettent un traitement
bloc par bloc avec tail detection en streaming. Ce choix :

- Élimine le problème de pré-allocation.
- Donne une tail detection exacte (pas de scan post-rendu).
- Évite la question de compatibilité `AudioWorkletNode` +
  `OfflineAudioContext`.
- Reste synchrone, cohérent avec le contrat du domaine.

L'`AudioWorkletNode` reste utilisé pour le **preview** (temps réel via
Web Audio), mais pas pour le bounce.

### Mono ou stéréo ?

Chaque effet de la Transform Chain peut avoir un nombre de canaux
d'entrée/sortie différent. Règle simple :

- **Entrée** : si le clip est mono et le premier effet attend du stéréo,
  dupliquer le canal mono sur les deux entrées. Si le clip est stéréo et
  le premier effet est mono, mixer les deux canaux en mono (average).
- **Entre effets** : même adaptation automatique entre la sortie d'un
  effet et l'entrée du suivant.
- **Sortie** : le résultat a le nombre de canaux de la sortie du
  dernier effet de la chaîne. Le DAW gère déjà le mixage
  mono/stéréo au niveau des pistes.

### Enchaînement de programmes

La Transform Chain supporte **plusieurs effets en série**. Le preview
et le bounce passent le clip à travers tous les effets non bypassés,
dans l'ordre de la chaîne. L'utilisateur peut bypasser individuellement
chaque effet pour isoler l'impact d'un programme particulier.

Le bounce produit un seul clip résultat — le résultat de toute la
chaîne. Si l'utilisateur veut appliquer les effets un par un, il
bypasse tous sauf celui qu'il veut appliquer, bounce, puis passe au
suivant.

### Persistance de la Transform Chain

La Transform Chain est persistée dans la session (via
`session-document.ts` / `session-archive.ts`), au même titre que les
FX Chains de piste. Les `FxResource` sont partagées dans le catalogue
global `project.fxResources`. Les fichiers `.dsp` sont archivés dans
le même répertoire `fx/` de l'archive de session.

### Interaction avec le transport

Le Preview Mode et le transport normal sont **mutuellement exclusifs**.
Entrer en Preview Mode arrête le transport. Sortir du Preview Mode
(bounce ou cancel) ne relance pas le transport — l'utilisateur le
relance manuellement.

## Litmus test (FUNCTIONALCOUPLING.md)

> Un **Faust Transform** est un workflow qui permet de prévisualiser un
> traitement Faust sur un clip en boucle, d'ajuster ses paramètres en
> temps réel, puis de bouncer le résultat dans le clip.

> La **Transform Chain** est une FX Chain dédiée aux transformations
> destructives de clips — même type, mêmes opérations CRUD, contexte
> audio différent (preview/bounce au lieu de temps réel permanent).

> Le **Preview Mode** est l'état du DAW pendant lequel un clip est joué
> en boucle à travers la Transform Chain, avec les effets de piste
> bypassés.

> Le **Bounce** est le rendu offline d'un clip à travers la Transform
> Chain, avec tail detection automatique.

Les quatre passent le test de concision → les groupements sont sains.

## Plan d'implémentation (non normatif)

1. **Vérifier la faisabilité technique** : identifier l'API Faust WASM
   bas niveau pour instancier un processeur offline (ex :
   `createOfflineProcessor`, ou instanciation directe du DSP WASM).
   Vérifier qu'on peut appeler `compute(blockSize, inputs, outputs)`
   de manière synchrone, bloc par bloc.

2. **Transform Chain dans le modèle** :
   - Ajouter `transformChain: readonly FxEffect[]` à `demoState`
     (ou `Project`).
   - Étendre `session-document.ts` / `session-archive.ts` pour
     sérialiser/restaurer la Transform Chain.
   - Réutiliser les opérations existantes de `fx-chain.ts`
     (`addEffect`, `removeEffect`, `moveEffect`, etc.) en les
     généralisant si nécessaire (elles opèrent actuellement sur
     `track.effects`).

3. **Primitive `replaceClipAudio`** dans `clip-operations.ts`.
   Testable unitairement avec des samples pré-calculés (identité,
   silence, etc.). Synchrone, même pattern que `reverseClip`.

4. **`FaustTransformSelection`** dans `operations/`. Suit le même
   pattern que `ReverseSelection`. Testable sans Faust (reçoit des
   `processedSamples` pré-calculés).

5. **Panneau overlay** :
   - HTML/CSS : panneau plein écran, fond semi-transparent
     (`rgba(0,0,0,0.6)`), `z-index` au-dessus de la timeline.
   - Transform Chain UI : liste d'effets avec drag-to-reorder,
     bypass, delete, drop zone pour `.dsp`.
   - Paramètres Orbit pour l'effet sélectionné.
   - Boutons Apply / Cancel.

6. **Preview Mode dans l'adapter UI** :
   - Nouveaux champs `transformChain` et `faustTransformPreview`
     dans `demoState`.
   - Graphe audio : BufferSource → Transform Chain (nodes en
     série) → master.
   - Boucle via Play Selection mechanism.
   - Feedback visuel (dimming, bordure violet, markers).

7. **Bounce** (synchrone, dans l'adapter) :
   - Capture des paramètres depuis les preview nodes.
   - Instanciation des processeurs Faust WASM bas niveau.
   - Rendu bloc par bloc : phase clip + phase tail (silence en entrée,
     arrêt quand RMS < -60 dB sous la crête pendant 2 s, garde-fou 30 s).
   - Appel `applySelectionOperation` avec `processedSamples`.

8. **Entrée dans le workflow** :
   - Bouton context menu « Faust Transform… »
   - Drag-and-drop d'un `.dsp` sur un clip sélectionné.

9. **Tests** :
   - Test unitaire de `replaceClipAudio` avec samples pré-calculés.
   - Test unitaire de la tail detection (buffer avec silence final).
   - Test d'intégration du workflow complet (si faisable en headless).
