# Nouvelle Spécification du Rendu Rapide de la Timeline

## Objet du document

Ce document décrit une nouvelle architecture de rendu pour le **pan horizontal
de la timeline rasterisée**.

Il ne remplace pas encore l'ensemble de [FASTRENDERINGSPEC.md](/Users/yannorlarey/Documents/Install/webdaw/FASTRENDERINGSPEC.md).
Il formalise une stratégie plus spécifique, destinée à remplacer la logique
actuelle de grande fenêtre rendue puis reconstruite périodiquement.

Le principe central est le suivant :

- le pan ne doit pas dépendre d'une reconstruction périodique de toute la
  géométrie visible ;
- le pan doit rester visuellement continu par **simple translation** ;
- le fond de la timeline doit être alimenté par **buffers glissants** remplis
  par blocs entiers de divisions primaires.

## Problème

L'approche actuelle reconstruit encore trop souvent le contenu temporel partagé
pendant le pan :

- règle ;
- grille ;
- waveforms ;
- clips non dragués ;
- labels associés.

Même si le coût JavaScript mesuré reste faible, ces reconstructions suffisent à
produire des blocages visibles sur grandes largeurs.

Le problème n'est donc pas seulement "calculer plus vite", mais **changer le
modèle de rendu** pour que le pan steady-state n'ait presque jamais besoin de
reconstruire le fond temporel.

## But

Pendant le pan horizontal steady-state, nous voulons approcher le comportement
suivant :

```text
Coût par frame ≈ translation visuelle des buffers déjà prêts
```

et non :

```text
Coût par frame ≈ décision de rebuild + reconstruction d'une nouvelle fenêtre
```

En particulier :

- le contenu déjà rasterisé doit rester utilisable pendant plusieurs frames ;
- la production de nouveau contenu doit se faire par blocs utiles et non par
  reconstruction globale ;
- le changement de rôle des buffers doit être rare, prévisible et discret ;
- le drag d'un ou plusieurs clips doit rester compatible avec ce pan continu ;
- la logique doit rester compatible avec [EXACTZOOMSPEC.md](/Users/yannorlarey/Documents/Install/webdaw/EXACTZOOMSPEC.md).

## Portée

Cette spécification concerne le rendu de la timeline en deux couches :

- une **couche de fond** rasterisée ;
- une **couche de drag** séparée.

La couche de fond contient :

- la règle ;
- la grille temporelle ;
- les waveforms ;
- les clips non dragués.

La couche de drag contient :

- la sélection actuellement draguée ;
- rien d'autre.

Les panneaux annexes ne sont pas traités ici.

## Hypothèse fondamentale

La timeline visible ne doit pas être pensée comme une suite de reconstructions
complètes, mais comme une suite de **buffers raster glissants**.

La granularité d'organisation du fond est la **division primaire**.

Autrement dit, pour un niveau de zoom donné :

- la forme graphique interne d'une division primaire est stable ;
- les subdivisions secondaires et tertiaires à l'intérieur de cette division
  sont déterministes ;
- les clips et waveforms qui tombent dans cette division peuvent être rendus au
  bon endroit à l'intérieur d'un buffer ;
- un même mécanisme de buffering peut donc servir à toute la couche de fond.

Les labels principaux ne suivent pas cette répétition simple, car leur texte
dépend de la position absolue sur la timeline.

Ils sont donc traités séparément via le DOM.

Les labels secondaires, en revanche, restent dans le raster de la division
primaire.

Le raster périodique actuellement utilisé pour une division primaire est
conservé comme noyau graphique de base.

La nouvelle architecture ne remet donc pas en cause :

- le contenu graphique interne de la division primaire ;
- les subdivisions secondaires et tertiaires ;
- les labels secondaires déjà intégrés à ce raster.

Elle remet en cause seulement :

- l'organisation des buffers ;
- la logique de pan ;
- la logique de remplissage et de rotation.

## Modèle retenu

Le rendu repose sur cinq objets logiques :

1. une **couche de fond** rasterisée ;
2. trois **buffers raster** de même taille, notés `A`, `B`, `C` ;
3. une logique de remplissage du fond par divisions primaires ;
4. une couche DOM pour les **labels principaux** ;
5. une **couche de drag** séparée, translatée au-dessus du fond.

## Couche de fond

