# Spécification de la Fenêtre de Clips Visibles

## Problème

Chaque piste contient une séquence de clips triée par date de début croissante.
L'affichage et le défilement de la timeline ne doivent parcourir que les clips
dont l'intervalle temporel intersecte la fenêtre visible, et non la totalité
des clips de la piste.

Avec des milliers de clips par piste, un parcours linéaire à chaque frame de
rendu (`O(n)`) est inacceptable. Il faut un mécanisme dont le coût est
proportionnel au nombre de clips visibles, pas au nombre total.

## Portée

Cette spécification introduit :

- la notion de **fenêtre de clips visibles** pour une piste donnée ;
- une opération de recherche par dichotomie qui exploite l'ordre de tri ;
- un cache d'indices `[first, last]` qui évite de refaire la recherche
  à chaque frame tant que la vue ne change pas.

Cette spécification ne modifie pas :

- la structure de données du domaine (`readonly Clip[]` trié) ;
- les opérations de placement, suppression ou déplacement de clips ;
- la sémantique d'observation audio.

## Vocabulaire

- **Vue** : intervalle temporel `[viewStart, viewEnd)` actuellement affiché.
- **Clip visible** : clip dont l'intervalle temporel `[clip.start, clipEnd)`
  a une intersection non vide avec la vue.
- **Fenêtre de clips visibles** : sous-séquence contiguë `clips[first..last]`
  contenant exactement les clips visibles d'une piste.

## Prérequis : invariant de tri

On rappelle l'invariant maintenu par le domaine :

```math
∀ track : Track,
  ∀ i, j ∈ [0, |track.clips|),
    i < j ⇒ track.clips[i].start ≤ track.clips[j].start
```

De plus, les clips sont non chevauchants :

```math
∀ track : Track,
  ∀ i ∈ [0, |track.clips| - 1),
    clipEnd(track.clips[i]) ≤ track.clips[i+1].start
```

Ces deux propriétés garantissent que les clips visibles forment un segment
contigu du tableau.

## Propriété fondamentale : contiguïté

**Théorème.** Si les clips d'une piste sont triés par `start` croissant et
non chevauchants, alors l'ensemble des clips visibles pour un intervalle de
vue donné forme un sous-tableau contigu.

**Preuve.** Soient `c_i` et `c_k` deux clips visibles avec `i < k`. Pour
tout `j` tel que `i < j < k`, on a :

```math
c_j.start ≥ clipEnd(c_i)     (non-chevauchement, i < j)
c_j.start ≤ c_k.start        (tri croissant, j < k)
```

Or `c_i` est visible donc `c_i.start < viewEnd`, et par non-chevauchement
`c_j.start ≥ clipEnd(c_i) > c_i.start ≥ viewStart` (quand `clipEnd(c_i) ≤ viewEnd`).
De plus `clipEnd(c_j) ≥ c_j.start > viewStart` (pour un clip de durée > 0)
et `c_j.start ≤ c_k.start < viewEnd` (car `c_k` est visible).
Donc `c_j` intersecte la vue, donc `c_j` est visible.

L'ensemble est donc un intervalle `[first, last]` dans le tableau. ∎

## Types

```math
ViewRange ::= ViewRange(
  viewStart: TimeCoord,
  viewEnd:   TimeCoord
)

VisibleClipRange ::= VisibleClipRange(
  first: entier ≥ 0,
  last:  entier ≥ -1
)
```

Convention : `last = first - 1` (par exemple `first = 0, last = -1`)
signifie qu'aucun clip n'est visible.

## Définition formelle

### Clip visible

```math
Visible(clip, view) ⇔
  clip.start < view.viewEnd ∧ clipEnd(clip) > view.viewStart
```

Reformulation : un clip est visible si et seulement si son intervalle
temporel `[start, clipEnd)` a une intersection non vide avec la vue
`[viewStart, viewEnd)`.

### Fenêtre de clips visibles

```math
VisibleRange(track, view) =
  soit first = min { i | Visible(track.clips[i], view) }
  soit last  = max { i | Visible(track.clips[i], view) }
  si first existe alors (first, last)
  sinon (0, -1)
```

## Algorithme de recherche

