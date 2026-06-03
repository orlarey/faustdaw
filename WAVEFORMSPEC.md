# Spécification du Rendu de Waveform

## Objet du document

Ce document fixe le modèle de données et les règles de rendu des waveforms dans
la timeline.

Il couvre :

- le régime `enveloppe` ;
- le régime `détaillé` ;
- la relation entre la waveform, la ressource audio, le clip et les niveaux de
  zoom exacts.

Il est complété par :

- [NEWFASTRENDERINGSPEC.md](/Users/yannorlarey/Documents/Install/webdaw/NEWFASTRENDERINGSPEC.md)
  pour l’architecture de rendu de la timeline rasterisée ;
- [WAVEFORMTEXTURESPEC.md](/Users/yannorlarey/Documents/Install/webdaw/WAVEFORMTEXTURESPEC.md)
  pour le backend GPU du régime enveloppe.

## Problème

Nous voulons afficher, dans le rectangle d’un clip audio, une représentation
visuelle fidèle du son sans recalculer cette représentation depuis les samples
bruts à chaque rendu.

Cette waveform doit rester fluide :

- quand plusieurs clips d’une même ressource sont visibles ;
- pendant le pan et le zoom ;
- pendant l’import et le drop de clips longs.

## Première décision

La waveform est une **donnée dérivée de la ressource audio**, pas du clip.

Autrement dit :

- la ressource porte le son ;
- le clip ne fait que projeter une portion de cette ressource dans la timeline ;
- plusieurs clips d’une même ressource partagent donc la même analyse waveform.

Conséquence :

- la construction de la waveform se fait **une fois par ressource** ;
- le rendu d’un clip réutilise cette analyse en la reprojectant dans le repère
  du clip.

## Deuxième décision

Le rendu waveform comporte deux régimes distincts :

1. `régime détaillé`
2. `régime enveloppe`

### Régime détaillé

Quand le zoom est suffisamment fin pour qu'un petit nombre de samples tombe
dans chaque pixel **device** (typiquement ≤ N samples par pixel device, avec
`N = WAVEFORM_DETAIL_MAX_SAMPLES_PER_DEVICE_PIXEL` ; cf. variable produit),
la waveform est rendue directement depuis les samples du `AudioBuffer` —
une polyligne traversant chaque sample visible. Le seuil est exprimé en
pixels **device**, pas en pixels CSS, parce que la fidélité visuelle est
gouvernée par la densité de samples par pixel physique : sur un écran
2× la limite acceptable double automatiquement.

### Régime enveloppe

Quand plusieurs samples tombent dans un même pixel device au-delà du seuil
détaillé, la waveform est rendue comme une enveloppe agrégée à partir d'une
pyramide précalculée. Sur le chemin chaud, on ne relit plus les samples
bruts.

Le régime enveloppe est rendu sous la forme d'une **bande remplie**
(`envelope-band`) : pour chaque bucket visible, on parcourt l'arête
supérieure (les `max[i]`) en sens forward, puis l'arête inférieure (les
`min[i]`) en sens backward, et on remplit le polygone fermé. Cette
représentation :

- évite l'effet « peigne » des barres verticales indépendantes à petite
  taille de bucket ;
- garde une amplitude lisible à toute taille de bucket ;
- coïncide visuellement avec le régime détaillé à la frontière (le
  régime détaillé pour un mono dégénéré donne lui-même une polyligne
  équivalente à la trace de la bande).

Le régime n'a plus de sous-régime `envelope-mean` : la moyenne arithmétique
par bucket s'annule asymptotiquement pour tout signal oscillant et ne
représente pas l'amplitude. Une `mean` peut subsister comme champ
auxiliaire pour des extensions futures, mais elle ne définit pas un mode
de rendu.

## Troisième décision

Le régime enveloppe repose sur une structure compacte par buckets.

La représentation canonique d’un bucket est :

- `min`
- `max`

