# Spécification de la Graduation Temporelle de la Timeline

## Problème

Nous voulons définir un principe de représentation graphique du temps, à la
manière d'une règle, dans la timeline d'un DAW web.

On dispose :

- d'une largeur visible `P` exprimée en pixels ;
- d'une durée visible `D` exprimée en secondes ;
- d'un espace minimal `digit_space1` permettant de représenter lisiblement un
  chiffre dans un label primaire ;
- d'un espace minimal `digit_space2` permettant de représenter lisiblement un
  chiffre dans un label secondaire ;
- d'une marge horizontale minimale `margin` ;
- de deux polices de caractères :
  - une police primaire pour les labels des graduations primaires ;
  - une police secondaire, plus petite, pour les labels des graduations
    secondaires.

Le problème est de choisir une échelle temporelle aussi précise que possible
tout en restant lisible.

## But

Nous voulons définir une fonction :

```math
ChooseScale(P, D, digit_space1, digit_space2, margin) → Scale
```

où `Scale` est l'échelle temporelle la plus fine permettant d'afficher
lisiblement :

- les graduations primaires ;
- leurs labels absolus ;
- les graduations secondaires ;
- leurs labels relatifs.

Selon l'espace disponible, cette échelle peut aussi induire l'affichage de
graduations tertiaires sans label, destinées à enrichir la lecture visuelle de
la subdivision temporelle.

La règle temporelle et la grille de piste doivent utiliser exactement cette
même échelle.

## Représentation du temps

Pour éviter les erreurs d'arrondi liées aux nombres flottants, les coordonnées
temporelles utilisées par la timeline doivent être représentées en arithmétique
entière.

On introduit :

```math
SampleRate ∈ N
InternalTimeFactor ∈ N
InternalTimeRate = InternalTimeFactor × SampleRate
```

Les instants et durées de la timeline sont alors représentés en nombre entier
d'unités internes :

```math
TimeCoord ::= entier relatif
DurationCoord ::= entier strictement positif
```

avec l'interprétation :

```math
1 seconde = InternalTimeRate unités internes
1 sample = InternalTimeFactor unités internes
```

Les unités temporelles de la règle sont converties en coordonnées entières
comme suit :

```math
Hour         = 3600 × InternalTimeRate
Minute       = 60 × InternalTimeRate
Second       = InternalTimeRate
Tenth        = InternalTimeRate / 10
Centisecond  = InternalTimeRate / 100
Millisecond  = InternalTimeRate / 1000
```

Cette représentation n'est valide que si `InternalTimeRate` est divisible par
`1000` (pour que toutes les divisions requises soient exactes).

Le facteur `1000` provient du fait que la plus fine unité temporelle manipulée
par la règle est la milliseconde :

```math
1 seconde = 1000 millisecondes
```

Donc rendre la milliseconde exacte suffit aussi à rendre exacts :

- le dixième de seconde ;
- le centième de seconde ;
- la milliseconde.

### Calcul de `InternalTimeFactor`

`InternalTimeFactor` est le plus petit entier `n` tel que `SampleRate × n` soit
divisible par `1000` :

```math
InternalTimeFactor = 1000 / gcd(SampleRate, 1000)
```

Exemples :

| SampleRate | gcd(SR, 1000) | InternalTimeFactor | InternalTimeRate |
|------------|---------------|--------------------|------------------|
| 44100      | 100           | 10                 | 441000           |
| 48000      | 1000          | 1                  | 48000            |
| 22050      | 50            | 20                 | 441000           |
| 96000      | 1000          | 1                  | 96000            |

Par construction, cette définition garantit que :

```math
InternalTimeRate / 10
InternalTimeRate / 100
InternalTimeRate / 1000
```

sont des entiers.

Vérification pour `SampleRate = 44100` :

```math
InternalTimeRate = 441000
441000 / 10   = 44100   (dixième)
441000 / 100  = 4410    (centième)
441000 / 1000 = 441     (milliseconde)
```

sont entiers.

Reformulation : la timeline ne doit pas manipuler ses coordonnées internes en
secondes flottantes, mais en positions entières exprimées dans une résolution
interne plus fine que la fréquence d'échantillonnage. Cette résolution reste
calée sur la `SampleRate`, puisque chaque sample correspond à un nombre entier
d'unités internes. Les subdivisions `1/10`, `1/100` et `1/1000` seconde sont
elles aussi exactes par construction. Les conversions en secondes ou en labels
textuels ne sont faites qu'au moment de l'affichage.

