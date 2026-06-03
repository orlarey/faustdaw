# Spécification du Player Audio

## Première Décision

Pendant `Playing`, l'horloge maître est l'horloge audio :

```text
AudioContext.currentTime
```

et non :

- le transport métier seul ;
- `requestAnimationFrame` ;
- le rendu visuel.

## Pourquoi

Le son doit rester stable même si l'interface ralentit.

## Deuxième Décision

Le scheduling audio est distribué par piste.

Donc :

- pas un scheduler central qui décide de tout pour toutes les pistes ;
- un player par piste ;
- une horloge globale commune ;
- une session de lecture globale commune.

## Pourquoi

Une piste est une source audio autonome :

- elle pourra porter ses propres traitements ;
- elle devra produire son propre signal avant le mix final.

De plus, une piste est simple à scheduler :

- ses clips sont triés ;
- ils ne se recouvrent pas.

## Troisième Décision

Le temps interne du player ne doit pas être représenté en secondes flottantes.

Le temps interne doit rester discret et entier.

Les secondes de la Web Audio API ne sont qu'un format d'entrée/sortie.

## Pourquoi

Les nombres IEEE-754 ne représentent pas exactement beaucoup de durées utiles,
par exemple :

- `0.1`
- `1 / 48000`
- `1 / 44100`

Donc si on calcule le temps interne en secondes flottantes, on cumule :

- erreur de représentation ;
- erreur d'arrondi ;
- dérive possible quand on additionne de grands temps et de petits deltas.

Donc :

- le scheduler raisonne en temps entiers ;
- la conversion en secondes ne se fait qu'au moment d'appeler Web Audio.

## Quatrième Décision

La ressource audio, le clip, et le nœud de lecture sont trois choses
distinctes.

```text
AudioResource -> AudioBuffer
Clip -> occurrence temporelle d'une ressource
Lecture effective d'un clip -> AudioBufferSourceNode
```

Un même `AudioBuffer` peut être partagé par plusieurs
`AudioBufferSourceNode`.

## Cinquième Décision

Chaque piste maintient un `TrackPlaybackPlan`.

Ce plan ne prépare pas seulement le premier clip, mais une petite fenêtre de
lecture de la piste.

Cette fenêtre peut contenir plusieurs clips très courts successifs.

Pendant qu'un plan joue, la piste peut préparer le suivant, qui commence à la
fin du plan courant.

## Définition de `TrackPlaybackPlan`

Un `TrackPlaybackPlan` est le résultat de :

```text
buildTrackPlaybackPlan(track, time, minDuration) -> TrackPlaybackPlan
```

où :

- `track` est une piste ;
- `time` est la position entière du curseur dans la timeline ;
- `minDuration` est la durée minimale entière à couvrir immédiatement au
  démarrage de ce plan.

Un `TrackPlaybackPlan` contient directement les `AudioBufferSourceNode` déjà
préparés pour la piste sur un intervalle donné.

```text
TrackPlaybackPlan = (
  trackId,
  anchorTime,
  endTime,
  events
)
```

avec :

```text
TrackPlaybackEvent = (
  clipId,
  sourceNode,
  gainNode,
  startOffsetInPlan,
  stopOffsetInPlan,
  offsetInBufferFrames
)
```

où :

- `startOffsetInPlan` est le temps entier entre `time` et le début effectif de
  lecture de cet événement ;
- `stopOffsetInPlan` est le temps entier entre `time` et la fin effective de
  lecture ;
- `endTime` est la date de fin couverte par le plan ;
- `offsetInBufferFrames` est l'offset entier dans le buffer audio au moment où
  la lecture doit commencer ;
- `sourceNode` est un `AudioBufferSourceNode` déjà créé ;
- `gainNode` est le `GainNode` associé à cet événement ;
- le `AudioBuffer` est déjà assigné à ce nœud.

Les événements sont ordonnés dans l'ordre de lecture de la piste.

Le paramètre `minDuration` sert à construire le plan, mais ne fait pas partie
du résultat.

Le plan final doit vérifier :

```text
endTime >= anchorTime + minDuration
```

## Algorithme de `buildTrackPlaybackPlan`

Entrée :

```text
track, time, minDuration
```

Sortie :

```text
TrackPlaybackPlan
```

Principe :

Le plan doit couvrir la lecture de la piste à partir de `time`, sur au moins
`minDuration`.

Algorithme :

1. Poser :

```text
anchor = time
horizon = time + minDuration
```

