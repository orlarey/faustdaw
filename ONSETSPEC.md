# ONSETSPEC

## Objet

Cette spec décrit une première version de :

- la **détection d'onsets** à l'intérieur d'un clip audio ;
- leur **visualisation** dans la waveform ;
- l'opération **Explode At Detected Onsets** qui remplace un clip par une
  séquence de sous-clips correspondant aux segments délimités par ces onsets.

L'objectif est double :

- préparer des opérations futures de slicing, layout temporel et manipulation
  générative ;
- garantir qu'un clip explosé redonne **exactement la même séquence de
  samples** que le clip d'origine lorsqu'on lit tous les sous-clips à la suite.

---

## Principes

### P1. L'audio canonique reste inchangé

La détection d'onsets ne modifie jamais la ressource audio.

Elle ne produit que :

- une liste de positions d'onsets en samples ;
- une visualisation non destructive ;
- puis, sur demande, une transformation éditoriale du clip.

### P2. L'explosion d'un clip crée des ressources dérivées

`Explode At Detected Onsets` crée autant de **nouvelles ressources audio**
qu'il y a de morceaux produits.

L'opération :

- remplace un clip par plusieurs clips plus courts ;
- crée pour chaque morceau une ressource audio autonome correspondant
  exactement à l'intervalle de samples visé ;
- attache chaque nouveau clip à sa propre ressource ;
- n'hérite pas d'un éventuel lien `session-render` du clip source.

### P3. La concaténation doit être sample-identique

Si un clip `[A, B]` est explosé en plusieurs sous-clips couvrant exactement
les mêmes frames de la ressource, la lecture successive de ces sous-clips doit
reproduire exactement le contenu du clip initial.

Autrement dit :

- pas de time-stretch ;
- pas de resampling supplémentaire ;
- pas de bounce implicite ;
- pas de décalage de coupe autre que celui explicitement choisi.

### P4. L'analyse est distincte de l'action d'édition

La détection des onsets doit pouvoir être lancée sans exploser le clip.

Le workflow V1 est :

1. détecter ;
2. afficher les marqueurs ;
3. décider ensuite si l'on veut exploser le clip.

---

## Algorithme V1 retenu

La première version repose sur :

- une STFT ;
- une novelty function de type **spectral flux** ;
- un seuil adaptatif ;
- un peak picking ;
- un raffinage local des points de coupe.

### Étape 1. Signal d'analyse

Le clip fournit un **signal d'analyse mono** dérivé de la ressource audio.

Pour un fichier multicanal :

- on n'affiche ni ne coupe canal par canal ;
- on calcule un signal d'analyse agrégé ;
- les positions d'onsets valent pour le clip entier.

Première règle simple :

- le signal d'analyse mono est dérivé des canaux existants par agrégation
  légère, sans modifier la ressource originale.

### Étape 2. STFT

Paramètres V1 recommandés :

- fenêtre : `1024` samples ;
- hop size : `256` samples ;
- fenêtre de Hann.

### Étape 3. Novelty function

La novelty function principale est le **spectral flux demi-redressé** :

- on mesure les augmentations de magnitude entre deux frames successives ;
- on ignore les variations négatives ;
- on obtient une courbe de nouveauté positive dans le temps.

### Étape 4. Lissage

La courbe de nouveauté est légèrement lissée.

Paramètre V1 :

- moyenne mobile courte sur `3` à `5` frames.

### Étape 5. Seuil adaptatif

Le seuil ne doit pas être global fixe.

La V1 utilise un seuil local de type :

- médiane ou moyenne locale ;
- plus un offset de sensibilité.

Cela permet :

- d'éviter les faux positifs sur les zones faibles ;
- et d'éviter de manquer des onsets dans des zones plus denses.

### Étape 6. Peak picking

Un onset candidat est retenu si :

- il dépasse le seuil adaptatif local ;
- il correspond à un maximum local de la novelty function ;
- il respecte une distance minimale avec le précédent onset retenu.