La couche de fond contient tout ce qui ne fait pas partie d'un drag actif :

- grille primaire ;
- subdivisions secondaires et tertiaires ;
- waveforms ;
- clips non dragués, y compris les clips sélectionnés tant qu'ils ne sont pas
  en cours de drag ;
- éventuels labels secondaires répétés.

Pendant le pan :

- cette couche se translate de façon continue ;
- son contenu n'est rerendu que quand de nouvelles divisions doivent entrer dans
  les buffers.

## États visuels de sélection

La timeline doit distinguer explicitement trois états visuels de clip :

1. clip non sélectionné ;
2. clip sélectionné mais immobile ;
3. clip sélectionné et en cours de drag.

Les clips dans l'état `2` restent dans la couche de fond.

Ils doivent y être rendus avec leur apparence propre de sélection, en
particulier :

- un bord spécifique ;
- et plus généralement tout style visuel indiquant l'état sélectionné.

Les clips dans l'état `3` quittent la couche de fond pour être rendus dans la
couche de drag.

Cette distinction est essentielle :

- la sélection n'implique pas en elle-même une couche séparée ;
- seul le drag de la sélection justifie son extraction dans une couche dédiée.

## Modèle d'état des clips

L'état visuel à trois valeurs ne doit pas être stocké comme champ persistant
des clips.

Le modèle retenu distingue explicitement :

1. l'état métier des clips dans les pistes ;
2. l'état de sélection de l'interface ;
3. l'état transitoire de drag ;
4. l'état visuel dérivé au moment du rendu.

Autrement dit :

- les clips restent des objets stables de la timeline ;
- la sélection est stockée séparément ;
- le drag est stocké séparément ;
- l'état `non sélectionné / sélectionné immobile / sélectionné en drag` est
  déduit à partir de ces informations.

Cette séparation a une conséquence importante :

- pendant le drag, on ne modifie pas réellement les pistes ;
- on ne modifie que des structures transitoires de preview ;
- la mutation effective des clips dans les pistes n'a lieu qu'au `drop`.

Le rendu raster et la couche de drag doivent donc être compris comme des
projections visuelles d'un état métier encore inchangé pendant le geste.

## Division primaire et remplissage

Le fond est rempli à la granularité de la division primaire.

Concrètement, "rendre une division primaire" signifie :

- tracer la règle et la grille de cette division primaire ;
- tracer les rectangles des clips appartenant à la couche de fond qui traversent
  cette division, en les clippant aux bornes de la division ;
- tracer les waveforms correspondantes, elles aussi clippées aux bornes de la
  division ;
- effectuer ce rendu d'un seul tenant dans le bon buffer et au bon offset.

La décision retenue est donc :

- le remplissage se fait par **blocs alignés sur les divisions primaires** ;
- chaque division primaire est rendue **en une seule opération logique de
  rasterisation** ;
- jamais par reconstruction arbitraire d'une grande fenêtre entière.

Cette décision implique qu'un clip ou une waveform traversant plusieurs
divisions primaires est rasterisé par morceaux, un morceau par division.

Ce comportement n'est pas un défaut ; il est au contraire la conséquence normale
du choix de la division primaire comme unité canonique de rendu.

## Buffers glissants

On utilise exactement **trois buffers de fond** `A`, `B`, `C`.

Chaque buffer a une largeur correspondant à un nombre entier `P` de divisions
primaires.

`P` est défini comme le plus petit entier tel que :

```text
P × Dx >= viewportWidth
```

où :

- `Dx` est la largeur en pixels d'une division primaire ;
- `viewportWidth` est la largeur utile de la vue.

Cette définition garantit que :

- un buffer couvre à lui seul au moins toute la largeur utile de la vue ;
- deux buffers suffisent donc toujours à couvrir entièrement la zone visible ;
- le troisième buffer peut être préparé hors champ.

Autrement dit :

```text
bufferWidth = P × primaryDivisionWidth
```

avec `P ∈ N` et :

```text
bufferWidth >= viewportWidth
```

## Invariants

À tout instant :

1. au plus **deux buffers de fond** sont visuellement nécessaires pour couvrir
   la vue ;
2. le troisième buffer de fond est soit hors champ, soit en cours de
   préparation ;
3. chaque buffer commence et finit sur une frontière entière de division
   primaire ;