2. Trouver dans la piste le premier clip dont la fin est strictement après
`anchor`.

3. Si aucun clip n'existe, retourner un `TrackPlaybackPlan` vide, avec :

```text
anchorTime = time
endTime = time + minDuration
events = []
```

4. Parcourir ensuite les clips de la piste dans l'ordre.

5. Pour chaque clip, ignorer :
- les clips dont le début est `>= horizon` et si le plan couvre déjà au moins
  `minDuration`

6. Pour chaque clip retenu, calculer :

```text
effectiveStart = max(anchor, clip.start)
effectiveStop = clip.end
startOffsetInPlan = effectiveStart - anchor
stopOffsetInPlan = effectiveStop - anchor
offsetInBufferFrames = conversion entière de (effectiveStart - clip.start)
```

7. Résoudre le `AudioBuffer` de la ressource du clip, créer un
`AudioBufferSourceNode`, lui assigner ce buffer, puis construire un
`TrackPlaybackEvent`.

8. Ajouter cet événement au plan.

9. Arrêter quand le plan contient tous les événements nécessaires pour que la
lecture puisse couvrir au moins `minDuration`.

10. Poser :

```text
endTime = max(time + minDuration, fin du dernier événement du plan)
```

Résultat :

Le `TrackPlaybackPlan` final contient les `AudioBufferSourceNode` déjà préparés
pour cette piste sur l'intervalle `[anchorTime, endTime)`.

Pendant que ce plan joue, la piste peut construire le plan suivant à partir de
`endTime`.

## Sixième Décision

La lecture d'une piste maintient en permanence :

- un plan actif ;
- un plan suivant déjà préparé.

La relève entre deux plans se fait avant la fin du plan actif.

Cette relève n'est pas déclenchée par un pourcentage du plan, mais par une
durée absolue restante.

## Paramètres temporels

Le mécanisme repose sur deux durées absolues distinctes :

- `minPlanDuration`
- `planActivationLeadTime`

où :

- `minPlanDuration` est la durée minimale couverte par un
  `TrackPlaybackPlan` ;
- `planActivationLeadTime` est la marge restante à partir de laquelle le plan
  suivant doit devenir actif.

## Règle de relève

Si le plan courant est :

```text
[anchorTime, endTime)
```

alors la relève doit se produire quand le temps courant atteint :

```text
endTime - planActivationLeadTime
```

À cet instant :

1. le plan suivant devient le plan actif ;
2. un nouveau plan suivant est calculé à partir de la fin de ce nouveau plan
   actif.

Donc, en régime établi :

```text
plan N actif
plan N+1 prêt
```

puis, à la relève :

```text
plan N+1 actif
plan N+2 prêt
```

Règle particulière :

- en lecture normale, le plan suivant est construit à partir de `endTime` ;
- après un `Seek` pendant `Playing`, le plan de remplacement est construit à
  partir de la nouvelle position du curseur.

## Septième Décision

Les transitions audio artificielles ne sont pas brutales.

Elles passent par une enveloppe courte de gain.

Donc :

- un démarrage en plein milieu d'un clip utilise un fade-in court ;
- un `Stop` ou un `Pause` utilisent un fade-out court ;
- un `Seek` pendant `Playing` utilise un crossfade court :
  - fade-out de l'ancien plan ;
  - fade-in du nouveau plan.

Cette enveloppe est portée par un `GainNode` associé à chaque
`AudioBufferSourceNode`.

Le fade se fait entre `0` et le niveau de la piste.

## Huitième Décision

La relève et la préparation des plans sont vérifiées par une boucle globale de
réveil pilotée par `setTimeout`.

Cette boucle ne décide pas à la place des pistes.

Elle se contente de réveiller périodiquement le système.

Ensuite chaque piste vérifie localement :

- si son plan suivant doit devenir actif ;
- si son plan d'après doit être construit.

`requestAnimationFrame` peut piloter la vue, mais pas la continuité audio.

La période de réveil globale est notée :

```text
wakePeriod
```

Elle doit vérifier :

```text
wakePeriod << planActivationLeadTime
```

Valeur initiale recommandée :

```text
wakePeriod = planActivationLeadTime / 4
```

## Tâche périodique

À chaque réveil, la boucle globale exécute une tâche périodique.

Cette tâche lit d'abord :

```text
currentAudioTime = AudioContext.currentTime
```

Puis elle convertit cette valeur en position courante de lecture dans la
timeline :