sur une fenêtre contiguë d’échantillons **du signal mono mixdown** — cf.
[Neuvième décision](#neuvième-décision) — pas sur les canaux séparés.

La waveform officielle d’une ressource en régime enveloppe est donc une
collection de niveaux :

```text
ResourceWaveformPyramid
  levels: WaveformLevel[]

WaveformLevel
  samplesPerBucket
  mins         // min du mono sur le bucket
  maxs         // max du mono sur le bucket
  means?       // optionnel, réservé à des extensions futures
```

Le couple `min/max` est la donnée de référence. La rendu canonique
(`envelope-band`) en dérive directement. Le champ `means` est conservé en
option mais n'est plus la base d'un sous-régime de rendu.

## Quatrième décision

Les tailles de buckets utiles ne sont pas choisies par une pyramide arbitraire
en puissances de deux.

Elles sont dérivées des **niveaux exacts de zoom timeline** définis par
[EXACTZOOMSPEC.md](/Users/yannorlarey/Documents/Install/webdaw/EXACTZOOMSPEC.md).

La règle est :

- si `pixelsPerSample >= 1`, on reste en régime détaillé ;
- si `pixelsPerSample < 1`, alors :

```text
bucketSizeSamples = samplesPerPixel exact du niveau courant
```

Conséquences :

- la waveform agrégée reste stable quand on déplace un clip ;
- le changement de silhouette n’intervient qu’au changement de niveau de zoom ;
- la granularité waveform est exactement compatible avec la géométrie exacte de
  la timeline.

## Cinquième décision

L’analyse waveform reste attachée à la **ressource**, mais son rendu reste
attaché au **clip**.

Autrement dit, pour afficher un clip :

```text
resource
  -> niveau waveform choisi
  -> portion source utile
  -> projection dans le rectangle visible du clip
  -> rendu raster
```

Le bucket `0` du niveau waveform est toujours défini dans le repère source de
la ressource, pas dans un repère écran dépendant du viewport.

Donc :

- deux positions différentes du même clip ne changent pas sa silhouette ;
- deux clips différents référencant la même ressource réutilisent la même
  analyse ;
- seul le clipping visible change avec le viewport.

## Sixième décision

Les waveforms visibles ne sont pas rendues comme un arbre DOM.

Le DOM des clips reste léger et sert aux interactions. La waveform elle-même
est rendue dans la couche raster de fond décrite dans
[NEWFASTRENDERINGSPEC.md](/Users/yannorlarey/Documents/Install/webdaw/NEWFASTRENDERINGSPEC.md).

Conséquences :

- pas de nœud DOM par bucket ;
- pas de `div` par colonne ;
- pas de `canvas` par bucket ;
- pas de reconstruction DOM de la waveform à chaque frame.

## Septième décision

La disponibilité complète de la waveform ne doit jamais bloquer l’édition.

En particulier :

- le `drop` d’un clip doit être immédiat ;
- le rectangle du clip peut apparaître avant sa waveform ;
- la waveform est autorisée à apparaître plus tard, de manière asynchrone.

Le pipeline correct est donc :

```text
drop
  -> insertion immédiate du clip
  -> rendu immédiat du rectangle
  -> génération waveform en arrière-plan
  -> apparition différée de la waveform
```

## Huitième décision

Quand plusieurs niveaux waveform doivent être préparés, la priorité est
obligatoire :

1. d’abord le niveau correspondant au zoom courant ;
2. ensuite les niveaux voisins les plus probables ;
3. enfin le reste en tâche de fond.

Le but est de rendre utilement la waveform du niveau visible, pas de construire
immédiatement tous les niveaux.

## Neuvième décision

La waveform affichée est une **projection mono par moyenne arithmétique des
canaux** : la base de tous les calculs (régime détaillé comme régime
enveloppe) est le signal :

```text
mono(t) = (canal_0(t) + canal_1(t) + … + canal_{N-1}(t)) / N
```

Pour le régime détaillé, la polyligne traverse `mono(t)` sample par sample.
Pour le régime enveloppe, chaque bucket retient :

- `min = min(mono sur le bucket)`
- `max = max(mono sur le bucket)`

Cette décision garantit que les deux régimes lisent un signal identique :
à la frontière de zoom, la transition détaillé → enveloppe ne change pas
le contenu visuel, seulement sa granularité. Pour un mono d'entrée, c'est
trivialement le signal lui-même. Pour un stéréo corrélé, c'est la
moyenne. Pour un stéréo anti-corrélé, c'est zéro — les deux régimes
montrent silence cohéremment, plutôt que de présenter des données
incohérentes (l'ancien calcul de `min/max` cross-canaux donnait `±A` même
quand le mono était nul, créant une discordance visuelle entre les
régimes).

Cette décision concerne uniquement l’affichage. Elle ne change ni :

- le `AudioBuffer` original ;
- ni la lecture multicanale réelle.

## Dixième décision

Le coût de rendu visé est :

```text
RenderWaveformCost ≈ coût de la portion visible effectivement projetée
```

et non :

```text
RenderWaveformCost ≈ coût de tous les samples de la ressource
```

Autrement dit :

- le pan et le zoom ne doivent pas reconstruire la waveform depuis zéro si le
  niveau utile existe déjà ;
- la waveform doit être réutilisée comme donnée stable ;
- le chemin chaud ne doit recalculer que la projection visible et le clipping.

## Complément d’architecture

Le présent document fixe le contrat logique.

La représentation cible plus avancée du régime enveloppe, sous forme de
textures de données `min/max` réutilisables par le GPU, est décrite dans
[WAVEFORMTEXTURESPEC.md](/Users/yannorlarey/Documents/Install/webdaw/WAVEFORMTEXTURESPEC.md).

Cette représentation avancée reste cohérente avec la décision fondamentale du
présent document :

- la donnée waveform reste dérivée de la ressource ;
- le clip ne fait qu’en demander une projection visible ;
- la donnée canonique reste `min/max` calculée sur le signal mono.

## Hors portée immédiate

Ce document ne fixe pas encore :

- le backend GPU exact retenu ;
- le style graphique final détaillé de la waveform ;
- la politique d’éviction mémoire à long terme des niveaux waveform.
