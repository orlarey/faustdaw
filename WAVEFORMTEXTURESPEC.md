# Spécification des Textures de Waveform

## Objet du document

Ce document décrit le backend cible du **régime enveloppe** des waveforms.

Il complète :

- [WAVEFORMSPEC.md](/Users/yannorlarey/Documents/Install/webdaw/WAVEFORMSPEC.md)
  pour le modèle logique ;
- [NEWFASTRENDERINGSPEC.md](/Users/yannorlarey/Documents/Install/webdaw/NEWFASTRENDERINGSPEC.md)
  pour la composition du fond raster par divisions primaires.

Le point central est le suivant :

- en régime enveloppe, on ne veut plus retracer la waveform bucket par bucket
  dans un `canvas 2D` sur le chemin chaud ;
- on veut conserver, par **ressource** et par **niveau waveform**, une
  représentation compacte directement exploitable par un backend GPU ;
- le clip visible n’est alors plus qu’une projection/clipping de cette source
  de données.

Ce document suppose en outre que le régime enveloppe est rendu sous la
forme d'une **bande remplie** (`envelope-band`) couvrant `[min, max]` du
signal mono mixdown sur chaque bucket — cf. WAVEFORMSPEC.md §"Deuxième
décision". Le présent document définit la banque GPU sous-jacente, qui
reste indépendante du sous-régime visuel exact.

## Portée

Cette spécification concerne uniquement :

- `waveform par buckets`

et non :

- `waveform détaillée par samples`

Autrement dit :

- quand un niveau de zoom impose un rendu détaillé depuis les samples, ce
  document ne change rien ;
- quand la waveform est rendue comme une enveloppe issue de buckets, ce
  document définit la représentation cible.

## Problème

Le pipeline actuel du régime enveloppe reste encore trop CPU :

- on choisit un niveau de buckets ;
- on parcourt les buckets visibles ;
- on retrace une silhouette dans un canvas 2D ;
- ce travail se répète encore trop souvent pendant les gestes de pan et de
  zoom.

Le coût à supprimer est donc :

```text
retracer CPU la waveform bucket par bucket sur le chemin chaud
```

Cela vaut pour le rendu `envelope-band` actuel et pour toute future
variante de rendu GPU qui partagerait la même banque `min/max`.

## Principe retenu

Pour chaque couple :

- `resource`
- `niveau waveform`

on conserve une représentation compacte :

```text
WaveformTextureLevel = suite ordonnée de texels/buckets min-max
```

où chaque texel logique contient exactement :

- `min`
- `max`

sur un bucket contigu d’échantillons.

Le clip visible n’a pas sa propre texture waveform.

Il utilise :

- la texture de sa ressource ;
- le niveau waveform correspondant au zoom courant ;
- la portion source utile ;
- et son rectangle visible dans la timeline.

Cette banque `min/max` reste la donnée canonique du régime enveloppe, et
elle est calculée sur le signal mono mixdown — cf. WAVEFORMSPEC.md §"Neuvième décision".

## Coût mémoire

Le coût mémoire par bucket est :

```text
2 × 32 bits = 64 bits = 8 bytes
```

Donc, pour une ressource de `N` samples et un niveau waveform de bucket size
`B`, avec :

```text
nbBuckets = ceil(N / B)
```

on a :

```text
Memory(level) = nbBuckets × 8 bytes
```

Ce coût correspond à une texture de données logique `nbBuckets × 64 bits`.

## Interprétation correcte de "texture"

Cette texture n’est pas une image finale déjà peinte.

Autrement dit :

- sa largeur logique est `nbBuckets` ;
- chaque colonne logique correspond à un bucket ;
- chaque colonne stocke `min/max` ;
- la texture est destinée à être lue directement par un moteur de rendu GPU ou
  équivalent.

Ce n’est donc pas une image `clipHeight × nbBuckets` déjà affichable.

## Décision de structure

La structure retenue est :

```text
ResourceWaveformTextureBank
  resourceId
  levels: Map<WaveformZoomLevelKey, WaveformTextureLevel>

WaveformTextureLevel
  bucketSizeSamples
  bucketCount
  packedMinMax
```

où :

- `packedMinMax` contient `nbBuckets × 64 bits` ;
- chaque élément logique correspond à un bucket ;
- `bucketSizeSamples` définit le niveau waveform ;
- `bucketCount` vaut `ceil(resourceLength / bucketSizeSamples)`.

Le champ `means` de la pyramide CPU reste optionnel pour des extensions
futures, mais il n'a plus de mode de rendu associé : `packedMinMax` est
la seule donnée requise pour le régime enveloppe canonique.

## Clé des niveaux

La clé logique d’un niveau waveform est :

```text
WaveformZoomLevelKey = bucketSizeSamples
```

et non :

```text
WaveformZoomLevelKey = exactTimelineZoomLevelIndex
```

Pourquoi :

- plusieurs niveaux de zoom timeline peuvent, en théorie, aboutir au même
  bucket size ;
- la waveform doit être indexée par sa granularité utile réelle ;
- on évite ainsi les doublons mémoire inutiles.

## Génération

La texture d’un niveau waveform est générée une seule fois pour une ressource
donnée.

Deux politiques sont compatibles avec cette spécification :

1. génération `lazy`
2. préchauffage en arrière-plan

### Option 1 : génération lazy

Au premier rendu qui demande le niveau `B` pour la ressource `R` :

- on construit `WaveformTextureLevel(R, B)` ;
- on le garde ensuite durablement ;
- tous les rendus suivants le réutilisent.

### Option 2 : préchauffage