4. la translation visible peut être quelconque à la frame près, mais le
   **remplissage** des buffers ne se fait qu'à la granularité de la division
   primaire ;
5. le contenu raster d'un buffer n'est jamais partiellement invalide sur une
   division primaire.

## Rôle des trois buffers

À un instant donné :

- deux buffers sont dans la chaîne visible ;
- un buffer est en réserve.

Exemple conceptuel :

```text
[buffer gauche visible] [buffer droit visible] [buffer réserve]
```

ou symétriquement selon le sens du pan.

Les buffers changent périodiquement de rôle :

- visible gauche ;
- visible droit ;
- réserve.

Ce changement de rôle ne se produit qu'après avoir parcouru `P` divisions
primaires.

## Pan steady-state

Pendant le pan steady-state du fond :

- on ne reconstruit pas le fond visible complet ;
- on applique une simple translation aux deux buffers visibles ;
- on suit l'avancement du pan en divisions primaires entières.

Tant que le déplacement reste à l'intérieur du contenu déjà disponible dans les
deux buffers visibles, aucune reconstruction géométrique globale n'est
autorisée.

## Phases du pan

Le pan doit être spécifié comme une succession de phases distinctes.

### 1. Entrée en pan

Au début du geste :

- l'état courant des trois buffers est figé comme point de départ ;
- deux buffers sont déjà visibles ;
- un buffer est déjà en réserve ;
- la translation visuelle du fond est initialisée à `0`.

Cette phase ne doit pas déclencher de reconstruction globale si les buffers
courants sont déjà valides pour le zoom actif.

### 2. Frame normale de pan

À une frame normale de pan :

- on calcule la nouvelle translation visuelle continue ;
- on translate les buffers visibles ;
- on translate aussi la couche DOM des labels principaux ;
- aucune division primaire nouvelle n'est rendue tant qu'aucune frontière
  primaire supplémentaire n'a été franchie.

Autrement dit, tant que le pan reste dans le contenu déjà prêt, une frame de
pan est une pure opération de transform.

### 3. Franchissement d'une frontière primaire

Dès que le pan cumulé franchit une division primaire entière :

- on détermine quelle nouvelle division primaire doit apparaître dans le futur
  champ visible ;
- on la rend dans le buffer de réserve au bon offset ;
- on incrémente l'état logique du pan en nombre entier de divisions primaires
  franchies.

Cette opération ne dépend donc pas d'un seuil arbitraire en pixels, mais du
franchissement exact d'une division primaire.

### 4. Épuisement d'un buffer visible

Quand un buffer visible est entièrement sorti du domaine utile :

- les rôles des buffers changent ;
- le second buffer visible devient le premier ;
- le buffer de réserve devient visible ;
- le buffer sorti redevient le nouveau buffer de réserve.

Cette permutation doit être discrète au niveau logique, mais sans rupture
visuelle au niveau du pan.

### 5. Fin de pan

À la fin du geste :

- la translation visuelle instantanée devient le nouvel état stabilisé ;
- les trois buffers restent dans leur dernier rôle ;
- aucun rebuild global n'est nécessaire si l'état final des buffers est déjà
  cohérent.

Autrement dit, la fin du pan ne doit pas être pensée comme un moment normal de
"rattrapage", mais simplement comme l'arrêt d'un mécanisme continu.

## Rendu durant le pan

Le comportement de rendu pendant le pan peut donc être résumé ainsi :

1. à chaque frame : translation visuelle continue ;
2. à chaque division primaire franchie : rendu d'une nouvelle division dans le
   buffer de réserve ;
3. à chaque `P` divisions primaires franchies : permutation des rôles des
   buffers ;

## Playback-Follow

Le `playback-follow` doit réutiliser le même pipeline que le pan horizontal.

Conceptuellement, la seule différence est la source du mouvement :

- pendant le pan, le décalage est piloté par le geste de l'utilisateur ;
- pendant le playback-follow, le décalage est piloté par l'horloge audio et la
  position du curseur.

Cela implique explicitement que, pendant le playback-follow :

- on applique d'abord une translation visuelle continue du décor ;
- on ne modifie l'état canonique de la vue que par commits discrets ;
- on réutilise les mêmes seuils de headroom et les mêmes permutations de
  buffers que pendant le pan ;
