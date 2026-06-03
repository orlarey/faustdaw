# Spécification des Markers

## Problème

Le DAW possède actuellement deux repères visuels sur la timeline — le curseur
(playhead) et le marqueur de début du dernier play — mais ils sont implémentés
de manière ad hoc avec des chemins de code séparés. Le curseur vit dans le
modèle domaine (`Timeline.cursor` de type `TimeCoord`), le marqueur de dernier
play vit uniquement dans le view state (`demoState.lastPlayStartCoord`). Chacun
a son propre rendu, ses propres interactions et sa propre logique de visibilité.

Nous voulons introduire un concept unifié de **Marker** qui systématise ces
repères et permette d'en ajouter de nouveaux (cue points, locators de boucle,
etc.) sans dupliquer du code à chaque fois.

## But

Fournir une abstraction commune pour tous les repères visuels attachés à une
position temporelle sur la timeline, avec :

- un modèle de données unifié ;
- un rendu autonome ;
- des comportements configurables.

## Première Décision

Un Marker est un **composant autonome** : il crée ses éléments DOM, gère ses
interactions (drag), se met à jour visuellement, et notifie l'extérieur quand
son état change.

### Principe fondamental

Un marker ne porte pas de « type » ou « kind ». C'est un objet générique dont
les propriétés (draggable, supprimable, apparence…) sont fixées à la
construction. C'est la **structure qui le contient** qui donne le sens :

- `timeline.cursor` → c'est le curseur parce que c'est le champ `cursor`
- `demoState.lastPlayStart` → c'est le last-play parce que c'est ce champ
- `timeline.markers[i]` → c'est un cue point parce qu'il est dans la collection
- `loopSystem.start` / `loopSystem.end` → c'est un locator de boucle parce
  que le système de boucle le référence

### Vocabulaire

- **Marker** : composant autonome associant une position temporelle
  (`TimeCoord`), des propriétés visuelles/comportementales, et ses éléments
  DOM.
- **Constructeur spécialisé** : fonction qui crée un marker avec les bonnes
  propriétés pour un usage donné (`makeCursorMarker`, `makeCueMarker`, etc.).

### Type

```text
MarkerId    ::= branded string
MarkerIcon  ::= "diamond" | "triangle" | "flag"
MarkerColor ::= string (CSS color)

Marker {
  -- Identité
  id          : MarkerId

  -- Position
  position    : TimeCoord       -- entier ≥ 0

  -- Contenu
  label       : string | null   -- nom affiché (null = pas de label)

  -- État
  active      : boolean         -- participe à la logique ?
  visible     : boolean         -- affiché sur la timeline ?

  -- Capacités (fixées à la construction)
  draggable   : boolean         -- déplaçable par l'utilisateur ?
  deletable   : boolean         -- supprimable par l'utilisateur ?
  editable    : boolean         -- label modifiable par l'utilisateur ?
  snappable   : boolean         -- magnétisme grille lors du drag ?

  -- Apparence (fixée à la construction)
  icon        : MarkerIcon      -- forme de l'icône
  color       : MarkerColor     -- couleur du marker
  height      : "full" | "ruler"-- pleine timeline ou règle seule
  zOrder      : number          -- ordre de superposition
}
```

Note : le temps formaté affiché pendant un drag n'est pas un label du marker.
C'est un feedback visuel produit par le marker pour tout marker draggable.

## Deuxième Décision

Le Marker est un composant visuel. Le contenant gère les interactions.

### Principe contenant / contenu

Le marker-layer est le **contenant** des markers, comme une track est le
contenant des clips. Le contenant connaît le contenu, mais pas l'inverse.

- Le **marker** est responsable de son **apparence DOM** : il crée ses
  éléments (icône, ligne, label, feedback de drag), gère ses classes CSS,
  son état visuel (actif/inactif, visible/caché).
- Le **contenant** (marker-layer / marker-manager) est responsable du
  **comportement** : hit-test, drag (capture du pointeur, conversion
  pixel↔coord, snap), auto-scroll, rendu (projection coord→pixel).

### Architecture

```text
Marker(config)

config = {
  position, label, active, visible,
  draggable, deletable, editable, snappable,
  icon, color, height, zOrder
}
```

Le marker ne reçoit pas de services. Il ne connaît ni le zoom, ni le scroll,
ni les conversions pixel↔coord. Tout cela est géré par le contenant.

### Ce que le marker fait lui-même

- **Crée ses éléments DOM** (icône, ligne, label, feedback de drag)
- **Expose son élément racine** pour que le contenant l'insère dans le DOM
- **Expose son icône** pour que le contenant y attache les événements
- **Gère sa visibilité** : `hidden` quand `visible = false`
- **Gère son apparence inactive** : grisé quand `active = false`
- **Affiche le feedback de drag** : texte passé par le contenant

### Ce que le marker ne fait PAS

- **Drag** : pas de capture de pointeur, pas de `pointerdown`. C'est le
  contenant qui écoute les pointer events sur l'icône du marker, fait le
  hit-test, gère la capture, et déplace le marker.
