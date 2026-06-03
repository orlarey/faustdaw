# Spécification du Placement Assisté

## Problème

Nous voulons définir les règles de **placement assisté** des objets temporels
de la timeline :

- clips ;
- curseur ;
- plus tard, potentiellement, marqueurs, sélections, bords de régions ou
  autres objets temporels.

Le problème est double :

- il faut pouvoir placer précisément un objet sur la grille ;
- il faut que cette précision reste **facile à obtenir** à la souris ou au
  doigt.

Sans assistance :

- on rate facilement une subdivision fine ;
- le placement paraît imprécis ;
- l'utilisateur doit corriger plusieurs fois la même intention.

Avec une assistance mal conçue :

- le placement devient collant ;
- l'objet saute vers des cibles non désirées ;
- le comportement change de façon peu lisible selon le contexte.

## But

Nous voulons définir un système de placement assisté qui soit :

- exact par rapport à la géométrie temporelle de la timeline ;
- lisible dans sa logique ;
- stable pendant le drag ;
- extensible à d'autres objets que les clips.

Le système doit permettre de répondre à la question :

```text
Pour une position candidate, vers quelle cible exacte faut-il snapper ?
```

## Principe général

Le placement assisté ne modifie pas la représentation interne du temps.

Il intervient seulement au moment de convertir :

- une intention utilisateur continue ;
- en une position temporelle discrète exacte.

Autrement dit :

```text
position brute utilisateur
  -> cibles de placement possibles
  -> choix d'une cible si elle est assez proche
  -> position exacte retenue
```

## Première décision

Le placement assisté repose d'abord sur la **grille exacte courante** de la
timeline.

Les cibles de base sont donc :

- divisions tertiaires ;
- divisions secondaires ;
- divisions primaires.

Ces cibles dépendent du niveau de zoom exact courant.

Le placement assisté n'invente pas sa propre grille :

- il réutilise la géométrie exacte déjà définie par `EXACTZOOMSPEC`.

## Deuxième décision

Les positions retenues par le placement assisté doivent toujours rester exactes
par rapport au maillage interne du temps.

Donc, même après magnétisme :

- la position finale est toujours resnappée sur un sample exact ;
- jamais sur une valeur flottante intermédiaire.

Autrement dit :

- le magnétisme choisit une cible ;
- la quantification finale reste alignée sur le sample.

## Troisième décision

La priorité actuelle du magnétisme de grille est hiérarchique :

1. tertiaire
2. secondaire
3. primaire

Le principe est :

- si une tertiaire est assez proche, elle gagne ;
- sinon on teste la secondaire ;
- sinon la primaire.

Ce choix favorise l'alignement fin sur la grille la plus utile.

## Quatrième décision

Dans l'état actuel, cette hiérarchie est **la même à tous les niveaux de
zoom**.

Autrement dit :

- le système ne change pas encore de politique entre zooms fins et zooms
  larges ;
- on applique la même logique de priorité à toute l'échelle de zoom.

Cette décision ne ferme pas la porte à une future adaptation par niveau de
zoom, mais ce n'est pas le comportement retenu pour la première version.

## Cinquième décision

Les seuils de magnétisme sont exprimés en pixels écran.

Dans l'état actuel :

- clip / primaire-secondaire : `4 px`
- clip / tertiaire : `3 px`
- curseur / primaire-secondaire : `3 px`
- curseur / tertiaire : `2 px`

Ces seuils sont des paramètres UX, pas des constantes mathématiques du temps.

Ils peuvent évoluer sans remettre en cause :

- la géométrie exacte de la grille ;
- ni la logique de quantification finale au sample.

## Sixième décision

Le placement assisté d'un clip et celui du curseur suivent la même famille de
règles, mais peuvent avoir des seuils différents.

Motif :

- un clip occupe une largeur visuelle importante et peut tolérer un magnétisme
  plus fort ;
- un curseur est visuellement plus fin et demande souvent un contrôle un peu
  plus léger.

Donc :

- logique commune ;
- paramètres UX distincts si nécessaire.

## Septième décision

Le placement assisté par grille n'est qu'un premier sous-système du placement
assisté global.

À terme, le document devra aussi couvrir :

- alignement d'un objet sur le début d'un autre ;
- alignement d'un objet sur la fin d'un autre ;
- alignement sur le curseur ;
- alignement sur des marqueurs ou repères ;
- politique de priorité entre grille et objets ;
- éventuelle hystérésis pendant le drag.

Autrement dit :

- la grille est la première famille de cibles ;
- elle n'est pas la seule famille de cibles future.

## Huitième décision

Le `drop` d'un fichier audio sur la timeline ne doit pas être traité comme une
demande implicite de recentrage de la vue.

Donc :

- le clip déposé est créé à la position visée ;
- il peut devenir sélectionné ;
- mais la vue courante ne doit pas bouger automatiquement.