Paramètre V1 recommandé :

- distance minimale entre onsets : `20 ms` à `40 ms`.

### Étape 7. Raffinage du point de coupe

Le pic détecté par la STFT n'est pas nécessairement le meilleur point de coupe
au sample près.

Chaque onset retenu doit être raffiné localement dans une petite fenêtre autour
du candidat.

Première stratégie recommandée :

- chercher un minimum local d'énergie ;
- ou un zero-crossing proche ;
- ou, à défaut, garder le sample candidat initial.

Le but n'est pas de déplacer fortement l'onset musical, mais de choisir un
point de coupe plus sûr.

---

## Paramètres V1

La V1 doit rester simple en UX.

Paramètres internes par défaut :

- `windowSizeSamples = 1024`
- `hopSizeSamples = 256`
- `window = hann`
- `smoothingFrames = 3..5`
- `minOnsetSpacingMs = 30`
- `adaptiveThreshold = localMedian + offset`
- `refineWindowMs = petite fenêtre locale autour du candidat`

Contrôle utilisateur minimal :

- un seul réglage de **sensibilité**

La sensibilité ajuste surtout :

- l'offset du seuil adaptatif ;
- éventuellement la distance minimale entre onsets.

---

## Sortie de l'analyse

La sortie de la détection est une liste triée :

- de positions d'onsets en **samples relatifs au clip**
- ou en **coordonnées absolues** clairement convertibles.

Règles :

- pas de doublons ;
- ordre strict croissant ;
- pas d'onset à la position `0` ;
- pas d'onset à la position finale du clip ;
- on ignore les candidats trop proches des bords.

---

## Visualisation V1

Les onsets détectés doivent pouvoir être affichés comme :

- des **traits verticaux** superposés à la waveform du clip.

Principes UX :

- la visualisation est non destructive ;
- elle doit apparaître avant l'action d'explosion ;
- elle doit permettre à l'utilisateur d'évaluer rapidement si la détection est
  plausible.

Première version :

- tous les onsets visibles utilisent le même style visuel ;
- pas de sélection individuelle obligatoire ;
- pas d'édition manuelle des marqueurs en V1.

## Stratégie de rendu retenue

La visualisation des onsets suit une stratégie **hybride**.

### Pendant le réglage

Pendant que le panneau `Detect Onsets…` est ouvert :

- les marqueurs d'onsets du clip en cours d'édition peuvent être affichés dans
  un **overlay temporaire** ;
- cet overlay est limité au clip preview concerné ;
- il permet une mise à jour live des marqueurs sans imposer immédiatement un
  rerendu global du fond raster.

Cette phase est transitoire :

- elle ne définit pas l'architecture permanente du rendu timeline ;
- elle sert uniquement au confort du réglage interactif.

### Après validation

Une fois l'annotation validée :

- les marqueurs d'onsets ne doivent plus dépendre d'un overlay dédié ;
- ils doivent être rendus dans la **même passe raster** que les waveforms et
  les blocs de clips.

Autrement dit :

- pas de couche permanente supplémentaire pour les onsets validés ;
- pas de prolifération de canvases superposés pour ce cas nominal ;
- les onsets deviennent une information supplémentaire du fond raster.

### Conséquence

Le régime nominal retenu est donc :

- **une seule passe raster** pour `clip + waveform + onsets`

et non :

- une couche onset permanente séparée.

---

## Données de rendu des onsets

Les données d'onsets ne doivent pas être encodées en détournant les données de
waveform elles-mêmes.

En particulier, la V1 **n'utilise pas** une surcharge du type :

- inversion artificielle de `min/max` dans un bucket contenant un onset.

Raison :

- les données waveform doivent conserver leur sémantique audio propre ;
- les données d'annotation doivent rester distinctes ;
- cela évite d'introduire des ambiguïtés ou des artefacts dans les chemins CPU
  et GPU existants.

La forme de stockage recommandée en V1 est :