- on ne reconstruit pas la géométrie complète du viewport à chaque frame.
4. jamais : reconstruction complète de toute la fenêtre visible.

Cette propriété constitue le coeur de l'architecture.

## Remplissage progressif

Le buffer de réserve est rempli progressivement par divisions primaires entières.

Le remplissage utile ne change que lorsqu'une nouvelle division primaire doit
apparaître dans le futur champ visible.

Donc, conceptuellement :

- tant qu'on n'a pas franchi une division primaire supplémentaire, il n'y a
  rien de nouveau à rasteriser ;
- quand une division primaire supplémentaire est franchie, on ajoute une
  nouvelle division primaire au bon endroit dans le troisième buffer.

On évite ainsi de raisonner en pixels arbitraires pour la préparation du futur
contenu.

## Rotation des buffers

L'expression "tous les `P` pas primaires" doit être comprise relativement à
l'alignement courant des buffers, et non comme un compteur libre sans repère.

Chaque buffer couvre toujours un intervalle exact de `P` divisions primaires :

```text
[bufferStartPrimaryIndex, bufferStartPrimaryIndex + P[
```

La permutation se produit exactement lorsqu'une frontière de buffer est
franchie.

Autrement dit :

- en pan vers la droite, le buffer visible de gauche cesse d'être visible quand
  l'indice de la première division primaire utile de la vue devient supérieur ou
  égal à `bufferStartPrimaryIndex + P` ;
- en pan vers la gauche, le cas symétrique s'applique au buffer visible de
  droite.

Exemple en pan vers la droite :

1. `A` et `B` sont visibles, `C` est en réserve ;
2. `C` est préparé pour devenir le prochain buffer à droite ;
3. quand la vue franchit la frontière séparant `A` et `B`, la chaîne devient
   `B`, `C` ;
4. `A` redevient le buffer de réserve à remplir.

Le cas symétrique vaut pour le pan vers la gauche.

## Couche de drag

Le drag d'un ou plusieurs clips ne doit pas casser la continuité du fond.

On introduit donc une seconde couche raster indépendante :

- la **couche de drag** ;
- placée visuellement au-dessus du fond ;
- contenant uniquement les clips sélectionnés en cours de drag.

Cette couche a les propriétés suivantes :

1. son contenu local reste stable pendant le geste ;
2. son `transform` change en continu pendant le drag ;
3. le pan du fond peut continuer indépendamment ;
4. la couche de drag n'a pas besoin de rerasteriser à chaque frame.

Autrement dit :

- le fond pan ;
- la couche de drag se translate par-dessus ;
- le geste de drag est la composition de ces deux mouvements.

Le passage d'un clip sélectionné de la couche de fond vers la couche de drag se
fait au début du drag.

Symétriquement, à la fin du drag :

- les clips concernés quittent la couche de drag ;
- ils réintègrent la couche de fond ;
- ils conservent leur apparence de sélection, mais redeviennent des éléments
  appartenant au fond raster.

## Taille de la couche de drag

La couche de drag ne doit pas être dimensionnée par une largeur fixe arbitraire.

Les **bornes de sélection** sont la boîte exacte de la sélection :

- horizontalement : plus petit début et plus grande fin ;
- verticalement : première piste touchée et dernière piste touchée.

Le calcul de la couche de drag se fait à partir de trois éléments :

- les bornes de sélection ;
- la vue courante ;
- le point de départ du drag `(x, y)`.

On note :

- `viewStart` et `viewEnd` les bornes temporelles de la vue au début du drag ;
- `viewWidth = viewEnd - viewStart` ;
- `grabTime` la coordonnée temporelle exacte du point de départ du drag.

La **partie potentiellement visible de la sélection** est définie, dans le
repère temporel de la sélection au début du drag, par l'intervalle :

```text
visibleDragRegionStart = grabTime - viewWidth
visibleDragRegionEnd   = grabTime + viewWidth
```

Autrement dit, on prépare au maximum une largeur de `2 × viewWidth`, centrée
sur la coordonnée temporelle attrapée.

Cette partie est la zone effectivement rasterisée dans la couche de drag.

En horizontal, sa borne gauche et sa borne droite sont obtenues par clipping :