## Couples candidats

Les couples candidats `(primaire, secondaire)` sont exactement :

```math
(heure, minute)
(minute, seconde)
(seconde, dixième)
(dixième, centième)
(centième, milliseconde)
```

L'unité secondaire est toujours l'unité immédiatement inférieure à l'unité
primaire.

Il n'existe pas d'unité primaire `milliseconde`.

## Regroupements autorisés

### Cas sexagésimaux

Pour les couples :

```math
(heure, minute)
(minute, seconde)
```

le nombre d'unités secondaires dans une unité primaire est `60`.

Les regroupements autorisés sont exactement :

```math
1, 5, 10, 15, 30
```

### Cas décimaux

Pour les couples :

```math
(seconde, dixième)
(dixième, centième)
(centième, milliseconde)
```

le nombre d'unités secondaires dans une unité primaire est `10`.

Les regroupements autorisés sont exactement :

```math
1, 2, 5
```

## Labels

### Labels primaires

Chaque graduation primaire porte un label absolu.

Les formats des labels primaires sont :

```math
heure      : hh:
minute     : hh:mm:
seconde    : hh:mm:ss
dixième    : hh:mm:ss.d
centième   : hh:mm:ss.cc
```

Les champs sont zéro-padés.

Exemples :

- `01:`
- `01:07:`
- `01:07:02`
- `01:07:02.9`
- `01:07:02.09`

### Labels secondaires

Chaque graduation secondaire porte un label relatif exprimé dans l'unité
secondaire du couple courant.

Les labels secondaires vérifient les règles suivantes :

- si la base est `60`, les valeurs sont zéro-padées ;
- si la base est `10`, les valeurs ne sont pas zéro-padées ;
- la valeur `0` n'est jamais affichée comme secondaire, car elle coïncide avec
  une graduation primaire ;
- si un regroupement vaut `n`, le label secondaire affiché est la valeur
  secondaire réelle `n, 2n, 3n, ...`, et non un compteur ordinal.

Exemples :

- `(heure, minute)` avec regroupement `5` :
  `05, 10, 15, ..., 55`
- `(minute, seconde)` avec regroupement `10` :
  `10, 20, 30, 40, 50`
- `(seconde, dixième)` avec regroupement `2` :
  `2, 4, 6, 8`
- `(centième, milliseconde)` avec regroupement `5` :
  `5`

### Cohérence des labels

Le principe de composition est le suivant :

- le label primaire représente la partie haute de l'instant ;
- le label secondaire représente la partie basse de l'instant ;
- la concaténation logique du primaire et du secondaire donne une écriture
  temporelle correcte.

Exemple :

- primaire `01:07:02.`
- secondaire `9`

correspond à :

```math
01:07:02.9
```

## Lisibilité

On note `margin` une marge horizontale positive entre une graduation et le
début de son label.

Un label, primaire ou secondaire, est dessiné à droite de sa graduation.

On considère qu'un label est lisible si son bord droit est situé au moins à une
distance `2 × margin` de la graduation suivante du même niveau.

Il n'est pas nécessaire de tester les collisions :

- entre un primaire et un secondaire ;

car les labels primaires et secondaires sont portés sur deux lignes
verticalement distinctes.

En revanche, il faut tester :

- les collisions primaire contre primaire ;
- les collisions secondaire contre secondaire.

## Précision

Une échelle est plus précise qu'une autre :

- si son pas secondaire est plus fin ;
- à pas secondaire égal, si son regroupement est plus petit.

## Ordre de recherche

Pour choisir une échelle, on parcourt :

1. les couples du plus précis au moins précis ;
2. pour chaque couple, les regroupements du plus petit au plus grand ;
3. on retourne le premier candidat satisfaisant la contrainte de lisibilité
   des labels primaires et secondaires.

L'ordre des couples, du plus précis au moins précis, est :

```math
(centième, milliseconde)
(dixième, centième)
(seconde, dixième)
(minute, seconde)
(heure, minute)
```

## Graduations dérivées

### Visibilité

Une graduation est dite visible si :

- soit son trait est au moins partiellement visible ;
- soit son label est au moins partiellement visible.