- une **liste sparse** de positions d'onsets

éventuellement complétée plus tard par :

- un cache plus compact par niveau de bucket si une optimisation mémoire ou
  de rendu devient nécessaire.

---

## Contraintes de rendu

L'implémentation doit rester alignée avec :

- [FASTRENDERINGSPEC.md](/Users/yannorlarey/Documents/Install/webdaw/FASTRENDERINGSPEC.md)
- [NEWFASTRENDERINGSPEC.md](/Users/yannorlarey/Documents/Install/webdaw/NEWFASTRENDERINGSPEC.md)

Conséquences :

- les marqueurs d'onsets ne doivent pas reposer sur une prolifération
  d'éléments DOM par onset ;
- leur rendu doit privilégier le pipeline raster déjà utilisé pour les clips et
  waveforms ;
- en régime nominal, les onsets validés doivent être rendus dans la même passe
  raster que `clip + waveform` ;
- l'affichage d'onsets ne doit pas provoquer de recalcul complet inutile des
  waveforms ;
- l'analyse doit être mise en cache par ressource et paramètres quand cela est
  possible.

Conséquence supplémentaire :

- l'overlay utilisé pendant le réglage est un outil de preview transitoire ;
- il ne doit pas devenir une couche permanente supplémentaire de la timeline.

---

## Opération `Explode At Detected Onsets`

### Principe

Soit un clip couvrant l'intervalle ressource :

- `[clipOffset, clipOffset + clipLength]`

et une liste ordonnée d'onsets internes :

- `o1 < o2 < ... < on`

L'opération remplace ce clip par les segments :

- `[clipOffset, o1]`
- `[o1, o2]`
- ...
- `[on, clipOffset + clipLength]`

placés bout à bout dans la timeline à partir du `start` du clip d'origine.

### Propriétés éditoriales

L'opération :

- supprime le clip original ;
- insère une séquence de nouveaux clips ;
- conserve l'ordre temporel exact ;
- ne crée aucun trou ;
- ne crée aucun recouvrement ;
- ne modifie pas les samples référencés.

### Ressource audio

Tous les sous-clips issus de l'explosion :

- référencent leur propre ressource audio dérivée ;
- doivent être sauvables/exportables comme des ressources normales ;
- ne doivent plus être considérés comme des clips `session-render` liés,
  même si le clip source l'était.

### Undo / Redo

`Explode At Detected Onsets` doit être :

- une seule transformation éditoriale undoable.

L'undo doit restaurer :

- le clip d'origine ;
- sa sélection éventuelle ;
- et supprimer la séquence de sous-clips créée par l'explosion.

La rétention locale des ressources et la distinction entre ressources retenues
pour l'undo et ressources effectivement exportées par `Save Session` suivent
les règles générales déjà posées dans [DATAMODEL.md](/Users/yannorlarey/Documents/Install/webdaw/DATAMODEL.md)
et [MULTISESSIONS.md](/Users/yannorlarey/Documents/Install/webdaw/MULTISESSIONS.md).

---

## Cas limites

### Aucun onset détecté

Si aucun onset interne pertinent n'est trouvé :

- l'action d'explosion ne modifie rien ;
- un feedback léger peut informer l'utilisateur qu'aucune coupe n'a été
  produite.

### Trop d'onsets

Si le signal est trop bruité ou trop dense :

- un cap raisonnable de coupes peut être appliqué ;
- ou l'analyse peut demander à l'utilisateur d'augmenter le seuil.

### Clips très courts

Pour les clips trop courts :

- l'analyse peut être désactivée ;
- ou retourner systématiquement zéro onset.

### Stéréo et multicanal

Les positions de coupe sont uniques pour le clip entier.

On ne coupe pas différemment selon les canaux.

---

## UX V1 recommandée

Première séquence d'usage :

1. sélectionner un clip ;
2. lancer `Detect Onsets` ;
3. visualiser les traits d'onset dans la waveform ;
4. ajuster éventuellement une sensibilité ;
5. lancer `Explode At Detected Onsets`.