```text
dragRasterStart = max(selectionBoundsStart, visibleDragRegionStart)
dragRasterEnd   = min(selectionBoundsEnd,   visibleDragRegionEnd)
```

Cette formule donne la zone optimale à rasteriser.

Elle évite :

- de rasteriser toute la largeur d'un écran 4K quand la sélection utile est
  petite ;
- de rasteriser toute la largeur logique d'un clip très long quand seule une
  partie de ce clip peut devenir visible pendant le drag.

Tous les objets de la sélection sont rendus dans cette zone rasterisée, en
étant clippés par ses bords.

Cette couche est ensuite translatée au-dessus de la vue, pendant qu'en dessous
le fond peut continuer à paner, y compris en auto-pan.

Cette zone de drag reste figée tant que la partie réellement visible de la
sélection reste à l'intérieur du raster préparé.

Si le geste ou l'auto-pan amène la partie visible au contact d'un bord du
raster de drag, la couche de drag est rerasterisée exceptionnellement en
recalculant `visibleDragRegionStart` et `visibleDragRegionEnd` à partir de la
vue et de la coordonnée temporelle courantes.

Le même raisonnement vaut en vertical si le drag multi-pistes autorise une
excursion verticale significative.

Dans le cas du drag de clips sur plusieurs pistes, la dimension verticale de la
couche de drag est définie à partir des bornes de sélection :

- son bord haut est le haut de la première piste contenant un clip de la
  sélection ;
- son bord bas est le bas de la dernière piste contenant un clip de la
  sélection.

Autrement dit, en vertical, la couche de drag couvre exactement l'enveloppe des
pistes touchées par la sélection.

## Labels principaux

Les labels principaux ne doivent pas être peints dans les pixmaps répétées.

Ils doivent rester une couche DOM séparée, pour trois raisons :

1. leur texte dépend du temps absolu ;
2. leur densité utile dépend de la lisibilité réelle ;
3. leur repositionnement est moins coûteux à raisonner séparément que de les
   fusionner avec le raster répétitif.

La règle temporelle se décompose donc en deux sous-couches :

- raster répétitif des subdivisions ;
- DOM des labels principaux.

Le cycle de vie des labels principaux suit la même logique discrète que celle
des divisions primaires :

1. à une frame normale de pan, on translate simplement leur conteneur DOM ;
2. lorsqu'une nouvelle division primaire est ajoutée dans le buffer de réserve,
   le label principal correspondant est créé ou recyclé ;
3. lorsqu'un buffer sort du domaine utile, les labels principaux associés à ses
   divisions sont retirés ou recyclés ;
4. le pan ne doit jamais reconstruire en bloc tous les labels principaux à
   chaque frame.

## Relation avec le zoom

Cette architecture n'est valide que si la largeur d'une division primaire est
géométriquement stable et exacte au niveau du zoom courant.

Elle dépend donc directement de [EXACTZOOMSPEC.md](/Users/yannorlarey/Documents/Install/webdaw/EXACTZOOMSPEC.md).

Pour chaque niveau de zoom discret :

- la largeur d'une division primaire en pixels est déterministe ;
- `P` peut être choisi comme entier ;
- les buffers peuvent être alignés exactement sur les frontières primaires.

L'avantage important de cette approche est le suivant :

- pour un zoom donné, une division primaire correspond à un nombre entier de
  pixels ;
- pour ce même zoom, elle correspond aussi à un nombre entier de samples ;
- le rendu par divisions primaires conserve donc naturellement l'alignement
  entre grille, clips et waveforms.

Dans les niveaux de zoom grossiers où la waveform est rendue en mode enveloppe :

- `1 pixel horizontal = N samples` avec `N ∈ N` ;
- la pyramide waveform contient alors un niveau exact de bucket de taille `N` ;
- chaque pixel horizontal correspond donc exactement à un bucket de cette
  pyramide.

Dans les niveaux de zoom fins :

- la waveform n'est plus rendue par buckets de pyramide ;
- elle est rendue directement depuis les samples ;
- mais elle reste alignée sur la même géométrie exacte en pixels et en samples.

En cas de changement de zoom :

- les trois buffers de fond doivent être réinitialisés ;
- la couche de drag doit être rerasterisée si un drag est actif ;
- les offsets de pan relatifs à l'ancien zoom ne sont plus réutilisables tels
  quels.

## Subprimary de rendu