Toutes les graduations visibles sont labellisées.

Si une graduation est visible mais que son label déborde hors de la fenêtre,
on affiche la partie visible du label.

### Superposition primaire / secondaire

Si une graduation primaire et une graduation secondaire coïncident :

- on dessine seulement la graduation primaire ;
- on n'affiche pas de label secondaire à cet endroit.

### Graduations tertiaires

En plus des graduations primaires et secondaires, la règle et la grille peuvent
afficher des graduations tertiaires.

Les graduations tertiaires :

- ne portent jamais de label ;
- sont dessinées plus courtes que les graduations secondaires ;
- sont utilisées uniquement pour enrichir la lecture visuelle de la subdivision
  du temps.

Leur détermination suit la règle suivante :

1. si l'unité secondaire visible est regroupée par un facteur `g > 1`, alors
   les graduations tertiaires sont les graduations de cette même unité
   secondaire non regroupée qui ne coïncident ni avec une primaire, ni avec une
   secondaire visible ;
2. si l'unité secondaire visible est déjà affichée avec un regroupement `1`,
   alors on considère l'unité immédiatement inférieure à cette unité
   secondaire ;
3. si cette unité plus fine peut être affichée sans label avec un espacement
   suffisant, alors elle est utilisée comme unité tertiaire, éventuellement
   regroupée ;
4. sinon, aucune graduation tertiaire n'est affichée.

Autrement dit :

- la tertiaire complète d'abord les secondaires masquées par le regroupement ;
- et si rien n'est masqué au niveau secondaire, la tertiaire peut provenir du
  niveau temporel encore plus fin.

Les graduations tertiaires ne doivent jamais coïncider avec :

- une graduation primaire ;
- une graduation secondaire visible.

## Conversion pixel / temps

Pour dessiner la règle et la grille, et pour interpréter les interactions de
la souris, il faut convertir entre :

- des coordonnées horizontales en pixels ;
- des coordonnées temporelles entières `TimeCoord`.

On note :

```math
ViewportStartCoord ∈ TimeCoord
ViewportDurationCoord ∈ DurationCoord
ViewportWidthPx ∈ R
```

La fenêtre temporelle visible est alors :

```math
[ViewportStartCoord, ViewportStartCoord + ViewportDurationCoord]
```

### Conversion temps -> pixel

Pour un instant `t` exprimé en coordonnées internes, son abscisse dans la
fenêtre visible est :

```math
time2pixel(t) = ViewportWidthPx × (t - ViewportStartCoord) / ViewportDurationCoord
```

Cette formule est utilisée pour :

- positionner les traits de graduation ;
- positionner les labels de la règle ;
- positionner le curseur ;
- positionner le début et la fin d'un clip.

### Conversion pixel -> temps

Pour une abscisse pixel `x` dans la zone visible, on définit d'abord le ratio
horizontal :

```math
r(x) = x / ViewportWidthPx
```

Puis la coordonnée temporelle correspondante :

```math
t(x) = ViewportStartCoord + round(r(x) × ViewportDurationCoord)
```

Cette formule est utilisée pour :

- faire un `seek` par clic ou drag sur la timeline ;
- définir le point d'ancrage d'un zoom dans la règle ;
- convertir un déplacement horizontal de souris en déplacement de clip.

### Delta pixel -> delta temps

Pour un déplacement horizontal `Δx` mesuré en pixels, on définit :

```math
Δt = round(Δx × ViewportDurationCoord / ViewportWidthPx)
```

Cette formule est utilisée pour :

- translater la vue lors d'un pan horizontal ;
- déplacer un clip pendant un drag ;
- translater la vue pendant un auto-scroll.

## Architecture géométrique

### Cohérence géométrique

La règle temporelle et la grille de piste doivent partager exactement :

- `ViewportStartCoord` ;
- `ViewportDurationCoord` ;
- `ViewportWidthPx` de leur zone utile ;
- la même formule de projection `time2pixel(t)`.

Autrement dit, une même coordonnée `t` doit être projetée par `time2pixel(t)`
sur la même abscisse pixel dans la règle et dans la piste, afin que les traits
verticaux soient parfaitement alignés.

### Couche de grille partagée

La géométrie verticale des graduations temporelles ne doit être dessinée qu'une
seule fois.

Autrement dit :