- **Conversion pixel↔coord** : le marker ne connaît ni le zoom ni le scroll.
- **Auto-scroll** : le marker ne connaît pas la vue.
- **Rendu de position** : la projection coord→pixel est faite par le
  contenant qui appelle `marker.update(coord)`.

### Méthodes publiques

```text
marker.update(coord)            -- met à jour la position (TimeCoord)
                                   et projette via coordToPixel
marker.setActive(active)        -- active/désactive
marker.setVisible(visible)      -- montre/cache
marker.setLabel(label)          -- change le label (si editable)
marker.setDragFeedback(text)    -- affiche un feedback pendant le drag
marker.destroy()                -- retire les éléments DOM

marker.position                 -- getter : TimeCoord courante
marker.iconElement              -- getter : élément DOM de l'icône
                                   (pour le hit-test du contenant)
marker.rootElement              -- getter : élément DOM racine
```

### Flux de drag (géré par le contenant)

```text
1. Utilisateur: pointerdown sur la marker-layer
2. Contenant:   hit-test → quel marker ? draggable ?
3. Contenant:   capture le pointeur sur l'icône du marker
4. Utilisateur: pointermove
5. Contenant:   pixelToCoord(pointerX) → coord
                snappable ? snapToGrid(coord) : coord
                marker.update(newCoord)
                détecte zone de bord → auto-scroll
                action domaine spécifique (seek pour cursor, rien pour cut)
6. Utilisateur: pointerup
7. Contenant:   relâche le pointeur, action de fin (render, log, etc.)
```

### Flux de rendu (frame runner)

```text
À chaque frame :
  pour chaque marker dans allMarkers :
    marker.update(marker.position)  -- re-projette via coordToPixel
```

## Troisième Décision

Le cursor est une instance de `Marker` stockée comme champ nommé dans le
domaine, pas dans une collection.

### Pourquoi

- **Même type** : le cursor a les mêmes propriétés que tous les autres markers.
  Ses particularités (non supprimable, toujours visible) sont exprimées par ses
  propriétés, pas par un type différent.
- **Champ nommé** : le cursor est structurellement unique (toujours exactement
  un, jamais supprimé). Le stocker comme champ dédié garantit cette unicité par
  la structure et donne un accès direct (`timeline.cursor.position`).

### Comment

```text
Timeline {
  cursor    : Marker              -- créé par makeCursorMarker()
  transport : TransportState      -- existant
  tracks    : readonly Track[]    -- existant
  markers   : readonly Marker[]   -- cue points créés par l'utilisateur
}
```

Les opérations domaine (`seek`, `tick`, `play`, `stop`) accèdent directement
à `timeline.cursor.position`.

### Reformulation

Le cursor **est** un Marker (même type). Il **n'est pas** dans la collection
`markers[]`. Il est un champ nommé de la Timeline. C'est la structure, pas le
marker, qui dit « ceci est le curseur ».

## Quatrième Décision

Le last-play marker est aussi une instance de `Marker`, stockée dans le view
state.

### Pourquoi