Quand une division primaire devient trop large en pixels pour rester une bonne
unité de raster, la granularité de rendu ne doit plus être la primaire entière,
mais une subdivision exacte de celle-ci.

On introduit alors une `subprimary` :

- la `primary` reste l'unité logique du zoom exact ;
- la `subprimary` devient l'unité pratique de raster et de buffering ;
- cette subdivision n'altère pas la signification temporelle de la `primary`.

La règle de choix est la suivante :

- si `primaryWidthPx <= primaryWidthLimit`, alors `k = 1` ;
- sinon on choisit le plus petit entier `k >= 2` tel que :
  - `primaryWidthPx / k <= primaryWidthLimit`
  - `primaryWidthPx / k` soit un multiple entier de `secondaryWidthPx`

Autrement dit :

```text
primaryWidthPx = (k × n) × secondaryWidthPx
subprimaryWidthPx = primaryWidthPx / k = n × secondaryWidthPx
```

Conséquences :

- les frontières de `subprimary` tombent exactement sur des frontières
  secondaires ;
- `subprimaryWidthPx` reste entier ;
- `subprimaryStepSamples = primaryStepSamples / k` reste entier ;
- les buffers glissants peuvent être alignés exactement sur ces nouvelles
  frontières de rendu.

La `subprimary` doit être comprise comme une sous-unité de rendu, pas comme une
nouvelle unité UX.

Donc :

- les labels principaux restent attachés aux frontières de `primary` ;
- la répétition périodique du raster se fait par phase de `subprimary` ;
- pour une `primary` subdivisée en `k` morceaux, il existe `k` pixmaps
  canoniques de `subprimary`, indexées par `subprimaryIndex ∈ [0, k-1]`.

Les éléments raster qui traversent une frontière de `subprimary` doivent être
traités exactement comme les éléments qui traversent une frontière de `primary`
:

- ils sont dessinés dans chaque `subprimary` concernée ;
- ils sont clippés aux bornes de cette `subprimary`.

Cela concerne notamment :

- les labels secondaires dont l'emprise graphique chevauche une frontière
  interne ;
- les clips ;
- les waveforms.

Si aucun `k` aligné sur la secondaire n'existe, il faudrait en théorie descendre
à une subdivision exacte plus fine. Dans la table de zoom actuelle, ce cas ne
se produit jamais ; il est donc hors scope de cette spécification.

## Différence avec l'architecture actuelle

L'architecture actuelle repose sur :

- une grande fenêtre de rendu élargie ;
- une zone stable ;
- un rebuild quand la vue sort de cette zone.

La nouvelle architecture repose au contraire sur :

- une couche de fond raster glissante ;
- trois buffers de largeur fixe pour cette couche de fond ;
- une translation continue ;
- un remplissage incrémental du futur contenu ;
- une rotation discrète des rôles des buffers ;
- une couche de drag séparée.

Ce document propose donc un **changement d'architecture**, pas un simple
ajustement de seuils.

## Conséquence attendue

Si cette architecture est correctement implémentée, alors pendant le pan
steady-state :

- le nombre de rebuilds globaux doit tendre vers zéro ;
- le nombre de rendus utiles doit croître avec les divisions primaires
  réellement franchies ;
- le coût visuel perçu doit devenir essentiellement indépendant de la largeur
  4K, tant que deux buffers couvrent la vue ;
- le drag d'une sélection ne doit plus forcer la reconstruction continue du
  fond.

## État de la spec

Le document ne contient plus, à ce stade, de point conceptuel bloquant pour une
première implémentation.

Les détails restants relèvent surtout de l'organisation interne du code :

- représentation mémoire exacte des buffers ;
- stratégie de pooling des noeuds DOM des labels principaux ;
- politique de rerasterisation exceptionnelle de la couche de drag.

## Décision provisoire

La direction retenue pour la suite est :

- conserver [FASTRENDERINGSPEC.md](/Users/yannorlarey/Documents/Install/webdaw/FASTRENDERINGSPEC.md) comme description de l'approche actuelle ;
- utiliser ce document comme base de conception pour une **nouvelle
  implémentation** du pan de la couche de fond et de la couche de drag ;
- ne pas mélanger, dans le même texte, la logique actuelle de fenêtre élargie
  et la future logique de buffers glissants.