- il existe une unique couche de grille temporelle partagée ;
- cette couche contient toutes les lignes verticales primaires, secondaires et
  tertiaires ;
- la règle temporelle et les pistes réutilisent exactement cette même couche ;
- la règle n'ajoute que les labels ;
- les pistes n'ajoutent que leur contenu propre.

Les différences visuelles entre la règle et les pistes ne doivent donc pas être
obtenues en redessinant les graduations verticales, mais uniquement par :

- des couches de fond distinctes ;
- des masques ou clips verticaux ;
- des labels spécifiques à la règle ;
- le contenu propre à chaque piste.

Cette contrainte est essentielle pour garantir :

- l'absence de décalage horizontal entre la règle et les pistes ;
- la stabilité visuelle lors du passage à plusieurs pistes ;
- l'unicité géométrique de l'espace temporel partagé.

### Rasterisation de la grille partagée

La couche de grille temporelle partagée n'est pas rendue comme une forêt de
nœuds DOM.

Elle est rendue comme une **couche raster partagée**.

Plus précisément :

- pour chaque échelle temporelle retenue par `ChooseScale`, le système produit
  le raster d'une **grille primaire complète** ;
- cette grille primaire complète contient :
  - le trait primaire ;
  - les graduations secondaires ;
  - les graduations tertiaires éventuelles ;
  - les labels secondaires ;
- ce raster primaire est ensuite répété horizontalement dans la couche de
  grille partagée.

Les labels primaires ne font pas partie de ce motif répétable, car ils
dépendent de la coordonnée absolue du temps.

Donc :

- les labels secondaires appartiennent à la couche raster répétable ;
- les labels primaires restent rendus séparément, à partir des positions
  absolues des graduations primaires.

Cette séparation permet :

- de stabiliser le coût de rendu de la grille pendant le zoom ;
- d'éviter la reconstruction d'un très grand nombre de nœuds DOM ;
- de conserver l'alignement exact entre règle et pistes ;
- de garder une sémantique absolue correcte pour les labels primaires.

## Interactions

### Magnétisme du drag de clip

Lorsqu'un clip est déplacé horizontalement à la souris, on peut appliquer un
léger magnétisme vers les graduations temporelles visibles.

Ce magnétisme vérifie les principes suivants :

- il ne s'applique qu'au déplacement des clips ;
- il agit uniquement dans un voisinage très petit d'une graduation visible ;
- il ne doit jamais rendre le drag collant ou empêcher un positionnement libre.

Du point de vue de l'expérience utilisateur, la graduation visible la plus fine
définit la maille temporelle locale perçue dans la vue. Cette maille constitue
donc naturellement la grille de magnétisme utilisée pour le placement des
clips.

Les graduations candidates au magnétisme sont :

- les graduations primaires visibles ;
- les graduations secondaires visibles ;
- éventuellement les graduations tertiaires visibles.

On associe à chaque niveau une tolérance en pixels :

```math
magnetism_primary_px
magnetism_secondary_px
magnetism_tertiary_px
```

avec en général :

```math
magnetism_tertiary_px < magnetism_secondary_px <= magnetism_primary_px
```

Si la position courante du début du clip est à une distance horizontale
strictement inférieure à la tolérance du niveau considéré, alors cette position
peut être remplacée par la graduation correspondante.

Si plusieurs graduations sont candidates, on choisit la plus proche en pixels.

Le magnétisme doit rester faible :

- les graduations primaires et secondaires peuvent avoir un magnétisme léger ;
- les graduations tertiaires, si elles participent au magnétisme, doivent avoir
  une tolérance plus faible encore.

## Formulation finale du problème

Étant donnés :

```math
P
D
digit_space1
digit_space2
margin
```

il faut choisir :

```math
primary_unit
secondary_unit
secondary_grouping
```

de telle sorte que :

- l'échelle choisie soit lisible ;
- l'échelle choisie soit la plus précise possible ;
- la règle temporelle et la grille de piste utilisent exactement cette même
  échelle ;
- les graduations et labels rendus soient verticalement alignés entre la règle
  et la piste.

## fallback

Si même le couple le moins précis `(heure, minute)` avec le regroupement le
plus large `(30)` ne satisfait pas la lisibilité, alors on n'affiche pas
l'unité secondaire, mais on laisse le recouvrement des labels principaux.
