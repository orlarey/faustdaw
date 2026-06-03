# Spécification de la compilation des effets Faust

## Vue d'ensemble

La compilation Faust transforme un fichier source `.dsp` en un `AudioWorkletNode` Web Audio
utilisable dans le graphe audio. Cette opération est **lourde** (~1-5 s par effet) car elle
passe par le compilateur Faust WASM (`libfaust-wasm`), puis instancie un `AudioWorkletProcessor`.

L'architecture repose sur un **point d'entrée unique** pour la compilation :
`compileAndAttachEffect`. Toutes les situations (drop interactif, restauration de session,
undo/redo) passent par cette fonction.

---

## Point d'entrée unique : `compileAndAttachEffect`

```typescript
export async function compileAndAttachEffect(
  effect: FxEffect,
  targetTrackId: TrackId,
  elements: Elements,
  savedParameters: readonly FxParam[] | null = null,
): Promise<void>
```

| Paramètre | Rôle |
|---|---|
| `effect` | L'instance FxEffect à compiler |
| `targetTrackId` | La piste cible |
| `elements` | Références DOM |
| `savedParameters` | `null` = drop frais (valeurs par défaut), non-null = restauration |

**Flux interne** :
```
compileAndAttachEffect(effect, trackId, elements, savedParameters)
  → getEffectCode(effect)             // cherche le code DSP dans fxResources
  → si code vide → warn + return     // effet orphelin (ressource perdue)
  → compileFxEffect(effectId, ...)    // compilation Faust WASM (sérialisée)
  → si savedParameters non null :
      → restoreEffectParameters(node, savedParameters)  // restaure les valeurs
  → captureEffectParameters(node)     // capture les métadonnées du node
  → updateEffectParameters(...)       // met à jour le modèle domaine
  → ensureTrackOutputGain(...)        // reconnecte la chaîne audio de la piste
```

---

## Les deux situations d'appel

### 1. Drop interactif d'un `.dsp` → `savedParameters = null`

**Déclencheur** : l'utilisateur dépose un fichier `.dsp` sur le panneau FX ou sur la grille.

**Appelants** :
- `fx-chain-panel.ts` — drop handler du panneau FX
- `interactions.ts` — drop handler de la grille timeline

**Flux** :
```
utilisateur drop .dsp
  → importDspFileAsEffect(file, code)     // crée FxResource + FxEffect
  → addEffect(project, trackId, effect)   // ajoute l'effet au modèle
  → syncFxPanelList(elements)             // rafraîchit la liste UI
  → compileAndAttachEffect(effect, trackId, elements)  // savedParameters = null
  → syncFxPanelList(elements)             // rafraîchit l'UI avec l'orbit-ui
```

Les paramètres sont **capturés** depuis le node compilé (valeurs par défaut Faust).

### 2. Restauration de session → `savedParameters = effect.parameters`

**Déclencheur** : le projet est restauré (workspace, undo/redo, import d'archive).

**Appelants** :
- `interactions.ts` — `startRecompilation(elements)` après chargement d'une session
- `interactions.ts` — `startRecompilation(elements)` après undo/redo

**Flux** :
```
restauration de session / undo / redo
  → startRecompilation(elements)
      → recompileAllSessionEffects(elements)
          pour chaque effet sans runtime :
            → compileAndAttachEffect(effect, trackId, elements, effect.parameters)
      → syncFxPanelListRef(elements)      // rafraîchit l'UI si le panneau est ouvert
```

Les paramètres sauvegardés sont **restaurés** sur le node avant capture.

---

## Séparation des responsabilités

### `compileAndAttachEffect` — compile et attache UN effet

Responsabilités :
- Vérifier que le code DSP est disponible
- Compiler via `compileFxEffect` (sérialisé)
- Restaurer ou capturer les paramètres
- Reconnexion audio de la piste

### `recompileAllSessionEffects` — boucle de restauration

Responsabilités :
- Identifier les effets sans runtime
- Appeler `compileAndAttachEffect` pour chacun avec les paramètres sauvés
- Rafraîchir le panneau FX si au moins un effet a été compilé
- Guard `recompilationInProgress` contre la réentrance

### `syncFxPanelList` — rendu UI pur

Responsabilités :
- Rendre le HTML de la liste d'effets
- Attendre `pendingRecompilation` si en cours
- Créer les orbit-ui pour les effets qui ont déjà un runtime
- **Ne déclenche jamais** de compilation

### `compileFxEffect` — compilation bas niveau (fx-chain-runtime.ts)

Responsabilités :
- Sérialiser les compilations via `compilationQueue` (le compilateur WASM est mono-thread)
- Dédupliquer par `effectId` (retourne le runtime existant si déjà compilé)
- Appeler `generator.compile()` puis `generator.createNode()`

---

## Diagramme de séquence — drop interactif

```
utilisateur                fx-chain-panel              fx-chain-runtime
    │                           │                            │
    │── drop .dsp ─────────────>│                            │
    │                           │── importDspFileAsEffect()  │
    │                           │── addEffect()              │
    │                           │── syncFxPanelList()        │
    │                           │     └── render HTML        │
    │                           │     └── void async IIFE    │
    │                           │          └── await pending │
    │                           │          └── orbit-ui      │
    │                           │                            │
    │                           │── compileAndAttachEffect(…, null)
    │                           │     │                      │
    │                           │     │── compileFxEffect ──>│
    │                           │     │                      │── queue
    │                           │     │                      │── compile WASM
    │                           │     │                      │── createNode
    │                           │     │<─── runtime ─────────│
    │                           │     │── captureParams      │
    │                           │     │── updateParams       │
    │                           │     │── rewire audio       │
    │                           │                            │
    │                           │── syncFxPanelList()        │
    │                           │     └── orbit-ui ready     │
    │<── "Effect ready" ────────│                            │
```

## Diagramme de séquence — restauration de session

```
interactions.ts            fx-chain-panel              fx-chain-runtime
    │                           │                            │
    │── startRecompilation() ──>│                            │
    │                           │── recompileAll...()        │
    │                           │     │                      │
    │                           │  pour chaque effet :       │
    │                           │     │── compileAndAttach(…, params)
    │                           │     │     │── compileFx ──>│
    │                           │     │     │<── runtime ────│
    │                           │     │     │── restore      │
    │                           │     │     │── capture      │
    │                           │     │     │── rewire       │
    │                           │     │                      │
    │                           │── syncFxPanelListRef()     │
    │                           │     └── orbit-ui ready     │
```

---

## Points d'attention

1. **La file de compilation est critique** : le compilateur WASM deadlock si deux
   `generator.compile()` s'exécutent en parallèle. Tout chemin de compilation
   doit passer par `compileFxEffect` qui sérialise via `compilationQueue`.

2. **Les effets orphelins** (code vide) proviennent de sessions sauvegardées dans
   le workspace avant l'ajout du champ `fxResources`. `compileAndAttachEffect`
   les détecte et les ignore avec un warning. L'utilisateur doit re-déposer
   le fichier `.dsp`.

3. **`startRecompilation`** encapsule `recompileAllSessionEffects` dans
   `pendingRecompilation`, ce qui permet à `syncFxPanelList` d'attendre la fin
   avant de créer les orbit-ui.