- Il est éphémère (piloté par le transport, pas par l'utilisateur).
- Il ne fait pas partie du projet musical.
- Mais il bénéficie du même type et du même pipeline de rendu.

### Comment

```text
-- dans le view state (demoState), pas dans le domaine
lastPlayStart : Marker | null   -- créé par makeLastPlayMarker()
```

## Cinquième Décision

Les cue points sont stockés dans la collection `timeline.markers` du modèle
domaine.

### Pourquoi

- Ils font partie du projet musical (l'utilisateur les pose intentionnellement).
- Ils doivent survivre au rechargement de session.
- Ils participent à la navigation (jump to cue).

## Sixième Décision

Le frame runner orchestre le rendu de tous les markers.

### Pourquoi

- Le marker ne connaît pas le zoom ni le scroll — il reçoit sa position pixel.
- Le frame runner connaît déjà le view state et fait la conversion
  `TimeCoord → pixel`.
- L'auto-scroll pendant le drag est géré par le frame runner, pas par le
  marker.

### Comment

```text
allMarkers = [timeline.cursor] + (lastPlayStart ?? []) + timeline.markers

À chaque frame :
  pour chaque marker dans allMarkers :
    leftPx = coordToPixel(marker.position)
    marker.update(leftPx)
```

Le frame runner écoute les `MarkerEvent` pour :
- Mettre à jour le modèle domaine sur `"position-changed"`
- Déclencher l'auto-scroll sur `"dragging"` (détection de zone de bord)
- Exécuter un seek sur `"clicked"` (pour les cue points)
- Supprimer un marker sur `"delete-requested"`

## Constructeurs spécialisés

```text
makeCursorMarker(container, services) → Marker
  position  = 0
  label     = null
  active    = true,    visible   = true
  draggable = true,    deletable = false
  editable  = false,   snappable = true
  icon      = "diamond"
  color     = "white"  (+ glow bleu)
  height    = "full"
  zOrder    = 100

makeLastPlayMarker(position, container, services) → Marker
  label     = null
  active    = true,    visible   = true
  draggable = false,   deletable = false
  editable  = false,   snappable = false
  icon      = "triangle"
  color     = "gray"
  height    = "ruler"
  zOrder    = 10

makeCueMarker(position, label, container, services) → Marker
  active    = true,    visible   = true
  draggable = true,    deletable = true
  editable  = true,    snappable = true
  icon      = "flag"
  color     = "orange" (ou couleur vive)
  height    = "ruler"
  zOrder    = 50
```

## Opérations domaine sur le Project

Ces opérations manipulent les markers dans le contexte du projet immuable.

### Ajouter un cue point

```text
addMarker(project, position, label?) → Project
```

- Précondition : `position ≥ 0`
- Crée un marker via `makeCueMarker()` et l'ajoute à `timeline.markers`
- Les markers restent triés par position

### Supprimer un cue point

```text
removeMarker(project, markerId) → Project
```

- Précondition : le marker existe dans `timeline.markers`
- Précondition : `marker.deletable = true`
- Retire le marker de `timeline.markers`

### Déplacer un marker

```text
moveMarker(project, markerId, newPosition) → Project
```

- Précondition : `newPosition ≥ 0`, le marker existe
- Met à jour la position, re-trie si nécessaire

### Déplacer le cursor (seek)

```text
seek(project, time) → Project
```

- Opération existante, adaptée pour modifier `timeline.cursor.position`

### Naviguer vers un marker

```text
seekToMarker(project, markerId) → Project
```

- Précondition : le marker existe et `marker.active = true`
- Équivalent à `seek(project, marker.position)`

## Invariants

1. `timeline.cursor` est toujours actif et visible.
2. `timeline.cursor` n'apparaît jamais dans `timeline.markers`.
3. `timeline.markers` est toujours trié par position croissante.
4. Tous les `MarkerId` sont uniques (cursor + markers + lastPlayStart).
5. Tous les markers ont une position `≥ 0` (entier).

## Septième Décision

Le cut marker est une instance de `Marker`, stockée comme champ nommé dans le
view state.

### Pourquoi

- C'est un **outil** de l'interface, pas une donnée du projet musical.
- Il est permanent, toujours présent, déplaçable.
- Il ne fait pas partie de la session sauvegardée.
- Un seul suffit (pas de collection).

### Comment

```text
-- dans le view state (demoState), pas dans le domaine
cutMarker : Marker   -- créé par makeCutMarker()
```

### Constructeur

```text
makeCutMarker(container, services) → Marker
  position  = 0
  label     = null
  active    = true,    visible   = true
  draggable = true,    deletable = false
  editable  = false,   snappable = true
  icon      = "content_cut"
  color     = "orange"
  height    = "full"
  zOrder    = 90
```

### Positionnement par Shift-clic

Le geste Shift-clic sur la timeline ouvre un **menu contextuel de
positionnement** proposant :

- **Move cursor here** (comportement actuel du Shift-clic)
- **Move cut marker here**

Ce menu est extensible : si d'autres markers positionnables sont ajoutés
(loop start, loop end…), ils apparaissent dans le même menu.

### Opération "Cut at marker"

- Accessible dans le **menu contextuel** d'un clip, si le clip **chevauche**
  la position du cut marker.
- Produit **deux clips indépendants** (même pattern qu'explode :
  `sliceAudioBuffer`, chaque sous-clip obtient sa propre ressource audio).
- L'opération est **undoable** (même mécanisme que les autres modifications
  de session).

### Sémantique du cut

Le point de coupe **appartient au clip droit** :

- **Clip gauche** : `[clip.start, cutPos[`
- **Clip droit** : `[cutPos, clip.start + clip.duration[`

à condition qu'aucun des deux clips résultants ne soit vide.

### Préconditions du cut

1. `clip.start < cutPos < clip.start + clip.duration` (strictement, le point
   de coupe est à l'intérieur du clip).
2. Les deux sous-clips résultants ont une durée > 0.

## Interactions utilisateur (futur)

- **Shift-clic sur la timeline** : ouvre le menu contextuel de
  positionnement (cursor, cut marker, futurs markers positionnables).
- **Double-clic sur la règle** : ajoute un cue point à cette position.
- **Drag d'un marker draggable** : déplace le marker (avec magnétisme si
  `snappable`). Le temps formaté s'affiche comme feedback pendant le drag.
  L'auto-scroll se déclenche si le pointeur atteint le bord de la vue.
- **Clic sur un cue point actif** : seek vers cette position.
- **Suppr/Delete sur un marker sélectionné** : supprime si `deletable`.
- **Raccourcis clavier** : navigation entre cue points (suivant/précédent).

## Extensibilité

Pour ajouter un nouveau type de marker (ex: locators de boucle) :

1. Créer un constructeur `makeLoopStartMarker(position, container, services)`
   avec les bonnes propriétés.
2. Stocker l'instance dans un champ nommé du système concerné
   (`loopSystem.start : Marker`).
3. L'ajouter à la liste `allMarkers` dans le frame runner.

Pas besoin de modifier la classe `Marker`, le frame runner, ni les
opérations génériques.