Commandes possibles plus tard :

- `Detect Onsets`
- `Clear Detected Onsets`
- `Explode At Detected Onsets`

## Workflow retenu

Le workflow retenu est explicitement en **deux étapes** :

1. **annoter** le clip ;
2. **découper** ensuite un clip déjà annoté.

Autrement dit :

- `Detect Onsets…` ne découpe pas le clip ;
- il produit une annotation visible et révisable ;
- `Explode At Detected Onsets` agit ensuite sur cette annotation.

Conséquence :

- l'analyse et l'édition restent découplées ;
- l'utilisateur peut voir ce qui va être coupé avant de transformer le clip ;
- la même annotation pourra plus tard servir à d'autres opérations que
  l'explosion.

## Annotation d'onsets

L'annotation d'onsets est attachée conceptuellement au **clip**.

Elle contient au minimum :

- la liste des positions d'onsets retenues ;
- les paramètres d'analyse utilisés ;
- éventuellement des métadonnées de fraîcheur ou de version d'analyse.

Remarque :

- un cache interne pourra être dérivé de la ressource audio pour accélérer
  l'analyse ;
- mais l'annotation visible reste attachée au clip, car un même fichier peut
  être utilisé par plusieurs clips avec des offsets et durées différents.

## UI de réglage retenue

La V1 ne retient pas un gros overlay modal plein écran.

Le modèle recommandé est :

- un **panneau flottant semi-transparent**
- compact ;
- non modal ou faiblement modal ;
- laissant visible la timeline et le clip annoté en arrière-plan.

Objectif :

- voir simultanément :
  - les réglages ;
  - le clip ;
  - les marqueurs d'onsets détectés.

### Ouverture

L'action `Detect Onsets…` ouvre ce panneau de réglage.

Le clip sélectionné passe alors en **mode preview onsets**.

### Comportement live

Les réglages doivent mettre à jour la détection en direct, avec un léger
debounce si nécessaire.

À chaque changement :

- les marqueurs d'onsets sont recalculés ;
- la preview visuelle est mise à jour ;
- le clip n'est toujours pas découpé.

### Fermeture

Le panneau doit proposer au minimum :

- `Apply`
- `Explode`
- `Cancel`

Sémantique :

- `Apply` conserve l'annotation d'onsets sur le clip sans le découper ;
- `Explode` conserve l'annotation puis applique immédiatement
  `Explode At Detected Onsets` ;
- `Cancel` ferme le panneau et abandonne l'annotation produite pendant cette
  session de réglage si elle n'a pas été validée.

Raccourcis recommandés :

- `Esc` = fermer / annuler ;
- `Enter` = appliquer les réglages.

## Paramètres exposés en V1

La V1 doit rester volontairement simple.

Paramètres visibles recommandés :

- `Sensitivity`
- `Minimum spacing`
- éventuellement `Refine cuts`

Tout le reste peut rester :

- interne ;
- ou rangé plus tard dans une section `Advanced`.

## Conditions d'activation de l'explosion

`Explode At Detected Onsets` doit être disponible seulement si :

- le clip possède déjà une annotation d'onsets valide.

Sinon :

- l'action est absente ;
- ou visible mais désactivée ;
- ou redirige vers `Detect Onsets…`

Le comportement exact pourra être choisi plus tard, mais la logique reste :

- on n'explose pas un clip "à l'aveugle" sans annotation préalable.

---

## Points ouverts

À préciser plus tard :

- la forme exacte du cache d'analyse d'onsets ;
- la persistance ou non des marqueurs détectés dans la session ;
- l'édition manuelle des marqueurs ;
- la possibilité de ne garder qu'une partie des onsets visibles ;
- l'ajout éventuel de micro-fades automatiques au moment de l'explosion ;
- l'affichage futur distinct des onsets “forts” et “faibles”.