Après import ou décodage d’une ressource, on peut construire en arrière-plan
plusieurs niveaux waveform d’avance.

Cette option est permise, mais non imposée.

## Priorité de génération

La génération ne doit pas être uniforme.

La priorité correcte est :

1. niveau waveform correspondant au zoom courant ;
2. niveaux voisins probables ;
3. niveaux plus éloignés.

Autrement dit, lors de l’apparition d’un clip dans la timeline :

- on ne doit jamais attendre la construction de tous les niveaux pour
  l’afficher ;
- on doit d’abord rendre disponible la texture utile pour le niveau
  actuellement visible ;
- les autres textures arrivent ensuite en arrière-plan.

## Règle d’interaction

La construction des textures waveform ne doit jamais bloquer :

- un `drop` ;
- un pan ;
- un zoom ;
- ou un rendu interactif de la timeline.

Le clip doit donc pouvoir entrer immédiatement dans l’état visible suivant :

```text
rectangle visible
waveform absente temporairement
```

Puis évoluer ensuite vers :

```text
rectangle visible
waveform disponible pour le niveau courant
```

Puis éventuellement :

```text
rectangle visible
banque de niveaux waveform progressivement complétée
```

Cette propriété est un invariant d’interface, pas une optimisation optionnelle.

## Invariant principal

Une fois qu’un niveau waveform `R × B` est construit :

- il n’est plus recalculé pendant les gestes de pan et de zoom ;
- le chemin chaud ne doit plus reconstruire ses buckets ;
- le chemin chaud ne doit plus retracer la waveform bucket par bucket en CPU.

Cet invariant vise la cible finale du régime enveloppe.

## Rendu cible

Le rendu d’un clip en régime enveloppe devient :

```text
clip
  -> ressource référencée
  -> niveau waveform choisi
  -> texture min/max déjà prête
  -> portion source visible
  -> projection / clipping dans le rectangle du clip
  -> rendu GPU / blit / shader
```

En pratique, le rendu GPU cible est `envelope-band` : un quad par clip
qui consulte la texture `min/max` pour produire la bande remplie. Le
présent document fixe la banque canonique `min/max` ; le détail du
shader (bars vs band) reste un choix de rendu indépendant de la donnée
stockée.

et non :

```text
clip
  -> niveau waveform choisi
  -> boucle CPU sur les buckets
  -> tracé 2D sur canvas
```

Le point important est :

- la texture appartient à la ressource ;
- seule sa projection change avec le clip, le viewport et le clipping.

## Relation avec le rendu par divisions primaires

Dans [NEWFASTRENDERINGSPEC.md](/Users/yannorlarey/Documents/Install/webdaw/NEWFASTRENDERINGSPEC.md),
la couche de fond est remplie par divisions primaires.

Cette représentation waveform s’intègre naturellement à ce modèle :

- chaque division primaire continue à être rasterisée comme unité de fond ;
- mais, pour la partie waveform, elle ne relance plus un tracé CPU complet ;
- elle lit la texture `min/max` de la ressource au bon niveau waveform ;
- puis elle en prélève la portion correspondant au clip et à la division
  primaire courants.

Autrement dit :

- la granularité de composition reste la division primaire ;
- la granularité de stockage waveform reste le bucket ;
- le clip fournit la projection temporelle locale ;
- les trois sont compatibles.

## Différence avec la pixmap primaire de grille

La grille primaire possède une pixmap périodique minuscule, réutilisable telle
quelle sur toute la timeline.

La waveform n’est pas périodique.

Donc :

- on ne garde pas une seule pixmap waveform globale ;
- on garde une banque de textures waveform par ressource et par niveau
  waveform.

La similarité avec la grille est architecturale :

- contenu préconstruit ;
- pas de recalcul sur le chemin chaud ;
- rendu par simple réutilisation d’une source raster/de données.

La différence est sémantique :

- la grille répète ;
- la waveform varie le long de la ressource ;
- le clip n’en montre qu’une projection locale.

## Régime détaillé

Cette spécification ne supprime pas le régime détaillé.

Quand le zoom impose un rendu proche du sample :

- soit on garde le pipeline détaillé actuel ;
- soit on introduit plus tard une autre représentation GPU dédiée.

Mais ce document ne couvre pas ce second problème.

## Backend

La représentation décrite ici est volontairement indépendante du backend.

Elle peut être matérialisée comme :

- une texture WebGL ;
- une texture WebGPU ;
- ou, transitoirement, une structure mémoire intermédiaire en attente d’un
  backend GPU.

L’invariant important n’est pas l’API graphique choisie, mais le contrat
suivant :

- `resource × niveau waveform` produit une texture `min/max` stable ;
- cette texture est réutilisée durablement ;
- le chemin chaud n’effectue plus de retracé CPU bucket par bucket.

## Décision de transition

Le pipeline actuel Canvas2D peut subsister transitoirement comme fallback.

Mais la direction retenue est claire :

- le régime enveloppe doit migrer vers cette banque de textures `64 bits par
  bucket` ;
- le pan et le zoom doivent ensuite réutiliser ces textures au lieu de
  rerasteriser la waveform sur le CPU.

## Résumé

La décision retenue est donc :

1. distinguer strictement le régime détaillé et le régime enveloppe ;
2. pour le régime enveloppe, stocker `min/max` sur `64 bits` par bucket ;
3. indexer ce stockage par `resource × bucketSizeSamples` ;
4. construire chaque niveau une seule fois ;
5. réutiliser cette texture sur tout le chemin chaud ;
6. ne plus tracer la waveform bucket par bucket dans un canvas 2D pendant le
   pan ou le zoom.