### Recherche du premier clip visible

Le premier clip visible est le premier clip dont la fin dépasse `viewStart` :

```math
first = min { i | clipEnd(track.clips[i]) > viewStart }
```

Par l'invariant de tri, `clipEnd` est croissant (puisque les clips sont non
chevauchants et triés par `start`). On peut donc trouver `first` par
**dichotomie** en `O(log n)`.

### Recherche du dernier clip visible

À partir de `first`, on itère tant que `clips[i].start < viewEnd`. Le
dernier indice satisfaisant cette condition est `last`.

```math
last = max { i ≥ first | track.clips[i].start < viewEnd }
```

Cette itération est en `O(k)` où `k` est le nombre de clips visibles.

### Complexité totale

```math
FindVisibleRange(track, view) ∈ O(log n + k)
```

où `n = |track.clips|` et `k = |{ c ∈ track.clips | Visible(c, view) }|`.

## Cache de vue

Pour éviter de refaire la dichotomie à chaque frame de rendu, on maintient
un cache par piste :

```math
ViewCache ::= ViewCache(
  first:     entier,
  last:      entier,
  viewStart: TimeCoord,
  viewEnd:   TimeCoord
)
```

### Invalidation

Le cache est invalidé (et la recherche relancée) quand :

1. La vue change : `viewStart` ou `viewEnd` a été modifié (pan, zoom, seek).
2. Les clips changent : un clip a été placé, supprimé ou déplacé sur la piste.

### Mise à jour incrémentale lors d'une translation

Quand la vue translate d'un petit delta (scroll), on peut ajuster les
indices sans dichotomie :

```math
TranslateCache(cache, track, newView) :

  // Clips sortant à gauche
  tant que first ≤ last ∧ clipEnd(track.clips[first]) ≤ newView.viewStart :
    first ← first + 1

  // Clips entrant à gauche
  tant que first > 0 ∧ clipEnd(track.clips[first - 1]) > newView.viewStart :
    first ← first - 1

  // Clips sortant à droite
  tant que last ≥ first ∧ track.clips[last].start ≥ newView.viewEnd :
    last ← last - 1

  // Clips entrant à droite
  tant que last + 1 < n ∧ track.clips[last + 1].start < newView.viewEnd :
    last ← last + 1
```

Cette mise à jour est en `O(δ)` où `δ` est le nombre de clips qui
entrent ou sortent de la vue — typiquement 0 ou 1 par frame.

## Invariant du cache

À tout instant, le cache satisfait :

```math
∀ i ∈ [first, last],  Visible(track.clips[i], view)
∀ i ∉ [first, last],  ¬Visible(track.clips[i], view)
```

Reformulation : le cache partitionne exactement les clips de la piste en
visibles et non visibles.

## Interface

```math
FindVisibleClipRange(project, track, viewStart, viewEnd) → VisibleClipRange

VisibleClips(track, range) = track.clips[range.first .. range.last]
```

## Positionnement architectural

Cette spécification concerne la **couche de vue** (demo/rendu), pas le
domaine. Le domaine conserve sa structure `readonly Clip[]` triée et ses
opérations immutables. La fenêtre de clips visibles est un **état dérivé**
calculé à partir de l'état du domaine et de la position de la vue.

```text
Domaine (src/)          Vue (demo/)
─────────────          ────────────
Track.clips ────────→  VisibleClipRange
  (trié, immutable)      (cache, mutable)
```

## Remarques

1. **Coût de l'insertion** : l'insertion d'un clip reste en `O(n)` dans le
   domaine (copie du tableau immutable). Ce coût est acceptable car
   l'insertion est une action utilisateur ponctuelle, pas une opération
   par frame.

2. **Extensibilité** : si le nombre de clips devait dépasser les dizaines
   de milliers, on pourrait substituer un arbre binaire de recherche
   immutable au tableau trié, sans changer l'interface
   `FindVisibleClipRange`.

3. **Pistes multiples** : le cache est indépendant par piste. Le coût
   total du rendu est `O(T × (log n + k))` pour la recherche initiale,
   puis `O(T × δ)` par frame en régime de translation, où `T` est le
   nombre de pistes.