```text
currentTransportCoord =
  transportStartCoord +
  convert(currentAudioTime - audioStartTime)
```

où `convert(...)` produit directement un `TimeCoord` entier.

Cette conversion doit être faite à partir de la différence absolue :

```text
currentAudioTime - audioStartTime
```

et non par accumulation de petits deltas flottants.

Donc :

- pas de `time = time + deltaSeconds` répété ;
- pas de dérive par additions successives ;
- une conversion directe depuis l'horloge audio vers `TimeCoord`.

Ensuite la tâche appelle, pour chaque piste :

```text
trackPlayer.onWake(currentTransportCoord)
```

Chaque piste décide alors localement :

- si le plan suivant doit devenir actif ;
- si le plan d'après doit être calculé.

Donc la boucle globale :

- fournit le temps courant ;
- réveille les pistes ;
- mais ne prend pas leurs décisions de scheduling à leur place.

## Neuvième Décision

Le DAW a une seule fréquence d'échantillonnage : celle du `AudioContext`.

Lors de l'import :

- une ressource est décodée ;
- puis rééchantillonnée à cette fréquence si nécessaire ;
- puis seulement créée dans le projet.

Donc ensuite :

- tous les `AudioBuffer` ont la même fréquence d'échantillonnage ;
- `offsetInBufferFrames` est exprimé dans ce repère unique.

## Dixième Décision

Un `TrackPlaybackPlan` ne peut être construit qu'à partir de ressources déjà
disponibles sous forme de `AudioBuffer`.

Donc :

- soit une ressource est importée, décodée et éventuellement rééchantillonnée ;
- soit elle n'existe pas dans le projet.

## Onzième Décision

Les valeurs initiales de réglage sont :

- `minPlanDuration = 2 s`
- `planActivationLeadTime = 1 s`
- `startStopFadeDuration = 5 ms`
- `seekCrossfadeDuration = 30 ms`

avec la contrainte :

```text
planActivationLeadTime < minPlanDuration
```

## Douzième Décision

Quand un plan ou un nœud n'est plus utile :

- `disconnect()` est recommandé ;
- les références applicatives sont supprimées ;
- le ramasse-miettes peut ensuite libérer les objets terminés.

## Treizième Décision

`Stop`, `Pause` et `Seek` invalident la chaîne de plans courante.

Donc :

- `Stop` et `Pause` provoquent un fade-out court du plan actif, puis l'arrêt et
  la destruction du plan actif et du plan suivant ;
- `Seek` pendant `Playing` déclenche la construction d'une nouvelle chaîne de
  plans à partir de la nouvelle position ;
- pendant cette préparation, l'ancienne chaîne peut continuer à jouer ;
- quand la nouvelle chaîne est prête, elle devient active avec un crossfade
  court, puis l'ancienne chaîne est arrêtée et détruite.

## Quatorzième Décision

Par défaut, la lecture s'arrête naturellement quand plus aucune piste n'a :

- de plan actif ;
- ni de plan suivant.

## Traduction du `TrackPlaybackPlan` au moment de `Play`

Au moment où l'utilisateur appuie sur `Play`, une session de lecture globale
est ouverte.

Cette session fixe :

- un `audioStartTime` sur l'horloge du `AudioContext` ;
- un `transportStartCoord` sur la timeline.

Pour une piste donnée, le `TrackPlaybackPlan` initial est alors traduit
directement en appels Web Audio.

Pour chaque `TrackPlaybackEvent` du plan :

```text
startTime = audioStartTime + convert(startOffsetInPlan)
stopTime = audioStartTime + convert(stopOffsetInPlan)
offset = convert(offsetInBufferFrames)
```

où :

- `convert(startOffsetInPlan)` convertit un temps entier interne en secondes ;
- `convert(stopOffsetInPlan)` convertit un temps entier interne en secondes ;
- `convert(offsetInBufferFrames)` convertit un offset entier en frames en
  secondes pour la Web Audio API.

Ensuite la piste effectue directement :

```text
sourceNode.connect(trackInput)
sourceNode.start(startTime, offset)
sourceNode.stop(stopTime)
```

où `trackInput` est l'entrée de la chaîne audio de la piste.

Donc :

- le calcul métier et temporel a déjà été fait dans `buildTrackPlaybackPlan` ;
- au moment de `Play`, il ne reste que :
  - connecter les nœuds ;
  - convertir les temps entiers en secondes ;
  - appeler `start(...)` et `stop(...)`.
