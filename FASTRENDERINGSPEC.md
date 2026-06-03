# Spécification du Rendu Rapide de la Timeline

## Problème

Nous voulons décrire comment rendre efficacement la timeline d'un DAW web quand
le projet contient un grand nombre de clips.

Ce document ne décrit pas principalement **ce qui est rendu**, mais **comment le
rendu est organisé** pour rester fluide.

Le point important pour un lecteur non spécialiste du web est le suivant :

- ici, le rendu est un **rendu DOM** ;
- il ne s'agit **pas** d'un rendu `canvas`.

Autrement dit, la timeline est construite à partir d'éléments HTML réels :

- `div` pour les clips ;
- `div` pour les graduations ;
- `div` pour le curseur ;
- `div` pour les overlays ;
- etc.

Chaque objet visible existe donc comme nœud du document, avec son style CSS,
ses textes et ses interactions.

Le problème de performance ne consiste donc pas à "repeindre une image", mais à
éviter :

- de recalculer trop d'objets ;
- de recréer trop de nœuds DOM ;
- de relire trop souvent la géométrie du layout ;
- de provoquer trop de recalculs de style, de layout et de paint.

## But

Nous voulons définir des principes de rendu tels que :

```math
RenderCost ≈ coût des objets effectivement visibles et modifiés
```

et non :

```math
RenderCost ≈ coût de tous les clips du projet
```

En particulier :

- un pan ou un zoom doit coûter principalement en fonction des objets visibles ;
- un drag de clip ne doit pas dépendre du nombre total de clips du projet ;
- un petit mouvement de pan ne doit pas faire entrer et sortir inutilement les
  mêmes clips ou les mêmes labels ;
- les panneaux annexes ne doivent pas pénaliser le chemin chaud de la timeline.

## Version naïve

La version naïve d'un rendu DOM de timeline consisterait à faire, à chaque
frame :

1. recalculer la timeline entière ;
2. reparcourir toutes les pistes et tous les clips ;
3. reconstruire le HTML complet de la règle ;
4. reconstruire le HTML complet de la grille ;
5. reconstruire le HTML complet de tous les clips visibles ;
6. réécrire aussi les panneaux annexes ;
7. refaire ces opérations à chaque `pointermove`.

Schématiquement :

```math
NaiveRender(project, view) :
  clipsVisible ← filtrer tous les clips du projet
  rulerHTML ← reconstruire toute la règle
  gridHTML ← reconstruire toute la grille
  clipsHTML ← reconstruire tous les clips visibles
  summary ← recalculer les panneaux annexes
```

Cette approche a plusieurs défauts :

- coût linéaire en le nombre total de clips ;
- beaucoup de recréation de nœuds DOM ;
- nombreuses invalidations de layout ;
- mauvais comportement quand on manipule un clip au-dessus d'une zone dense.

## Principes effectivement retenus

La version actuellement retenue repose sur les mécanismes suivants :

1. ne considérer que la sous-partie utile de chaque piste ;
2. élargir la vue réelle en une **fenêtre de rendu** avec **zone stable** ;
3. utiliser cette même fenêtre rendue pour les clips et la géométrie temporelle
   partagée ;
4. séparer le rendu complet et le rendu interactif léger ;
5. faire un **pan preview** par `transform` avant de committer le viewport ;
6. réutiliser les nœuds DOM des clips au lieu de reconstruire tout le HTML ;
7. isoler le clip dragué dans une couche d'overlay ;
8. découpler les caches de vue de l'identité globale du `Project` ;
9. mettre en cache la géométrie et le magnétisme pendant les gestes ;
10. désactiver les panneaux coûteux dans les scénarios de charge.

Important :

- la version actuelle **ne retient pas** un système de double-buffer glissant
  complexe ;
- elle retient une solution plus simple :
  - fenêtre de rendu élargie ;
  - zone stable ;
  - pan preview par translation visuelle ;
  - reconstruction exacte seulement quand elle devient nécessaire.

## 1. Vue visible et recherche locale des clips

Le premier principe est :

```math
ne jamais parcourir tous les clips si seule une sous-fenêtre est visible
```

Chaque piste contient une séquence triée de clips. On ne s'intéresse qu'aux
clips dont l'intervalle temporel intersecte une fenêtre temporelle.

La recherche naïve serait :

```math
VisibleClips(track, view) = { clip ∈ track.clips | clip intersecte view }
```

avec un coût `O(n)`.

La version retenue utilise :

- une recherche dichotomique du premier clip visible ;
- puis une extension locale jusqu'au dernier clip visible ;
- ou, quand c'est possible, un cache incrémental `[first, last]`.

Voir [VISIBLECLIPSSPEC.md](/Users/yannorlarey/Documents/Install/webdaw/VISIBLECLIPSSPEC.md).

