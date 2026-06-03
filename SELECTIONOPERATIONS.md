# Spécification des Selection Operations

## Problème

Le DAW propose aujourd'hui plusieurs actions qui transforment un ensemble de
clips sélectionnés : supprimer les clips sélectionnés, fusionner les clips
contigus, appliquer un crossfade de quelques millisecondes aux jonctions,
découper en deux les clips qui traversent le marker `cut`, etc. Chacune de
ces actions est actuellement implémentée de manière **ad hoc** dans
[demo/interactions.ts](demo/interactions.ts) :

- `removeSelectedClipFromUi` ([demo/interactions.ts:5981](demo/interactions.ts#L5981))
  reconstruit une liste ordonnée à partir de `demoState.selectedClipIds`,
  appelle `clearSelectedClips()`, puis `reduce` de `removeClip` sur le projet,
  le tout emballé dans `applySessionDocumentTransition`.
- Les autres opérations (merge, crossfade, split sur cut, …) n'existent
  pas encore ou seraient ajoutées en copiant-collant le même canevas.

Conséquences :

1. **Le concept « transformation de sélection » est invisible.** Il n'y a
   pas de type, pas de signature commune, pas d'endroit unique où on
   découvre la liste des opérations disponibles.
2. **Chaque nouvelle opération dupliquerait** la gestion de l'ordre stable,
   le calcul du libellé d'action, la mise à jour de la sélection post-
   transformation, la propagation vers le `SessionDocument` / undo-redo.
3. **L'état de sélection et les opérations sont dispersés**
   (`demoState.selectedClipIds`, `setSelectedClipIds`,
   `getOrderedSelectedClipIds`, `clearSelectedClips`,
   `toggleSelectedClipId`, `removeSelectedClipFromUi`, …) dans
   `interactions.ts` — aucun concept `Selection` n'est nommé.

Nous voulons introduire un concept unifié de **Selection Operation** qui
systématise ces transformations et permette d'en ajouter de nouvelles
sans dupliquer de code.

## But

Fournir une **abstraction commune** pour toutes les fonctions qui
transforment le contenu d'une sélection de clips. L'abstraction doit :

- définir précisément ce qu'est une `Selection` ;
- exposer une signature unique `(project, selection, params) → (project', selection')` ;
- vivre dans le domaine (pur, immutable), en dehors de `demo/interactions.ts` ;
- rendre la liste des opérations **découvrable** (un fichier, une classe
  de base, N sous-classes) ;
- respecter [FUNCTIONALCOUPLING.md](FUNCTIONALCOUPLING.md) : une seule
  raison d'exister par concept, dépendances en DAG, pas de couplage
  latéral entre opérations.

## Vocabulaire

- **Selection** : ensemble ordonné, stable et déterministe de clip ids
  actuellement sélectionnés dans le projet. Ne contient **que** des
  identifiants — pas de position, pas de couleur, pas d'état d'UI.
- **SelectionOperation** : transformation pure qui, appliquée à
  `(project, selection, params)`, produit un nouveau
  `(project, selection)`. Une opération est **atomique** du point de vue
  undo-redo : une application = une entrée dans
  `sessionHistoryPast`.
- **Opération courante** : les quatre exemples canoniques de ce document
  sont `DeleteSelection`, `MergeContiguousInSelection`,
  `CrossfadeContiguousInSelection`, `SplitSelectionAtCut`. La liste est
  **ouverte** — la spec doit rester vraie pour toute opération future
  (normaliser le gain des clips sélectionnés, quantiser leur start, …).

## Concept 1 — `Selection` (classe)

### Pourquoi une classe

Aujourd'hui la sélection est éclatée en deux champs dans
[demo/state.ts:324-325](demo/state.ts#L324-L325) :

```ts
selectedClipId: string | null;        // primary (pour context-menu, drag anchor)
selectedClipIds: Set<string>;         // multi-selection
```

Et les opérations associées sont **dispersées** à travers
`interactions.ts` :

- construction ordonnée : `setSelectedClipIds`
  ([demo/interactions.ts:3821](demo/interactions.ts#L3821)),
  `getOrderedSelectedClipIds`
  ([demo/interactions.ts:3866](demo/interactions.ts#L3866)) ;
- mutation : `clearSelectedClips`
  ([demo/interactions.ts:3839](demo/interactions.ts#L3839)),
  `toggleSelectedClipId`
  ([demo/interactions.ts:3853](demo/interactions.ts#L3853)) ;
- **bounding box temporelle et bounding box de pistes** : calculées à
  la main, inlinées, au démarrage d'un drag
  ([demo/interactions.ts:4151-4167](demo/interactions.ts#L4151-L4167)) —
  `sourceGroupStart`, `sourceGroupEnd`, `sourceGroupMinTrackIndex`,
  `sourceGroupMaxTrackIndex`.

Toutes ces opérations manipulent exactement les mêmes données (un
ensemble ordonné de `ClipId` dans le contexte d'un `Project`) et sont
utilisées ensemble. Elles forment un concept qui doit être **nommé et
rassemblé** : la classe `Selection`.

### Lien Selection ↔ Project

Une `Selection` est **liée à un snapshot `Project` précis** : elle
connaît le projet dans lequel elle vit et peut donc répondre à des
questions comme « quel est l'intervalle temporel [min, max] de mes
clips ? » sans qu'on lui repasse le projet à chaque appel.

Conséquence : quand une `SelectionOperation` transforme `project`, elle
retourne un couple `{ project, selection }` où la `selection` est déjà
attachée au **nouveau** projet. Aucun rebase manuel.

Convention pour éviter la staleness : `demoState` **ne stocke pas** de
`Selection`. Il stocke seulement un `selectedClipIds: ReadonlySet<ClipId>`
(et accessoirement un primary id pour l'UI). L'adapter UI (§5)
construit une `Selection` fraîche à chaque opération ou à chaque frame
qui en a besoin. Une `Selection` n'existe donc jamais assez longtemps
pour devenir obsolète.

### Interface de la classe

```ts
// src/domain/selection/selection.ts
export class Selection {
  /**
   * Construction directe. L'invariant d'ordre visuel et d'absence de
   * doublons est garanti par `Selection.of` / `Selection.empty` ;
   * n'utiliser le constructeur qu'en interne, après normalisation.
   */
  private constructor(
    private readonly project: Project,
    public readonly clipIds: readonly ClipId[],
  ) {}

  // ─── Construction ────────────────────────────────────────────────

  /** Sélection vide attachée à `project`. */
  static empty(project: Project): Selection;

  /**
   * Construit une Selection à partir d'un ensemble quelconque
   * d'identifiants : filtre les ids absents du projet, déduplique,
   * et réordonne dans l'ordre visuel (tracks puis clips).
   */
  static of(project: Project, clipIds: Iterable<ClipId>): Selection;

  // ─── Mutation (immutable, retournent une nouvelle Selection) ────

  /** Ajoute un clip. No-op si déjà présent. */
  add(clipId: ClipId): Selection;

  /** Retire un clip. No-op si absent. */
  remove(clipId: ClipId): Selection;

  /** Ajoute si absent, retire si présent. */
  toggle(clipId: ClipId): Selection;

  /** Sélection vide attachée au même projet. */
  clear(): Selection;

  /** Remplace entièrement le contenu. Passe par la normalisation de `of`. */
  withClipIds(clipIds: Iterable<ClipId>): Selection;

  // ─── Introspection ──────────────────────────────────────────────

  contains(clipId: ClipId): boolean;
  get size(): number;
  get isEmpty(): boolean;
  /** Équivalent à `clipIds[0] ?? null`. Utilisé comme anchor de drag. */
  get primaryClipId(): ClipId | null;
  /** Résout chaque id en son `Clip` dans le projet courant. */
  clips(): readonly Clip[];
  /** Itération directe sur les ids : `for (const id of selection)`. */
  [Symbol.iterator](): IterableIterator<ClipId>;

  // ─── Bounding boxes ─────────────────────────────────────────────

  /**
   * Intervalle temporel couvert par la sélection :
   *   startCoord = min des clip.start
   *   endCoord   = max des clipEnd(project, clip)
   * Renvoie `null` si la sélection est vide.
   * Remplace les calculs inlinés de
   * [demo/interactions.ts:4151-4158](demo/interactions.ts#L4151-L4158).
   */
  timeRange(): { startCoord: TimeCoord; endCoord: TimeCoord } | null;

  /**
   * Span de pistes touchées :
   *   minIndex = index de track visuellement le plus haut
   *   maxIndex = index de track visuellement le plus bas
   * Renvoie `null` si la sélection est vide.
   * Remplace les calculs inlinés de
   * [demo/interactions.ts:4160-4167](demo/interactions.ts#L4160-L4167).
   */
  trackRange(): { minIndex: number; maxIndex: number } | null;

  // ─── Rebase ─────────────────────────────────────────────────────

  /**
   * Projette la sélection sur un nouveau snapshot de projet :
   * garde les clip ids encore présents, dans l'ordre visuel du
   * nouveau projet. Utilisé uniquement par les `SelectionOperation`
   * pour construire leur résultat — l'adapter UI n'en a pas besoin
   * puisqu'il reconstruit toujours from ids.
   */
  rebase(project: Project): Selection;
}
```

### Invariants

1. **Ordre stable.** `clipIds` suit l'ordre visuel du projet lié :
   tracks dans l'ordre du timeline, clips dans l'ordre de chaque track.
   Deux constructions successives avec les mêmes ids et le même projet
   donnent la même liste.
2. **Cohérence.** Tout `ClipId` dans `clipIds` existe dans `this.project`.
   `Selection.of` filtre silencieusement les ids orphelins.
3. **Sans doublon.** Chaque `ClipId` apparaît au plus une fois.
4. **Immutabilité.** Toutes les méthodes de mutation retournent une
   nouvelle instance. La donnée interne n'est jamais modifiée en place.
5. **Binding au projet.** Une instance est attachée à un snapshot
   `Project` précis ; utiliser ses query methods avec un autre projet
   n'a pas de sens et n'est pas supporté. Pour suivre une transformation
   de projet, passer par `rebase` ou reconstruire via `Selection.of`.

### Mémoïsation des bounding boxes

Puisqu'une instance est liée à un projet immutable et à une liste de
clipIds immutable, `timeRange()` et `trackRange()` peuvent cacher leur
résultat au premier appel. C'est un détail d'implémentation — pas
exposé, pas obligatoire — mais autorisé par le design.

### Ce qui **reste hors** de la classe

- **Construction depuis un rectangle de marquee.** La fonction actuelle
  `collectMarqueeSelectedClipIds`
  ([demo/interactions.ts:3915](demo/interactions.ts#L3915)) mélange de
  la géométrie de viewport (`gridWidthPx`, `laneHeightPx`,
  `clipTopInsetPx`, `pixelsPerCoord`, …) avec de la logique de
  sélection. La géométrie de viewport est une dépendance **UI** que
  `src/domain/` n'a pas le droit de connaître. La construction depuis
  un rectangle reste donc dans `demo/interactions.ts` ; elle collecte
  des ids puis appelle `Selection.of(project, ids)`.
- **Stockage persistant.** Une `Selection` ne vit pas dans `demoState`
  ni dans le `SessionDocument` ; elle n'est jamais sérialisée. Seuls
  les `clipIds` bruts sont persistés/observés par l'UI.
- **Primary id UI.** Le champ `demoState.selectedClipId` (utilisé pour
  l'ancrage du drag, du context-menu, etc.) reste de l'état UI ;
  `Selection.primaryClipId` est une commodité dérivée qui retourne
  simplement `clipIds[0]`.

## Concept 2 — `SelectionOperation`

### Signature unique

Puisque `Selection` porte son `Project`, les trois méthodes abstraites
n'ont besoin que de `(selection, params)` :

```ts
// src/domain/selection/selection-operation.ts
export interface SelectionOperationResult {
  readonly project: Project;      // le nouveau snapshot de projet
  readonly selection: Selection;  // déjà attachée à ce nouveau projet
}

export abstract class SelectionOperation<Params = void> {
  /**
   * Libellé humain de l'opération, utilisé pour l'entrée undo-redo et
   * le log de rendu. Peut dépendre de la sélection et des paramètres
   * pour afficher "Remove 3 clips" vs "Remove clip \"kick-01\"".
   */
  abstract label(selection: Selection, params: Params): string;

  /**
   * Vrai si l'opération peut s'appliquer à (selection, params).
   * Utilisé pour griser les entrées de menu et court-circuiter
   * les raccourcis clavier.
   *   - DeleteSelection : selection non vide
   *   - MergeContiguous : au moins deux clips contigus dans la même track
   *   - SplitAtCut      : cutCoord intersecte strictement au moins un clip
   */
  abstract canApply(selection: Selection, params: Params): boolean;

  /**
   * Transformation pure. Produit un nouveau couple (project, selection)
   * cohérent :
   *   - les clips qui n'existent plus sont absents de la nouvelle sélection
   *   - les clips nouvellement créés (merge, split) sont ajoutés si
   *     l'opération le précise dans son contrat
   *   - l'ordre visuel de la nouvelle sélection reste stable
   *   - la nouvelle selection est construite via `Selection.of(newProject, ids)`
   *     ou via `selection.rebase(newProject)`, jamais à la main.
   *
   * Contrat : si `canApply` renvoie false, `apply` doit retourner
   * `{ project: <projet courant>, selection }` inchangé (identité). Ne
   * doit jamais lancer d'exception sur une sélection valide — les
   * erreurs de validation se reflètent dans `canApply`.
   */
  abstract apply(
    selection: Selection,
    params: Params,
  ): SelectionOperationResult;
}
```

Note : le `Project` courant n'apparaît pas dans la signature publique
parce que `selection` le porte. Les sous-classes le récupèrent en
interne via la méthode privée / utilitaire de la classe de base, par
exemple :

```ts
protected projectOf(selection: Selection): Project {
  return selection.project;   // accesseur protégé sur Selection
}
```

(Ou `Selection` expose un getter `project: Project` lisible par les
opérations. Détail d'implémentation à trancher — la spec n'impose pas.)

### Pourquoi une classe abstraite plutôt qu'un type fonction

Le user a explicitement demandé « une classe abstraite dont dériveraient
toutes les opérations ». Les avantages par rapport à une union
discriminée ou un simple `type SelectionOperation = (…) => …` :

1. **Découvrabilité.** Chaque sous-classe est un fichier nommé qui
   documente un cas ; la classe de base centralise la signature.
2. **Co-localisation `label` / `canApply` / `apply`.** Les trois
   fonctions partagent les mêmes paramètres et les mêmes invariants :
   les grouper dans la même unité évite qu'un refactoring fasse diverger
   `canApply` de `apply` (critère « internal co-usage » de
   FUNCTIONALCOUPLING.md).
3. **Paramétrage générique.** Le type `Params` permet à chaque opération
   d'exiger ses propres paramètres (ex : `CrossfadeParams = { durationSamples: number }`),
   tout en gardant `apply` typé.

### Invariants transversaux de `apply`

Toute sous-classe **doit** respecter :

1. **Pureté.** Aucune mutation du projet ni de la sélection ; retour de
   nouvelles structures.
2. **Cohérence du résultat.** `result.selection` est attachée à
   `result.project`, et tous ses clipIds existent dans ce projet.
3. **Construction normalisée.** `result.selection` est construite via
   `Selection.of(newProject, ids)` ou `selection.rebase(newProject)`,
   jamais par un accès direct au constructeur privé.
4. **Pas de dépendance à `demoState`.** Les opérations vivent dans `src/`
   et ne connaissent ni `DemoState`, ni `Elements`, ni `SessionDocument`.
5. **Pas de dépendance croisée entre opérations.** Une opération ne peut
   pas appeler une autre opération par son nom — si elles partagent du
   code (ex : « clips contigus d'une track »), ce code est une fonction
   utilitaire privée au fichier `selection-operation.ts` ou à un fichier
   helper dédié.

## Concept 3 — Opérations primitives sur les clips

Avant de définir les `SelectionOperation`, on extrait deux opérations
bas niveau qui travaillent sur des **paires de clips** indépendamment
de toute notion de sélection. Ces primitives encapsulent la logique
audio (lecture PCM, création de resource, mixage linéaire) et sont
réutilisées par plusieurs `SelectionOperation` (§4.2 Merge, §4.3
Crossfade). Les extraire ici évite la duplication et garde les
`SelectionOperation` concentrées sur la **stratégie** (quelles paires
traiter, dans quel ordre) plutôt que sur la **mécanique** (comment
fabriquer effectivement le clip résultat).

### Signatures

```ts
// src/domain/clip-operations.ts

export interface ClipSampleDeps {
  /**
   * Lit `length` échantillons PCM à partir de `startSample` dans la
   * resource désignée. Retourne un `Float32Array` par canal (format
   * natif d'`AudioBuffer.getChannelData`, non-interleaved). La longueur
   * du tableau extérieur donne le nombre de canaux.
   */
  readonly sampleStore: {
    read(
      resourceId: ResourceId,
      startSample: number,
      length: number,
    ): Float32Array[];
  };

  /**
   * Publie une nouvelle resource à partir d'un buffer PCM :
   *   1. alloue un `ResourceId` unique,
   *   2. enregistre `samples` dans le store PCM externe
   *      (`demoState.resourceAudioBuffers`),
   *   3. importe la resource dans `project` via `importAudioResource`,
   *   4. retourne le projet mis à jour et le record `AudioResource`.
   *
   * `samples` suit la même convention que `sampleStore.read` : un
   * `Float32Array` par canal. Le nombre de canaux est donc
   * `samples.length` — il n'y a pas de paramètre `channels` séparé.
   */
  readonly resourceSink: {
    create(
      project: Project,
      samples: Float32Array[],
      sampleRate: number,
      name: string,
    ): { project: Project; resource: AudioResource };
  };
}

/**
 * Concatène deux clips contigus d'une même track en un clip unique
 * couvrant `[a.start, clipEnd(b))`. Deux chemins selon la structure :
 *
 *   - Fast path (re-slice) : si `a.resource === b.resource` et
 *     `b.sourceStartSample === a.sourceStartSample + a.sourceLengthSamples`,
 *     le clip résultat est une simple re-tranche de la même resource.
 *     Aucune donnée audio n'est créée. C'est le cas exceptionnel où
 *     `concatenateClips` est l'inverse exact d'un split précédent.
 *
 *   - General path : dans tous les autres cas (resources différentes,
 *     ou tranches non contiguës dans la même resource), lit les
 *     échantillons PCM de `a` puis de `b`, les concatène dans un
 *     nouveau buffer, enregistre une **nouvelle `AudioResource`** via
 *     `resourceSink`, et le clip résultat pointe vers cette resource
 *     avec `sourceStartSample = 0` et
 *     `sourceLengthSamples = |A| + |B|`. Pas de bounce audio : simple
 *     copie d'échantillons PCM, aucun passage par le graphe audio.
 *
 * Retourne le nouveau projet (clips `a` et `b` retirés, clip fusionné
 * placé sur la même track à la position `a.start`, resource
 * potentiellement ajoutée) ainsi que le clip créé.
 */
export function concatenateClips(
  project: Project,
  a: Clip,
  b: Clip,
  deps: ClipSampleDeps,
): { project: Project; clip: Clip };

/**
 * Fusionne deux clips contigus d'une même track en un clip unique
 * couvrant `[a.start, clipEnd(b) - D)` où `D = durationSamples`, avec
 * un crossfade **linéaire** sur la région de chevauchement (façon
 * montage bande magnétique, coupe en biais).
 *
 * Contrairement à `concatenateClips`, **pas de fast path** : un
 * nouveau buffer PCM est toujours créé, même si `a` et `b` partagent
 * la même resource. Les échantillons sont produits comme suit, avec
 * `N_a = a.sourceLengthSamples`, `N_b = b.sourceLengthSamples` :
 *
 *   - i ∈ [0, N_a - D)         : out[i] = a[i]
 *   - i ∈ [N_a - D, N_a)       : out[i] = (1 - t) * a[i]
 *                                        + t * b[i - (N_a - D)]
 *                                 avec t = (i - (N_a - D)) / D
 *   - i ∈ [N_a, N_a + N_b - D) : out[i] = b[i - (N_a - D)]
 *
 * La longueur totale du clip résultant est donc `N_a + N_b - D`
 * samples. Le clip retourné pointe vers la nouvelle resource avec
 * `sourceStartSample = 0` et `sourceLengthSamples = N_a + N_b - D`.
 *
 * Précondition : `N_a >= D` et `N_b >= D`. L'appelant
 * (`CrossfadeContiguousInSelection.canApply`) est responsable de la
 * vérifier.
 */
export function crossfadeClips(
  project: Project,
  a: Clip,
  b: Clip,
  durationSamples: number,
  deps: ClipSampleDeps,
): { project: Project; clip: Clip };
```

### Invariants des primitives

1. **Pureté.** `project`, `a`, `b` ne sont pas mutés. Retour de
   nouvelles structures.
2. **Injection du stockage PCM.** Aucun accès global à `demoState` ;
   l'adapter UI construit `ClipSampleDeps` à partir de
   `demoState.resourceAudioBuffers`
   ([demo/state.ts:284](demo/state.ts#L284)) et le passe explicitement.
3. **Pas de dépendance à `Selection`.** Ces primitives vivent à côté
   de `Clip`, en amont du concept `Selection` dans le DAG — elles
   peuvent être réutilisées par d'autres consommateurs (automatisation
   de split, tests unitaires, …) sans traîner la notion de sélection.
4. **Contiguïté supposée.** Les deux fonctions **supposent** que `a`
   et `b` sont contigus sur la même track (c'est-à-dire
   `clipEnd(project, a) === b.start` et `trackOf(a) === trackOf(b)`).
   Elles ne vérifient pas — c'est l'appelant qui filtre, via
   `contiguous-runs.ts` (§5).
5. **Nommage de la nouvelle resource.** Quand le general path crée une
   resource, son nom est fabriqué à partir des noms source
   (`"<a.name>+<b.name>"` ou un ordinal). Détail d'implémentation non
   fixé par la spec.

## Concept 4 — Les quatre opérations de départ

Chaque opération est un fichier dédié sous
`src/domain/selection/operations/`. On donne ici le contrat fonctionnel ;
les invariants §2 s'appliquent à toutes.

### 4.1 `DeleteSelection`

```ts
class DeleteSelection extends SelectionOperation<void>
```

- **label** : `"Remove clip \"<id>\""` si `selection.size === 1`,
  sinon `"Remove <N> clips"`.
- **canApply** : `!selection.isEmpty`.
- **apply** : retire du projet chaque clip de `selection.clipIds` via
  `removeClip` ([src/daw.ts:357](src/daw.ts#L357)). La sélection
  résultante est `Selection.empty(newProject)`.
- **Remplace** : `removeSelectedClipFromUi`
  ([demo/interactions.ts:5981](demo/interactions.ts#L5981)).

### 4.2 `MergeContiguousInSelection`

```ts
class MergeContiguousInSelection extends SelectionOperation<MergeParams>

interface MergeParams extends ClipSampleDeps {}
```

- **Définition de « contigus »** : deux clips `a` et `b` d'une même
  track sont contigus si `b.start === a.start + length(a)`
  (c'est-à-dire `clipEnd(project, a) === b.start`). La fusion est
  transitive : toute run maximale contiguë dans la sélection est
  fusionnée en un clip unique qui couvre `[firstStart, lastClipEnd)`.
- **label** : `"Merge <N> contiguous groups"` où `N` est le nombre de
  runs contigus fusionnés (≥ 1). Si un seul run : `"Merge clips"`.
- **canApply** : il existe au moins une paire de clips contigus dans la
  sélection appartenant à la même track. Aucune contrainte sur les
  `AudioResource` référencées — `concatenateClips` (§3) sait gérer les
  deux cas (fast path re-slice et general path PCM).
- **apply** : détecte les runs contigus via `findContiguousRuns` (§5,
  helper privé `contiguous-runs.ts`). Pour chaque run de longueur ≥ 2,
  appelle `concatenateClips` de manière repliée gauche-à-droite :

  ```ts
  let merged = run[0];
  let proj = project;
  for (let i = 1; i < run.length; i++) {
    const r = concatenateClips(proj, merged, run[i], params);
    proj = r.project;
    merged = r.clip;
  }
  ```

  La sélection résultante contient les **nouveaux** clip ids créés (un
  par run fusionné), construite via `Selection.of(newProject, newIds)`.

- **Pas de logique PCM ici.** Toute la mécanique de lecture
  d'échantillons, de création de resource et de fast-path vit dans
  `concatenateClips` (§3). `MergeContiguousInSelection` se contente de
  **stratégiquement** décider quelles paires fusionner. C'est une
  application directe du principe « group by concept » : la concept
  audio (concaténer deux clips) est isolée dans `clip-operations.ts` ;
  la concept sélection (choisir les paires) vit ici.

### 4.3 `CrossfadeContiguousInSelection`

```ts
class CrossfadeContiguousInSelection extends SelectionOperation<CrossfadeParams>

interface CrossfadeParams extends ClipSampleDeps {
  /** Durée du crossfade en samples (ex : 35ms × sampleRate). */
  readonly durationSamples: number;
}
```

- **Objectif** : fusionner chaque paire de clips contigus de la
  sélection en un clip unique, avec un crossfade **linéaire** sur la
  région de chevauchement (façon montage bande magnétique, coupe en
  biais). Contrairement à une simple concaténation, le clip résultant
  est **plus court** que la somme des deux entrées.
- **Sémantique longueur** : si les deux clips font `N_a` et `N_b`
  samples et que la durée de crossfade est `D`, le clip résultant fait
  `N_a + N_b - D` samples. Les `D` derniers samples de `A` et les `D`
  premiers samples de `B` sont mixés linéairement (rampe 0→1 / 1→0).
  Cf. la formule détaillée dans la docstring de `crossfadeClips` (§3).
- **label** : `"Crossfade <N> junctions"` où `N` est le nombre de
  jonctions traitées.
- **canApply** : il existe au moins une paire contiguë dans la
  sélection appartenant à la même track, **et** pour chaque telle
  paire `(a, b)` : `a.sourceLengthSamples >= durationSamples` et
  `b.sourceLengthSamples >= durationSamples`.
- **apply** : détecte les runs contigus via `findContiguousRuns` (§5).
  Pour chaque run de longueur ≥ 2, appelle `crossfadeClips` de manière
  repliée gauche-à-droite (même structure que §4.2, en passant
  `durationSamples`). Contrairement au merge, **pas de fast path** :
  chaque appel à `crossfadeClips` crée une nouvelle resource. La
  sélection résultante contient les nouveaux clip ids créés (un par
  run fusionné), construite via `Selection.of(newProject, newIds)`.
- **Pas de traitement spécial** du cas où deux clips contigus seraient
  également contigus dans la même resource : le crossfade recrée
  toujours un buffer PCM pour porter la rampe de mix.

### 4.4 `SplitSelectionAtCut`

```ts
class SplitSelectionAtCut extends SelectionOperation<SplitParams>

interface SplitParams {
  readonly cutCoord: TimeCoord;
}
```

- **Objectif** : pour chaque clip de la sélection qui intersecte
  strictement le marker `cut`
  (`clip.start < cutCoord < clipEnd(project, clip)`), remplacer ce clip
  par deux clips adjacents partageant la même `AudioResource`, coupés à
  `cutCoord`.
- **label** : `"Split <N> clips at cut"`.
- **canApply** : `cutCoord` est fini et au moins un clip de
  `selection.clips()` intersecte strictement `cutCoord`.
- **apply** : pour chaque clip intersecté, crée deux nouveaux clips avec
  des `ClipId` neufs. La sélection résultante contient **les deux
  moitiés** pour chaque clip split, plus les clips de la sélection
  d'origine qui n'étaient pas intersectés, construite via
  `Selection.of(newProject, newIds)`.
- **Pourquoi le `cutCoord` est un paramètre et non un champ de `Selection`**
  — voir §7, **« Selection contient-elle les markers ? »**.

## Concept 5 — Emplacement et dépendances (DAG)

```
src/domain/
├── clip.ts
├── clip-operations.ts                # §3 : concatenateClips, crossfadeClips
└── selection/
    ├── selection.ts                  # §1 : class Selection
    ├── selection-operation.ts        # §2 : classe abstraite
    ├── contiguous-runs.ts            # privé : findContiguousRuns (helper §4.2/§4.3)
    └── operations/
        ├── delete-selection.ts
        ├── merge-contiguous-in-selection.ts
        ├── crossfade-contiguous-in-selection.ts
        └── split-selection-at-cut.ts
```

Arêtes du DAG :

```
Project  ◄─── clip-operations.ts
Project  ◄─── Selection  ◄─── SelectionOperation  ◄─── operations/*.ts
                                                             │
                                                             ▼
                                              contiguous-runs.ts  (helper privé)
                                                             ▼
                                              clip-operations.ts  (primitives §3)

                            demo/interactions.ts (adapter)
                                        │
                                        └───►  tout ce qui précède
```

- `clip-operations.ts` dépend de `Project`, `Clip`, `AudioResource` et
  des fonctions de domaine déjà existantes. **Il ne connaît rien de
  `Selection`** — c'est ce qui permet de le réutiliser sans traîner la
  notion de sélection.
- `contiguous-runs.ts` est un helper **privé** au dossier `selection/`
  qui détecte les runs contigus (même track, `clipEnd(a) === b.start`)
  dans une `Selection`. Il est utilisé par §4.2
  (`MergeContiguousInSelection`) et §4.3
  (`CrossfadeContiguousInSelection`). Il n'est pas exporté hors du
  dossier.
- `Selection` dépend de `Project` (pour l'ordre visuel et la
  validation).
- `SelectionOperation` dépend de `Selection` et `Project`.
- Les quatre opérations dépendent de `SelectionOperation`, `Selection`,
  `Project`, et des fonctions de domaine déjà existantes (`removeClip`,
  `placeClip`, `clipEnd`, …) dans [src/daw.ts](src/daw.ts).
  `merge-contiguous-in-selection.ts` et
  `crossfade-contiguous-in-selection.ts` dépendent en outre de
  `clip-operations.ts` et `contiguous-runs.ts`.
- **Aucune** dépendance inverse : `daw.ts` n'importe pas `selection.ts`
  ni `clip-operations.ts`.
- **Aucune** dépendance latérale entre fichiers d'`operations/` :
  `delete-selection.ts` n'importe pas `merge-contiguous-in-selection.ts`.
  Partager un helper (`contiguous-runs.ts`) reste autorisé — c'est une
  dépendance vers un nœud situé plus bas dans le DAG, pas une dépendance
  latérale.

La règle « peer concepts in DAG » de FUNCTIONALCOUPLING.md est ainsi
respectée : chaque opération est un nœud feuille ; les parties
partagées (`clip-operations.ts`, `contiguous-runs.ts`) sont factorisées
plus bas.

## Concept 6 — Adapter UI : comment `interactions.ts` appelle tout ça

Les opérations vivent dans le domaine ; la couche `demo/` fournit un
**adapter** qui fait trois choses.

### 6.1 Matérialiser la `Selection` à la demande

`demoState` continue de stocker les ids bruts (pour que le rendering
path garde son `Set.has()` O(1) — voir
[demo/clip/clip-presentation-inputs.ts:18](demo/clip/clip-presentation-inputs.ts#L18)) :

```ts
selectedClipIds: ReadonlySet<ClipId>;   // inchangé
selectedClipId:  ClipId | null;         // inchangé (anchor UI)
```

L'adapter construit une `Selection` fraîche chaque fois qu'il en a
besoin :

```ts
function getCurrentSelection(): Selection {
  return Selection.of(demoState.project, demoState.selectedClipIds);
}
```

Aucune `Selection` n'est jamais mise en cache — elle est toujours
attachée au `demoState.project` courant, donc jamais stale.

### 6.2 Appliquer une opération en une seule entrée undo-redo

```ts
function applySelectionOperation<P>(
  operation: SelectionOperation<P>,
  params: P,
  elements: Elements,
): boolean {
  const selection = getCurrentSelection();
  if (!operation.canApply(selection, params)) return false;
  const label = operation.label(selection, params);
  return applySessionDocumentTransition(label, () => {
    const result = operation.apply(selection, params);
    writeSelectionToDemoState(result.selection);
    return result.project;
  }, elements);
}
```

Cette fonction **remplace** les multiples canevas de
`applySessionDocumentTransition(label, () => …)` qui se dupliquent
actuellement dans `interactions.ts` pour chaque action sur la sélection.

### 6.3 Écrire le résultat dans le view-state

Un unique point d'entrée reflète le résultat d'une `SelectionOperation`
dans `demoState` :

```ts
function writeSelectionToDemoState(selection: Selection): void {
  demoState.selectedClipIds = new Set(selection.clipIds);
  demoState.selectedClipId = selection.primaryClipId;
  demoState.clipRenderStructureDirty = true;
}
```

Les anciens helpers `setSelectedClipIds`, `clearSelectedClips`,
`toggleSelectedClipId` deviennent de fins wrappers autour de
`Selection.of` / `selection.clear()` / `selection.toggle()` +
`writeSelectionToDemoState`. Exemple :

```ts
function toggleSelectedClipId(clipId: ClipId): void {
  const next = getCurrentSelection().toggle(clipId);
  writeSelectionToDemoState(next);
}
```

### 6.4 Construction depuis la marquee

`collectMarqueeSelectedClipIds`
([demo/interactions.ts:3915](demo/interactions.ts#L3915)) reste dans
`demo/interactions.ts` — il mélange de la géométrie de viewport
(`gridWidthPx`, `laneHeightPx`, `pixelsPerCoord`, …) avec de la
logique de sélection, et `src/domain/` n'a pas le droit de connaître
ces entités UI. Son corps est refactoré pour finir sur :

```ts
const ids = /* balayage géométrique inchangé */;
const next = Selection.of(demoState.project, ids);
writeSelectionToDemoState(next);
```

### 6.5 Consommation des bounding boxes par le drag

Le démarrage de drag
([demo/interactions.ts:4151-4167](demo/interactions.ts#L4151-L4167))
cesse de recalculer `sourceGroupStart` / `sourceGroupEnd` /
`sourceGroupMinTrackIndex` / `sourceGroupMaxTrackIndex` à la main :

```ts
const selection = getCurrentSelection();
const timeRange = selection.timeRange()!;    // garanti non-null : drag suppose selection non vide
const trackRange = selection.trackRange()!;

demoState.dragState = {
  // ...
  sourceGroupStart:          timeRange.startCoord,
  sourceGroupDurationCoord:  timeRange.endCoord - timeRange.startCoord,
  sourceGroupMinTrackIndex:  trackRange.minIndex,
  sourceGroupMaxTrackIndex:  trackRange.maxIndex,
  // ...
};
```

C'est l'une des concrétisations les plus visibles du principe
« complete abstraction » : les bounding boxes sont maintenant une
propriété de la `Selection`, pas une computation inlinée ailleurs.

### Qui branche les entrées de menu et les raccourcis

Les entrées de menu « clip context menu » et les raccourcis clavier
(`Delete`, `Cmd-J`, `Cmd-K`, …) appellent **uniquement**
`applySelectionOperation(new DeleteSelection(), undefined, elements)` (ou
similaire). Aucune de ces entrées ne touche plus directement à `project`
ou à `selectedClipIds`. L'ensemble des opérations disponibles se lit
donc en parcourant `src/domain/selection/operations/`.

## Concept 7 — Décisions et open questions

### Selection contient-elle les markers (cursor, cut) ?

**Non.** Raisons :

1. **Co-usage.** La plupart des opérations (`Delete`, `Merge`,
   `Crossfade`) n'ont pas besoin des markers. Les y inclure violerait
   « Keep separate what is often used independently » de
   FUNCTIONALCOUPLING.md.
2. **Invariant de cohérence.** `Selection.clipIds` doit être cohérent
   avec `project.timeline.tracks[*].clips` ; les markers vivent dans un
   autre sous-système (`MarkerManager` dans [src/marker/](src/marker/)),
   avec leurs propres invariants. Les mélanger complique les deux.
3. **Alternative propre.** Les opérations qui ont besoin d'un marker
   le reçoivent en **paramètre** (`SplitParams = { cutCoord }`). Le
   concept « transformation de sélection » reste indépendant du
   sous-système marker.

### Selection est-elle mutable ou immutable ?

**Immutable.** Toutes les méthodes de mutation (`add`, `remove`,
`toggle`, `clear`, `withClipIds`) retournent une nouvelle instance.
La donnée interne n'est jamais modifiée en place. C'est aligné avec le
reste du modèle domaine (`Project`, `Timeline`, `Track`, `Clip` sont
tous immutables). La cellule mutable unique est
`demoState.selectedClipIds`, qui reste une décision UI.

### Plusieurs sélections simultanées ?

Pas de besoin actuel : la timeline n'a qu'une sélection active. La spec
n'interdit rien cependant : le type `Selection` peut être instancié
plusieurs fois sans état global — une extension future
(ex : « sélection pinned pour comparaison ») n'aurait pas besoin de
refactor.

### Selection multi-track ?

Oui, dès le premier jour. L'ordre visuel balaie les tracks dans l'ordre
du timeline puis les clips dans chaque track — c'est le même ordre que
`getOrderedSelectedClipIds` actuel
([demo/interactions.ts:3866](demo/interactions.ts#L3866)).

### Que deviennent les sélections incohérentes héritées de l'ancien code ?

Quand un undo/redo ou une opération externe supprime un clip qui est
encore dans `demoState.selectedClipIds`, le prochain
`getCurrentSelection()` appelle `makeSelection` qui **filtre** les clip
ids orphelins (invariant de cohérence §2.1 du Concept 1). L'adapter
réécrit ensuite `demoState.selectedClipIds` pour refléter ce filtrage.
Aucune opération ne voit jamais une sélection incohérente.

## Litmus test (FUNCTIONALCOUPLING.md §Documentation)

Description en une phrase :

> Une **SelectionOperation** est une transformation pure qui, à partir
> d'un projet, d'une sélection ordonnée et de paramètres, produit un
> nouveau projet et une nouvelle sélection cohérente, emballable en une
> entrée unique d'undo-redo.

Description d'une phrase de `Selection` :

> Une **Selection** est la liste ordonnée, stable et sans doublon des
> clip ids actuellement sélectionnés dans un projet.

Les deux passent le test de concision → les groupements sont sains.

## Plan de migration (non normatif, aide à l'implémentation)

1. Créer `src/domain/selection/selection.ts` avec la classe `Selection`
   (constructeur privé, `of`, `empty`, mutations, introspection,
   bounding boxes, `rebase`). Ne rien supprimer de `interactions.ts` à
   cette étape.
2. Créer `src/domain/selection/selection-operation.ts` avec la classe
   abstraite et `SelectionOperationResult`.
3. Introduire l'adapter §6 (`getCurrentSelection`,
   `writeSelectionToDemoState`, `applySelectionOperation`) dans
   `interactions.ts`. Remplacer `setSelectedClipIds`,
   `clearSelectedClips`, `toggleSelectedClipId`,
   `getOrderedSelectedClipIds` par des wrappers de une ligne sur la
   classe. Aucune opération n'existe encore — ce commit réorganise
   seulement l'état existant.
4. Refactorer le démarrage de drag (§6.5) pour consommer
   `selection.timeRange()` / `selection.trackRange()` à la place des
   boucles inlinées. Supprimer les computations dupliquées.
5. Refactorer `collectMarqueeSelectedClipIds` (§6.4) pour terminer sur
   `Selection.of` + `writeSelectionToDemoState`.
6. Ajouter `DeleteSelection` sous `operations/`. Le brancher à
   `removeSelectedClipFromUi` via `applySelectionOperation`.
   **Supprimer** l'ancien corps de `removeSelectedClipFromUi`.
7. Ajouter `SplitSelectionAtCut` — nouvelle fonctionnalité, aucun code
   à supprimer. Brancher le raccourci/menu « Split at cut ».
8. Créer `src/domain/clip-operations.ts` avec `ClipSampleDeps`,
   `concatenateClips` (fast path + general path PCM) et `crossfadeClips`
   (linéaire, toujours une nouvelle resource). Ajouter une fabrique de
   `ClipSampleDeps` dans l'adapter UI, branchée sur
   `demoState.resourceAudioBuffers`. Aucune `SelectionOperation` ne
   l'utilise encore à ce stade — le commit est autonome et testable.
9. Créer `src/domain/selection/contiguous-runs.ts` (helper privé au
   dossier `selection/`) avec `findContiguousRuns(selection)`.
10. Ajouter `MergeContiguousInSelection` sous `operations/`. S'appuie
    sur `concatenateClips` et `findContiguousRuns`. Brancher le menu
    correspondant.
11. Ajouter `CrossfadeContiguousInSelection` sous `operations/`.
    S'appuie sur `crossfadeClips` et `findContiguousRuns`. Brancher le
    menu correspondant (durée par défaut : 35 ms × sampleRate).

Chaque étape est un commit atomique ; les tests existants doivent
passer entre chaque étape.