Cette règle relève du placement assisté au sens large :

- l'utilisateur a déjà choisi son contexte visuel ;
- le système ne doit pas requalifier cette intention en demande de navigation.

## Neuvième décision

Au chargement ou au refresh de la fenêtre, si l'état initial de la vue est
ancré à `t = 0`, le bord gauche visible doit rester aligné sur ce zéro.

Donc :

- un recalcul de largeur utile ou de durée exacte ne doit pas recentrer la vue
  par défaut ;
- le premier rendu doit conserver explicitement `viewStart = 0`.

Cette règle garantit que le repère visuel de base du projet reste stable.

## Dixième décision

Le système de placement assisté peut utiliser un **zoom provisoire** pour
augmenter temporairement la précision de placement.

Le mécanisme retenu est :

- si le niveau courant est `N` ;
- alors l'appui sur la touche `Option` fait passer provisoirement au niveau
  `N - 1` ;
- le relâchement de `Option` ramène au niveau `N`.

Ce zoom provisoire :

- n'est pas lié au fait de tenir ou non un objet ;
- peut être utilisé pendant un drag, mais aussi plus généralement pendant une
  phase d'inspection ou de placement ;
- ne modifie pas le niveau de zoom de base choisi par l'utilisateur.

## Onzième décision

Le zoom provisoire est ancré sous la souris.

Autrement dit :

- si l'abscisse écran `x` correspond à la coordonnée temporelle `t` au niveau
  `N` ;
- alors, pendant le passage provisoire au niveau `N - 1`, cette même abscisse
  `x` doit continuer à correspondre à cette même coordonnée `t`.

Donc :

- le zoom provisoire ne se fait pas autour du centre de la vue ;
- il se fait autour de la position de travail courante.

Cette règle évite de perdre la cible visée quand on cherche à affiner un
placement.

## Douzième décision

Le placement assisté ne repose pas seulement sur la grille.

Pendant le drag d'un clip, on peut aussi utiliser les dates des autres objets
temporels visibles comme **cibles de placement**.

Dans l'état actuel, la première forme de placement objet-objet retenue est :

- début de clip visible ;
- fin de clip visible.

Donc, au début d'un drag de clip, on construit une liste des dates candidates :

- `clip.start`
- `clip.end`

pour tous les clips visibles dans la vue, hors clip déplacé.

## Treizième décision

Des dates différentes peuvent avoir la même projection pixel, ou une projection
indiscernable à la tolérance près.

Le système ne raisonne donc pas seulement en pixels, ni seulement en dates :

- l'admissibilité d'une cible est d'abord testée en projection écran ;
- la résolution finale choisit une date en coordonnées temporelles exactes.

Autrement dit :

1. une date candidate devient admissible si la projection écran du bord gauche
   ou du bord droit du clip déplacé tombe à l'intérieur du seuil ;
2. parmi les dates admissibles, on retient la date temporelle la plus proche du
   bord concerné.

## Quatorzième décision

Le trait vertical d'alignement n'est pas seulement décoratif.

Sa sémantique est :

- trait visible = **cible active de placement**

Donc :

- si un trait est visible pendant le drag ;
- alors le `drop` doit placer réellement le clip sur cette cible active.

Il ne doit pas exister de divergence entre :

- le trait affiché ;
- et la position réellement retenue au relâchement.

Cette cohérence impose que :

- le rendu du trait ;
- et la résolution de placement au `drop`

utilisent exactement la même règle.

## Quinzième décision

La résolution de conflit entre plusieurs cibles admissibles suit la règle
suivante :

1. on retient la date la plus proche en coordonnées temporelles ;
2. si deux cibles restent exactement à égalité ;
3. on privilégie l'alignement sur le **début** plutôt que sur la **fin**.

Autrement dit :

- proximité temporelle d'abord ;
- priorité au bord gauche ensuite.

Cette règle rend le système déterministe, même quand plusieurs dates distinctes
partagent la même projection visuelle.

## Seizième décision

Le seuil d'admissibilité de ces cibles objet-objet est exprimé en pixels écran,
comme pour le magnétisme de grille.

Dans l'état actuel, ce seuil est :

- `4 px`

Mais la cible retenue reste ensuite une vraie date en `TimeCoord`.

Donc :

- perception : en pixels ;
- décision finale : en temps exact.

## Structure future

Le document pourra évoluer selon les sections suivantes :

1. placement assisté par grille
2. placement assisté objet-objet
3. placement assisté par curseur et marqueurs
4. priorités entre familles de cibles
5. hystérésis et stabilité pendant le drag
6. différences éventuelles entre souris, touch et clavier

Pour l'instant, la première version du document consigne surtout :

- le placement assisté par grille ;
- les seuils actuels ;
- et les premières règles de stabilité de viewport liées au placement.