## 2. Fenêtre de rendu élargie et zone stable

La vue réelle ne suffit pas pour obtenir un pan fluide.

Si l'on ne rend que :

```math
V = [viewStart, viewEnd)
```

alors un petit pan à gauche ou à droite fait immédiatement entrer et sortir des
clips et des labels au bord du viewport.

La version retenue introduit deux zones dérivées :

- une **fenêtre de rendu** `R`, plus large que la vue réelle ;
- une **zone stable** `S`, incluse dans `R`.

Schématiquement :

```math
V ⊂ S ⊂ R
```

Le principe est :

- tant que `V` reste dans `S`, on garde la même fournée DOM ;
- quand `V` sort de `S`, on reconstruit une nouvelle fenêtre rendue `R'` et une
  nouvelle zone stable `S'`.

Cette hystérésis évite que de petits allers-retours fassent entrer et sortir
inutilement les mêmes clips et les mêmes labels.

Les deux paramètres utiles sont :

- `renderMarginFactor` : élargissement de `R` par rapport à `V` ;
- `stableFactor` : largeur relative de `S` à l'intérieur de `R`.

## 3. Même mécanisme pour clips, règle et grille

Une version incohérente consisterait à bufferiser les clips, mais pas la règle.
Dans ce cas :

- les clips peuvent déjà être prêts au bord ;
- les labels de règle apparaissent plus tard ;
- le pan paraît asymétrique.

La version retenue applique le même principe à toutes les couches temporelles
utiles au pan :

- clips ;
- géométrie temporelle partagée.

La règle n'est plus une seconde géométrie indépendante. Elle est dérivée de la
géométrie temporelle partagée :

- mêmes blocs primaires ;
- mêmes divisions secondaires et tertiaires ;
- masquage visuel spécifique à la zone de règle ;
- labels primaires recyclés avec ces blocs.

Autrement dit :

- les clips sont rendus sur leur fenêtre utile ;
- la structure temporelle fixe est rendue sur sa propre fenêtre utile ;
- ces couches sont réutilisées tant que le viewport reste dans leurs zones
  stables respectives.

## 4. Cache incrémental des plages visibles

Quand la vue se translate ou zoome légèrement, la plage visible d'une piste
change peu.

La version naïve recalculerait à chaque frame :

```math
FindVisibleClipRange(track, newView)
```

à partir de zéro.

La version retenue conserve, par piste :

```math
CachedVisibleRange ::= (
  clipsRef,
  viewStart,
  viewEnd,
  first,
  last
)
```

Puis ajuste localement `first` et `last` tant que la piste n'a pas changé.

Le coût devient alors proche de :

```math
O(δ)
```

où `δ` est le nombre de clips qui entrent ou sortent réellement de la vue.

## 5. Réutilisation des nœuds DOM

La version naïve reconstruit les clips visibles par :

```math
clipsLayer.innerHTML ← HTML(clips visibles)
```

Cette approche force :

- le parsing HTML ;
- la destruction des anciens nœuds ;
- la création de nouveaux nœuds ;
- un travail de layout et de paint inutile.

La version retenue associe un nœud DOM stable à chaque `clipId` visible :

```math
RenderedClipElements : ClipId → HTMLElement
```

Ainsi :

- un clip entrant crée un nœud ;
- un clip sortant détruit un nœud ;
- un clip toujours visible réutilise son nœud ;
- seules ses propriétés utiles sont mises à jour.

## 6. Diff DOM au lieu de reconstruction complète

Même avec réutilisation des nœuds, il serait encore naïf de faire :

```math
replaceChildren(tous les clips visibles)
```

à chaque frame.

La version retenue fait un diff minimal :

- suppression des clips qui quittent la fenêtre rendue ;
- création des clips qui y entrent ;
- réordonnancement seulement si nécessaire ;
- mutation locale des nœuds déjà présents.

Le principe est :

```math
DOMCost ≈ nombre de nœuds réellement ajoutés, retirés ou déplacés
```

## 7. Séparation entre rendu complet et rendu interactif

Tous les rendus n'ont pas le même coût acceptable.

Nous distinguons :

### Rendu complet

Utilisé pour :

- fin de drag ;
- transitions métier ;
- changement structurel du projet ;
- rendu initial ;
- resize important.

Il peut mettre à jour :

- la règle ;
- la grille ;
- les clips ;
- le curseur ;
- les panneaux annexes ;
- les logs ;
- le résumé.

### Rendu interactif léger

Utilisé pour :

- pan ;
- zoom ;
- drag du curseur ;
- drag de clip ;
- auto-scroll ;
- mise à jour du seul indicateur de geste.

Il doit être limité au strict nécessaire.

La règle est :

```math
hot path ≠ full UI render
```

## 8. Pan preview par translation de couches

Pendant un pan, il est trop coûteux de recalculer immédiatement la géométrie
de tous les clips et de toute la structure temporelle fixe.

La version retenue applique d'abord un **pan preview** purement visuel :

```math
translateX(previewOffsetPx)
```

sur les couches temporelles :

- couche temporelle partagée ;
- couche des clips ;
- overlay de drag ;
- curseur ;
- poignée du curseur.

Le viewport logique n'est committé qu'à intervalles réguliers.

Cette technique permet :

- une réponse immédiate au geste ;
- un amortissement des recalculs exacts ;
- une continuité visuelle pendant le pan.

Le pan preview se combine avec l'offset de base de la fenêtre rendue.

## 9. Fusion de la règle dans la géométrie partagée

La version actuelle ne rend plus la règle comme une couche géométrique séparée.

Le principe retenu est :

```math
RuleGeometry = SharedTimeGeometry + Mask + Labels
```

où :

- `SharedTimeGeometry` fournit les blocs primaires et leurs subdivisions ;
- `Mask` coupe visuellement la hauteur utile des secondaires et tertiaires dans
  la zone règle ;
- `Labels` sont recyclés avec les blocs primaires.

Donc :

- `ruler.dom` doit tendre vers `0` dans les mesures de rebuild géométrique ;
- le coût de commit géométrique fixe doit se concentrer dans
  `sharedGrid.dom`.

Cette fusion est importante parce qu'elle évite de maintenir deux DOM
géométriques distincts pour des objets temporels identiques.

## 10. Invalidation géométrique explicite

La seule stabilité de `R` ne suffit pas.

Si la projection en pixels change, alors il faut reconstruire même si la
fenêtre temporelle rendue reste identique.

Exemples :

- zoom ;
- resize de la grille ;
- rendu complet forcé après un drop.

La version retenue invalide donc la géométrie rendue dès que changent :

- `renderStartCoord`
- `renderEndCoord`
- `pixelsPerCoord`
- `gridWidthPx`

Cela évite un bug du type :

```math
la partition semble translater pendant le zoom puis se recale au relâchement
```

De même, un `render()` complet invalide explicitement les caches géométriques,
afin de rétablir une structure DOM exacte après les interactions temporaires.

## 11. Isolation du clip dragué dans un overlay

Cette technique est essentielle.

### Symptôme

Quand un clip est déplacé au-dessus d'une zone dense, le drag devient plus
lent que lorsqu'il est déplacé au-dessus d'une zone vide.

### Interprétation

Ce symptôme montre que le coût dépend de ce qui se trouve **sous** le clip.
La cause n'est donc pas principalement le calcul de ses coordonnées, mais la
composition visuelle de la couche.

### Version naïve

Le clip dragué reste dans la même couche que les autres clips :

```math
clipsLayer = tous les clips visibles, y compris le clip dragué
```

Le navigateur doit alors recomposer la zone où le clip se déplace, avec tous
les clips sous-jacents.

### Version retenue

On extrait temporairement le clip dragué de la couche normale et on le rend
dans une couche dédiée :

```math
dragOverlayLayer = couche DOM séparée, au-dessus des clips normaux
```

Ainsi :

- les clips de fond restent statiques ;
- le clip dragué est seul dans sa couche ;
- son déplacement dépend beaucoup moins de la densité de clips située en dessous.

## 12. Découplage entre modèle global et caches de vue

Le domaine reste immutable : des opérations comme `seek`, `play`, `stop` ou
`tick` produisent un nouveau `Project`.

Mais cela ne signifie pas que les caches de vue des clips doivent être
invalidés à chaque changement d'identité du projet.

La version naïve indexerait ses caches sur :

```math
Project
```

et les reconstruirait donc dès que le curseur ou le transport change.

La version retenue fait dépendre les caches de clips seulement de la structure
pertinente :

- `project.timeline.tracks`
- `track.clips`
- `timebase.internalTimeRate`

Donc :

- un `seek` ne doit pas invalider l'index des clips ;
- un `tick` ne doit pas invalider la plage visible des clips ;
- seuls les changements structurels des pistes ou de la base temporelle doivent
  invalider ces caches.

Il s'agit d'une séparation importante entre :

- le **modèle global du projet** ;
- la **vue dérivée des clips**.

## 13. Cache de géométrie pendant les gestes

Pendant un geste, la version naïve relit à chaque mouvement :

- `getBoundingClientRect()`
- la largeur de grille
- la hauteur de grille
- la position de la grille

Or ces valeurs ne changent pas pendant un drag sans resize.

La version retenue capture au début du geste :

```math
GestureGeometry ::= (
  gridLeftPx,
  gridRightPx,
  gridTopPx,
  gridWidthPx,
  gridHeightPx
)
```

et réutilise ces valeurs tant que le geste dure.

On évite ainsi des lectures répétées de layout dans le chemin chaud.

## 14. Cache du magnétisme

Le magnétisme dépend de :

- la largeur visible ;
- la durée visible ;
- la résolution temporelle ;
- l'échelle de graduations choisie.

Pendant un drag sans pan ni zoom, ces éléments sont constants.

La version naïve recalculerait à chaque `pointermove` :

- l'échelle visible ;
- la tertiaire ;
- les pas de magnétisme.

La version retenue mémorise cette géométrie de snap tant que :

```math
widthPx,
spanCoord,
internalTimeRate
```

ne changent pas.

## 15. Désactivation des panneaux lourds

Un panneau de debug comme :

```math
JSON.stringify(project)
```

peut devenir très coûteux quand le projet contient des milliers de clips.

Dans un contexte de test de charge, la version retenue doit :

- désactiver ce rendu ;
- ou le déclencher seulement à la demande.

La console d'état ne doit jamais pénaliser le pan, le zoom ou le drag.

## 16. Mesure du pan steady-state

Pour l'UX, le coût le plus important n'est pas celui du `pointerdown` ni celui
du `pointerup`, mais celui de la phase continue du pan pendant laquelle
l'utilisateur garde le bouton enfoncé et déplace la souris.

La mesure retenue côté navigateur doit donc isoler :

- le coeur du geste ;
- hors verrou initial du geste ;
- hors relâchement final et hors settle.

Le benchmark Playwright stabilisé fait exactement cela :

- il amorce le pan par quelques pas initiaux ;
- il remet ensuite les compteurs de perf à zéro ;
- il mesure seulement la portion centrale du drag ;
- il prend un snapshot avant le `pointerup`.

Cette distinction est essentielle :

- les coûts de commit géométrique ponctuels existent toujours ;
- mais le coût UX perçu pendant le pan steady-state dépend surtout de ce qui
  est encore muté ou repainté pendant cette phase centrale.

Dans l'état actuel :

- les coûts de géométrie fixe appartiennent surtout aux rebuilds ;
- le surcoût steady-state d'une partition dense par rapport au vide provient
  principalement des clips visibles.

## 17. Ce qui reste naturellement coûteux

Même avec ces optimisations, certains coûts restent légitimes.

### Zoom out extrême

Si le zoom out rend visibles un très grand nombre de clips, alors le coût du
rendu augmente naturellement, car il y a réellement plus d'objets visibles.

### Changements structurels

Un drop qui réorganise une piste ou décale de nombreux clips peut nécessiter :

- un nouveau calcul des plages visibles ;
- un nouveau diff DOM ;
- des mutations sur beaucoup de clips.

Cela est normal, car le projet lui-même a changé.

### Coût de paint des clips

Même avec un DOM raisonnablement optimisé, des clips visuellement riches
(dégradés, bordures, ombres, trames) gardent un coût de paint non nul quand un
grand nombre d'entre eux sont visibles simultanément.

## Résumé : naïf vs retenu

### Naïf

- parcourir tous les clips ;
- recalculer les indices visibles à chaque frame depuis zéro ;
- reconstruire tout le HTML des clips ;
- reconstruire la règle et la grille dès le moindre mouvement ;
- maintenir une géométrie de règle séparée de la géométrie temporelle partagée ;
- laisser le clip dragué dans la même couche que les autres ;
- invalider les caches à chaque nouveau `Project` ;
- relire la géométrie à chaque `pointermove`.

### Retenu

- ne travailler que sur une fenêtre temporelle utile ;
- élargir cette fenêtre en une fenêtre rendue `R` avec zone stable `S` ;
- appliquer ce mécanisme aux clips et à la géométrie temporelle partagée ;
- fusionner la règle dans cette géométrie via masques et labels recyclés ;
- maintenir un cache de plages visibles par piste ;
- réutiliser les nœuds DOM ;
- faire un diff DOM incrémental ;
- séparer rendu complet et rendu interactif ;
- translater les couches pendant le pan avant de committer le viewport ;
- invalider le rendu quand la géométrie pixel change réellement ;
- isoler le clip dragué dans un overlay ;
- découpler les caches de vue des clips de l'identité globale du projet ;
- mettre en cache la géométrie des gestes et le magnétisme ;
- désactiver les panneaux annexes coûteux.

## Principe final

Le principe général de ce document peut se résumer ainsi :

```math
Le coût du rendu doit dépendre de la vue courante et des objets réellement
modifiés, pas de la taille totale du projet.
```

En version DOM, cela signifie :

- moins de parcours globaux ;
- moins de recréations de nœuds ;
- moins de lectures de layout ;
- moins de repaints évitables ;
- plus d'isolation des objets interactifs ;
- plus d'hystérésis contrôlée dans la gestion des fenêtres rendues.
